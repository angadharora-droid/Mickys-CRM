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
    // Export Kit inputs that are commercial policy rather than per-country data:
    // the container options a full-load shipment can book, each with its rated
    // capacity band and the fixed factory-to-port transportation cost.
    export: {
      containers: {
        ft20: {
          label: { type: String, default: '20 ft Container' },
          capacityTonsMin: { type: Number, default: 15 },
          capacityTonsMax: { type: Number, default: 16 },
          portTransportInr: { type: Number, default: 75000 },
        },
        ft40: {
          label: { type: String, default: '40 ft Container' },
          capacityTonsMin: { type: Number, default: 20 },
          capacityTonsMax: { type: Number, default: 21 },
          portTransportInr: { type: Number, default: 95000 },
        },
      },
      // Boilerplate printed under the export rate card table, one clause per line.
      rateCardTerms: {
        type: String,
        default: [
          "Rates are quoted per pack and include the shipment's apportioned logistics as itemised on this card.",
          'Exports are zero-rated under GST (supply under LUT); prices exclude destination-country duties, taxes and clearance charges.',
          'Rates are indicative until confirmed by proforma invoice and are valid for 15 days from the card date.',
          'Exchange rate as printed on this card; final invoicing at the rate prevailing on the invoice date.',
          'Subject to Nagpur jurisdiction.',
        ].join('\n'),
      },
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
