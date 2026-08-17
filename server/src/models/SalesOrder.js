const mongoose = require('mongoose');

const STATUSES = ['open', 'dispatched', 'cancelled'];

/**
 * A sales order built against the Tally stock mirror. Line amounts and the
 * total are computed server-side (qty × rate); `stockQtyAtOrder` and
 * `availableAtOrder` record the stock position the order was saved against, so
 * availability disputes can be settled later. Both are refreshed on every
 * edit, so they describe the last save rather than the original booking.
 * Orders are records + PDFs only — the tax invoice still happens in Tally.
 *
 * An order also reserves stock while it is holding goods (see
 * services/stockAvailability.service.js): `dispatchedAt` is the clock that
 * releases the reservation once Tally has had time to catch up, and
 * `items[].nameKey` is the normalised name every reservation join runs on.
 */
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
    // When the order was marked dispatched. Cleared whenever it moves back to
    // open or is cancelled, which restarts the release clock.
    dispatchedAt: { type: Date, default: null, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

const SalesOrder = mongoose.model('SalesOrder', salesOrderSchema);
SalesOrder.STATUSES = STATUSES;

module.exports = SalesOrder;
