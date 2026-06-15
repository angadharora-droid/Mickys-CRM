const mongoose = require('mongoose');

/**
 * Singleton settings document (key = "global").
 * Email settings configured here override .env SMTP values.
 */
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },
    email: {
      host: { type: String, default: '' },
      port: { type: Number, default: 587 },
      secure: { type: Boolean, default: false },
      user: { type: String, default: '' },
      pass: { type: String, default: '' },
      from: { type: String, default: '' },
      enabled: { type: Boolean, default: true },
      // Central mailbox BCC'd on every generated sales kit
      kitInbox: { type: String, default: '' },
    },
    company: {
      name: { type: String, default: "Micky's" },
      address: { type: String, default: '' },
      phone: { type: String, default: '' },
      email: { type: String, default: '' },
      gstNumber: { type: String, default: '' },
    },
    // Defaults merged into every generated kit's term sheet / quotation.
    kit: {
      defaultPaymentTerms: { type: String, default: '100% advance against proforma invoice.' },
      defaultCreditPeriod: { type: String, default: 'Nil' },
      termsAndConditions: {
        type: String,
        default:
          'Rates are exclusive of GST unless stated. Prices valid for 15 days from quotation date. ' +
          'Goods once sold will not be taken back. Subject to Nagpur jurisdiction.',
      },
    },
  },
  { timestamps: true }
);

settingSchema.statics.getGlobal = async function () {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) doc = await this.create({ key: 'global' });
  return doc;
};

module.exports = mongoose.model('Setting', settingSchema);
