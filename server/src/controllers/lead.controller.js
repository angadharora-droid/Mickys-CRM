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
const { sendKitEmail } = require('../services/email.service');
const { generateKit, KITS_DIR } = require('../services/kit.service');
const { uploadBuffer, deleteFiles, openDownloadStream, getBuffer } = require('../services/fileStore.service');

const POPULATE = [
  { path: 'assignedExecId', select: 'name email employeeCode phone' },
  { path: 'createdBy', select: 'name role' },
  { path: 'statusHistory.changedBy', select: 'name role' },
  { path: 'notes.createdBy', select: 'name role' },
  { path: 'instructions.createdBy', select: 'name role' },
  { path: 'instructions.doneBy', select: 'name role' },
  { path: 'crmHistory.by', select: 'name role' },
  { path: 'followUp.closedBy', select: 'name role' },
  { path: 'attachments.uploadedBy', select: 'name role' },
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const roundTo10 = (n) => Math.round((Number(n) || 0) / 10) * 10;

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
 * Basic + GST rounded to the nearest ₹10. `basic` is the master net rate and
 * `dsp` (Distributor Selling Price) is the product's institutional rate, looked
 * up by SKU. Institutional card: `netRate` is the editable net rate as before.
 */
function snapshotLine(item, kitType, dspBySku) {
  const isDist = kitType === 'distributor';
  const basic = item.netRate;
  const dsp = isDist ? (dspBySku?.get(item.sku) || 0) : 0;
  // DLP for distributor (rounded landed price); plain net rate for institutional.
  const netRate = isDist ? roundTo10(basic * (1 + item.gst / 100)) : basic;
  return {
    rateItemId: item._id,
    sku: item.sku,
    productName: item.productName,
    packSize: item.packSize,
    category: item.category || '',
    included: true,
    mrp: item.mrp,
    basic: isDist ? basic : 0,
    dsp,
    standardNetRate: netRate,
    netRate,
    suggestiveMargin: item.suggestiveMargin || 0,
    gst: item.gst,
    // DLP already includes GST; institutional net rate is pre-GST.
    netInclGst: isDist ? netRate : round2(netRate * (1 + item.gst / 100)),
    deviationPct: 0,
  };
}

function scopeFilter(user) {
  if (user.role === 'sales_exec') return { assignedExecId: user._id };
  return {}; // admin sees all
}

function assertCanView(lead, user) {
  if (user.role === 'admin') return;
  const uid = user._id.toString();
  const exec = lead.assignedExecId?._id?.toString() || lead.assignedExecId?.toString();
  if (exec !== uid) throw ApiError.forbidden('You can only access your own leads');
}

/** Client details are locked once a kit type is chosen (admin may still edit). */
function assertEditable(lead, user) {
  if (user.role === 'admin') return;
  if (lead.status !== 'new') {
    throw ApiError.badRequest('Client details are locked once a kit type is selected');
  }
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

async function resolveExecId(req, providedId) {
  // Everyone (exec, manager, admin) owns the leads they create. A manager/admin
  // may still explicitly assign a different sales exec by passing their id.
  if (!providedId || String(providedId) === String(req.user._id)) return req.user._id;
  if (req.user.role === 'sales_exec') return req.user._id;
  const exec = await User.findOne({ _id: providedId, role: 'sales_exec', isActive: true });
  if (!exec) throw ApiError.badRequest('Assigned sales executive not found or inactive');
  return exec._id;
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
    const fileId = await uploadBuffer({
      buffer: f.buffer,
      filename: f.fileName,
      contentType: f.contentType,
      metadata: { leadId: String(lead._id), refNumber: lead.refNumber, docType: f.docType },
    });
    generatedFiles.push({
      docType: f.docType,
      label: f.label,
      fileName: f.fileName,
      fileId: String(fileId),
      url: `/api/leads/${lead._id}/documents/${i}`,
      static: f.static,
    });
  }

  const zipId = await uploadBuffer({
    buffer: result.zip.buffer,
    filename: result.zip.fileName,
    contentType: result.zip.contentType,
    metadata: { leadId: String(lead._id), refNumber: lead.refNumber, docType: 'KitZip' },
  });

  lead.generatedFiles = generatedFiles;
  lead.zipFile = { fileName: result.zip.fileName, fileId: String(zipId), url: `/api/leads/${lead._id}/kit.zip` };
  lead.generatedAt = new Date();
  if (oldFileIds.length) await deleteFiles(oldFileIds);
  return result;
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

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.status(201).json({ success: true, data: populated });
});

// GET /api/leads
const listLeads = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = { ...scopeFilter(req.user) };
  const q = req.query;
  if (q.status) filter.status = q.status;
  if (q.kitType) filter.kitType = q.kitType;
  if (q.businessType) filter.businessType = q.businessType;
  if (q.city) filter.city = searchRegex(q.city);
  if (q.execId && req.user.role !== 'sales_exec') filter.assignedExecId = q.execId;
  if (q.createdBy && req.user.role !== 'sales_exec') filter.createdBy = q.createdBy;
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

// PUT /api/leads/:id  (client details — only before a kit type is locked in)
const updateLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);
  assertNotLocked(lead);
  assertEditable(lead, req.user);

  const { assignedExecId, ...rest } = req.body;
  if (assignedExecId && req.user.role !== 'sales_exec') {
    lead.assignedExecId = await resolveExecId(req, assignedExecId);
  }
  Object.assign(lead, rest);
  markEditedIfGenerated(lead);
  lead.modifiedBy = req.user._id;
  await lead.save();

  await logActivity({
    userId: req.user._id, action: 'LEAD_UPDATED', entity: 'Lead', entityId: lead._id,
    details: `Updated lead ${lead.refNumber}`, ip: req.ip,
  });

  const populated = await Lead.findById(lead._id).populate(POPULATE);
  res.json({ success: true, data: populated });
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

  const items = await RateItem.find({ kitType, isActive: true }).sort({ productName: 1 });
  if (!items.length) throw ApiError.badRequest(`No active rate items in the ${kitType} rate master`);

  // The distributor card's DSP column is each product's institutional rate, so
  // pull the institutional master and map it by SKU for the snapshot.
  let dspBySku;
  if (kitType === 'distributor') {
    const instItems = await RateItem.find({ kitType: 'institutional', isActive: true }).select('sku netRate');
    dspBySku = new Map(instItems.map((i) => [i.sku, i.netRate]));
  }

  const settings = await Setting.getGlobal();
  const from = lead.status;
  lead.kitType = kitType;
  lead.rates = items.map((item) => snapshotLine(item, kitType, dspBySku));
  lead.rateEditLog = [];
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
    // For the distributor card the edited value is the DLP, which already
    // includes GST; institutional net rates are pre-GST.
    const isDist = lead.kitType === 'distributor';
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
  if (!lead.zipFile?.fileName) throw ApiError.badRequest('Generate the kit before downloading it');
  await ensureFreshKit(lead);

  if (lead.zipFile.fileId) {
    await logActivity({
      userId: req.user._id, action: 'LEAD_KIT_DOWNLOADED', entity: 'Lead', entityId: lead._id,
      details: `Downloaded kit ZIP for ${lead.refNumber}`, ip: req.ip,
    });
    setDownloadHeaders(res, lead.zipFile.fileName, 'application/zip');
    return openDownloadStream(lead.zipFile.fileId).pipe(res);
  }

  let zipPath = path.join(KITS_DIR, lead.refNumber, lead.zipFile.fileName);
  if (!fs.existsSync(zipPath)) {
    await buildKitFiles(lead);
    await lead.save();
    setDownloadHeaders(res, lead.zipFile.fileName, 'application/zip');
    return openDownloadStream(lead.zipFile.fileId).pipe(res);
  }

  await logActivity({
    userId: req.user._id, action: 'LEAD_KIT_DOWNLOADED', entity: 'Lead', entityId: lead._id,
    details: `Downloaded kit ZIP for ${lead.refNumber}`, ip: req.ip,
  });
  res.download(zipPath, lead.zipFile.fileName);
});

// GET /api/leads/:id/documents/:idx
const downloadDocument = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);
  await ensureFreshKit(lead);

  const file = lead.generatedFiles[Number(req.params.idx)];
  if (!file) throw ApiError.notFound('Document not found');

  if (file.fileId) {
    setDownloadHeaders(res, file.fileName, 'application/pdf');
    return openDownloadStream(file.fileId).pipe(res);
  }

  const filePath = path.join(KITS_DIR, lead.refNumber, file.fileName);
  if (!fs.existsSync(filePath)) throw ApiError.badRequest('Regenerate the kit — file is missing');
  res.download(filePath, file.fileName);
});

// POST /api/leads/:id/email  (send the kit to the client)
const emailKit = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw ApiError.notFound('Lead not found');
  assertCanView(lead, req.user);
  if (!lead.generatedFiles?.length) throw ApiError.badRequest('Generate the kit before emailing it');
  await ensureFreshKit(lead);

  if (!lead.generatedFiles.every((f) => f.fileId)) {
    const dir = path.join(KITS_DIR, lead.refNumber);
    const legacyFiles = lead.generatedFiles.map((f) => path.join(dir, f.fileName));
    if (!legacyFiles.every((p) => fs.existsSync(p))) {
      await buildKitFiles(lead);
      await lead.save();
    }
  }

  if (!lead.generatedFiles.every((f) => f.fileId)) {
    await buildKitFiles(lead);
    await lead.save();
  }

  const generatedFiles = await Promise.all(
    lead.generatedFiles.map(async (f) => ({
      filename: f.fileName,
      content: f.fileId ? await getBuffer(f.fileId) : undefined,
      path: f.fileId ? undefined : path.join(KITS_DIR, lead.refNumber, f.fileName),
    }))
  );

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
        : 'Email is not configured. Set RESEND_API_KEY or SMTP_* in the server .env (or SMTP in Settings).'
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
  createLead,
  listLeads,
  getLead,
  updateLead,
  deleteLead,
  selectKitType,
  confirmRates,
  generateLeadKit,
  saveTerms,
  unlockLead,
  addNote,
  updateNote,
  deleteNote,
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
  deleteAttachment,
  downloadZip,
  downloadDocument,
  emailKit,
  markDelivered,
};
