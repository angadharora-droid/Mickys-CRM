const mongoose = require('mongoose');

/**
 * A lead appointed as a sales-order customer after their kit was delivered.
 * Carries a FROZEN price list — the kit's emailed rates, reviewed/edited at
 * appointment time. Sales orders for this customer may contain only these
 * items, always at these rates (enforced in salesOrder.controller).
 *
 * Every text detail is stored in CAPS (business requirement — matches how
 * ledgers are written in Tally).
 */
const frozenItemSchema = new mongoose.Schema(
  {
    sku: { type: String, trim: true, uppercase: true, default: '' },
    name: { type: String, required: true, trim: true, uppercase: true },
    packSize: { type: String, trim: true, uppercase: true, default: '' },
    rate: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const appointedCustomerSchema = new mongoose.Schema(
  {
    companyName: { type: String, required: true, trim: true, uppercase: true, unique: true },
    email: { type: String, trim: true, uppercase: true, default: '' },
    gstin: { type: String, trim: true, uppercase: true, default: '' },
    mobile: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, uppercase: true, default: '' },

    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', index: true },
    items: { type: [frozenItemSchema], default: [] },

    frozenAt: { type: Date, default: Date.now },
    appointedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AppointedCustomer', appointedCustomerSchema);
