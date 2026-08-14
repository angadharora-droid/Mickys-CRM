const mongoose = require('mongoose');

/**
 * A lead appointed as a sales-order customer after their kit was delivered.
 * Carries a FROZEN price list — the kit's emailed rates, reviewed/edited at
 * appointment time — plus the kit's commercial terms, frozen the same way.
 * Sales orders for this customer may contain only these items, always at
 * these rates (enforced in salesOrder.controller).
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
    // Email is the one detail kept lowercase — it's an address, not a label.
    email: { type: String, trim: true, lowercase: true, default: '' },
    gstin: { type: String, required: true, trim: true, uppercase: true },
    mobile: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, uppercase: true, default: '' },

    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', index: true },
    items: { type: [frozenItemSchema], default: [] },

    // Frozen commercial terms — captured from the kit at appointment time and
    // re-frozen on every edit, like the rates. Document prose, so (like email)
    // not forced to CAPS.
    terms: {
      paymentTerms: { type: String, trim: true, default: '' },
      creditPeriod: { type: String, trim: true, default: '' },
      // One clause per line.
      termsAndConditions: { type: String, trim: true, default: '' },
    },

    frozenAt: { type: Date, default: Date.now },
    appointedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AppointedCustomer', appointedCustomerSchema);
