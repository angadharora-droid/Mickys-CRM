const ExcelJS = require('exceljs');
const Lead = require('../models/Lead');
const ApiError = require('../utils/ApiError');

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
};

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

/** One lean scan powering the two aggregate reports. */
function activityScan(ctx) {
  return Lead.find(ctx.scope)
    .select(
      'assignedExecId leadDate visitReports.visitDate generatedAt delivery.sentAt status ' +
      'followUp.status followUp.date crmHistory.type crmHistory.at emailLog.createdAt actionPoint ' +
      'instructions.status instructions.createdAt instructions.doneAt'
    )
    .populate({ path: 'assignedExecId', select: 'name isActive' })
    .lean();
}

async function execPerformanceRows(ctx) {
  const leads = await activityScan(ctx);
  const todayKey = istDayKey(new Date());
  const byExec = new Map();
  const fieldDays = new Map(); // exec id -> Set of IST days with at least one visit

  for (const l of leads) {
    const id = String(l.assignedExecId?._id || 'unassigned');
    if (!byExec.has(id)) {
      byExec.set(id, {
        executive: l.assignedExecId?.name || 'Unassigned',
        totalLeads: 0, leadsAdded: 0, visits: 0, activeDays: 0, kitsGenerated: 0, kitsDelivered: 0,
        followUpsClosed: 0, instructionsDone: 0, emailsSent: 0, openFollowUps: 0, overdueFollowUps: 0,
        openActionPoints: 0, openInstructions: 0,
      });
      fieldDays.set(id, new Set());
    }
    const s = byExec.get(id);
    s.totalLeads += 1;
    if (inRange(l.leadDate, ctx)) s.leadsAdded += 1;
    for (const v of l.visitReports || []) {
      if (!inRange(v.visitDate, ctx)) continue;
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
      newLeads: 0, visits: 0, kitsGenerated: 0, kitsDelivered: 0, followUpsClosed: 0,
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
    (l.visitReports || []).forEach((v) => inRange(v.visitDate, ctx) && bump(v.visitDate, 'visits'));
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
    description: 'Every client visit in the period — who was visited, what happened in the meeting, and who logged it.',
    build: visitRows,
    columns: [
      { key: 'visitDate', header: 'Visit Date', type: 'date', width: 13 },
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
    description: 'Per-executive totals for the period: leads added, visits, kits, follow-ups closed and open workload.',
    build: execPerformanceRows,
    totals: true,
    columns: [
      { key: 'executive', header: 'Executive', width: 20 },
      { key: 'totalLeads', header: 'Total Leads', type: 'number', width: 11 },
      { key: 'leadsAdded', header: 'Leads Added', type: 'number', width: 12 },
      { key: 'visits', header: 'Visits', type: 'number', width: 8 },
      { key: 'activeDays', header: 'Field Days', type: 'number', width: 10 },
      { key: 'kitsGenerated', header: 'Kits Generated', type: 'number', width: 14 },
      { key: 'kitsDelivered', header: 'Kits Delivered', type: 'number', width: 13 },
      { key: 'followUpsClosed', header: 'Follow-ups Closed', type: 'number', width: 16 },
      { key: 'instructionsDone', header: 'Instructions Done', type: 'number', width: 16 },
      { key: 'emailsSent', header: 'Emails Sent', type: 'number', width: 11 },
      { key: 'openFollowUps', header: 'Open Follow-ups', type: 'number', width: 15 },
      { key: 'overdueFollowUps', header: 'Overdue', type: 'number', width: 9 },
      { key: 'openActionPoints', header: 'Open Actions', type: 'number', width: 12 },
      { key: 'openInstructions', header: 'Open Instructions', type: 'number', width: 16 },
    ],
  },
  'daily-summary': {
    label: 'Daily Summary',
    description: 'Day-by-day activity across the period: new leads, visits, kits, follow-ups closed and emails.',
    build: dailySummaryRows,
    totals: true,
    columns: [
      { key: 'day', header: 'Date', type: 'day', width: 13 },
      { key: 'newLeads', header: 'New Leads', type: 'number', width: 11 },
      { key: 'visits', header: 'Visits', type: 'number', width: 8 },
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
  };
}

// ---------------------------------------------------------------------------
// Excel output
// ---------------------------------------------------------------------------

const BRAND_ARGB = 'FF8C2424';

function addSheet(wb, report, rangeLabel) {
  const ws = wb.addWorksheet(report.label.slice(0, 31));
  const colCount = report.columns.length;

  ws.mergeCells(1, 1, 1, Math.max(colCount, 1));
  const title = ws.getCell(1, 1);
  title.value = `Micky's CRM — ${report.label} (${rangeLabel})`;
  title.font = { bold: true, size: 13, color: { argb: BRAND_ARGB } };
  ws.getRow(1).height = 22;

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

  if (!report.rows.length) ws.getCell(4, 1).value = 'No records in this period.';

  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: colCount } };
  ws.views = [{ state: 'frozen', ySplit: 3 }];
  return ws;
}

async function buildWorkbook(reports, ctx, generatedBy) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Micky's CRM";
  wb.created = new Date();
  for (const report of reports) addSheet(wb, report, ctx.rangeLabel);

  // A closing info sheet so any exported file is self-describing.
  const info = wb.addWorksheet('Report Info');
  info.getColumn(1).width = 20;
  info.getColumn(2).width = 50;
  const meta = [
    ['Generated from', "Micky's CRM"],
    ['Report(s)', reports.map((r) => r.label).join(', ')],
    ['Period', ctx.rangeLabel],
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
