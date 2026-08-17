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
      // Standard Mixed-Load FOB assumptions (from the official FOB price list
      // workbook): one shared payload/overhead plus per-load commercials. The
      // FOB selling price is computed from these + the FobItem cost master:
      //   logistics ₹/kg = commonCostInr / payloadKg × (1 + bufferPercent%)
      //   price = (COGS × (1 + overheadPercent%) + logistics × net wt) / (1 − marginPercent%)
      fob: {
        payloadKg: { type: Number, default: 18000 },
        overheadPercent: { type: Number, default: 25 },
        variants: {
          ft20: {
            label: { type: String, default: '20 ft FCL' },
            commonCostInr: { type: Number, default: 75000 },
            bufferPercent: { type: Number, default: 10 },
            marginPercent: { type: Number, default: 25 },
          },
          ft40: {
            label: { type: String, default: '40 ft FCL' },
            commonCostInr: { type: Number, default: 90000 },
            bufferPercent: { type: Number, default: 15 },
            marginPercent: { type: Number, default: 20 },
          },
          ton5: {
            label: { type: String, default: '5 Ton Mixed Load' },
            commonCostInr: { type: Number, default: 76060 },
            bufferPercent: { type: Number, default: 15 },
            marginPercent: { type: Number, default: 25 },
          },
        },
      },
      // Boilerplate printed under the FOB price list card, one clause per line
      // (the workbook's "Standard Quotation Conditions").
      fobRateCardTerms: {
        type: String,
        default: [
          'Prices are FOB Nhava Sheva, Incoterms® 2020 — ocean freight and insurance are quoted separately based on destination port and booking date.',
          'Rates are based on one standard mixed-load consignment with approximately 18 MT saleable payload per FCL.',
          'Minimum commercial order: one mixed-load FCL, subject to minimum SKU quantities.',
          'Rates are valid for 48 hours from the card date only.',
          'The final proforma invoice may be adjusted if actual container utilisation is materially below the standard payload.',
          'Exports are zero-rated under GST (supply under LUT); prices exclude destination-country duties, taxes and clearance charges.',
          'Subject to Nagpur jurisdiction.',
        ].join('\n'),
      },
      // Boilerplate printed under the export rate card table, one clause per line.
      rateCardTerms: {
        type: String,
        default: [
          "Rates are quoted per pack and include the shipment's apportioned logistics as itemised on this card.",
          'Exports are zero-rated under GST (supply under LUT); prices exclude destination-country duties, taxes and clearance charges.',
          'Rates are indicative until confirmed by proforma invoice and are valid for 48 hours from the card date.',
          'Subject to Nagpur jurisdiction.',
        ].join('\n'),
      },
    },
    // Sales order module. Accounts have to see an order the moment it is
    // agreed, not when someone remembers to forward it, so confirming an order
    // can mail its PDF straight to the accounts desk. Off until an admin turns
    // it on and lists the addresses.
    salesOrder: {
      accountsEmails: { type: [String], default: [] },
      emailAccountsOnConfirm: { type: Boolean, default: false },
    },
    // Daily email digest bookkeeping: the last IST day (YYYY-MM-DD) whose
    // report was emailed, so restarts/redeploys never send a day twice.
    dailyReport: {
      lastSentDay: { type: String, default: '' },
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
