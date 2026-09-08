const Lead = require('../models/Lead');
const AppointedCustomer = require('../models/AppointedCustomer');
const SalesOrder = require('../models/SalesOrder');
const Setting = require('../models/Setting');

/**
 * THE LEAD SCORE CARD
 *
 * Every lead earns points as the team works it. The rules below are the
 * milestones; the points per milestone live in Setting.leadScore (defaults
 * here) so an admin can tune the weights without a deploy. Each milestone is
 * earned ONCE — "has this ever happened to the lead" — except repeat orders,
 * which pay per order. So the card reads as a running total of achievement,
 * not a snapshot that drops when a kit is switched or a client goes quiet.
 *
 *   newLead        the lead exists                       (0 by default)
 *   kitGenerated   a kit was generated (lead.generatedAt)
 *   kitDelivered   a kit reached the client (lead.delivery.sentAt)
 *   sampleGiven    samples were logged as given (lead.samples)
 *   visitDone      at least one FIELD visit (visitReports, type field)
 *   feedbackTaken  feedback logged on the lead, or on one of its orders
 *   callsDone      at least `callsRequired` calls (visitReports, type call)
 *   clientMade     the lead became a client (lead.clientMadeAt)
 *   sampleOrder    the first sales order booked for the client
 *   repeatOrder    every further sales order, points × count
 *
 * Orders are joined through the appointed customer (AppointedCustomer.lead →
 * SalesOrder.customer); cancelled orders never count.
 *
 * THE LEAD STATUS FUNNEL (Lead.stage) is managed here too, because the two
 * move together: the first activity takes a new lead live, an appointment
 * makes it a client, and every stage change is recorded in stageHistory.
 */

const RULES = [
  { key: 'newLead', label: 'New lead', defaultPoints: 0 },
  { key: 'kitGenerated', label: 'Kit generated', defaultPoints: 10 },
  { key: 'kitDelivered', label: 'Kit delivered', defaultPoints: 10 },
  { key: 'sampleGiven', label: 'Samples given', defaultPoints: 10 },
  { key: 'visitDone', label: 'Visit done', defaultPoints: 20 },
  { key: 'feedbackTaken', label: 'Feedback taken', defaultPoints: 5 },
  { key: 'callsDone', label: 'Calls done', defaultPoints: 10 },
  { key: 'clientMade', label: 'Client made', defaultPoints: 20 },
  { key: 'sampleOrder', label: 'Sample order bought', defaultPoints: 10 },
  { key: 'repeatOrder', label: 'Repeat order', defaultPoints: 5, perEvent: true },
];

const DEFAULT_POINTS = Object.fromEntries(RULES.map((r) => [r.key, r.defaultPoints]));
const DEFAULT_CALLS_REQUIRED = 2;

const toNum = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** The weights in force: saved settings over the defaults. */
function normaliseConfig(raw) {
  const saved = raw?.points ? (raw.points.toObject ? raw.points.toObject() : raw.points) : {};
  const points = {};
  for (const r of RULES) points[r.key] = Math.max(0, toNum(saved[r.key], r.defaultPoints));
  return {
    points,
    callsRequired: Math.max(1, Math.round(toNum(raw?.callsRequired, DEFAULT_CALLS_REQUIRED))),
  };
}

async function getScoreConfig() {
  const settings = await Setting.getGlobal();
  return normaliseConfig(settings.leadScore);
}

// ---------------------------------------------------------------------------
// Orders per lead
// ---------------------------------------------------------------------------

const ORDER_FIELDS = 'number status total createdAt customer feedback.submittedAt';

/**
 * Non-cancelled sales orders for a set of leads, keyed by lead id, oldest
 * first. One appointed customer per lead is the rule, but the join tolerates
 * several.
 */
async function linkedOrdersByLead(leadIds) {
  const map = new Map(leadIds.map((id) => [String(id), []]));
  if (!leadIds.length) return map;
  const customers = await AppointedCustomer.find({ lead: { $in: leadIds } }).select('_id lead').lean();
  if (!customers.length) return map;
  const leadOfCustomer = new Map(customers.map((c) => [String(c._id), String(c.lead)]));
  const orders = await SalesOrder.find({
    customer: { $in: customers.map((c) => c._id) },
    status: { $ne: 'cancelled' },
  })
    .select(ORDER_FIELDS)
    .sort({ createdAt: 1 })
    .lean();
  for (const o of orders) {
    const leadId = leadOfCustomer.get(String(o.customer));
    if (leadId && map.has(leadId)) map.get(leadId).push(o);
  }
  return map;
}

async function linkedOrders(leadId) {
  return (await linkedOrdersByLead([leadId])).get(String(leadId)) || [];
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

const time = (d) => (d ? new Date(d).getTime() : NaN);
const earliest = (arr, key) => {
  const ts = arr.map((x) => time(x[key])).filter((t) => !Number.isNaN(t));
  return ts.length ? new Date(Math.min(...ts)) : null;
};
const nth = (arr, key, n) => {
  const ts = arr.map((x) => time(x[key])).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
  return ts.length >= n ? new Date(ts[n - 1]) : null;
};

/**
 * Builds the score card for one lead: each rule with whether it is earned,
 * when, how many times, and the points it contributes; plus the total and the
 * scale (the most a lead can earn without repeat orders).
 *
 * `lead` may be a document or a lean object; `orders` are the lead's linked
 * orders (see linkedOrders) and `config` the weights (see getScoreConfig).
 */
function buildScoreCard(lead, orders = [], config = normaliseConfig()) {
  const { points, callsRequired } = config;
  const visits = lead.visitReports || [];
  const fieldVisits = visits.filter((v) => v.visitType !== 'call');
  const calls = visits.filter((v) => v.visitType === 'call');
  const samples = lead.samples || [];
  const feedbacks = lead.feedbacks || [];
  const orderFeedbacks = orders.filter((o) => o.feedback?.submittedAt);
  const feedbackAt = earliest(
    [...feedbacks.map((f) => ({ at: f.takenOn })), ...orderFeedbacks.map((o) => ({ at: o.feedback.submittedAt }))],
    'at'
  );

  const facts = {
    newLead: { earned: true, at: lead.createdAt || null, count: 1 },
    kitGenerated: { earned: Boolean(lead.generatedAt), at: lead.generatedAt || null },
    kitDelivered: { earned: Boolean(lead.delivery?.sentAt), at: lead.delivery?.sentAt || null },
    sampleGiven: { earned: samples.length > 0, at: earliest(samples, 'givenOn'), count: samples.length },
    visitDone: { earned: fieldVisits.length > 0, at: earliest(fieldVisits, 'visitDate'), count: fieldVisits.length },
    feedbackTaken: {
      earned: feedbacks.length + orderFeedbacks.length > 0,
      at: feedbackAt,
      count: feedbacks.length + orderFeedbacks.length,
    },
    callsDone: {
      earned: calls.length >= callsRequired,
      at: nth(calls, 'visitDate', callsRequired),
      count: calls.length,
      required: callsRequired,
    },
    clientMade: { earned: Boolean(lead.clientMadeAt), at: lead.clientMadeAt || null },
    sampleOrder: {
      earned: orders.length > 0,
      at: orders[0]?.createdAt || null,
      detail: orders[0]?.number || '',
    },
    repeatOrder: {
      earned: orders.length > 1,
      at: orders[1]?.createdAt || null,
      count: Math.max(orders.length - 1, 0),
      detail: orders.slice(1).map((o) => o.number).join(', '),
    },
  };

  const items = RULES.map((r) => {
    const f = facts[r.key];
    const rate = points[r.key];
    const earnedPoints = r.perEvent ? (f.count || 0) * rate : f.earned ? rate : 0;
    return {
      key: r.key,
      label: r.key === 'callsDone' ? `Calls done (at least ${callsRequired})` : r.label,
      points: rate,
      perEvent: Boolean(r.perEvent),
      earned: Boolean(f.earned),
      earnedPoints,
      count: f.count ?? (f.earned ? 1 : 0),
      required: f.required,
      at: f.at,
      detail: f.detail || '',
    };
  });

  const total = items.reduce((sum, i) => sum + i.earnedPoints, 0);
  const scale = RULES.filter((r) => !r.perEvent).reduce((sum, r) => sum + points[r.key], 0);
  return {
    total,
    scale,
    repeatOrderPoints: points.repeatOrder,
    items,
    orders: orders.map((o) => ({ number: o.number, status: o.status, total: o.total, createdAt: o.createdAt })),
  };
}

/**
 * Computes the card for a lead, stores the total when it changed (without
 * touching updatedAt — a score refresh is bookkeeping, not an edit), and
 * returns the card. Pass `orders` / `config` when already in hand.
 */
async function refreshLeadScore(lead, { orders, config } = {}) {
  const cfg = config || (await getScoreConfig());
  const linked = orders || (await linkedOrders(lead._id));
  const card = buildScoreCard(lead, linked, cfg);
  if (lead.score !== card.total) {
    await Lead.updateOne(
      { _id: lead._id },
      { $set: { score: card.total, scoreUpdatedAt: new Date() } },
      { timestamps: false }
    );
    lead.score = card.total;
  }
  return card;
}

/** Refreshes the stored score of a lead by id (no-op when it doesn't exist). */
async function refreshLeadScoreById(leadId) {
  if (!leadId) return null;
  const lead = await Lead.findById(leadId);
  if (!lead) return null;
  return refreshLeadScore(lead);
}

/**
 * The order module's hook: after an order is booked, moved or deleted, the
 * customer's lead is re-scored (and made a client if it wasn't already —
 * an order is the surest sign the client is made). Never throws: a scoring
 * hiccup must not fail the order.
 */
async function onCustomerOrdersChanged(customerId, actor) {
  try {
    if (!customerId) return;
    const customer = await AppointedCustomer.findById(customerId).select('lead').lean();
    if (!customer?.lead) return;
    const lead = await Lead.findById(customer.lead);
    if (!lead) return;
    const orders = await linkedOrders(lead._id);
    if (orders.length && lead.stage !== 'client') {
      setStage(lead, 'client', { user: actor, source: 'system', reason: `Sales order ${orders[0].number} booked` });
      await lead.save();
    }
    await refreshLeadScore(lead, { orders });
  } catch (err) {
    console.error(`[lead-score] refresh after order change failed: ${err.message}`);
  }
}

/**
 * Recomputes every lead's stored score in bulk — after the weights change,
 * and for the one-off backfill. Returns how many leads were updated.
 */
async function recomputeAllScores() {
  const config = await getScoreConfig();
  const leads = await Lead.find({})
    .select('score createdAt generatedAt delivery.sentAt samples.givenOn visitReports.visitDate visitReports.visitType feedbacks.takenOn clientMadeAt')
    .lean();
  const ordersByLead = await linkedOrdersByLead(leads.map((l) => l._id));
  const ops = [];
  for (const l of leads) {
    const card = buildScoreCard(l, ordersByLead.get(String(l._id)) || [], config);
    if (card.total !== (l.score || 0)) {
      ops.push({
        updateOne: { filter: { _id: l._id }, update: { $set: { score: card.total, scoreUpdatedAt: new Date() } }, timestamps: false },
      });
    }
  }
  if (ops.length) await Lead.bulkWrite(ops, { ordered: false });
  return { leads: leads.length, updated: ops.length };
}

// ---------------------------------------------------------------------------
// The funnel
// ---------------------------------------------------------------------------

/**
 * Moves the lead to a stage, recording the move. Returns true when the stage
 * actually changed (the caller saves). Entering `client` for the first time
 * stamps clientMadeAt; a turn-down keeps its reason on the lead until the
 * lead is revived, after which the reason survives in stageHistory only.
 */
function setStage(lead, stage, { user, reason = '', source = 'user' } = {}) {
  if (!Lead.LEAD_STAGES.includes(stage)) throw new Error(`Unknown lead stage "${stage}"`);
  if (lead.stage === stage) return false;
  const from = lead.stage || 'new';
  lead.stage = stage;
  if (stage === 'client' && !lead.clientMadeAt) lead.clientMadeAt = new Date();
  lead.turnDownReason = stage === 'turned_down' ? String(reason || '').trim() : '';
  lead.stageHistory.push({ from, to: stage, changedBy: user?._id, reason: String(reason || '').trim(), source });
  return true;
}

/**
 * The first piece of work on a new lead takes it live. Only `new` moves —
 * a client stays a client and a turned-down lead is revived by hand, on
 * purpose, not by someone logging a call against it.
 */
function markLive(lead, user, reason) {
  if (lead.stage !== 'new') return false;
  return setStage(lead, 'live', { user, source: 'system', reason });
}

module.exports = {
  RULES,
  DEFAULT_POINTS,
  DEFAULT_CALLS_REQUIRED,
  normaliseConfig,
  getScoreConfig,
  linkedOrders,
  linkedOrdersByLead,
  buildScoreCard,
  refreshLeadScore,
  refreshLeadScoreById,
  onCustomerOrdersChanged,
  recomputeAllScores,
  setStage,
  markLive,
};
