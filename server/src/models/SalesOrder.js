const mongoose = require('mongoose');

const STATUSES = ['open', 'confirmed', 'closed', 'cancelled'];

/**
 * A sales order built against the Tally stock mirror. Line amounts and the
 * total are computed server-side (qty × rate); `stockQtyAtOrder` and
 * `availableAtOrder` record the stock position the order was saved against, so
 * availability disputes can be settled later. Both are refreshed on every
 * edit, so they describe the last save rather than the original booking.
 * Orders are records + PDFs only — the tax invoice still happens in Tally.
 *
 * THE FOUR STATUSES
 *   open       still being worked on — editable, and holds stock.
 *   confirmed  agreed with the customer — LOCKED against edits, still holds
 *              stock. Un-confirming is admin-only, or the lock means nothing.
 *   closed     the goods have gone and the invoice is in Tally — locked, and
 *              the stock reservation is released.
 *   cancelled  never happened — locked, releases the reservation at once.
 *
 * An order reserves stock while it is holding goods (see
 * services/stockAvailability.service.js): `closedAt` is the clock that releases
 * the reservation once Tally has had time to catch up, and `items[].nameKey` is
 * the normalised name every reservation join runs on.
 */

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
    // When the order was closed. Cleared on any move back out of closed, which
    // restarts the release clock.
    closedAt: { type: Date, default: null, index: true },
    // When accounts were emailed this order's confirmation. Cleared whenever
    // the order leaves confirmed, so re-confirming an order that has since been
    // re-opened and edited mails accounts the new version.
    accountsEmailedAt: { type: Date, default: null },
    emails: { type: [orderEmailSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

const SalesOrder = mongoose.model('SalesOrder', salesOrderSchema);
SalesOrder.STATUSES = STATUSES;

module.exports = SalesOrder;
