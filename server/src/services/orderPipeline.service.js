const mongoose = require('mongoose');
const SalesOrder = require('../models/SalesOrder');
const TallyInvoice = require('../models/TallyInvoice');
const User = require('../models/User');
const { logActivity } = require('./activity.service');
const { notifyUser } = require('./push.service');
const { istDateKey } = require('../utils/istDate');

/**
 * The order pipeline in one place: which moves are allowed and by whom, what a
 * move stamps on the order, how a Tally invoice finds its order, who gets told,
 * and how the funnel is counted. Every controller that moves an order goes
 * through applyTransition() so the stamps, the history and the reports can
 * never disagree about where an order is.
 *
 * See models/SalesOrder.js for the stage definitions.
 */

const { STATUSES, PIPELINE } = SalesOrder;

/** The stamp each stage writes when entered. `open` has none — createdAt is it. */
const STAMP = {
  confirmed: 'confirmedAt',
  invoiced: 'invoicedAt',
  dispatched: 'dispatchedAt',
  delivered: 'deliveredAt',
  closed: 'closedAt',
  cancelled: 'cancelledAt',
};

const STAGE_LABELS = {
  open: 'Booked',
  confirmed: 'Confirmed',
  invoiced: 'Invoiced',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  closed: 'Completed',
  cancelled: 'Cancelled',
};

/** Statuses that hold stock back — see services/stockAvailability.service.js. */
const RESERVING = new Set(['open', 'confirmed']);

/** Statuses an order is locked in once it reaches them (no line edits). */
const LOCKED = new Set(['confirmed', 'invoiced', 'dispatched', 'delivered', 'closed', 'cancelled']);

/**
 * What the booking exec may do through the plain status endpoint. Everything
 * else on the forward path has its own endpoint with its own form (dispatch,
 * deliver, feedback) or is written by the Tally push (invoiced); any move
 * backwards, or out of a locked status, is an admin's call — an exec who could
 * un-confirm at will would make the confirmation lock decorative.
 */
const EXEC_MOVES = {
  open: ['confirmed', 'cancelled'],
  confirmed: ['cancelled'],
};

/** Days an order may sit at a stage before the funnel calls it stuck. */
const STUCK_AFTER_DAYS = {
  open: 3,
  confirmed: 2,
  invoiced: 2,
  dispatched: 7,
  delivered: 7,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** When the order entered the stage it is in now. */
const stageSince = (order) => {
  const field = STAMP[order.status];
  return (field && order[field]) || order.createdAt;
};

const isBackward = (from, to) => PIPELINE.indexOf(to) < PIPELINE.indexOf(from);

/**
 * Moves the order and writes everything the move implies: the target stage's
 * stamp, the clearing of every later stage's stamp (an order re-opened after
 * dispatch was never dispatched as far as the funnel is concerned — the history
 * keeps the story), and one history row. Mutates the order; the caller saves.
 * Returns the previous status.
 */
function applyTransition(order, to, { user, source = 'user', note = '', at = new Date() } = {}) {
  if (!STATUSES.includes(to)) throw new Error(`Unknown sales order status "${to}"`);
  const from = order.status;
  order.status = to;

  if (to === 'cancelled') {
    order.cancelledAt = at;
  } else {
    order.cancelledAt = null;
    const idx = PIPELINE.indexOf(to);
    PIPELINE.forEach((stage, i) => {
      const field = STAMP[stage];
      if (!field) return;
      if (i === idx) order[field] = at;
      else if (i > idx) order[field] = null;
      // Earlier stages keep whatever they had: an admin who jumps an order
      // straight from open to dispatched has not confirmed it, and the blank
      // confirmedAt says so honestly.
    });
  }

  // The accounts-email claim guards against mailing twice on one
  // confirmation. An order sent back to editing, or written off, gives it up
  // so a later re-confirmation mails the (possibly changed) order again.
  if (to === 'open' || to === 'cancelled') order.accountsEmailedAt = null;

  order.history.push({ from, to, at, by: user?._id, source, note });
  return from;
}

/**
 * Whether this user may move this order to `to` through the status endpoint.
 * Returns '' when allowed, otherwise the reason to refuse.
 */
function refusalFor(user, order, to) {
  if (user.role === 'admin') return '';
  const own = String(order.createdBy?._id || order.createdBy) === String(user._id);
  if (!own) return 'You can only update your own orders';
  const allowed = EXEC_MOVES[order.status] || [];
  if (allowed.includes(to)) return '';
  if (LOCKED.has(order.status)) {
    return to === 'open'
      ? `Sales order ${order.number} is ${order.status} — only an admin can re-open it for editing`
      : `Sales order ${order.number} is ${order.status} — only an admin can change it now`;
  }
  return `Sales order ${order.number} cannot be moved from ${order.status} to ${to} here`;
}

// ---------------------------------------------------------------------------
// Notifications — every step tells the people whose queue the order just
// landed in. Fire-and-forget: notifyUser never throws, and a push hiccup must
// never fail the request (or the Tally sync) that moved the order.
// ---------------------------------------------------------------------------

async function notifyModule(moduleName, payload, { except } = {}) {
  try {
    const users = await User.find({ isActive: true, modules: moduleName }).select('_id').lean();
    for (const u of users) {
      if (except && String(u._id) === String(except)) continue;
      notifyUser(u._id, payload);
    }
  } catch (err) {
    console.error(`[pipeline] notify ${moduleName} failed: ${err.message}`);
  }
}

function notifyExec(order, payload, { except } = {}) {
  const execId = order.createdBy?._id || order.createdBy;
  if (!execId || (except && String(execId) === String(except))) return;
  notifyUser(execId, { ...payload, url: payload.url || `/sales/orders?order=${order._id}` });
}

/** What each arrival means for the people downstream. */
function announce(order, actor) {
  const money = `Rs. ${Number(order.total || 0).toLocaleString('en-IN')}`;
  switch (order.status) {
    case 'confirmed':
      notifyModule(
        'invoicing',
        {
          title: `${order.number} confirmed — invoice it in Tally`,
          body: `${order.customerName} · ${money} · payment ${paymentLabel(order.payment)}`,
          url: `/sales/invoicing?order=${order._id}`,
          tag: `so-${order._id}`,
        },
        { except: actor?._id }
      );
      break;
    case 'invoiced':
      notifyModule(
        'dispatch',
        {
          title: `${order.number} invoiced — ready to dispatch`,
          body: `${order.customerName} · ${money}${order.invoices.length ? ` · Tally invoice ${order.invoices[order.invoices.length - 1].voucherNumber}` : ''}`,
          url: `/sales/dispatch?order=${order._id}`,
          tag: `so-${order._id}`,
        },
        { except: actor?._id }
      );
      notifyExec(
        order,
        {
          title: `${order.number} invoiced in Tally`,
          body: `${order.customerName} — dispatch has been told to send it`,
          tag: `so-${order._id}`,
        },
        { except: actor?._id }
      );
      break;
    case 'dispatched':
      notifyExec(
        order,
        {
          title: `${order.number} dispatched`,
          body: `${dispatchLabel(order.dispatch)} — mark it delivered once ${order.customerName} has it`,
          tag: `so-${order._id}`,
        },
        { except: actor?._id }
      );
      break;
    case 'delivered':
      notifyExec(
        order,
        {
          title: `${order.number} delivered — collect feedback`,
          body: `Fill the feedback form for ${order.customerName} to complete the order`,
          tag: `so-${order._id}`,
        },
        { except: actor?._id }
      );
      break;
    default:
      break;
  }
}

const PAYMENT_LABELS = {
  upi: 'UPI', neft: 'NEFT', rtgs: 'RTGS', imps: 'IMPS', cheque: 'cheque', cash: 'cash', credit: 'on credit', other: 'other',
};
const paymentLabel = (p) => {
  if (!p?.mode) return 'not recorded';
  const amt = p.amount != null ? ` Rs. ${Number(p.amount).toLocaleString('en-IN')}` : '';
  return `${PAYMENT_LABELS[p.mode] || p.mode}${amt}${p.reference ? ` (${p.reference})` : ''}`;
};

const DISPATCH_LABELS = {
  courier: 'Courier', transport: 'Transport', own_vehicle: 'Own vehicle', hand_delivery: 'Hand delivery',
  customer_pickup: 'Customer pickup', other: 'Other',
};
const dispatchLabel = (d) => {
  if (!d?.mode) return 'Dispatched';
  const parts = [DISPATCH_LABELS[d.mode] || d.mode, d.carrier, d.docketNumber && `docket ${d.docketNumber}`, d.vehicleNumber];
  return parts.filter(Boolean).join(' · ');
};

// ---------------------------------------------------------------------------
// Tally invoice matching
//
// Accounts key the tax invoice in Tally with the CRM order number written on
// it — in the invoice's Order No(s) field, its Reference, or its Narration.
// The stock push carries every recent sales voucher with those three fields,
// and this is where a voucher finds its order. Matching is forgiving about
// punctuation ("SO-2026-0042", "SO 2026 42", "so-2026-0042") because the
// number is typed by hand into Tally.
// ---------------------------------------------------------------------------

const SO_NUMBER_RX = /\bSO[\s_-]*(\d{4})[\s_-]*(\d{1,5})\b/gi;

/** Every order number mentioned in a piece of text, normalised to SO-YYYY-NNNN. */
function extractOrderNumbers(text) {
  const found = new Set();
  const rx = new RegExp(SO_NUMBER_RX.source, 'gi');
  let m;
  while ((m = rx.exec(String(text || '')))) {
    // Leading zeros are re-derived, so "42", "0042" and "00042" all name
    // SO-YYYY-0042 (numbers past 9999 keep their fifth digit).
    found.add(`SO-${m[1]}-${String(Number(m[2])).padStart(4, '0')}`);
  }
  return [...found];
}

/** [{ number, via }] for one voucher, first mention of a number wins. */
function orderRefsOf(invoice) {
  const refs = new Map();
  for (const [via, text] of [
    ['orderNo', invoice.orderNos],
    ['reference', invoice.reference],
    ['narration', invoice.narration],
  ]) {
    for (const number of extractOrderNumbers(text)) {
      if (!refs.has(number)) refs.set(number, via);
    }
  }
  return [...refs.entries()].map(([number, via]) => ({ number, via }));
}

const sameDay = (a, b) => (a && b ? istDateKey(a) === istDateKey(b) : !a && !b);

const invoiceKey = (inv) => inv.guid || `${inv.voucherNumber}|${inv.date ? istDateKey(inv.date) : ''}`;

/**
 * Keeps a copy of every voucher the push carried, matched or not, for the
 * daily report's revenue figures (models/TallyInvoice.js). Best effort: a
 * mirror failure is logged and never stops the matching.
 */
async function mirrorInvoice(inv, refs, orderIds, syncedAt) {
  try {
    await TallyInvoice.updateOne(
      { key: invoiceKey(inv) },
      {
        $set: {
          guid: inv.guid || '',
          voucherNumber: inv.voucherNumber || '',
          voucherType: inv.voucherType || '',
          date: inv.date || null,
          party: inv.party || '',
          amount: inv.amount || 0,
          basicValue: inv.basicValue || 0,
          salesLedgerValue: inv.salesLedgerValue || 0,
          itemValue: inv.itemValue || 0,
          tax: inv.tax || 0,
          reference: inv.reference || '',
          narration: inv.narration || '',
          orderNos: inv.orderNos || '',
          orderNumbers: refs.map((r) => r.number),
          orders: orderIds,
          lastSeenAt: syncedAt,
        },
        $setOnInsert: { firstSeenAt: syncedAt },
      },
      { upsert: true }
    );
  } catch (err) {
    console.error(`[pipeline] invoice mirror failed for ${inv.voucherNumber || inv.guid}: ${err.message}`);
  }
}

/**
 * Writes the vouchers of one Tally push onto their orders and moves each
 * matched order to `invoiced` when it is still upstream of that. Idempotent
 * across pushes: a voucher already on the order (by Tally GUID, or by number +
 * date for exports without one) is refreshed, not duplicated, and an order
 * already past invoiced is left where it is. A voucher naming a cancelled
 * order is recorded on it and reported, never used to revive it — someone has
 * to look at that. Every voucher, matched or not, is also mirrored for the
 * daily revenue report.
 */
async function matchInvoices(invoices, { syncedAt = new Date(), actor } = {}) {
  const summary = {
    vouchers: invoices.length,
    withOrderNo: 0,
    matched: 0, // voucher↔order pairs written
    advanced: [], // order numbers moved to invoiced by this push
    unknown: [], // { number, voucherNumber } order numbers no order has
    cancelled: [], // { number, voucherNumber } vouchers naming cancelled orders
  };

  for (const inv of invoices) {
    const refs = orderRefsOf(inv);
    const orderIds = [];
    if (!refs.length) {
      await mirrorInvoice(inv, refs, orderIds, syncedAt);
      continue;
    }
    summary.withOrderNo += 1;

    for (const { number, via } of refs) {
      const order = await SalesOrder.findOne({ number }).populate('createdBy', 'name');
      if (!order) {
        summary.unknown.push({ number, voucherNumber: inv.voucherNumber });
        continue;
      }
      orderIds.push(order._id);

      const record = {
        guid: inv.guid || '',
        voucherNumber: inv.voucherNumber || '',
        voucherType: inv.voucherType || '',
        date: inv.date || null,
        party: inv.party || '',
        amount: inv.amount || 0,
        basicValue: inv.basicValue || 0,
        reference: inv.reference || '',
        narration: inv.narration || '',
        orderNos: inv.orderNos || '',
        matchedVia: via,
        source: 'tally',
        seenAt: syncedAt,
      };
      const existing = order.invoices.find((i) =>
        inv.guid ? i.guid === inv.guid : i.voucherNumber === record.voucherNumber && sameDay(i.date, record.date)
      );
      if (existing) Object.assign(existing, record);
      else order.invoices.push(record);
      summary.matched += 1;

      if (order.status === 'open' || order.status === 'confirmed') {
        const from = applyTransition(order, 'invoiced', {
          source: 'tally',
          at: syncedAt,
          note: `Tally invoice ${record.voucherNumber || '(no number)'} for ${record.party || 'party'} — order number found in ${via === 'orderNo' ? 'Order No(s)' : via}`,
        });
        await order.save();
        summary.advanced.push(order.number);
        await logActivity({
          userId: actor?._id,
          action: 'SALES_ORDER_STATUS',
          entity: 'SalesOrder',
          entityId: order._id,
          meta: { status: 'invoiced', from, source: 'tally', voucherNumber: record.voucherNumber },
          details:
            `Sales order ${order.number} marked invoiced — Tally invoice ${record.voucherNumber || '(no number)'}` +
            `${record.date ? ` dated ${istDateKey(record.date)}` : ''} for ${record.party || order.customerName}` +
            (from === 'open' ? ' (invoiced while still open — never confirmed in the CRM)' : ''),
        });
        announce(order, actor);
      } else {
        if (order.status === 'cancelled') {
          summary.cancelled.push({ number, voucherNumber: inv.voucherNumber });
        } else if (!order.invoicedAt) {
          // A manual close from before Tally matching existed: the invoice is
          // evidence Tally has the goods out, so the reservation can go now.
          order.invoicedAt = record.date || syncedAt;
        }
        await order.save();
      }
    }
    await mirrorInvoice(inv, refs, orderIds, syncedAt);
  }

  return summary;
}

/**
 * Accounts linking an invoice by hand — the voucher was keyed without the
 * order number on it, or the push has not run yet. Same effect as a matched
 * push. Mutates and saves the order; returns the previous status.
 */
async function linkInvoiceManually(order, { voucherNumber, date, amount, note }, user) {
  order.invoices.push({
    voucherNumber,
    date: date || null,
    amount: amount || 0,
    party: order.customerName,
    matchedVia: 'manual',
    source: 'manual',
    seenAt: new Date(),
    linkedBy: user._id,
    note: note || '',
  });
  let from = order.status;
  if (order.status === 'open' || order.status === 'confirmed') {
    from = applyTransition(order, 'invoiced', {
      user,
      note: `Invoice ${voucherNumber} linked by ${user.name}${note ? ` — ${note}` : ''}`,
    });
  } else if (!order.invoicedAt) {
    order.invoicedAt = date || new Date();
  }
  await order.save();
  // If the push has already mirrored this voucher, point it at the order too,
  // so the daily report can name the order beside the invoice.
  await TallyInvoice.updateOne(
    { voucherNumber },
    { $addToSet: { orders: order._id, orderNumbers: order.number } }
  ).catch((err) => console.error(`[pipeline] could not link mirrored invoice ${voucherNumber}: ${err.message}`));
  return from;
}

// ---------------------------------------------------------------------------
// The funnel
// ---------------------------------------------------------------------------

const avg = (nums) => (nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null);
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * How the orders booked in a window have progressed. Each stage counts the
 * orders that REACHED it (its stamp is set) — the classic funnel read — and
 * separately the orders sitting at it right now, which is the actionable
 * number. Cancelled orders are taken out of the funnel and reported beside it:
 * an order cancelled after dispatch did not "drop out at confirmation", and
 * folding it into the stages would say so.
 */
async function funnel({ from, to, execId, mine } = {}) {
  const match = {};
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = from;
    if (to) match.createdAt.$lte = to;
  }
  const scopeId = execId || mine;
  if (scopeId && mongoose.isValidObjectId(scopeId)) match.createdBy = new mongoose.Types.ObjectId(String(scopeId));

  const orders = await SalesOrder.find(match)
    .select('status total createdAt confirmedAt invoicedAt dispatchedAt deliveredAt closedAt cancelledAt feedback')
    .lean();

  const now = Date.now();
  const live = orders.filter((o) => o.status !== 'cancelled');
  const cancelled = orders.filter((o) => o.status === 'cancelled');

  const reachedBy = (o, stage) => (stage === 'open' ? true : Boolean(o[STAMP[stage]]));
  const enteredAt = (o, stage) => (stage === 'open' ? o.createdAt : o[STAMP[stage]]);

  let previous = null;
  const stages = PIPELINE.map((stage) => {
    const reached = live.filter((o) => reachedBy(o, stage));
    const current = live.filter((o) => o.status === stage);
    const limit = STUCK_AFTER_DAYS[stage];
    const stuck = limit
      ? current.filter((o) => (now - new Date(enteredAt(o, stage)).getTime()) / DAY_MS > limit)
      : [];
    const oldestDays = current.length
      ? Math.max(...current.map((o) => (now - new Date(enteredAt(o, stage)).getTime()) / DAY_MS))
      : 0;
    // Time it took the orders that made it here to get here from the stage
    // before — the lead time the funnel is really asking about.
    const days = previous
      ? reached
          .filter((o) => enteredAt(o, previous) && enteredAt(o, stage))
          .map((o) => (new Date(enteredAt(o, stage)) - new Date(enteredAt(o, previous))) / DAY_MS)
          .filter((d) => d >= 0)
      : [];
    const row = {
      key: stage,
      label: STAGE_LABELS[stage],
      reached: reached.length,
      reachedValue: round2(reached.reduce((s, o) => s + (o.total || 0), 0)),
      current: current.length,
      currentValue: round2(current.reduce((s, o) => s + (o.total || 0), 0)),
      stuck: stuck.length,
      stuckAfterDays: limit || null,
      oldestDays: round1(oldestDays),
      avgDaysFromPrevious: days.length ? round1(avg(days)) : null,
      conversion: null,
    };
    previous = stage;
    return row;
  });
  // Conversion from the stage before, once every stage is counted.
  stages.forEach((s, i) => {
    if (i === 0) return;
    const prev = stages[i - 1].reached;
    s.conversion = prev ? Math.round((s.reached / prev) * 100) : null;
  });

  const withFeedback = live.filter((o) => o.feedback?.submittedAt);
  const ratings = withFeedback.map((o) => o.feedback.rating).filter((r) => r != null);
  const feedback = {
    count: withFeedback.length,
    avgRating: round1(avg(ratings)),
    wouldReorder: withFeedback.filter((o) => o.feedback.wouldReorder === true).length,
    wouldNotReorder: withFeedback.filter((o) => o.feedback.wouldReorder === false).length,
  };

  return {
    totals: {
      booked: live.length,
      value: round2(live.reduce((s, o) => s + (o.total || 0), 0)),
      cancelled: cancelled.length,
      cancelledValue: round2(cancelled.reduce((s, o) => s + (o.total || 0), 0)),
    },
    stages,
    feedback,
  };
}

module.exports = {
  STAMP,
  STAGE_LABELS,
  RESERVING,
  LOCKED,
  STUCK_AFTER_DAYS,
  stageSince,
  isBackward,
  applyTransition,
  refusalFor,
  announce,
  paymentLabel,
  dispatchLabel,
  extractOrderNumbers,
  matchInvoices,
  linkInvoiceManually,
  funnel,
};
