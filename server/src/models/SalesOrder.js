const mongoose = require('mongoose');

const STATUSES = ['open', 'dispatched', 'cancelled'];

/**
 * A sales order built against the Tally stock mirror. Line amounts and the
 * total are computed server-side (qty × rate); `stockQtyAtOrder` freezes the
 * closing quantity at order time so availability disputes can be settled
 * later. Orders are records + PDFs only — the tax invoice still happens in
 * Tally.
 */
const salesOrderSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true }, // SO-2026-0001
    customerName: { type: String, required: true, trim: true, index: true },
    items: [
      {
        name: { type: String, required: true, trim: true },
        baseUnits: { type: String, trim: true, default: '' },
        qty: { type: Number, required: true, min: 0 },
        rate: { type: Number, default: 0, min: 0 },
        amount: { type: Number, default: 0 },
        stockQtyAtOrder: { type: Number, default: null },
      },
    ],
    total: { type: Number, default: 0 },
    notes: { type: String, trim: true, default: '' },
    status: { type: String, enum: STATUSES, default: 'open', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

const SalesOrder = mongoose.model('SalesOrder', salesOrderSchema);
SalesOrder.STATUSES = STATUSES;

module.exports = SalesOrder;
