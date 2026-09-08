const mongoose = require('mongoose');

/**
 * THE ORDER PIPELINE
 *
 *   open        being worked on — editable, holds stock.
 *   confirmed   the booking exec has the customer's payment (or credit
 *               approval) and confirms the order. LOCKED against edits, still
 *               holds stock. Accounts are notified: this is their queue.
 *   invoiced    accounts keyed the tax invoice into Tally with this order's
 *               number written on it; the Tally push carried the invoice back
 *               and the CRM matched it. The goods are booked out in Tally's
 *               own figures from this point, so the CRM stops reserving them.
 *               Dispatch are notified: this is their queue.
 *   dispatched  dispatch filled in how the goods went (carrier, docket,
 *               vehicle…). The booking exec is notified.
 *   delivered   the booking exec confirms the customer received the goods.
 *   closed      the customer's feedback is in — the order's journey is done.
 *               (Also the admin's manual "close outside the pipeline" for
 *               orders that never went through Tally matching.)
 *   cancelled   never happened — locked, releases the reservation at once.
 *
 * Every step stamps its own *At field and appends to `history`, so the funnel
 * and the fulfilment report can be built from the order document alone.
 * Un-doing a step (admin only) clears the stamps of every later step, so an
 * order never claims to have been dispatched before it was invoiced.
 *
 * Stock reservation (services/stockAvailability.service.js): open and
 * confirmed reserve; invoiced and beyond never do (Tally already counts the
 * goods out); a manual close with no invoice on record keeps the settle window
 * keyed off `closedAt`; cancelled releases at once. `items[].nameKey` is the
 * normalised name every reservation join runs on.
 */

const STATUSES = ['open', 'confirmed', 'invoiced', 'dispatched', 'delivered', 'closed', 'cancelled'];

/** The forward path, in order. Cancelled sits outside it. */
const PIPELINE = ['open', 'confirmed', 'invoiced', 'dispatched', 'delivered', 'closed'];

const PAYMENT_MODES = ['upi', 'neft', 'rtgs', 'imps', 'cheque', 'cash', 'credit', 'other'];

const DISPATCH_MODES = ['courier', 'transport', 'own_vehicle', 'hand_delivery', 'customer_pickup', 'other'];

/**
 * One send of this order's PDF, whoever it went to — the manual send to the
 * customer and the automatic send to accounts on confirmation share a single
 * history so the screen can show "who has seen this order" in one list.
 * Failures are recorded too: a send that did not happen is exactly the thing
 * someone needs to see.
 */
const orderEmailSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['customer', 'accounts'], required: true },
    to: { type: [String], default: [] },
    cc: { type: [String], default: [] },
    subject: { type: String, default: '' },
    sentAt: { type: Date, default: Date.now },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    messageId: { type: String, default: '' },
    status: { type: String, enum: ['sent', 'failed'], default: 'sent' },
    error: { type: String, default: '' },
  },
  { _id: false }
);

/** One status move — the order's own audit trail. */
const historySchema = new mongoose.Schema(
  {
    from: { type: String, default: '' },
    to: { type: String, required: true },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // 'tally' when the Tally push moved the order (invoice matched).
    source: { type: String, enum: ['user', 'tally', 'system'], default: 'user' },
    note: { type: String, default: '' },
  },
  { _id: false }
);

/**
 * A Tally sales invoice matched to this order. Normally written by the stock
 * push (source 'tally'); accounts can also link one by hand when the voucher
 * was keyed without the order number on it (source 'manual').
 */
const invoiceSchema = new mongoose.Schema(
  {
    guid: { type: String, default: '' },
    voucherNumber: { type: String, default: '' },
    voucherType: { type: String, default: '' },
    date: { type: Date, default: null },
    party: { type: String, default: '' },
    amount: { type: Number, default: 0 }, // as billed, GST included
    basicValue: { type: Number, default: 0 }, // before GST (Tally's "Basic Value")
    reference: { type: String, default: '' },
    narration: { type: String, default: '' },
    orderNos: { type: String, default: '' },
    // Which field of the voucher carried this order's number.
    matchedVia: { type: String, enum: ['orderNo', 'reference', 'narration', 'manual'], default: 'manual' },
    source: { type: String, enum: ['tally', 'manual'], default: 'tally' },
    seenAt: { type: Date, default: Date.now },
    linkedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, default: '' },
  },
  { _id: false }
);

const salesOrderSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true }, // SO-2026-0001
    customerName: { type: String, required: true, trim: true, index: true },
    // Set when the order is for an appointed (rate-frozen) customer — their
    // frozen list restricts items and dictates rates.
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'AppointedCustomer' },
    items: [
      {
        name: { type: String, required: true, trim: true },
        nameKey: { type: String, trim: true, default: '', index: true },
        // Pack weight from the appointed customer's frozen list (e.g. "1 KG");
        // plain Tally-ledger orders have no weight source and leave it blank.
        packSize: { type: String, trim: true, default: '' },
        baseUnits: { type: String, trim: true, default: '' },
        qty: { type: Number, required: true, min: 0 },
        rate: { type: Number, default: 0, min: 0 },
        amount: { type: Number, default: 0 },
        stockQtyAtOrder: { type: Number, default: null },
        // What was left to sell when this order was saved, computed EXCLUDING
        // this order's own lines — so it legitimately sits this order's qty
        // above the availability the stock report shows afterwards. null means
        // the item was not in the Tally mirror at all.
        availableAtOrder: { type: Number, default: null },
      },
    ],
    total: { type: Number, default: 0 },
    notes: { type: String, trim: true, default: '' },
    status: { type: String, enum: STATUSES, default: 'open', index: true },

    // ---- Stage stamps: when the order last entered each stage ----
    confirmedAt: { type: Date, default: null, index: true },
    invoicedAt: { type: Date, default: null, index: true },
    dispatchedAt: { type: Date, default: null, index: true },
    deliveredAt: { type: Date, default: null, index: true },
    // When the order was closed. Cleared on any move back out of closed, which
    // restarts the reservation-release clock for a manual close.
    closedAt: { type: Date, default: null, index: true },
    cancelledAt: { type: Date, default: null },

    // ---- Step 1: confirmation — the payment the exec confirmed against ----
    payment: {
      mode: { type: String, enum: [...PAYMENT_MODES, ''], default: '' },
      amount: { type: Number, default: null },
      reference: { type: String, trim: true, default: '' }, // UTR / cheque no.
      receivedOn: { type: Date, default: null },
      notes: { type: String, trim: true, default: '' },
      recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      recordedAt: { type: Date, default: null },
    },

    // ---- Step 2: accounts' own check before keying the invoice (optional) ----
    accounts: {
      verifiedAt: { type: Date, default: null },
      verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      note: { type: String, trim: true, default: '' },
    },

    // ---- Step 3: the Tally invoice(s) matched to this order ----
    invoices: { type: [invoiceSchema], default: [] },

    // ---- Step 4: how the goods went ----
    dispatch: {
      mode: { type: String, enum: [...DISPATCH_MODES, ''], default: '' },
      carrier: { type: String, trim: true, default: '' }, // courier / transporter
      docketNumber: { type: String, trim: true, default: '' }, // LR / AWB / docket
      vehicleNumber: { type: String, trim: true, default: '' },
      driverName: { type: String, trim: true, default: '' },
      driverPhone: { type: String, trim: true, default: '' },
      packages: { type: Number, default: null },
      weightKg: { type: Number, default: null },
      ewayBill: { type: String, trim: true, default: '' },
      dispatchedOn: { type: Date, default: null },
      expectedDeliveryOn: { type: Date, default: null },
      remarks: { type: String, trim: true, default: '' },
      filledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      filledAt: { type: Date, default: null },
    },

    // ---- Step 5: the customer has the goods ----
    delivery: {
      deliveredOn: { type: Date, default: null },
      receivedBy: { type: String, trim: true, default: '' },
      remarks: { type: String, trim: true, default: '' },
      markedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      markedAt: { type: Date, default: null },
    },

    // ---- Step 6: what the customer thought ----
    feedback: {
      rating: { type: Number, min: 1, max: 5, default: null }, // overall
      quality: { type: Number, min: 1, max: 5, default: null },
      delivery: { type: Number, min: 1, max: 5, default: null },
      packaging: { type: Number, min: 1, max: 5, default: null },
      wouldReorder: { type: Boolean, default: null },
      comments: { type: String, trim: true, default: '' },
      submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      submittedAt: { type: Date, default: null },
    },

    history: { type: [historySchema], default: [] },

    // When accounts were emailed this order's confirmation. Cleared whenever
    // the order leaves confirmed, so re-confirming an order that has since been
    // re-opened and edited mails accounts the new version.
    accountsEmailedAt: { type: Date, default: null },
    emails: { type: [orderEmailSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

// The invoicing and dispatch queues list one status sorted by when it was
// entered; the funnel counts stamps over a booking window.
salesOrderSchema.index({ status: 1, confirmedAt: 1 });
salesOrderSchema.index({ status: 1, invoicedAt: 1 });
salesOrderSchema.index({ createdAt: -1 });
salesOrderSchema.index({ 'invoices.guid': 1 });

const SalesOrder = mongoose.model('SalesOrder', salesOrderSchema);
SalesOrder.STATUSES = STATUSES;
SalesOrder.PIPELINE = PIPELINE;
SalesOrder.PAYMENT_MODES = PAYMENT_MODES;
SalesOrder.DISPATCH_MODES = DISPATCH_MODES;

module.exports = SalesOrder;
