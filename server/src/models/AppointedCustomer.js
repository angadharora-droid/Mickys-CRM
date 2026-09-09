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
    // GST rate (%) on this product, from the kit's rate card. null on lists
    // frozen before GST was recorded — orders then fall back to the default
    // rate in Sales Order settings until the customer is re-frozen.
    gst: { type: Number, default: null, min: 0, max: 100 },
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
    // Whether the frozen rates are quoted exclusive of GST (the distributor
    // and institutional rate cards) or inclusive (the B2C MRP card). Every
    // order for this customer is priced on this basis — it is part of the
    // freeze, so the order screen cannot flip it.
    gstBasis: { type: String, enum: ['exclusive', 'inclusive'], default: 'exclusive' },

    // Frozen commercial terms — captured from the kit at appointment time and
    // re-frozen on every edit, like the rates. Document prose, so (like email)
    // not forced to CAPS.
    terms: {
      paymentTerms: { type: String, trim: true, default: '' },
      creditPeriod: { type: String, trim: true, default: '' },
      // One clause per line.
      termsAndConditions: { type: String, trim: true, default: '' },
    },

    // Last day these frozen rates may be booked against, inclusive and judged
    // in IST. There is no default period — the admin states it when appointing
    // and re-states it on every edit, since editing re-freezes the rates.
    // null means "no validity recorded": everyone appointed before validity
    // existed, who keeps trading while the admin works through the list.
    validUntil: { type: Date, default: null },

    frozenAt: { type: Date, default: Date.now },
    appointedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AppointedCustomer', appointedCustomerSchema);
