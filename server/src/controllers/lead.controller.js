const path = require('path');
const fs = require('fs');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Lead = require('../models/Lead');
const RateItem = require('../models/RateItem');
const User = require('../models/User');
const Counter = require('../models/Counter');
const Setting = require('../models/Setting');
const { getPagination, buildMeta } = require('../utils/pagination');
const { searchRegex } = require('../utils/sanitize');
const { logActivity } = require('../services/activity.service');
const { notifyUser } = require('../services/push.service');
const { sendKitEmail } = require('../services/email.service');
const { generateKit, buildZip, getBrochureBuffer, BROCHURE_PATH, KITS_DIR } = require('../services/kit.service');
const ExportCountry = require('../models/ExportCountry');
const exportKitService = require('../services/exportKit.service');
const { INDIAN_CITIES, canonicalCity, stateForCity } = require('../config/indianCities');
const { uploadBuffer, deleteFiles, openDownloadStream, getBuffer } = require('../services/fileStore.service');
const { dlp, stockistPrice } = require('../config/kitContent');

const POPULATE = [
  { path: 'assignedExecId', select: 'name email employeeCode phone' },
  { path: 'createdBy', select: 'name role' },
  { path: 'statusHistory.changedBy', select: 'name role' },
  { path: 'notes.createdBy', select: 'name role' },
  { path: 'visitReports.createdBy', select: 'name role' },
  { path: 'instructions.createdBy', select: 'name role' },
  { path: 'instructions.doneBy', select: 'name role' },
  { path: 'crmHistory.by', select: 'name role' },
  { path: 'followUp.closedBy', select: 'name role' },
  { path: 'attachments.uploadedBy', select: 'name role' },
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Always copied on outgoing kit emails (in addition to any sender-added CCs).
const FIXED_KIT_CC = 'angadh.arora@cpgh.in';

/** Builds the next quotation reference: MKY-[CITY3]-[DDMMYY]-[###]. */
async function nextRefNumber(city) {
  const code = String(city || '')
    .replace(/[^a-zA-Z]/g, '')
    .slice(0, 3)
    .toUpperCase()
    .padEnd(3, 'X');
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  const key = `MKY-${code}-${dd}${mm}${yy}`;
  const seq = await Counter.next(key);
  return `${key}-${String(seq).padStart(3, '0')}`;
}

/**
 * Snapshot a priced line from a rate-master item (standard, un-overridden).
 *
 * Distributor card: the editable price is the DLP (Delivered Landed Price) =
 * the Basic rate, exclusive of GST. `basic` is the master net rate and `dsp`
 * (Distributor Selling Price) is the product's institutional rate, looked up by
 * SKU. Stockist card: the editable price is the Stockist Price = that same DLP
 * × 0.95; the DLP itself is fixed and re-derived from `basic` wherever it's
 * displayed. Institutional card: `netRate` is the editable net rate as before.
 * All rate-card prices are stated exclusive of GST — no GST is added anywhere.
 */
function snapshotLine(item, kitType, dspBySku) {
  const isStockist = kitType === 'stockist';
  const isDistLike = kitType === 'distributor' || isStockist;
  const basic = item.netRate;
  const dsp = isDistLike ? (dspBySku?.get(item.sku) || 0) : 0;
  // Distributor: DLP · Stockist: Stockist Price · Institutional: net rate.
  const netRate = isStockist
    ? stockistPrice(dlp(basic))
    : isDistLike
      ? dlp(basic)
      : basic;
  return {
    rateItemId: item._id,
    sku: item.sku,
    productName: item.productName,
    packSize: item.packSize,
    category: item.category || '',
    included: true,
    mrp: item.mrp,
    basic: isDistLike ? basic : 0,
    dsp,
    standardNetRate: netRate,
    netRate,
    suggestiveMargin: item.suggestiveMargin || 0,
    gst: item.gst,
    // Rate-card prices are exclusive of GST, so the dist-like cards carry the
    // editable price as-is (the field name is legacy); the institutional
    // quotation still derives its Net+GST display value.
    netInclGst: isDistLike ? netRate : round2(netRate * (1 + item.gst / 100)),
    deviationPct: 0,
  };
}

function scopeFilter(user) {
  if (user.role === 'admin') return {}; // admin sees all
  // Visibility follows the current owner, not the creator: reassigning a lead
  // (e.g. to an admin) moves it entirely off the previous owner's lists, even
  // if they created it.
  return { assignedExecId: user._id };
}

function assertCanView(lead, user) {
  if (user.role === 'admin') return;
  const uid = user._id.toString();
  const exec = lead.assignedExecId?._id?.toString() || lead.assignedExecId?.toString();
  if (exec === uid) return;
  throw ApiError.forbidden('You can only access your own leads');
}

/**
 * Once a kit is generated the lead is frozen until someone clicks "Edit" to
 * unlock it. This applies to everyone (incl. admin) — the unlock is the explicit
 * gate. Downloads/email are unaffected since they don't go through this check.
 */
function assertNotLocked(lead) {
  if (lead.locked) {
    throw ApiError.badRequest('This lead is locked. Click "Edit" to unlock it before making changes.');
  }
}

/**
 * Flag that a generated lead has been changed after the fact, so the UI can warn
 * that the client's kit is now out of date until it's regenerated.
 */
function markEditedIfGenerated(lead) {
  if (lead.generatedAt) lead.editedAfterGeneration = true;
}

/**
 * Merge an incoming customTerms payload onto the lead, keeping any field the
 * caller omitted. Shared by rate confirmation and (re)generation so an edited
 * price-card / agreement term is always persisted before the PDFs are built.
 */
function applyCustomTerms(lead, customTerms) {
  if (!customTerms) return;
  lead.customTerms = {
    paymentTerms: customTerms.paymentTerms ?? lead.customTerms.paymentTerms,
    creditPeriod: customTerms.creditPeriod ?? lead.customTerms.creditPeriod,
    termsAndConditions: customTerms.termsAndConditions ?? lead.customTerms.termsAndConditions,
    agreementTermsAndConditions:
      customTerms.agreementTermsAndConditions ?? lead.customTerms.agreementTermsAndConditions,
  };
}

/**
 * Web-push "a lead was assigned to you" to every device the new owner has
 * registered. Fire-and-forget (notifyUser never throws) and skipped when
 * someone assigns a lead to themselves. Tapping the notification opens the
 * lead directly.
 */
function pushAssignment(actor, ownerId, lead) {
  if (!ownerId || String(ownerId) === String(actor._id)) return;
  notifyUser(ownerId, {
    title: 'New lead assigned to you',
    body: `${lead.businessName} (${lead.refNumber}) — assigned by ${actor.name}`,
    url: `/leads/${lead._id}`,
    tag: `lead-${lead._id}`,
  });
}

async function resolveExecId(req, providedId) {
  // Everyone (exec, PR manager, admin) owns the leads they create and stays
  // owner until an admin reassigns. An admin may hand the lead to anyone —
  // a sales exec, a PR manager, or an admin (which hides it from everyone
  // else, since visibility follows the owner).
  if (!providedId || String(providedId) === String(req.user._id)) return req.user._id;
  if (req.user.role !== 'admin') return req.user._id;
  const owner = await User.findOne({
    _id: providedId,
    role: { $in: ['sales_exec', 'pr_manager', 'admin'] },
    isActive: true,
  });
  if (!owner) throw ApiError.badRequest('Assigned user not found or inactive');
  return owner._id;
}

async function buildKitFiles(lead) {
  const [exec, settings] = await Promise.all([User.findById(lead.assignedExecId), Setting.getGlobal()]);
  const oldFileIds = [
    lead.zipFile?.fileId,
    ...(lead.generatedFiles || []).map((f) => f.fileId),
  ].filter(Boolean);

  const result = await generateKit({ lead, exec, settings });
  const generatedFiles = [];

  for (let i = 0; i < result.files.length; i += 1) {
    const f = result.files[i];
    // Only the per-lead generated PDFs are stored in GridFS. Static assets (the
    // brochure) are served from disk, and the ZIP is assembled on demand at
    // download time — neither is persisted, keeping the DB footprint to a few KB
    // per lead instead of ~30 MB.
    let fileId = '';
    if (!f.static) {
      fileId = String(
        await uploadBuffer({
          buffer: f.buffer,
          filename: f.fileName,
          contentType: f.contentType,
          metadata: { leadId: String(lead._id), refNumber: lead.refNumber, docType: f.docType },
        })
      );
    }
    generatedFiles.push({
      docType: f.docType,
      label: f.label,
      fileName: f.fileName,
      fileId,
      url: `/api/leads/${lead._id}/documents/${i}`,
      static: !!f.static,
    });
  }

  lead.generatedFiles = generatedFiles;
  lead.zipFile = { fileName: result.zipName, fileId: '', url: `/api/leads/${lead._id}/kit.zip` };
  lead.generatedAt = new Date();
  if (oldFileIds.length) await deleteFiles(oldFileIds);
  return result;
}

/**
 * Materialise a lead's kit files as in-memory buffers: the per-lead PDFs come
 * from GridFS and the static brochure is read from disk. Used to assemble the
 * ZIP on demand and to attach the documents to the kit email.
 */
async function collectKitFiles(lead) {
  const out = [];
  for (const f of lead.generatedFiles || []) {
    if (f.static) {
      const buffer = getBrochureBuffer();
      if (buffer) out.push({ fileName: f.fileName, buffer, contentType: 'application/pdf' });
    } else if (f.fileId) {
      out.push({ fileName: f.fileName, buffer: await getBuffer(f.fileId), contentType: 'application/pdf' });
    }
  }
  return out;
}

function setDownloadHeaders(res, filename, contentType) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
}

/**
 * Rebuild a lead's stored PDFs if a referenced rate item was renamed after the
 * kit was generated (pdfStale). The snapshot already carries the new name, so
 * this only refreshes the documents' text — prices are unchanged. Called lazily
 * before any download/email so PDFs catch up the moment they are next used.
 */
async function ensureFreshKit(lead) {
  if (!lead.pdfStale || !lead.generatedAt) return;
  await buildKitFiles(lead);
  lead.pdfStale = false;
  await lead.save();
}

// POST /api/leads
const createLead = asyncHandler(async (req, res) => {
  const { assignedExecId, internalNotes, followUpDate, followUpNote, ...rest } = req.body;
  // Every stored city goes through the canonical Indian-city list, so one city
  // is always spelled one way ("mumbay" and "Bombay" both land as "Mumbai").
  rest.city = canonicalCity(rest.city);
  // The state follows the chosen city; a hand-entered state only survives for
  // cities off the Indian list (e.g. foreign cities on export leads).
  rest.state = stateForCity(rest.city) || String(rest.state || '').trim();
  const execId = await resolveExecId(req, assignedExecId);
  const refNumber = await nextRefNumber(rest.city);

  // A lead has one editable internal note.
  const initialNote = String(internalNotes || '').trim();

  // An optional first follow-up: a due date opens it, with an optional note.
  const followDate = followUpDate ? new Date(followUpDate) : null;

  const lead = await Lead.create({
    ...rest,
    assignedExecId: execId,
    refNumber,
    status: 'new',
    internalNotes: initialNote,
    followUp: followDate
      ? { note: String(followUpNote || '').trim(), date: followDate, status: 'open' }
      : undefined,
    notes: [],
    statusHistory: [{ from: null, to: 'new', changedBy: req.user._id, note: 'Lead created' }],
    createdBy: req.user._id,
    modifiedBy: req.user._id,
  });

  await logActivity({
    userId: req.user._id, action: 'LEAD_CREATED', entity: 'Lead', entityId: lead._id,
    details: `Created lead ${lead.refNumber} for "${lead.businessName}" (${lead.city})`, ip: req.ip,
  });
  pushAssignment(req.user, lead.assignedExecId, lead);

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.status(201).json({ success: true, data: populated });
});

// GET /api/cities — the city dropdown's options: the canonical Indian list
// plus any distinct city already stored on a lead (legacy or foreign values
// survive normalisation and stay selectable). With ?inUse=true it instead
// returns only the cities on leads the caller can see — the option set for the
// lead-list filter.
const listCities = asyncHandler(async (req, res) => {
  if (req.query.inUse === 'true') {
    const inUse = await Lead.distinct('city', scopeFilter(req.user));
    return res.json({ success: true, data: inUse.filter(Boolean).sort((a, b) => a.localeCompare(b)) });
  }
  const dbCities = await Lead.distinct('city');
  const all = [...new Set([...INDIAN_CITIES, ...dbCities.filter(Boolean)])].sort((a, b) =>
    a.localeCompare(b)
  );
  res.json({ success: true, data: all });
});

// GET /api/states — the lead-list State filter's option set: the distinct
// states on leads the caller can see (states are derived from the canonical
// city, so they need no canonicalisation of their own).
const listStates = asyncHandler(async (req, res) => {
  const inUse = await Lead.distinct('state', scopeFilter(req.user));
  res.json({ success: true, data: inUse.filter(Boolean).sort((a, b) => a.localeCompare(b)) });
});

// GET /api/leads/usage-options — the Daily usage filter's option set: the
// distinct Meta-form usage answers on leads the caller can see. Empty for
// callers whose leads carry none (the UI hides the filter then).
const listUsageOptions = asyncHandler(async (req, res) => {
  const inUse = await Lead.distinct('dailyUsage', scopeFilter(req.user));
  res.json({ success: true, data: inUse.filter(Boolean).sort((a, b) => a.localeCompare(b)) });
});

// GET /api/leads/creators — the "Created by" filter's option set: only the
// creators that actually appear on leads the caller can see, so an exec's
// dropdown never lists people who created none of their leads.
const listCreators = asyncHandler(async (req, res) => {
  const ids = (await Lead.distinct('createdBy', scopeFilter(req.user))).filter(Boolean);
  const creators = await User.find({ _id: { $in: ids } })
    .select('name role')
    .sort({ name: 1 });
  res.json({ success: true, data: creators });
});

// GET /api/leads
const listLeads = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = { ...scopeFilter(req.user) };
  const q = req.query;
  if (q.status) filter.status = q.status;
  if (q.kitType) filter.kitType = q.kitType;
  // Business type is multi-select in the UI: a comma-separated list means
  // "any of these"; a single value keeps the old exact match.
  if (q.businessType) {
    const types = String(q.businessType).split(',').map((s) => s.trim()).filter(Boolean);
    if (types.length === 1) filter.businessType = types[0];
    else if (types.length > 1) filter.businessType = { $in: types };
  }
  // Cities are stored canonically, so the filter is an exact value from the
  // dropdown — "Delhi" must not also match "New Delhi". States are derived
  // from the city, so they are exact values too.
  if (q.city) filter.city = q.city;
  // State is multi-select in the UI (state names never contain commas).
  if (q.state) {
    const statesWanted = String(q.state).split(',').map((s) => s.trim()).filter(Boolean);
    if (statesWanted.length === 1) filter.state = statesWanted[0];
    else if (statesWanted.length > 1) filter.state = { $in: statesWanted };
  }
  // Daily usage mirrors the business-type multi-select: comma-separated list
  // of the Meta form's exact answer values.
  if (q.dailyUsage) {
    const usages = String(q.dailyUsage).split(',').map((s) => s.trim()).filter(Boolean);
    if (usages.length === 1) filter.dailyUsage = usages[0];
    else if (usages.length > 1) filter.dailyUsage = { $in: usages };
  }
  if (q.execId && req.user.role === 'admin') filter.assignedExecId = q.execId;
  // Anyone may narrow their list by creator — the visibility scope above still
  // applies, so a non-admin only ever sees their own leads filtered further.
  if (q.createdBy) filter.createdBy = q.createdBy;
  if (q.dateFrom || q.dateTo) {
    filter.leadDate = {};
    if (q.dateFrom) filter.leadDate.$gte = new Date(q.dateFrom);
    if (q.dateTo) {
      const to = new Date(q.dateTo);
      to.setHours(23, 59, 59, 999);
      filter.leadDate.$lte = to;
    }
  }
  if (q.createdFrom || q.createdTo) {
    filter.createdAt = {};
    if (q.createdFrom) filter.createdAt.$gte = new Date(q.createdFrom);
    if (q.createdTo) {
      const to = new Date(q.createdTo);
      to.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = to;
    }
  }
  if (q.search) {
    const rx = searchRegex(q.search);
    filter.$or = [{ refNumber: rx }, { businessName: rx }, { contactPerson: rx }, { email: rx }, { mobileNumber: rx }];
  }

  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .populate({ path: 'assignedExecId', select: 'name email employeeCode' })
      .populate({ path: 'createdBy', select: 'name role' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Lead.countDocuments(filter),
  ]);
  res.json({ success: true, data: leads, meta: buildMeta(total, page, limit) });
});

// GET /api/leads/:id
const getLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id).populate(POPULATE);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);
  res.json({ success: true, data: lead });
});

// PUT /api/leads/:id  (client details — editable at any stage until the kit is generated/locked)
const updateLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);
  assertNotLocked(lead);

  const { assignedExecId, ...rest } = req.body;
  const prevOwner = String(lead.assignedExecId || '');
  if (assignedExecId && req.user.role === 'admin') {
    lead.assignedExecId = await resolveExecId(req, assignedExecId);
  }
  if (rest.city !== undefined) {
    rest.city = canonicalCity(rest.city);
    // Re-derive the state from the (possibly changed) city; a manual state is
    // only kept when the city isn't on the Indian list.
    const derived = stateForCity(rest.city);
    if (derived) rest.state = derived;
  }
  Object.assign(lead, rest);
  markEditedIfGenerated(lead);
  lead.modifiedBy = req.user._id;
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_UPDATED', entity: 'Lead', entityId: lead._id,
    details: `Updated lead ${lead.refNumber}`, ip: req.ip,
  });
  if (String(lead.assignedExecId) !== prevOwner) pushAssignment(req.user, lead.assignedExecId, lead);

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

// POST /api/leads/bulk-reassign  (admin — hand a batch of leads to any active user)
const bulkReassignLeads = asyncHandler(async (req, res) => {
  const { leadIds, assignedExecId } = req.body;
  // Unlike single-lead assignment (sales execs only), bulk reassignment may
  // target any active user — admins and PR managers own leads the same way.
  const target = await User.findOne({ _id: assignedExecId, isActive: true });
  if (!target) throw ApiError.badRequest('Selected user not found or inactive');

  const leads = await Lead.find({ _id: { $in: leadIds } }).select('refNumber businessName assignedExecId generatedAt');
  if (!leads.length) throw ApiError.notFound('No matching leads found');

  // Leads already owned by the target are left untouched (and not logged).
  const changed = leads.filter((l) => String(l.assignedExecId) !== String(target._id));
  const changedIds = changed.map((l) => l._id);

  if (changedIds.length) {
    await Lead.updateMany(
      { _id: { $in: changedIds } },
      { $set: { assignedExecId: target._id, modifiedBy: req.user._id } }
    );
    // Generated kit PDFs print the assigned exec's contact details, so flag
    // them stale — they're rebuilt with the new owner on next download/email.
    await Lead.updateMany(
      { _id: { $in: changedIds }, generatedAt: { $ne: null } },
      { $set: { pdfStale: true } }
    );
    await Promise.all(changed.map((l) => logActivity({
      userId: req.user._id, action: 'LEAD_REASSIGNED', entity: 'Lead', entityId: l._id,
      details: `Reassigned lead ${l.refNumber} to ${target.name}`, ip: req.ip,
    })));

    // One tap-through notification for a single lead; a summary that opens the
    // lead list when a batch was handed over.
    if (changed.length === 1) {
      pushAssignment(req.user, target._id, changed[0]);
    } else if (String(target._id) !== String(req.user._id)) {
      notifyUser(target._id, {
        title: `${changed.length} leads assigned to you`,
        body: `Assigned by ${req.user.name}`,
        url: '/leads',
        tag: 'bulk-assign',
      });
    }
  }

  res.json({
    success: true,
    message: `${changedIds.length} lead${changedIds.length === 1 ? '' : 's'} reassigned to ${target.name}`,
    data: { reassigned: changedIds.length, unchanged: leads.length - changedIds.length },
  });
});

// DELETE /api/leads/:id
const deleteLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);

  // Remove any generated kit files for this lead, including legacy disk files.
  const fileIds = [
    lead.zipFile?.fileId,
    ...(lead.generatedFiles || []).map((f) => f.fileId),
    ...(lead.attachments || []).map((a) => a.fileId),
  ].filter(Boolean);
  if (fileIds.length) await deleteFiles(fileIds);
  const dir = path.join(KITS_DIR, lead.refNumber);
  fs.rmSync(dir, { recursive: true, force: true });

  await lead.deleteOne();
  await logActivity({
    userId: req.user._id, action: 'LEAD_DELETED', entity: 'Lead', entityId: lead._id,
    details: `Deleted lead ${lead.refNumber}`, ip: req.ip,
  });
  res.json({ success: true, message: 'Lead deleted' });
});

// POST /api/leads/:id/kit-type  (select / switch kit, snapshot the rate master)
const selectKitType = asyncHandler(async (req, res) => {
  const { kitType } = req.body;
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);
  assertNotLocked(lead);
  if (lead.status === 'delivered') throw ApiError.badRequest('This lead has already been delivered');

  // The export kit has no upfront rate snapshot — its products, quantities and
  // shipment configuration are all chosen in the export step and snapshotted
  // when the shipment is confirmed. Selecting it just opens that step.
  if (kitType === 'export') {
    const from = lead.status;
    const settings = await Setting.getGlobal();
    lead.kitType = 'export';
    lead.rates = [];
    lead.rateEditLog = [];
    lead.exportConfig = lead.exportConfig?.countryId ? lead.exportConfig : undefined;
    lead.customTerms = {
      paymentTerms: settings.kit?.defaultPaymentTerms || '',
      creditPeriod: settings.kit?.defaultCreditPeriod || '',
    };
    lead.status = 'kit_selected';
    markEditedIfGenerated(lead);
    lead.modifiedBy = req.user._id;
    lead.statusHistory.push({ from, to: 'kit_selected', changedBy: req.user._id, note: 'Kit: export' });
    await lead.save();

    await logActivity({
      userId: req.user._id, action: 'LEAD_KIT_SELECTED', entity: 'Lead', entityId: lead._id,
      details: `${lead.refNumber}: selected export kit`, ip: req.ip,
    });
    const populated = await Lead.findById(lead._id).populate(POPULATE);
    return res.json({ success: true, data: populated });
  }

  // Stockist kits have no rate master of their own — they draw from the
  // distributor catalogue and derive the stockist price from the DLP.
  const masterKitType = kitType === 'stockist' ? 'distributor' : kitType;
  const items = await RateItem.find({ kitType: masterKitType, isActive: true }).sort({ productName: 1 });
  if (!items.length) throw ApiError.badRequest(`No active rate items in the ${masterKitType} rate master`);

  // The distributor/stockist card's DSP column is each product's institutional
  // rate, so pull the institutional master and map it by SKU for the snapshot.
  let dspBySku;
  if (masterKitType === 'distributor') {
    const instItems = await RateItem.find({ kitType: 'institutional', isActive: true }).select('sku netRate');
    dspBySku = new Map(instItems.map((i) => [i.sku, i.netRate]));
  }

  const settings = await Setting.getGlobal();
  const from = lead.status;
  lead.kitType = kitType;
  lead.rates = items.map((item) => snapshotLine(item, kitType, dspBySku));
  lead.rateEditLog = [];
  lead.exportConfig = undefined; // switching to a domestic kit drops any export snapshot
  lead.customTerms = {
    paymentTerms: settings.kit?.defaultPaymentTerms || '',
    creditPeriod: settings.kit?.defaultCreditPeriod || '',
  };
  lead.status = 'kit_selected';
  markEditedIfGenerated(lead);
  lead.modifiedBy = req.user._id;
  lead.statusHistory.push({ from, to: 'kit_selected', changedBy: req.user._id, note: `Kit: ${kitType}` });
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_KIT_SELECTED', entity: 'Lead', entityId: lead._id,
    details: `${lead.refNumber}: selected ${kitType} kit (${items.length} rates loaded)`, ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

// PUT /api/leads/:id/rates  (override + confirm rates)
const confirmRates = asyncHandler(async (req, res) => {
  const { rates = [], customTerms } = req.body;
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);
  assertNotLocked(lead);
  if (lead.kitType === 'export') throw ApiError.badRequest('Export leads are confirmed from the export shipment step');
  if (!lead.kitType || !lead.rates.length) throw ApiError.badRequest('Select a kit type before confirming rates');

  const overrideById = new Map(rates.map((r) => [String(r.rateItemId), r]));
  const edits = [];

  lead.rates = lead.rates.map((line) => {
    const override = overrideById.get(String(line.rateItemId));
    if (!override) return line;
    const included = override.included !== false;
    const newRate = round2(override.netRate);
    if (included && newRate > line.mrp) {
      throw ApiError.badRequest(`"${line.productName}": rate ${newRate} exceeds MRP ${line.mrp}`);
    }
    if (newRate !== line.netRate) {
      edits.push({ productName: line.productName, field: 'netRate', from: line.netRate, to: newRate, by: req.user._id });
    }
    const deviationPct =
      line.standardNetRate > 0 && newRate < line.standardNetRate
        ? round2(((line.standardNetRate - newRate) / line.standardNetRate) * 100)
        : 0;
    // For the distributor card the edited value is the DLP and for the stockist
    // card it's the Stockist Price — both stated exclusive of GST, like the
    // institutional net rates.
    const isDist = lead.kitType === 'distributor' || lead.kitType === 'stockist';
    return {
      ...line.toObject(),
      included,
      netRate: newRate,
      netInclGst: isDist ? newRate : round2(newRate * (1 + line.gst / 100)),
      deviationPct,
    };
  });
  const includedCount = lead.rates.filter((line) => line.included !== false).length;
  if (!includedCount) throw ApiError.badRequest('Include at least one product before confirming rates');

  applyCustomTerms(lead, customTerms);
  if (edits.length) lead.rateEditLog.push(...edits);

  const from = lead.status;
  lead.status = 'rates_confirmed';
  markEditedIfGenerated(lead);
  lead.modifiedBy = req.user._id;
  lead.statusHistory.push({
    from, to: 'rates_confirmed', changedBy: req.user._id,
    note: `${includedCount} product(s) included${edits.length ? ` · ${edits.length} rate override(s)` : ''}`,
  });
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_RATES_CONFIRMED', entity: 'Lead', entityId: lead._id,
    details: `${lead.refNumber}: confirmed ${includedCount} product rate(s)${edits.length ? ` with ${edits.length} override(s)` : ''}`, ip: req.ip,
  });

  // Finalizing the rates auto-(re)generates the kit, so the documents always
  // reflect the latest rates without a separate Generate step. Saved as two
  // steps so the confirmed rates persist even if the build fails.
  await buildKitFiles(lead);
  lead.status = from === 'delivered' ? 'delivered' : 'generated';
  lead.locked = true;
  lead.editedAfterGeneration = false;
  lead.modifiedBy = req.user._id;
  lead.statusHistory.push({
    from: 'rates_confirmed', to: lead.status, changedBy: req.user._id, note: 'Kit generated · locked',
  });
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_KIT_GENERATED', entity: 'Lead', entityId: lead._id,
    details: `${lead.refNumber}: generated ${lead.generatedFiles.length}-document ${lead.kitType} kit`, ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

// PUT /api/leads/:id/export-config  (confirm the export shipment: snapshot the
// selected products + the destination's commercials onto the lead, then
// auto-generate the kit — the export counterpart of confirmRates)
const confirmExportConfig = asyncHandler(async (req, res) => {
  const { rateType, loadingType, containerSize, countryId, currency, lines, customTerms } = req.body;
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);
  assertNotLocked(lead);
  if (lead.kitType !== 'export') throw ApiError.badRequest('Select the export kit before configuring a shipment');

  // FOB shipments are destination-independent (FOB Nhava Sheva) — no country
  // is collected for them; the destination-priced rate types require one.
  let country = null;
  if (rateType !== 'fob' || countryId) {
    country = await ExportCountry.findById(countryId);
    if (!country || !country.isActive) throw ApiError.badRequest('Unknown or inactive destination country');
  }

  // Resolve + validate every line against the backing master. Weights default
  // to the parsed pack size; a rate override is bounded by MRP like the
  // domestic kits and logged the same way.
  const edits = [];
  if (rateType === 'fob') {
    // FOB lines price off the cost master + standard mixed-load assumptions;
    // there is no MRP bound, and exports are zero-rated so gst stays 0. The
    // computed standard price doubles as the reference for deviation tracking.
    const settings = await Setting.getGlobal();
    const resolved = await exportKitService.resolveFobLines(
      lines,
      settings.export?.fob,
      exportKitService.fobVariantKey(loadingType, containerSize)
    );
    lead.rates = resolved.map((l) => {
      const netRate = round2(l.baseRateInr);
      if (netRate !== l.standardRateInr) {
        edits.push({ productName: l.productName, field: 'netRate', from: l.standardRateInr, to: netRate, by: req.user._id });
      }
      const deviationPct =
        l.standardRateInr > 0 && netRate < l.standardRateInr
          ? round2(((l.standardRateInr - netRate) / l.standardRateInr) * 100)
          : 0;
      return {
        rateItemId: l.rateItemId,
        sku: l.sku,
        productName: l.productName,
        packSize: l.packSize,
        category: l.category || '',
        included: true,
        mrp: l.standardRateInr,
        basic: 0,
        dsp: 0,
        standardNetRate: l.standardRateInr,
        netRate,
        suggestiveMargin: 0,
        gst: 0,
        netInclGst: netRate,
        deviationPct,
        qty: l.qty,
        unitWeightKg: l.unitWeightKg || 0,
      };
    });
  } else {
  const resolved = await exportKitService.resolveLines(rateType, lines);
  lead.rates = resolved.map((l) => {
    const item = l.item;
    const netRate = round2(l.baseRateInr);
    if (netRate > item.mrp) {
      throw ApiError.badRequest(`"${item.productName}": rate ${netRate} exceeds MRP ${item.mrp}`);
    }
    if (netRate !== item.netRate) {
      edits.push({ productName: item.productName, field: 'netRate', from: item.netRate, to: netRate, by: req.user._id });
    }
    const deviationPct =
      item.netRate > 0 && netRate < item.netRate
        ? round2(((item.netRate - netRate) / item.netRate) * 100)
        : 0;
    return {
      rateItemId: item._id,
      sku: item.sku,
      productName: item.productName,
      packSize: item.packSize,
      category: item.category || '',
      included: true,
      mrp: item.mrp,
      basic: 0,
      dsp: 0,
      standardNetRate: item.netRate,
      netRate,
      suggestiveMargin: item.suggestiveMargin || 0,
      gst: item.gst,
      // Exports are zero-rated under GST, so the line carries the base rate.
      netInclGst: netRate,
      deviationPct,
      qty: l.qty,
      unitWeightKg: l.unitWeightKg || 0,
    };
  });
  }

  lead.exportConfig = {
    rateType,
    loadingType,
    containerSize: loadingType === 'full' ? containerSize : '',
    currency,
    countryId: country?._id,
    countryName: country?.name || '',
    countryCode: country?.code || '',
    cirPercent: country?.cirPercent || 0,
    partLoadFreightPerKg: country?.partLoadFreightPerKg || 0,
  };
  applyCustomTerms(lead, customTerms);
  if (edits.length) lead.rateEditLog.push(...edits);

  // Validate the whole shipment (part-load weights, container, FX) by computing
  // the card once before anything is persisted.
  const card = await exportKitService.computeRateCardFromLead(lead);

  const from = lead.status;
  lead.status = 'rates_confirmed';
  markEditedIfGenerated(lead);
  lead.modifiedBy = req.user._id;
  lead.statusHistory.push({
    from, to: 'rates_confirmed', changedBy: req.user._id,
    note:
      `Export shipment: ${country ? `${country.name} · ` : ''}` +
      `${rateType === 'fob'
        ? `FOB (${card.config.fob?.label || 'standard mixed load'})`
        : loadingType === 'full' ? `full load (${card.config.container?.label || containerSize})` : 'part load'} · ` +
      `${lead.rates.length} product(s) · ${currency}`,
  });
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_RATES_CONFIRMED', entity: 'Lead', entityId: lead._id,
    details:
      `${lead.refNumber}: confirmed export shipment${country ? ` to ${country.name}` : ' (FOB)'} ` +
      `(${lead.rates.length} product(s), ${currency}${edits.length ? `, ${edits.length} rate override(s)` : ''})`,
    ip: req.ip,
  });

  // Finalizing the shipment auto-(re)generates the kit, mirroring confirmRates.
  await buildKitFiles(lead);
  lead.status = from === 'delivered' ? 'delivered' : 'generated';
  lead.locked = true;
  lead.editedAfterGeneration = false;
  lead.modifiedBy = req.user._id;
  lead.statusHistory.push({
    from: 'rates_confirmed', to: lead.status, changedBy: req.user._id, note: 'Kit generated · locked',
  });
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_KIT_GENERATED', entity: 'Lead', entityId: lead._id,
    details: `${lead.refNumber}: generated ${lead.generatedFiles.length}-document export kit`, ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

// POST /api/leads/:id/generate  (build the PDFs + ZIP)
const generateLeadKit = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);
  assertNotLocked(lead);
  if (!['rates_confirmed', 'generated', 'delivered'].includes(lead.status)) {
    throw ApiError.badRequest('Confirm the rates before generating the kit');
  }

  // Persist any terms edited since the last save so the rebuilt PDFs reflect
  // them — without this, regenerating rebuilds from the previously-saved terms.
  applyCustomTerms(lead, req.body?.customTerms);

  await buildKitFiles(lead);
  const from = lead.status;
  if (from !== 'delivered') lead.status = 'generated';
  // Freeze the lead now that a fresh kit exists; the data is back in sync.
  lead.locked = true;
  lead.editedAfterGeneration = false;
  lead.modifiedBy = req.user._id;
  lead.statusHistory.push({ from, to: lead.status, changedBy: req.user._id, note: 'Kit generated · locked' });
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_KIT_GENERATED', entity: 'Lead', entityId: lead._id,
    details: `${lead.refNumber}: generated ${lead.generatedFiles.length}-document ${lead.kitType} kit`, ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

// PUT /api/leads/:id/terms  (save edited price-card / agreement terms on their
// own; rebuild the kit in place when one already exists so the documents reflect
// the saved terms straight away)
const saveTerms = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);
  assertNotLocked(lead);
  if (!lead.kitType) throw ApiError.badRequest('Select a kit type before editing its terms');

  applyCustomTerms(lead, req.body.customTerms);
  lead.modifiedBy = req.user._id;

  // If a kit was already generated, regenerate so the saved terms appear in the
  // PDFs immediately; otherwise just persist them for the next generation.
  const hadKit = (lead.generatedFiles || []).length > 0;
  if (hadKit) {
    await buildKitFiles(lead);
    lead.editedAfterGeneration = false;
  }
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_TERMS_SAVED', entity: 'Lead', entityId: lead._id,
    details: hadKit
      ? `${lead.refNumber}: saved terms and rebuilt the kit`
      : `${lead.refNumber}: saved terms`,
    ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

// POST /api/leads/:id/unlock  (re-open a generated/locked lead for editing)
const unlockLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user); // owner or admin

  if (lead.locked) {
    lead.locked = false;
    lead.modifiedBy = req.user._id;
    lead.statusHistory.push({
      from: lead.status, to: lead.status, changedBy: req.user._id, note: 'Unlocked for editing',
    });
    await lead.save();

    await logActivity({
      userId: req.user._id, action: 'LEAD_UNLOCKED', entity: 'Lead', entityId: lead._id,
      details: `${lead.refNumber}: unlocked for editing after generation`, ip: req.ip,
    });
  }

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

/** A note may be edited/deleted by its author or any admin. Notes are
 *  collaboration metadata, so they're never frozen by the kit lock. */
function assertCanModifyNote(note, user) {
  if (user.role === 'admin') return;
  if (String(note.createdBy) !== String(user._id)) {
    throw ApiError.forbidden('You can only edit or delete your own notes');
  }
}

// POST /api/leads/:id/notes  (create or replace the single internal note)
const addNote = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);

  const text = String(req.body.text || '').trim();
  if (!text) throw ApiError.badRequest('Note text is required');

  lead.internalNotes = text;
  lead.notes = [];
  lead.modifiedBy = req.user._id;
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_NOTE_UPDATED', entity: 'Lead', entityId: lead._id,
    details: `Updated the internal note on ${lead.refNumber}`, ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

// PUT /api/leads/:id/notes/:noteId  (edit an internal note)
const updateNote = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);

  const note = lead.notes.id(req.params.noteId);
  if (!note) throw ApiError.notFound('Note not found');
  assertCanModifyNote(note, req.user);

  const text = String(req.body.text || '').trim();
  if (!text) throw ApiError.badRequest('Note text is required');

  note.text = text;
  lead.modifiedBy = req.user._id;
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_NOTE_UPDATED', entity: 'Lead', entityId: lead._id,
    details: `Edited an internal note on ${lead.refNumber}`, ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

// DELETE /api/leads/:id/notes/:noteId  (remove an internal note)
const deleteNote = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);

  const note = lead.notes.id(req.params.noteId);
  if (!note) throw ApiError.notFound('Note not found');
  assertCanModifyNote(note, req.user);

  lead.notes.pull(note._id);
  lead.modifiedBy = req.user._id;
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_NOTE_DELETED', entity: 'Lead', entityId: lead._id,
    details: `Deleted an internal note from ${lead.refNumber}`, ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

/** A visit report may be edited/deleted by its author or any admin. Like
 *  notes, visits are CRM metadata and are never frozen by the kit lock. */
function assertCanModifyVisit(visit, user) {
  if (user.role === 'admin') return;
  if (String(visit.createdBy) !== String(user._id)) {
    throw ApiError.forbidden('You can only edit or delete your own visit reports');
  }
}

// POST /api/leads/:id/visit-reports  (record a client visit; optionally derive
// the lead's next follow-up and action point from the meeting's outcome)
const addVisitReport = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);

  const note = String(req.body.note || '').trim();
  if (!note) throw ApiError.badRequest('Visit note is required');
  if (!req.body.visitDate) throw ApiError.badRequest('Visit date is required');
  const visitDate = new Date(req.body.visitDate);

  lead.visitReports.push({ visitDate, note, createdBy: req.user._id });

  // Derived follow-up: scheduling needs a date — a follow-up note without one
  // is ignored rather than wiping any follow-up already on the lead.
  const followUpDate = req.body.followUpDate ? new Date(req.body.followUpDate) : null;
  if (followUpDate) {
    lead.followUp = {
      note: String(req.body.followUpNote || '').trim(),
      date: followUpDate,
      status: 'open',
      closingNote: '',
      closedAt: undefined,
      closedBy: undefined,
    };
  }

  // Derived action point: same archival rule as setActionPoint, so replacing
  // the previous value keeps its history trail.
  const actionPoint = String(req.body.actionPoint || '');
  if (actionPoint) {
    if (lead.actionPoint && lead.actionPoint !== actionPoint) {
      lead.crmHistory.push({ type: 'action_point', summary: lead.actionPoint, by: req.user._id });
    }
    lead.actionPoint = actionPoint;
  }

  lead.modifiedBy = req.user._id;
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_VISIT_ADDED', entity: 'Lead', entityId: lead._id,
    details: `Added a visit report on ${lead.refNumber} (visited ${visitDate.toISOString().slice(0, 10)})`,
    ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.status(201).json({ success: true, data: populated });
});

// PUT /api/leads/:id/visit-reports/:visitId  (edit a visit's date / note)
const updateVisitReport = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);

  const visit = lead.visitReports.id(req.params.visitId);
  if (!visit) throw ApiError.notFound('Visit report not found');
  assertCanModifyVisit(visit, req.user);

  const note = String(req.body.note || '').trim();
  if (!note) throw ApiError.badRequest('Visit note is required');
  if (!req.body.visitDate) throw ApiError.badRequest('Visit date is required');

  visit.visitDate = new Date(req.body.visitDate);
  visit.note = note;
  lead.modifiedBy = req.user._id;
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_VISIT_UPDATED', entity: 'Lead', entityId: lead._id,
    details: `Edited a visit report on ${lead.refNumber}`, ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

// DELETE /api/leads/:id/visit-reports/:visitId  (remove a visit report)
const deleteVisitReport = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);

  const visit = lead.visitReports.id(req.params.visitId);
  if (!visit) throw ApiError.notFound('Visit report not found');
  assertCanModifyVisit(visit, req.user);

  lead.visitReports.pull(visit._id);
  lead.modifiedBy = req.user._id;
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_VISIT_DELETED', entity: 'Lead', entityId: lead._id,
    details: `Deleted a visit report from ${lead.refNumber}`, ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

// POST /api/leads/:id/instructions  (admin adds a directive for the assigned exec)
const addInstruction = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  // Instructions flow admin -> exec, so only admins author them (also gated on
  // the route). Anyone who can view the lead may later mark them done.
  if (req.user.role !== 'admin') throw ApiError.forbidden('Only admins can add instructions');

  const text = String(req.body.text || '').trim();
  if (!text) throw ApiError.badRequest('Instruction text is required');

  lead.instructions.push({ text, status: 'open', createdBy: req.user._id });
  lead.modifiedBy = req.user._id;
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_INSTRUCTION_ADDED', entity: 'Lead', entityId: lead._id,
    details: `Added an instruction to ${lead.refNumber}`, ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.status(201).json({ success: true, data: populated });
});

// POST /api/leads/:id/instructions/:instrId/done  (assigned exec or admin closes it)
const closeInstruction = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user); // the lead's owner exec, or an admin

  const instr = lead.instructions.id(req.params.instrId);
  if (!instr) throw ApiError.notFound('Instruction not found');
  if (instr.status !== 'open') throw ApiError.badRequest('This instruction is already done');

  instr.status = 'done';
  instr.doneBy = req.user._id;
  instr.doneAt = new Date();
  lead.modifiedBy = req.user._id;
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_INSTRUCTION_DONE', entity: 'Lead', entityId: lead._id,
    details: `Marked an instruction done on ${lead.refNumber}`, ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

// DELETE /api/leads/:id/instructions/:instrId  (admin removes an instruction)
const deleteInstruction = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  if (req.user.role !== 'admin') throw ApiError.forbidden('Only admins can delete instructions');

  const instr = lead.instructions.id(req.params.instrId);
  if (!instr) throw ApiError.notFound('Instruction not found');
  lead.instructions.pull(instr._id);
  lead.modifiedBy = req.user._id;
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_INSTRUCTION_DELETED', entity: 'Lead', entityId: lead._id,
    details: `Deleted an instruction from ${lead.refNumber}`, ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

// GET /api/instructions  (leads with an open instruction, scoped to the user)
const listInstructions = asyncHandler(async (req, res) => {
  const filter = { ...scopeFilter(req.user), 'instructions.status': 'open' };
  const leads = await Lead.find(filter)
    .populate({ path: 'assignedExecId', select: 'name email employeeCode' })
    .populate({ path: 'instructions.createdBy', select: 'name role' })
    .sort({ updatedAt: -1 })
    .limit(500);
  res.json({ success: true, data: leads });
});

// GET /api/follow-ups  (leads with an open follow-up, soonest due first)
const listFollowUps = asyncHandler(async (req, res) => {
  const filter = { ...scopeFilter(req.user), 'followUp.status': 'open' };
  const leads = await Lead.find(filter)
    .populate({ path: 'assignedExecId', select: 'name email employeeCode' })
    .sort({ 'followUp.date': 1 })
    .limit(500);
  res.json({ success: true, data: leads });
});

// GET /api/action-points  (leads with an open action point, most recently set first)
const listActionPoints = asyncHandler(async (req, res) => {
  const filter = { ...scopeFilter(req.user), actionPoint: { $in: Lead.ACTION_POINTS } };
  const leads = await Lead.find(filter)
    .populate({ path: 'assignedExecId', select: 'name email employeeCode' })
    .sort({ updatedAt: -1 })
    .limit(500);
  res.json({ success: true, data: leads });
});

// PUT /api/leads/:id/action-point  (set / clear the lead's next action)
const setActionPoint = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);

  const actionPoint = String(req.body.actionPoint || '');
  // Archive the outgoing action point so clearing/changing it leaves a history
  // trail (the previous value is otherwise lost).
  const prev = lead.actionPoint;
  if (prev && prev !== actionPoint) {
    lead.crmHistory.push({ type: 'action_point', summary: prev, by: req.user._id });
  }
  lead.actionPoint = actionPoint;
  lead.modifiedBy = req.user._id;
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_ACTION_POINT_SET', entity: 'Lead', entityId: lead._id,
    details: actionPoint
      ? `Set action point for ${lead.refNumber} — ${actionPoint}`
      : `Cleared action point for ${lead.refNumber}`,
    ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

// PUT /api/leads/:id/follow-up  (set / update the follow-up date + note)
const updateFollowUp = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);

  const note = String(req.body.note || '').trim();
  const date = req.body.date ? new Date(req.body.date) : null;

  // Saving (re)opens the follow-up; clearing the date removes it entirely.
  lead.followUp = {
    note,
    date: date || undefined,
    status: date ? 'open' : '',
    closingNote: '',
    closedAt: undefined,
    closedBy: undefined,
  };
  lead.modifiedBy = req.user._id;
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_FOLLOWUP_SET', entity: 'Lead', entityId: lead._id,
    details: date
      ? `Set follow-up for ${lead.refNumber} due ${date.toISOString().slice(0, 10)}`
      : `Cleared follow-up for ${lead.refNumber}`,
    ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

// POST /api/leads/:id/follow-up/close  (close an open follow-up with a note)
const closeFollowUp = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);

  if (lead.followUp?.status !== 'open') {
    throw ApiError.badRequest('There is no open follow-up to close');
  }
  const closingNote = String(req.body.closingNote || '').trim();
  if (!closingNote) throw ApiError.badRequest('A closing note is required');

  lead.followUp.status = 'closed';
  lead.followUp.closingNote = closingNote;
  lead.followUp.closedAt = new Date();
  lead.followUp.closedBy = req.user._id;
  // Archive the closed follow-up so the lead keeps a history of past ones (the
  // single followUp slot is overwritten when the next one is scheduled).
  lead.crmHistory.push({
    type: 'follow_up',
    summary: lead.followUp.note || '',
    note: closingNote,
    date: lead.followUp.date,
    by: req.user._id,
  });
  lead.modifiedBy = req.user._id;
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_FOLLOWUP_CLOSED', entity: 'Lead', entityId: lead._id,
    details: `Closed follow-up for ${lead.refNumber}`, ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

// POST /api/leads/:id/attachments  (manual file upload — photos, PDFs, sheets)
const uploadAttachments = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);

  const files = req.files || [];
  if (!files.length) throw ApiError.badRequest('No files were uploaded');

  for (const f of files) {
    const fileId = await uploadBuffer({
      buffer: f.buffer,
      filename: f.originalname,
      contentType: f.mimetype,
      metadata: { leadId: String(lead._id), refNumber: lead.refNumber, docType: 'Attachment' },
    });
    lead.attachments.push({
      fileName: f.originalname,
      fileId: String(fileId),
      contentType: f.mimetype,
      size: f.size,
      uploadedBy: req.user._id,
    });
  }
  lead.modifiedBy = req.user._id;
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_ATTACHMENT_ADDED', entity: 'Lead', entityId: lead._id,
    details: `Uploaded ${files.length} file(s) to ${lead.refNumber}`, ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.status(201).json({ success: true, data: populated });
});

// GET /api/leads/:id/attachments/:attId  (stream inline for preview / download)
const downloadAttachment = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);

  const att = lead.attachments.id(req.params.attId);
  if (!att || !att.fileId) throw ApiError.notFound('Attachment not found');

  res.setHeader('Content-Type', att.contentType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${String(att.fileName).replace(/"/g, '')}"`);
  return openDownloadStream(att.fileId).pipe(res);
});

// PATCH /api/leads/:id/attachments/:attId  (rename the stored file name)
const renameAttachment = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);

  const att = lead.attachments.id(req.params.attId);
  if (!att) throw ApiError.notFound('Attachment not found');

  const fileName = String(req.body?.fileName || '').trim();
  if (!fileName) throw ApiError.badRequest('File name is required');

  // Keep the original extension when the new name omits one, so previews
  // and downloads still open with the right type.
  const oldName = att.fileName;
  const oldExt = (String(oldName).match(/\.[A-Za-z0-9]+$/) || [''])[0];
  const hasExt = /\.[A-Za-z0-9]+$/.test(fileName);
  att.fileName = !hasExt && oldExt ? fileName + oldExt : fileName;
  lead.modifiedBy = req.user._id;
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_ATTACHMENT_RENAMED', entity: 'Lead', entityId: lead._id,
    details: `Renamed attachment "${oldName}" to "${att.fileName}" on ${lead.refNumber}`, ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

// DELETE /api/leads/:id/attachments/:attId
const deleteAttachment = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);

  const att = lead.attachments.id(req.params.attId);
  if (!att) throw ApiError.notFound('Attachment not found');
  if (att.fileId) await deleteFiles([att.fileId]);
  lead.attachments.pull(att._id);
  lead.modifiedBy = req.user._id;
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_ATTACHMENT_DELETED', entity: 'Lead', entityId: lead._id,
    details: `Deleted attachment "${att.fileName}" from ${lead.refNumber}`, ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

// GET /api/leads/:id/kit.zip
const downloadZip = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);
  if (!lead.generatedFiles?.length) throw ApiError.badRequest('Generate the kit before downloading it');
  await ensureFreshKit(lead);

  // Rebuild if any per-lead PDF is missing from storage (e.g. a legacy lead) so
  // every document is available before zipping.
  if (lead.generatedFiles.some((f) => !f.static && !f.fileId)) {
    await buildKitFiles(lead);
    await lead.save();
  }

  // The ZIP is assembled on the fly from the stored PDFs + the on-disk brochure,
  // so no (large, redundant) archive is ever persisted in the database.
  const entries = await collectKitFiles(lead);
  const zipBuffer = await buildZip(entries);

  await logActivity({
    userId: req.user._id, action: 'LEAD_KIT_DOWNLOADED', entity: 'Lead', entityId: lead._id,
    details: `Downloaded kit ZIP for ${lead.refNumber}`, ip: req.ip,
  });
  setDownloadHeaders(res, lead.zipFile?.fileName || `MickysSalesKit_${lead.refNumber}.zip`, 'application/zip');
  res.send(zipBuffer);
});

// GET /api/leads/:id/documents/:idx
const downloadDocument = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);
  await ensureFreshKit(lead);

  const file = lead.generatedFiles[Number(req.params.idx)];
  if (!file) throw ApiError.notFound('Document not found');

  // The brochure is a static asset served straight from disk — never stored in
  // the database, so it's handled before any GridFS lookup.
  if (file.static) {
    if (!fs.existsSync(BROCHURE_PATH)) throw ApiError.notFound('Brochure is not available');
    setDownloadHeaders(res, file.fileName, 'application/pdf');
    return fs.createReadStream(BROCHURE_PATH).pipe(res);
  }

  if (file.fileId) {
    setDownloadHeaders(res, file.fileName, 'application/pdf');
    return openDownloadStream(file.fileId).pipe(res);
  }

  // No stored copy (legacy lead) — rebuild the kit, then stream the fresh PDF.
  await buildKitFiles(lead);
  await lead.save();
  const rebuilt = lead.generatedFiles[Number(req.params.idx)];
  if (!rebuilt?.fileId) throw ApiError.badRequest('Regenerate the kit — file is missing');
  setDownloadHeaders(res, rebuilt.fileName, 'application/pdf');
  return openDownloadStream(rebuilt.fileId).pipe(res);
});

// POST /api/leads/:id/email  (send the kit to the client)
const emailKit = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);
  if (!lead.generatedFiles?.length) throw ApiError.badRequest('Generate the kit before emailing it');
  await ensureFreshKit(lead);

  // Rebuild if any per-lead PDF is missing from storage (the static brochure has
  // no fileId by design — it's attached from disk below).
  if (lead.generatedFiles.some((f) => !f.static && !f.fileId)) {
    await buildKitFiles(lead);
    await lead.save();
  }

  // Per-lead PDFs are pulled from GridFS; the brochure rides along from disk.
  const generatedFiles = (
    await Promise.all(
      lead.generatedFiles.map(async (f) => {
        if (f.static) {
          return fs.existsSync(BROCHURE_PATH) ? { filename: f.fileName, path: BROCHURE_PATH } : null;
        }
        return { filename: f.fileName, content: await getBuffer(f.fileId) };
      })
    )
  ).filter(Boolean);

  // Manually uploaded attachments (photos, PDFs, sheets) ride along with the kit.
  const attachmentFiles = await Promise.all(
    (lead.attachments || [])
      .filter((a) => a.fileId)
      .map(async (a) => ({
        filename: a.fileName,
        content: await getBuffer(a.fileId),
        contentType: a.contentType || undefined,
      }))
  );

  const files = [...generatedFiles, ...attachmentFiles];

  // angadh.arora@cpgh.in is always CC'd on every kit email; any addresses the
  // sender adds are appended. Deduped case-insensitively so it is never doubled.
  const extraCc = String(req.body.cc || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  const cc = [FIXED_KIT_CC, ...extraCc].filter(
    (e, i, arr) => arr.findIndex((x) => x.toLowerCase() === e.toLowerCase()) === i
  );

  const [exec, settings] = await Promise.all([User.findById(lead.assignedExecId), Setting.getGlobal()]);
  const result = await sendKitEmail({
    lead, exec,
    actingUser: req.user, // their linked mailbox (if any) becomes the sender
    to: req.body.to || lead.email,
    cc: cc.length ? cc : undefined,
    subject: req.body.subject,
    message: req.body.message,
    files,
    bcc: settings.email?.kitInbox || undefined,
  });
  if (result.skipped) {
    throw ApiError.badRequest(
      result.reason === 'No recipient email'
        ? 'No recipient email on this lead.'
        : result.reason === 'disabled'
          ? 'Email sending is disabled in Settings.'
          : 'No email account is available. Link your official mailbox under Email settings (user menu), or ask an admin to configure the company account.'
    );
  }

  const from = lead.status;
  lead.status = 'delivered';
  lead.delivery = {
    method: 'email',
    sentTo: req.body.to || lead.email,
    sentAt: new Date(),
    status: 'sent',
    messageId: result.messageId || '',
  };
  lead.modifiedBy = req.user._id;
  // Keep an exact record of what was emailed (recipients, subject, body and
  // attachment names) so it can be reviewed in-app without a mailbox copy.
  lead.emailLog.push({
    to: result.to || req.body.to || lead.email,
    from: result.from || '',
    sentVia: result.sentVia || '',
    cc: result.cc || cc || [],
    bcc: result.bcc || [],
    subject: result.subject || req.body.subject || '',
    message: req.body.message || '',
    bodyHtml: result.html || '',
    attachments: result.attachments || [],
    provider: result.provider || '',
    status: 'sent',
    messageId: result.messageId || '',
    sentBy: req.user._id,
  });
  if (from !== 'delivered') lead.statusHistory.push({ from, to: 'delivered', changedBy: req.user._id, note: 'Kit emailed' });
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_KIT_EMAILED', entity: 'Lead', entityId: lead._id,
    details: `${lead.refNumber}: emailed kit to ${lead.delivery.sentTo}`, ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

// POST /api/leads/:id/deliver-manual  (record that the kit was handed over outside email)
const markDelivered = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);
  if (!lead.generatedFiles?.length) throw ApiError.badRequest('Generate the kit before marking it delivered');

  const note = String(req.body.note || '').trim();
  const sentTo = String(req.body.sentTo || '').trim();

  const from = lead.status;
  lead.status = 'delivered';
  lead.delivery = {
    method: 'manual',
    sentTo,
    sentAt: new Date(),
    status: 'sent',
    messageId: '',
    note,
  };
  lead.modifiedBy = req.user._id;
  if (from !== 'delivered') {
    lead.statusHistory.push({
      from, to: 'delivered', changedBy: req.user._id,
      note: note ? `Manually delivered — ${note}` : 'Manually delivered',
    });
  }
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_KIT_DELIVERED_MANUAL', entity: 'Lead', entityId: lead._id,
    details: `${lead.refNumber}: marked kit manually delivered${note ? ` (${note})` : ''}`, ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
});

module.exports = {
  listCities,
  listStates,
  listUsageOptions,
  listCreators,
  createLead,
  listLeads,
  getLead,
  updateLead,
  bulkReassignLeads,
  deleteLead,
  selectKitType,
  confirmRates,
  confirmExportConfig,
  generateLeadKit,
  saveTerms,
  unlockLead,
  addNote,
  updateNote,
  deleteNote,
  addVisitReport,
  updateVisitReport,
  deleteVisitReport,
  addInstruction,
  closeInstruction,
  deleteInstruction,
  listInstructions,
  listFollowUps,
  listActionPoints,
  setActionPoint,
  updateFollowUp,
  closeFollowUp,
  uploadAttachments,
  downloadAttachment,
  renameAttachment,
  deleteAttachment,
  downloadZip,
  downloadDocument,
  emailKit,
  markDelivered,
};
