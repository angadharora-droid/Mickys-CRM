const ExcelJS = require('exceljs');
const Lead = require('../models/Lead');
const SalesOrder = require('../models/SalesOrder');
const ApiError = require('../utils/ApiError');
const { getScoreConfig, linkedOrdersByLead, buildScoreCard } = require('./leadScore.service');

/**
 * Report engine: every report is a registry entry with a column spec and a row
 * builder, so the same definition drives the in-app preview (JSON), the
 * per-report Excel download and the all-in-one workbook.
 *
 * All date maths runs on Indian Standard Time days — the team works across
 * India, so "today" and daily buckets follow IST wall clock, not UTC.
 */
const IST_OFFSET_MS = 330 * 60 * 1000;

const STATUS_LABELS = {
  new: 'New Lead',
  kit_selected: 'Kit Selected',
  rates_confirmed: 'Rates Confirmed',
  generated: 'Kit Generated',
  delivered: 'Delivered',
};

const KIT_TYPE_LABELS = {
  distributor: 'Distributor Kit',
  stockist: 'Stockist Kit',
  institutional: 'Institutional Kit',
  export: 'Export Kit',
  b2c: 'B2C Kit',
};

const STAGE_LABELS = { new: 'New', live: 'Live', client: 'Client made', turned_down: 'Turned down' };

/** Calendar day (YYYY-MM-DD) a timestamp falls on in IST. */
const istDayKey = (d) => new Date(new Date(d).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Inclusive UTC bounds of an IST calendar-day range. */
const istBounds = (fromStr, toStr) => ({
  from: new Date(`${fromStr}T00:00:00.000+05:30`),
  to: new Date(`${toStr}T23:59:59.999+05:30`),
});

const inRange = (d, ctx) => {
  if (!d) return false;
  const t = new Date(d).getTime();
  return t >= ctx.from.getTime() && t <= ctx.to.getTime();
};

/** Leads visible to this requester (admins may narrow to one executive). */
function reportScope(user, execId) {
  if (user.role !== 'admin') return { assignedExecId: user._id };
  return execId ? { assignedExecId: execId } : {};
}

const dmy = (d) =>
  new Date(new Date(d).getTime() + IST_OFFSET_MS).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });

// ---------------------------------------------------------------------------
// Row builders — each returns plain objects keyed by its report's column keys.
// Date values stay as Date objects; the JSON layer serializes them to ISO and
// the Excel layer writes them as real date cells.
// ---------------------------------------------------------------------------

const leadBasics = (l) => ({
  refNumber: l.refNumber,
  businessName: l.businessName,
  city: l.city,
  executive: l.assignedExecId?.name || '—',
});

async function visitRows(ctx) {
  const leads = await Lead.find({
    ...ctx.scope,
    visitReports: { $elemMatch: { visitDate: { $gte: ctx.from, $lte: ctx.to } } },
  })
    .select(
      'refNumber businessName contactPerson mobileNumber city state businessType leadSource status ' +
      'assignedExecId visitReports actionPoint followUp.date followUp.status'
    )
    .populate({ path: 'assignedExecId', select: 'name' })
    .populate({ path: 'visitReports.createdBy', select: 'name' })
    .lean();

  const rows = [];
  for (const l of leads) {
    const visitCount = (l.visitReports || []).length;
    for (const v of l.visitReports || []) {
      if (!inRange(v.visitDate, ctx)) continue;
      rows.push({
        visitDate: new Date(v.visitDate),
        visitType: v.visitType === 'call' ? 'Call' : 'Field visit',
        ...leadBasics(l),
        contactPerson: l.contactPerson || '',
        mobileNumber: l.mobileNumber || '',
        state: l.state || '',
        businessType: l.businessType || '',
        leadSource: l.leadSource || '',
        status: STATUS_LABELS[l.status] || l.status,
        note: v.note || '',
        totalVisits: visitCount,
        actionPoint: l.actionPoint || '',
        nextFollowUp: l.followUp?.status === 'open' && l.followUp?.date ? new Date(l.followUp.date) : null,
        loggedBy: v.createdBy?.name || '—',
        loggedAt: v.createdAt ? new Date(v.createdAt) : null,
      });
    }
  }
  rows.sort((a, b) => b.visitDate - a.visitDate || (b.loggedAt || 0) - (a.loggedAt || 0));
  return rows;
}

async function leadRows(ctx) {
  const leads = await Lead.find({ ...ctx.scope, leadDate: { $gte: ctx.from, $lte: ctx.to } })
    .select(
      'refNumber businessName contactPerson designation mobileNumber email whatsappNumber city state address gstin ' +
      'businessType leadSource dailyUsage assignedExecId status kitType actionPoint followUp leadDate createdBy createdAt ' +
      'internalNotes visitReports.visitDate generatedAt delivery.sentAt delivery.method emailLog.createdAt'
    )
    .populate({ path: 'assignedExecId', select: 'name' })
    .populate({ path: 'createdBy', select: 'name' })
    .sort({ leadDate: -1 })
    .lean();

  return leads.map((l) => {
    const visitDates = (l.visitReports || []).map((v) => new Date(v.visitDate)).filter((d) => !Number.isNaN(d.getTime()));
    return {
      leadDate: l.leadDate ? new Date(l.leadDate) : null,
      ...leadBasics(l),
      contactPerson: l.contactPerson || '',
      designation: l.designation || '',
      mobileNumber: l.mobileNumber || '',
      email: l.email || '',
      whatsappNumber: l.whatsappNumber || '',
      state: l.state || '',
      businessType: l.businessType || '',
      leadSource: l.leadSource || '',
      dailyUsage: l.dailyUsage || '',
      status: STATUS_LABELS[l.status] || l.status,
      kitType: KIT_TYPE_LABELS[l.kitType] || '',
      actionPoint: l.actionPoint || '',
      followUpDate: l.followUp?.status === 'open' && l.followUp?.date ? new Date(l.followUp.date) : null,
      visits: visitDates.length,
      lastVisit: visitDates.length ? new Date(Math.max(...visitDates.map((d) => d.getTime()))) : null,
      generatedAt: l.generatedAt ? new Date(l.generatedAt) : null,
      delivered: l.delivery?.sentAt ? 'Yes' : 'No',
      deliveryMethod: l.delivery?.method || '',
      emailsSent: (l.emailLog || []).length,
      gstin: l.gstin || '',
      address: l.address || '',
      internalNotes: l.internalNotes || '',
      createdBy: l.createdBy?.name || '—',
      createdAt: l.createdAt ? new Date(l.createdAt) : null,
    };
  });
}

async function followUpRows(ctx) {
  const todayKey = istDayKey(new Date());
  const leads = await Lead.find({
    ...ctx.scope,
    $or: [
      { 'followUp.status': 'open', 'followUp.date': { $gte: ctx.from, $lte: ctx.to } },
      { crmHistory: { $elemMatch: { type: 'follow_up', date: { $gte: ctx.from, $lte: ctx.to } } } },
    ],
  })
    .select(
      'refNumber businessName contactPerson mobileNumber city businessType status actionPoint ' +
      'assignedExecId followUp crmHistory'
    )
    .populate({ path: 'assignedExecId', select: 'name' })
    .populate({ path: 'crmHistory.by', select: 'name' })
    .lean();

  const rows = [];
  for (const l of leads) {
    const shared = {
      ...leadBasics(l),
      contactPerson: l.contactPerson || '',
      mobileNumber: l.mobileNumber || '',
      businessType: l.businessType || '',
      leadStatus: STATUS_LABELS[l.status] || l.status,
      actionPoint: l.actionPoint || '',
    };
    const fu = l.followUp || {};
    if (fu.status === 'open' && inRange(fu.date, ctx)) {
      const dueKey = istDayKey(fu.date);
      rows.push({
        dueDate: new Date(fu.date),
        ...shared,
        status: dueKey < todayKey ? 'Overdue' : dueKey === todayKey ? 'Due today' : 'Open',
        note: fu.note || '',
        closingNote: '',
        closedBy: '',
        closedAt: null,
      });
    }
    // Closed follow-ups live in crmHistory (each close archives one there, so
    // this also covers the currently-closed followUp without double counting).
    for (const h of l.crmHistory || []) {
      if (h.type !== 'follow_up' || !inRange(h.date, ctx)) continue;
      rows.push({
        dueDate: h.date ? new Date(h.date) : null,
        ...shared,
        status: 'Closed',
        note: h.summary || '',
        closingNote: h.note || '',
        closedBy: h.by?.name || '—',
        closedAt: h.at ? new Date(h.at) : null,
      });
    }
  }
  rows.sort((a, b) => (b.dueDate || 0) - (a.dueDate || 0));
  return rows;
}

async function actionPointRows(ctx) {
  const leads = await Lead.find({
    ...ctx.scope,
    $or: [
      { actionPoint: { $nin: ['', null] } },
      { crmHistory: { $elemMatch: { type: 'action_point', at: { $gte: ctx.from, $lte: ctx.to } } } },
    ],
  })
    .select(
      'refNumber businessName contactPerson mobileNumber city businessType status ' +
      'assignedExecId actionPoint updatedAt crmHistory followUp.date followUp.status'
    )
    .populate({ path: 'assignedExecId', select: 'name' })
    .populate({ path: 'crmHistory.by', select: 'name' })
    .lean();

  const rows = [];
  for (const l of leads) {
    const shared = {
      ...leadBasics(l),
      contactPerson: l.contactPerson || '',
      mobileNumber: l.mobileNumber || '',
      businessType: l.businessType || '',
      leadStatus: STATUS_LABELS[l.status] || l.status,
      nextFollowUp: l.followUp?.status === 'open' && l.followUp?.date ? new Date(l.followUp.date) : null,
    };
    // Open action points are current state, so they're always listed.
    if (l.actionPoint) {
      rows.push({
        actionPoint: l.actionPoint,
        ...shared,
        status: 'Open',
        clearedBy: '',
        clearedAt: null,
      });
    }
    for (const h of l.crmHistory || []) {
      if (h.type !== 'action_point' || !inRange(h.at, ctx)) continue;
      rows.push({
        actionPoint: h.summary || '',
        ...shared,
        status: 'Cleared',
        clearedBy: h.by?.name || '—',
        clearedAt: h.at ? new Date(h.at) : null,
      });
    }
  }
  rows.sort((a, b) => (a.status === b.status ? (b.clearedAt || 0) - (a.clearedAt || 0) : a.status === 'Open' ? -1 : 1));
  return rows;
}

async function kitRows(ctx) {
  const leads = await Lead.find({
    ...ctx.scope,
    $or: [
      { generatedAt: { $gte: ctx.from, $lte: ctx.to } },
      { 'delivery.sentAt': { $gte: ctx.from, $lte: ctx.to } },
    ],
  })
    .select(
      'refNumber businessName contactPerson mobileNumber city businessType assignedExecId kitType status ' +
      'rates generatedAt generatedFiles delivery emailLog.createdAt'
    )
    .populate({ path: 'assignedExecId', select: 'name' })
    .sort({ generatedAt: -1 })
    .lean();

  return leads.map((l) => {
    const included = (l.rates || []).filter((r) => r.included !== false);
    const avgDiscount = included.length
      ? Math.round((included.reduce((s, r) => s + (Number(r.deviationPct) || 0), 0) / included.length) * 10) / 10
      : 0;
    return {
      generatedAt: l.generatedAt ? new Date(l.generatedAt) : null,
      ...leadBasics(l),
      contactPerson: l.contactPerson || '',
      mobileNumber: l.mobileNumber || '',
      businessType: l.businessType || '',
      kitType: KIT_TYPE_LABELS[l.kitType] || '—',
      status: STATUS_LABELS[l.status] || l.status,
      products: included.length,
      documents: (l.generatedFiles || []).length,
      avgDiscount,
      delivered: l.delivery?.sentAt ? 'Yes' : 'No',
      deliveryMethod: l.delivery?.method || '',
      deliveredTo: l.delivery?.sentTo || l.delivery?.note || '',
      deliveredAt: l.delivery?.sentAt ? new Date(l.delivery.sentAt) : null,
      emailsSent: (l.emailLog || []).length,
    };
  });
}

async function emailRows(ctx) {
  const leads = await Lead.find({
    ...ctx.scope,
    emailLog: { $elemMatch: { createdAt: { $gte: ctx.from, $lte: ctx.to } } },
  })
    .select('refNumber businessName city assignedExecId emailLog')
    .populate({ path: 'assignedExecId', select: 'name' })
    .populate({ path: 'emailLog.sentBy', select: 'name' })
    .lean();

  const rows = [];
  for (const l of leads) {
    for (const e of l.emailLog || []) {
      if (!inRange(e.createdAt, ctx)) continue;
      rows.push({
        sentAt: new Date(e.createdAt),
        ...leadBasics(l),
        to: e.to || '',
        cc: (e.cc || []).join(', '),
        subject: e.subject || '',
        status: e.status === 'failed' ? 'Failed' : 'Sent',
        provider: e.provider || '',
        attachments: (e.attachments || []).join(', '),
        attachmentCount: (e.attachments || []).length,
        sentBy: e.sentBy?.name || '—',
      });
    }
  }
  rows.sort((a, b) => b.sentAt - a.sentAt);
  return rows;
}

async function instructionRows(ctx) {
  const leads = await Lead.find({
    ...ctx.scope,
    instructions: { $elemMatch: { createdAt: { $gte: ctx.from, $lte: ctx.to } } },
  })
    .select('refNumber businessName city businessType status assignedExecId instructions')
    .populate({ path: 'assignedExecId', select: 'name' })
    .populate({ path: 'instructions.createdBy', select: 'name' })
    .populate({ path: 'instructions.doneBy', select: 'name' })
    .lean();

  const rows = [];
  for (const l of leads) {
    for (const i of l.instructions || []) {
      if (!inRange(i.createdAt, ctx)) continue;
      const done = i.status === 'done';
      const end = done && i.doneAt ? new Date(i.doneAt) : new Date();
      rows.push({
        givenAt: new Date(i.createdAt),
        ...leadBasics(l),
        businessType: l.businessType || '',
        leadStatus: STATUS_LABELS[l.status] || l.status,
        text: i.text || '',
        status: done ? 'Done' : 'Open',
        daysOpen: Math.max(0, Math.round((end - new Date(i.createdAt)) / 86400000)),
        givenBy: i.createdBy?.name || '—',
        doneBy: i.doneBy?.name || '',
        doneAt: i.doneAt ? new Date(i.doneAt) : null,
      });
    }
  }
  rows.sort((a, b) => b.givenAt - a.givenAt);
  return rows;
}

/**
 * The lead's internal note as one text: the shared note, plus any legacy
 * per-author notes that have not been consolidated into it yet (oldest first).
 */
function internalNoteText(l) {
  const legacy = [...(l.notes || [])]
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
    .map((n) => String(n.text || '').trim());
  return [...new Set([String(l.internalNotes || '').trim(), ...legacy].filter(Boolean))].join('\n');
}

/**
 * The enquiry register: every enquiry received in the period with the full
 * lead details, the team's internal notes and where it stands — last contact,
 * next action and funnel stage.
 */
async function enquiryRows(ctx) {
  const leads = await Lead.find({ ...ctx.scope, leadDate: { $gte: ctx.from, $lte: ctx.to } })
    .select(
      'refNumber businessName contactPerson designation mobileNumber email whatsappNumber city state address gstin ' +
      'businessType leadSource dailyUsage assignedExecId leadDate stage status turnDownReason actionPoint ' +
      'followUp.date followUp.status internalNotes notes.text notes.createdAt ' +
      'visitReports.visitDate visitReports.visitType visitReports.note createdBy'
    )
    .populate({ path: 'assignedExecId', select: 'name' })
    .populate({ path: 'createdBy', select: 'name' })
    .sort({ leadDate: -1 })
    .lean();

  return leads.map((l) => {
    const contacts = (l.visitReports || [])
      .filter((v) => v.visitDate)
      .sort((a, b) => new Date(b.visitDate) - new Date(a.visitDate));
    const last = contacts[0];
    return {
      leadDate: l.leadDate ? new Date(l.leadDate) : null,
      ...leadBasics(l),
      contactPerson: l.contactPerson || '',
      designation: l.designation || '',
      mobileNumber: l.mobileNumber || '',
      whatsappNumber: l.whatsappNumber || '',
      email: l.email || '',
      state: l.state || '',
      address: l.address || '',
      gstin: l.gstin || '',
      businessType: l.businessType || '',
      leadSource: l.leadSource || '',
      dailyUsage: l.dailyUsage || '',
      stage: STAGE_LABELS[l.stage] || 'New',
      status: STATUS_LABELS[l.status] || l.status,
      internalNotes: internalNoteText(l),
      interactions: contacts.length,
      lastContact: last ? new Date(last.visitDate) : null,
      lastContactType: last ? (last.visitType === 'call' ? 'Call' : 'Field visit') : '',
      lastContactNote: last?.note || '',
      actionPoint: l.actionPoint || '',
      followUpDate: l.followUp?.status === 'open' && l.followUp?.date ? new Date(l.followUp.date) : null,
      turnDownReason: l.turnDownReason || '',
      createdBy: l.createdBy?.name || '—',
    };
  });
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Enquiries that became clients in the period: how long the conversion took,
 * the work that went into it, who made it, and the business booked since.
 */
async function conversionRows(ctx) {
  const leads = await Lead.find({ ...ctx.scope, clientMadeAt: { $gte: ctx.from, $lte: ctx.to } })
    .select(
      'refNumber businessName contactPerson mobileNumber city state businessType leadSource assignedExecId kitType ' +
      'leadDate createdAt stage clientMadeAt stageHistory visitReports.visitType samples.givenOn'
    )
    .populate({ path: 'assignedExecId', select: 'name' })
    .populate({ path: 'stageHistory.changedBy', select: 'name' })
    .sort({ clientMadeAt: -1 })
    .lean();
  const ordersByLead = await linkedOrdersByLead(leads.map((l) => l._id));

  return leads.map((l) => {
    const orders = ordersByLead.get(String(l._id)) || [];
    const enquiredAt = l.leadDate || l.createdAt;
    const visits = l.visitReports || [];
    // clientMadeAt is stamped by the first move to `client`, so that entry is
    // the conversion (older leads backfilled with a date may have none).
    const made = (l.stageHistory || []).find((h) => h.to === 'client');
    return {
      clientMadeAt: new Date(l.clientMadeAt),
      ...leadBasics(l),
      contactPerson: l.contactPerson || '',
      mobileNumber: l.mobileNumber || '',
      state: l.state || '',
      businessType: l.businessType || '',
      leadSource: l.leadSource || '',
      leadDate: enquiredAt ? new Date(enquiredAt) : null,
      daysToConvert: enquiredAt
        ? Math.max(0, Math.round((new Date(l.clientMadeAt) - new Date(enquiredAt)) / 86400000))
        : null,
      stage: STAGE_LABELS[l.stage] || 'New',
      kitType: KIT_TYPE_LABELS[l.kitType] || '',
      visits: visits.filter((v) => v.visitType !== 'call').length,
      calls: visits.filter((v) => v.visitType === 'call').length,
      samples: (l.samples || []).length,
      orders: orders.length,
      orderValue: round2(orders.reduce((sum, o) => sum + (Number(o.total) || 0), 0)),
      firstOrder: orders[0]?.number || '',
      firstOrderDate: orders[0]?.createdAt ? new Date(orders[0].createdAt) : null,
      lastOrderDate: orders.length ? new Date(orders[orders.length - 1].createdAt) : null,
      convertedBy: made?.changedBy?.name || (made?.source === 'system' ? 'System' : '—'),
      conversionNote: made?.reason || '',
    };
  });
}

/**
 * Headline figures for the conversion report. The rate sets the clients made
 * in the period against the enquiries received in the same period — the rows
 * alone can't give it, since they list only the enquiries that converted.
 */
async function conversionSummary(ctx, rows) {
  const enquiries = await Lead.countDocuments({ ...ctx.scope, leadDate: { $gte: ctx.from, $lte: ctx.to } });
  const timed = rows.filter((r) => r.daysToConvert !== null);
  const avgDays = timed.length
    ? Math.round((timed.reduce((sum, r) => sum + r.daysToConvert, 0) / timed.length) * 10) / 10
    : 0;
  const orderValue = rows.reduce((sum, r) => sum + r.orderValue, 0);
  return [
    { label: 'Clients made', value: rows.length, tone: 'green' },
    { label: 'Enquiries received', value: enquiries, tone: 'sky' },
    { label: 'Conversion rate', value: enquiries ? `${Math.round((rows.length / enquiries) * 1000) / 10}%` : '—' },
    { label: 'Avg days to convert', value: avgDays },
    { label: 'With orders', value: rows.filter((r) => r.orders > 0).length },
    { label: 'Order value', value: `₹${Math.round(orderValue).toLocaleString('en-IN')}`, tone: 'amber' },
  ];
}

/**
 * Every piece of client feedback taken in the period, from both places the CRM
 * records it: feedback logged on the lead (on the samples / kit / offer) and
 * the rated feedback collected on a delivered sales order. Order feedback is
 * joined back to its lead through the appointed customer, so it obeys the same
 * executive scope as everything else here.
 */
async function feedbackRows(ctx) {
  const range = { $gte: ctx.from, $lte: ctx.to };
  const orders = await SalesOrder.find({ 'feedback.submittedAt': range, status: { $ne: 'cancelled' } })
    .select('number customer feedback')
    .populate({ path: 'customer', select: 'lead' })
    .populate({ path: 'feedback.submittedBy', select: 'name' })
    .lean();
  const ordersByLead = new Map();
  for (const o of orders) {
    const leadId = o.customer?.lead ? String(o.customer.lead) : '';
    if (!leadId) continue;
    if (!ordersByLead.has(leadId)) ordersByLead.set(leadId, []);
    ordersByLead.get(leadId).push(o);
  }

  const leads = await Lead.find({
    ...ctx.scope,
    $or: [
      { feedbacks: { $elemMatch: { takenOn: range } } },
      { _id: { $in: [...ordersByLead.keys()] } },
    ],
  })
    .select(
      'refNumber businessName contactPerson mobileNumber city businessType assignedExecId stage ' +
      'feedbacks samples.givenOn samples.products'
    )
    .populate({ path: 'assignedExecId', select: 'name' })
    .populate({ path: 'feedbacks.createdBy', select: 'name' })
    .lean();

  const rows = [];
  for (const l of leads) {
    const shared = {
      ...leadBasics(l),
      contactPerson: l.contactPerson || '',
      mobileNumber: l.mobileNumber || '',
      businessType: l.businessType || '',
      stage: STAGE_LABELS[l.stage] || 'New',
    };
    const samples = [...(l.samples || [])].sort((a, b) => new Date(b.givenOn) - new Date(a.givenOn));
    for (const f of l.feedbacks || []) {
      if (!inRange(f.takenOn, ctx)) continue;
      // What the client was reacting to: the latest samples given by then.
      const sample = samples.find((s) => new Date(s.givenOn) <= new Date(f.takenOn));
      rows.push({
        feedbackDate: new Date(f.takenOn),
        feedbackOn: 'Lead',
        orderNumber: '',
        ...shared,
        note: f.note || '',
        rating: null,
        quality: null,
        deliveryRating: null,
        packaging: null,
        wouldReorder: '',
        sampleProducts: sample?.products || '',
        takenBy: f.createdBy?.name || '—',
        loggedAt: f.createdAt ? new Date(f.createdAt) : null,
      });
    }
    for (const o of ordersByLead.get(String(l._id)) || []) {
      const fb = o.feedback;
      rows.push({
        feedbackDate: new Date(fb.submittedAt),
        feedbackOn: 'Sales order',
        orderNumber: o.number || '',
        ...shared,
        note: fb.comments || '',
        rating: fb.rating ?? null,
        quality: fb.quality ?? null,
        deliveryRating: fb.delivery ?? null,
        packaging: fb.packaging ?? null,
        wouldReorder: fb.wouldReorder == null ? '' : fb.wouldReorder ? 'Yes' : 'No',
        sampleProducts: '',
        takenBy: fb.submittedBy?.name || '—',
        loggedAt: new Date(fb.submittedAt),
      });
    }
  }
  rows.sort((a, b) => b.feedbackDate - a.feedbackDate || (b.loggedAt || 0) - (a.loggedAt || 0));
  return rows;
}

/** One lean scan powering the two aggregate reports. */
function activityScan(ctx) {
  return Lead.find(ctx.scope)
    .select(
      'assignedExecId leadDate visitReports.visitDate visitReports.visitType generatedAt delivery.sentAt status ' +
      'followUp.status followUp.date crmHistory.type crmHistory.at emailLog.createdAt actionPoint ' +
      'instructions.status instructions.createdAt instructions.doneAt stage score clientMadeAt samples.givenOn feedbacks.takenOn'
    )
    .populate({ path: 'assignedExecId', select: 'name isActive' })
    .lean();
}

/**
 * The score card, one row per lead dated in the period, ranked by points:
 * the stage on the funnel, the total, and every milestone as the points it
 * contributed (0 = not yet earned).
 */
async function leadScoreRows(ctx) {
  const [config, leads] = await Promise.all([
    getScoreConfig(),
    Lead.find({ ...ctx.scope, leadDate: { $gte: ctx.from, $lte: ctx.to } })
      .select(
        'refNumber businessName contactPerson mobileNumber city businessType assignedExecId status kitType leadDate createdAt ' +
        'stage score clientMadeAt turnDownReason generatedAt delivery.sentAt samples.givenOn ' +
        'visitReports.visitDate visitReports.visitType feedbacks.takenOn'
      )
      .populate({ path: 'assignedExecId', select: 'name' })
      .lean(),
  ]);
  const ordersByLead = await linkedOrdersByLead(leads.map((l) => l._id));

  const rows = leads.map((l) => {
    const card = buildScoreCard(l, ordersByLead.get(String(l._id)) || [], config);
    const pts = Object.fromEntries(card.items.map((i) => [i.key, i.earnedPoints]));
    const counts = Object.fromEntries(card.items.map((i) => [i.key, i.count]));
    return {
      score: card.total,
      ...leadBasics(l),
      contactPerson: l.contactPerson || '',
      mobileNumber: l.mobileNumber || '',
      businessType: l.businessType || '',
      stage: STAGE_LABELS[l.stage] || 'New',
      status: STATUS_LABELS[l.status] || l.status,
      kitType: KIT_TYPE_LABELS[l.kitType] || '',
      kitGenerated: pts.kitGenerated,
      kitDelivered: pts.kitDelivered,
      sampleGiven: pts.sampleGiven,
      visitDone: pts.visitDone,
      feedbackTaken: pts.feedbackTaken,
      callsDone: pts.callsDone,
      clientMade: pts.clientMade,
      sampleOrder: pts.sampleOrder,
      repeatOrder: pts.repeatOrder,
      visits: counts.visitDone,
      calls: counts.callsDone,
      orders: card.orders.length,
      clientMadeAt: l.clientMadeAt ? new Date(l.clientMadeAt) : null,
      turnDownReason: l.turnDownReason || '',
      leadDate: l.leadDate ? new Date(l.leadDate) : null,
    };
  });
  rows.sort((a, b) => b.score - a.score || (b.leadDate || 0) - (a.leadDate || 0));
  return rows;
}

async function execPerformanceRows(ctx) {
  const leads = await activityScan(ctx);
  const todayKey = istDayKey(new Date());
  const byExec = new Map();
  const fieldDays = new Map(); // exec id -> Set of IST days with at least one field visit

  for (const l of leads) {
    const id = String(l.assignedExecId?._id || 'unassigned');
    if (!byExec.has(id)) {
      byExec.set(id, {
        executive: l.assignedExecId?.name || 'Unassigned',
        totalLeads: 0, leadsAdded: 0, visits: 0, calls: 0, activeDays: 0, kitsGenerated: 0, kitsDelivered: 0,
        samplesGiven: 0, feedbackTaken: 0, clientsMade: 0, liveLeads: 0, turnedDown: 0, points: 0,
        followUpsClosed: 0, instructionsDone: 0, emailsSent: 0, openFollowUps: 0, overdueFollowUps: 0,
        openActionPoints: 0, openInstructions: 0,
      });
      fieldDays.set(id, new Set());
    }
    const s = byExec.get(id);
    s.totalLeads += 1;
    if (inRange(l.leadDate, ctx)) s.leadsAdded += 1;
    // Score-card activity in the period, plus the funnel position and points
    // as they stand now (the score is cumulative, not a period figure).
    s.samplesGiven += (l.samples || []).filter((x) => inRange(x.givenOn, ctx)).length;
    s.feedbackTaken += (l.feedbacks || []).filter((x) => inRange(x.takenOn, ctx)).length;
    if (inRange(l.clientMadeAt, ctx)) s.clientsMade += 1;
    if (l.stage === 'live') s.liveLeads += 1;
    if (l.stage === 'turned_down') s.turnedDown += 1;
    s.points += l.score || 0;
    for (const v of l.visitReports || []) {
      if (!inRange(v.visitDate, ctx)) continue;
      // Phone calls are counted on their own and don't make a day a field day.
      if (v.visitType === 'call') { s.calls += 1; continue; }
      s.visits += 1;
      fieldDays.get(id).add(istDayKey(v.visitDate));
    }
    if (inRange(l.generatedAt, ctx)) s.kitsGenerated += 1;
    if (inRange(l.delivery?.sentAt, ctx)) s.kitsDelivered += 1;
    s.followUpsClosed += (l.crmHistory || []).filter((h) => h.type === 'follow_up' && inRange(h.at, ctx)).length;
    s.instructionsDone += (l.instructions || []).filter((i) => inRange(i.doneAt, ctx)).length;
    s.emailsSent += (l.emailLog || []).filter((e) => inRange(e.createdAt, ctx)).length;
    if (l.followUp?.status === 'open') {
      s.openFollowUps += 1;
      if (l.followUp.date && istDayKey(l.followUp.date) < todayKey) s.overdueFollowUps += 1;
    }
    if (l.actionPoint) s.openActionPoints += 1;
    s.openInstructions += (l.instructions || []).filter((i) => i.status === 'open').length;
  }

  for (const [id, s] of byExec) s.activeDays = fieldDays.get(id).size;
  return [...byExec.values()].sort((a, b) => a.executive.localeCompare(b.executive));
}

// The daily summary is bounded so a 13-month range can't produce a 400-row
// sheet; export-all uses the same constant to skip (not abort) this report.
const DAILY_SUMMARY_MAX_DAYS = 190;

const rangeDayCount = (ctx) => Math.round((ctx.to - ctx.from) / 86400000);

async function dailySummaryRows(ctx) {
  if (rangeDayCount(ctx) > DAILY_SUMMARY_MAX_DAYS) {
    throw ApiError.badRequest('The daily summary covers at most 6 months — pick a shorter date range');
  }

  const leads = await activityScan(ctx);
  const days = new Map(); // 'YYYY-MM-DD' -> counters
  for (let t = ctx.from.getTime(); t <= ctx.to.getTime(); t += 86400000) {
    days.set(istDayKey(new Date(t)), {
      newLeads: 0, visits: 0, calls: 0, kitsGenerated: 0, kitsDelivered: 0, followUpsClosed: 0,
      actionPointsCleared: 0, instructionsGiven: 0, instructionsDone: 0, emailsSent: 0,
    });
  }
  const bump = (date, key) => {
    if (!date) return;
    const day = days.get(istDayKey(date));
    if (day) day[key] += 1;
  };

  for (const l of leads) {
    if (inRange(l.leadDate, ctx)) bump(l.leadDate, 'newLeads');
    (l.visitReports || []).forEach(
      (v) => inRange(v.visitDate, ctx) && bump(v.visitDate, v.visitType === 'call' ? 'calls' : 'visits')
    );
    if (inRange(l.generatedAt, ctx)) bump(l.generatedAt, 'kitsGenerated');
    if (inRange(l.delivery?.sentAt, ctx)) bump(l.delivery.sentAt, 'kitsDelivered');
    (l.crmHistory || []).forEach((h) => {
      if (!inRange(h.at, ctx)) return;
      if (h.type === 'follow_up') bump(h.at, 'followUpsClosed');
      if (h.type === 'action_point') bump(h.at, 'actionPointsCleared');
    });
    (l.instructions || []).forEach((i) => {
      if (inRange(i.createdAt, ctx)) bump(i.createdAt, 'instructionsGiven');
      if (inRange(i.doneAt, ctx)) bump(i.doneAt, 'instructionsDone');
    });
    (l.emailLog || []).forEach((e) => inRange(e.createdAt, ctx) && bump(e.createdAt, 'emailsSent'));
  }

  return [...days.entries()]
    .map(([day, counts]) => ({ day, ...counts }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
}

// ---------------------------------------------------------------------------
// Registry — the single source of truth for report types, labels and columns.
// Column `type`: string | number | date | datetime ('day' = ISO day string).
// ---------------------------------------------------------------------------

const REPORTS = {
  visits: {
    label: 'Visit Report',
    description: 'Every client visit or call in the period — who was reached, whether in person or by phone, what happened, and who logged it.',
    build: visitRows,
    columns: [
      { key: 'visitDate', header: 'Visit Date', type: 'date', width: 13 },
      { key: 'visitType', header: 'Visit Type', width: 12 },
      { key: 'refNumber', header: 'Ref', width: 20 },
      { key: 'businessName', header: 'Business', width: 26 },
      { key: 'contactPerson', header: 'Contact', width: 18 },
      { key: 'mobileNumber', header: 'Mobile', width: 14 },
      { key: 'city', header: 'City', width: 14 },
      { key: 'state', header: 'State', width: 14 },
      { key: 'businessType', header: 'Type', width: 13 },
      { key: 'leadSource', header: 'Source', width: 14 },
      { key: 'status', header: 'Lead Status', width: 14 },
      { key: 'executive', header: 'Executive', width: 16 },
      { key: 'note', header: 'Visit Note', width: 50, wrap: true },
      { key: 'totalVisits', header: 'Total Visits', type: 'number', width: 11 },
      { key: 'actionPoint', header: 'Action Point', width: 18 },
      { key: 'nextFollowUp', header: 'Next Follow-up', type: 'date', width: 14 },
      { key: 'loggedBy', header: 'Logged By', width: 16 },
      { key: 'loggedAt', header: 'Logged At', type: 'datetime', width: 18 },
    ],
  },
  leads: {
    label: 'Leads Report',
    description: 'All leads dated in the period, with full client, CRM and kit details.',
    build: leadRows,
    columns: [
      { key: 'leadDate', header: 'Lead Date', type: 'date', width: 13 },
      { key: 'refNumber', header: 'Ref', width: 20 },
      { key: 'businessName', header: 'Business', width: 26 },
      { key: 'contactPerson', header: 'Contact', width: 18 },
      { key: 'designation', header: 'Designation', width: 14 },
      { key: 'mobileNumber', header: 'Mobile', width: 14 },
      { key: 'email', header: 'Email', width: 24 },
      { key: 'whatsappNumber', header: 'WhatsApp', width: 14 },
      { key: 'city', header: 'City', width: 14 },
      { key: 'state', header: 'State', width: 14 },
      { key: 'businessType', header: 'Type', width: 13 },
      { key: 'leadSource', header: 'Source', width: 14 },
      { key: 'dailyUsage', header: 'Daily Usage', width: 18 },
      { key: 'executive', header: 'Executive', width: 16 },
      { key: 'status', header: 'Status', width: 15 },
      { key: 'kitType', header: 'Kit', width: 15 },
      { key: 'actionPoint', header: 'Action Point', width: 18 },
      { key: 'followUpDate', header: 'Follow-up Due', type: 'date', width: 14 },
      { key: 'visits', header: 'Visits', type: 'number', width: 8 },
      { key: 'lastVisit', header: 'Last Visit', type: 'date', width: 13 },
      { key: 'generatedAt', header: 'Kit Generated At', type: 'datetime', width: 18 },
      { key: 'delivered', header: 'Delivered', width: 10 },
      { key: 'deliveryMethod', header: 'Delivery Method', width: 14 },
      { key: 'emailsSent', header: 'Emails', type: 'number', width: 8 },
      { key: 'gstin', header: 'GSTIN', width: 18 },
      { key: 'address', header: 'Address', width: 34, wrap: true },
      { key: 'internalNotes', header: 'Internal Notes', width: 40, wrap: true },
      { key: 'createdBy', header: 'Created By', width: 16 },
      { key: 'createdAt', header: 'Created At', type: 'datetime', width: 18 },
    ],
  },
  enquiries: {
    label: 'Enquiry Report',
    description: 'Every enquiry received in the period with the full lead details and internal notes, plus where it stands: last contact, next action and funnel stage.',
    build: enquiryRows,
    columns: [
      { key: 'leadDate', header: 'Enquiry Date', type: 'date', width: 13 },
      { key: 'refNumber', header: 'Ref', width: 20 },
      { key: 'businessName', header: 'Business', width: 26 },
      { key: 'contactPerson', header: 'Contact', width: 18 },
      { key: 'designation', header: 'Designation', width: 14 },
      { key: 'mobileNumber', header: 'Mobile', width: 14 },
      { key: 'whatsappNumber', header: 'WhatsApp', width: 14 },
      { key: 'email', header: 'Email', width: 24 },
      { key: 'city', header: 'City', width: 14 },
      { key: 'state', header: 'State', width: 14 },
      { key: 'businessType', header: 'Type', width: 13 },
      { key: 'leadSource', header: 'Source', width: 14 },
      { key: 'dailyUsage', header: 'Daily Usage', width: 18 },
      { key: 'executive', header: 'Executive', width: 16 },
      { key: 'stage', header: 'Funnel Stage', width: 13 },
      { key: 'status', header: 'Kit Status', width: 15 },
      { key: 'internalNotes', header: 'Internal Notes', width: 50, wrap: true },
      { key: 'interactions', header: 'Visits + Calls', type: 'number', width: 12 },
      { key: 'lastContact', header: 'Last Contact', type: 'date', width: 13 },
      { key: 'lastContactType', header: 'Contact Type', width: 12 },
      { key: 'lastContactNote', header: 'Last Contact Note', width: 44, wrap: true },
      { key: 'actionPoint', header: 'Action Point', width: 18 },
      { key: 'followUpDate', header: 'Follow-up Due', type: 'date', width: 14 },
      { key: 'turnDownReason', header: 'Turn-down Reason', width: 30, wrap: true },
      { key: 'gstin', header: 'GSTIN', width: 18 },
      { key: 'address', header: 'Address', width: 34, wrap: true },
      { key: 'createdBy', header: 'Captured By', width: 16 },
    ],
  },
  conversions: {
    label: 'Conversion Report',
    description: 'Enquiries that became clients in the period — days taken, the work behind it, who converted it and the orders booked since. Conversion rate = clients made ÷ enquiries received in the same period.',
    build: conversionRows,
    summary: conversionSummary,
    columns: [
      { key: 'clientMadeAt', header: 'Converted On', type: 'date', width: 13 },
      { key: 'refNumber', header: 'Ref', width: 20 },
      { key: 'businessName', header: 'Business', width: 26 },
      { key: 'contactPerson', header: 'Contact', width: 18 },
      { key: 'mobileNumber', header: 'Mobile', width: 14 },
      { key: 'city', header: 'City', width: 14 },
      { key: 'state', header: 'State', width: 14 },
      { key: 'businessType', header: 'Type', width: 13 },
      { key: 'leadSource', header: 'Source', width: 14 },
      { key: 'executive', header: 'Executive', width: 16 },
      { key: 'leadDate', header: 'Enquiry Date', type: 'date', width: 13 },
      { key: 'daysToConvert', header: 'Days to Convert', type: 'number', width: 14 },
      { key: 'stage', header: 'Current Stage', width: 13 },
      { key: 'kitType', header: 'Kit', width: 15 },
      { key: 'visits', header: 'Field Visits', type: 'number', width: 11 },
      { key: 'calls', header: 'Calls', type: 'number', width: 8 },
      { key: 'samples', header: 'Samples', type: 'number', width: 9 },
      { key: 'orders', header: 'Orders', type: 'number', width: 8 },
      { key: 'orderValue', header: 'Order Value (₹)', type: 'number', width: 15 },
      { key: 'firstOrder', header: 'First Order', width: 15 },
      { key: 'firstOrderDate', header: 'First Order On', type: 'date', width: 14 },
      { key: 'lastOrderDate', header: 'Last Order On', type: 'date', width: 14 },
      { key: 'convertedBy', header: 'Converted By', width: 16 },
      { key: 'conversionNote', header: 'Conversion Note', width: 34, wrap: true },
    ],
  },
  feedback: {
    label: 'Feedback Report',
    description: 'All client feedback taken in the period — feedback logged on the lead (samples / kit / offer) and the rated feedback collected on delivered sales orders.',
    build: feedbackRows,
    columns: [
      { key: 'feedbackDate', header: 'Feedback Date', type: 'date', width: 13 },
      { key: 'feedbackOn', header: 'Feedback On', width: 12 },
      { key: 'orderNumber', header: 'Order No.', width: 15 },
      { key: 'refNumber', header: 'Ref', width: 20 },
      { key: 'businessName', header: 'Business', width: 26 },
      { key: 'contactPerson', header: 'Contact', width: 18 },
      { key: 'mobileNumber', header: 'Mobile', width: 14 },
      { key: 'city', header: 'City', width: 14 },
      { key: 'businessType', header: 'Type', width: 13 },
      { key: 'executive', header: 'Executive', width: 16 },
      { key: 'stage', header: 'Funnel Stage', width: 13 },
      { key: 'note', header: 'Feedback', width: 50, wrap: true },
      { key: 'rating', header: 'Rating (1-5)', type: 'number', width: 11 },
      { key: 'quality', header: 'Quality', type: 'number', width: 9 },
      { key: 'deliveryRating', header: 'Delivery', type: 'number', width: 9 },
      { key: 'packaging', header: 'Packaging', type: 'number', width: 10 },
      { key: 'wouldReorder', header: 'Would Reorder', width: 13 },
      { key: 'sampleProducts', header: 'Samples Given', width: 30, wrap: true },
      { key: 'takenBy', header: 'Taken By', width: 16 },
      { key: 'loggedAt', header: 'Logged At', type: 'datetime', width: 18 },
    ],
  },
  'follow-ups': {
    label: 'Follow-ups Report',
    description: 'Follow-ups due in the period — open, due today, overdue and closed (with closing notes).',
    build: followUpRows,
    columns: [
      { key: 'dueDate', header: 'Due Date', type: 'date', width: 13 },
      { key: 'refNumber', header: 'Ref', width: 20 },
      { key: 'businessName', header: 'Business', width: 26 },
      { key: 'contactPerson', header: 'Contact', width: 18 },
      { key: 'mobileNumber', header: 'Mobile', width: 14 },
      { key: 'city', header: 'City', width: 14 },
      { key: 'businessType', header: 'Type', width: 13 },
      { key: 'executive', header: 'Executive', width: 16 },
      { key: 'status', header: 'Status', width: 12 },
      { key: 'leadStatus', header: 'Lead Status', width: 14 },
      { key: 'actionPoint', header: 'Action Point', width: 18 },
      { key: 'note', header: 'Reason', width: 34, wrap: true },
      { key: 'closingNote', header: 'Closing Note', width: 34, wrap: true },
      { key: 'closedBy', header: 'Closed By', width: 16 },
      { key: 'closedAt', header: 'Closed At', type: 'datetime', width: 18 },
    ],
  },
  'action-points': {
    label: 'Action Points Report',
    description: 'All currently open action points, plus the ones cleared during the period.',
    build: actionPointRows,
    columns: [
      { key: 'actionPoint', header: 'Action Point', width: 22 },
      { key: 'refNumber', header: 'Ref', width: 20 },
      { key: 'businessName', header: 'Business', width: 26 },
      { key: 'contactPerson', header: 'Contact', width: 18 },
      { key: 'mobileNumber', header: 'Mobile', width: 14 },
      { key: 'city', header: 'City', width: 14 },
      { key: 'businessType', header: 'Type', width: 13 },
      { key: 'executive', header: 'Executive', width: 16 },
      { key: 'status', header: 'Status', width: 11 },
      { key: 'leadStatus', header: 'Lead Status', width: 14 },
      { key: 'nextFollowUp', header: 'Next Follow-up', type: 'date', width: 14 },
      { key: 'clearedBy', header: 'Cleared By', width: 16 },
      { key: 'clearedAt', header: 'Cleared At', type: 'datetime', width: 18 },
    ],
  },
  kits: {
    label: 'Kits Report',
    description: 'Kits generated or delivered in the period, with products, delivery method and email count.',
    build: kitRows,
    columns: [
      { key: 'generatedAt', header: 'Generated At', type: 'datetime', width: 18 },
      { key: 'refNumber', header: 'Ref', width: 20 },
      { key: 'businessName', header: 'Business', width: 26 },
      { key: 'contactPerson', header: 'Contact', width: 18 },
      { key: 'mobileNumber', header: 'Mobile', width: 14 },
      { key: 'city', header: 'City', width: 14 },
      { key: 'businessType', header: 'Type', width: 13 },
      { key: 'executive', header: 'Executive', width: 16 },
      { key: 'kitType', header: 'Kit', width: 15 },
      { key: 'status', header: 'Status', width: 15 },
      { key: 'products', header: 'Products', type: 'number', width: 10 },
      { key: 'documents', header: 'Documents', type: 'number', width: 11 },
      { key: 'avgDiscount', header: 'Avg Discount %', type: 'number', width: 14 },
      { key: 'delivered', header: 'Delivered', width: 10 },
      { key: 'deliveryMethod', header: 'Method', width: 10 },
      { key: 'deliveredTo', header: 'Delivered To', width: 24 },
      { key: 'deliveredAt', header: 'Delivered At', type: 'datetime', width: 18 },
      { key: 'emailsSent', header: 'Emails', type: 'number', width: 8 },
    ],
  },
  emails: {
    label: 'Emails Report',
    description: 'Every kit email sent in the period — recipients, subject, status and attachments.',
    build: emailRows,
    columns: [
      { key: 'sentAt', header: 'Sent At', type: 'datetime', width: 18 },
      { key: 'refNumber', header: 'Ref', width: 20 },
      { key: 'businessName', header: 'Business', width: 26 },
      { key: 'city', header: 'City', width: 14 },
      { key: 'executive', header: 'Executive', width: 16 },
      { key: 'to', header: 'To', width: 24 },
      { key: 'cc', header: 'CC', width: 24 },
      { key: 'subject', header: 'Subject', width: 40 },
      { key: 'status', header: 'Status', width: 9 },
      { key: 'provider', header: 'Via', width: 10 },
      { key: 'attachmentCount', header: 'Files', type: 'number', width: 7 },
      { key: 'attachments', header: 'Attachments', width: 40, wrap: true },
      { key: 'sentBy', header: 'Sent By', width: 16 },
    ],
  },
  instructions: {
    label: 'Instructions Report',
    description: 'Admin instructions given in the period and whether they were actioned.',
    build: instructionRows,
    columns: [
      { key: 'givenAt', header: 'Given At', type: 'datetime', width: 18 },
      { key: 'refNumber', header: 'Ref', width: 20 },
      { key: 'businessName', header: 'Business', width: 26 },
      { key: 'city', header: 'City', width: 14 },
      { key: 'executive', header: 'Executive', width: 16 },
      { key: 'businessType', header: 'Type', width: 13 },
      { key: 'leadStatus', header: 'Lead Status', width: 14 },
      { key: 'text', header: 'Instruction', width: 50, wrap: true },
      { key: 'status', header: 'Status', width: 9 },
      { key: 'daysOpen', header: 'Days Open', type: 'number', width: 10 },
      { key: 'givenBy', header: 'Given By', width: 16 },
      { key: 'doneBy', header: 'Done By', width: 16 },
      { key: 'doneAt', header: 'Done At', type: 'datetime', width: 18 },
    ],
  },
  'exec-performance': {
    label: 'Executive Performance',
    description: 'Per-executive totals for the period: leads added, field visits, calls, kits, follow-ups closed and open workload.',
    build: execPerformanceRows,
    totals: true,
    columns: [
      { key: 'executive', header: 'Executive', width: 20 },
      { key: 'totalLeads', header: 'Total Leads', type: 'number', width: 11 },
      { key: 'leadsAdded', header: 'Leads Added', type: 'number', width: 12 },
      { key: 'visits', header: 'Field Visits', type: 'number', width: 12 },
      { key: 'calls', header: 'Calls', type: 'number', width: 8 },
      { key: 'activeDays', header: 'Field Days', type: 'number', width: 10 },
      { key: 'kitsGenerated', header: 'Kits Generated', type: 'number', width: 14 },
      { key: 'kitsDelivered', header: 'Kits Delivered', type: 'number', width: 13 },
      { key: 'samplesGiven', header: 'Samples Given', type: 'number', width: 13 },
      { key: 'feedbackTaken', header: 'Feedback Taken', type: 'number', width: 14 },
      { key: 'clientsMade', header: 'Clients Made', type: 'number', width: 12 },
      { key: 'liveLeads', header: 'Live Now', type: 'number', width: 9 },
      { key: 'turnedDown', header: 'Turned Down', type: 'number', width: 12 },
      { key: 'points', header: 'Score Points', type: 'number', width: 12 },
      { key: 'followUpsClosed', header: 'Follow-ups Closed', type: 'number', width: 16 },
      { key: 'instructionsDone', header: 'Instructions Done', type: 'number', width: 16 },
      { key: 'emailsSent', header: 'Emails Sent', type: 'number', width: 11 },
      { key: 'openFollowUps', header: 'Open Follow-ups', type: 'number', width: 15 },
      { key: 'overdueFollowUps', header: 'Overdue', type: 'number', width: 9 },
      { key: 'openActionPoints', header: 'Open Actions', type: 'number', width: 12 },
      { key: 'openInstructions', header: 'Open Instructions', type: 'number', width: 16 },
    ],
  },
  'lead-scores': {
    label: 'Lead Score Card',
    description: 'Every lead dated in the period ranked by score-card points, with its funnel stage and the points each milestone earned (0 = not yet).',
    build: leadScoreRows,
    totals: true,
    columns: [
      { key: 'score', header: 'Score', type: 'number', width: 8 },
      { key: 'refNumber', header: 'Ref', width: 20 },
      { key: 'businessName', header: 'Business', width: 26 },
      { key: 'contactPerson', header: 'Contact', width: 18 },
      { key: 'mobileNumber', header: 'Mobile', width: 14 },
      { key: 'city', header: 'City', width: 14 },
      { key: 'businessType', header: 'Type', width: 13 },
      { key: 'executive', header: 'Executive', width: 16 },
      { key: 'stage', header: 'Funnel Stage', width: 13 },
      { key: 'status', header: 'Kit Status', width: 14 },
      { key: 'kitType', header: 'Kit', width: 15 },
      { key: 'kitGenerated', header: 'Kit Generated', type: 'number', width: 12 },
      { key: 'kitDelivered', header: 'Kit Delivered', type: 'number', width: 12 },
      { key: 'sampleGiven', header: 'Samples Given', type: 'number', width: 13 },
      { key: 'visitDone', header: 'Visit Done', type: 'number', width: 10 },
      { key: 'feedbackTaken', header: 'Feedback Taken', type: 'number', width: 14 },
      { key: 'callsDone', header: 'Calls Done', type: 'number', width: 10 },
      { key: 'clientMade', header: 'Client Made', type: 'number', width: 11 },
      { key: 'sampleOrder', header: 'Sample Order', type: 'number', width: 12 },
      { key: 'repeatOrder', header: 'Repeat Orders', type: 'number', width: 13 },
      { key: 'visits', header: 'Visits', type: 'number', width: 8 },
      { key: 'calls', header: 'Calls', type: 'number', width: 8 },
      { key: 'orders', header: 'Orders', type: 'number', width: 8 },
      { key: 'clientMadeAt', header: 'Client Made On', type: 'date', width: 14 },
      { key: 'turnDownReason', header: 'Turn-down Reason', width: 30, wrap: true },
      { key: 'leadDate', header: 'Lead Date', type: 'date', width: 13 },
    ],
  },
  'daily-summary': {
    label: 'Daily Summary',
    description: 'Day-by-day activity across the period: new leads, field visits, calls, kits, follow-ups closed and emails.',
    build: dailySummaryRows,
    totals: true,
    columns: [
      { key: 'day', header: 'Date', type: 'day', width: 13 },
      { key: 'newLeads', header: 'New Leads', type: 'number', width: 11 },
      { key: 'visits', header: 'Field Visits', type: 'number', width: 12 },
      { key: 'calls', header: 'Calls', type: 'number', width: 8 },
      { key: 'kitsGenerated', header: 'Kits Generated', type: 'number', width: 14 },
      { key: 'kitsDelivered', header: 'Kits Delivered', type: 'number', width: 13 },
      { key: 'followUpsClosed', header: 'Follow-ups Closed', type: 'number', width: 16 },
      { key: 'actionPointsCleared', header: 'Actions Cleared', type: 'number', width: 14 },
      { key: 'instructionsGiven', header: 'Instructions Given', type: 'number', width: 16 },
      { key: 'instructionsDone', header: 'Instructions Done', type: 'number', width: 16 },
      { key: 'emailsSent', header: 'Emails Sent', type: 'number', width: 11 },
    ],
  },
};

const REPORT_TYPES = Object.keys(REPORTS);

/** Catalog for the client's report picker. */
const reportCatalog = () =>
  REPORT_TYPES.map((type) => ({
    type,
    label: REPORTS[type].label,
    description: REPORTS[type].description,
    columns: REPORTS[type].columns.map(({ key, header, type: colType }) => ({ key, header, type: colType || 'string' })),
  }));

/** Sums the numeric columns — the Total row on aggregate reports. */
function totalsRow(def, rows) {
  const totals = {};
  for (const c of def.columns) {
    if (c.type !== 'number') continue;
    totals[c.key] = rows.reduce((sum, r) => sum + (Number(r[c.key]) || 0), 0);
  }
  return totals;
}

/**
 * Validates the date window a report request asked for and returns its UTC
 * bounds. `fromStr`/`toStr` are IST calendar days (YYYY-MM-DD); defaults cover
 * the last 30 days. Role scoping is deliberately not part of this — the sales
 * order reports draw the same window but scope a different collection, and one
 * copy of these rules is worth far more than two that can drift apart.
 */
function dayRangeContext({ from, to, execId }) {
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const todayKey = istDayKey(new Date());
  const toStr = to || todayKey;
  const fromStr = from || istDayKey(new Date(Date.now() - 29 * 86400000));
  if (!DAY_RE.test(fromStr) || !DAY_RE.test(toStr)) {
    throw ApiError.badRequest('Dates must be in YYYY-MM-DD format');
  }
  if (fromStr > toStr) throw ApiError.badRequest('The "from" date must not be after the "to" date');
  const bounds = istBounds(fromStr, toStr);
  // Reject calendar-invalid dates (e.g. 2026-02-30) — they'd otherwise parse to
  // a rolled-over or Invalid Date and silently return the wrong day's data.
  if (
    Number.isNaN(bounds.from.getTime()) || Number.isNaN(bounds.to.getTime()) ||
    istDayKey(bounds.from) !== fromStr || istDayKey(bounds.to) !== toStr
  ) {
    throw ApiError.badRequest('One of the dates is not a valid calendar day');
  }
  if ((bounds.to - bounds.from) / 86400000 > 400) {
    throw ApiError.badRequest('Choose a date range of at most 13 months');
  }
  if (execId && !/^[0-9a-fA-F]{24}$/.test(String(execId))) {
    throw ApiError.badRequest('Invalid executive filter');
  }
  return {
    ...bounds,
    fromStr,
    toStr,
    rangeLabel: `${dmy(bounds.from)} – ${dmy(bounds.to)}`,
  };
}

/**
 * Builds the query context for a report request: the date window plus the
 * lead scope this requester may see.
 */
function buildContext(user, query) {
  const range = dayRangeContext(query);
  return {
    ...range,
    scope: reportScope(user, user.role === 'admin' ? query.execId : ''),
  };
}

async function runReport(type, ctx) {
  // Own-property lookup: a plain-object registry would otherwise accept
  // prototype-chain keys like "constructor" and crash on def.build.
  const def = Object.hasOwn(REPORTS, type) ? REPORTS[type] : null;
  if (!def) throw ApiError.badRequest(`Unknown report type "${type}"`);
  const rows = await def.build(ctx);
  return {
    type,
    label: def.label,
    columns: def.columns,
    rows,
    totals: def.totals ? totalsRow(def, rows) : null,
    // Headline figures the rows alone can't give (e.g. a conversion rate).
    summary: def.summary ? await def.summary(ctx, rows) : null,
  };
}

// ---------------------------------------------------------------------------
// Excel output
// ---------------------------------------------------------------------------

const BRAND_ARGB = 'FF8C2424';

function addSheet(wb, report, rangeLabel) {
  const ws = wb.addWorksheet(report.label.slice(0, 31));
  const colCount = report.columns.length;
  // A sheet may name the period its own rows obey — a report that describes the
  // position as it stands today must not be stamped with the window the request
  // happened to carry, or whoever the file is forwarded to reads it as a
  // period extract.
  const period = report.rangeLabel || rangeLabel;

  ws.mergeCells(1, 1, 1, Math.max(colCount, 1));
  const title = ws.getCell(1, 1);
  title.value = `Micky's CRM — ${report.label} (${period})`;
  title.font = { bold: true, size: 13, color: { argb: BRAND_ARGB } };
  ws.getRow(1).height = 22;

  if (report.summary?.length) {
    ws.mergeCells(2, 1, 2, Math.max(colCount, 1));
    const summary = ws.getCell(2, 1);
    summary.value = report.summary.map((s) => `${s.label}: ${s.value}`).join('   |   ');
    summary.font = { italic: true, color: { argb: 'FF555555' } };
  }

  const headerRow = ws.getRow(3);
  report.columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_ARGB } };
    cell.alignment = { vertical: 'middle' };
    ws.getColumn(i + 1).width = c.width || 18;
  });
  headerRow.height = 18;

  report.rows.forEach((row, ri) => {
    const xr = ws.getRow(4 + ri);
    report.columns.forEach((c, ci) => {
      const cell = xr.getCell(ci + 1);
      const v = row[c.key];
      if (v instanceof Date) {
        // exceljs writes the date's UTC clock face, so shift to IST first.
        cell.value = new Date(v.getTime() + IST_OFFSET_MS);
        cell.numFmt = c.type === 'datetime' ? 'dd mmm yyyy hh:mm' : 'dd mmm yyyy';
      } else if (v === null || v === undefined) {
        cell.value = '';
      } else {
        cell.value = v;
      }
      if (c.wrap) cell.alignment = { wrapText: true, vertical: 'top' };
    });
  });

  if (report.totals && report.rows.length) {
    const tr = ws.getRow(4 + report.rows.length);
    report.columns.forEach((c, ci) => {
      const cell = tr.getCell(ci + 1);
      if (ci === 0) cell.value = 'Total';
      else if (c.type === 'number') cell.value = report.totals[c.key] ?? '';
      cell.font = { bold: true };
      cell.border = { top: { style: 'thin' } };
    });
  }

  if (!report.rows.length) {
    ws.getCell(4, 1).value = report.rangeLabel ? 'No records.' : 'No records in this period.';
  }

  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: colCount } };
  ws.views = [{ state: 'frozen', ySplit: 3 }];
  return ws;
}

async function buildWorkbook(reports, ctx, generatedBy) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Micky's CRM";
  wb.created = new Date();
  for (const report of reports) addSheet(wb, report, ctx.rangeLabel);

  // A closing info sheet so any exported file is self-describing. Where the
  // sheets do not share one period — a workbook mixing period reports with
  // current-position ones — each is named rather than one window claimed for
  // the whole file.
  const periods = [...new Set(reports.map((r) => r.rangeLabel || ctx.rangeLabel))];
  const period = periods.length > 1
    ? reports.map((r) => `${r.label}: ${r.rangeLabel || ctx.rangeLabel}`).join('; ')
    : periods[0] || ctx.rangeLabel;

  const info = wb.addWorksheet('Report Info');
  info.getColumn(1).width = 20;
  info.getColumn(2).width = 50;
  const meta = [
    ['Generated from', "Micky's CRM"],
    ['Report(s)', reports.map((r) => r.label).join(', ')],
    ['Period', period],
    ['Generated by', generatedBy || ''],
    ['Generated at', `${dmy(new Date())} ${new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(11, 16)} IST`],
  ];
  meta.forEach(([k, v], i) => {
    info.getCell(i + 1, 1).value = k;
    info.getCell(i + 1, 1).font = { bold: true };
    info.getCell(i + 1, 2).value = v;
  });

  return wb.xlsx.writeBuffer();
}

module.exports = {
  REPORTS,
  REPORT_TYPES,
  DAILY_SUMMARY_MAX_DAYS,
  rangeDayCount,
  reportCatalog,
  dayRangeContext,
  buildContext,
  runReport,
  buildWorkbook,
  istDayKey,
};
