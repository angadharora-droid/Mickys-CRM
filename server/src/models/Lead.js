const mongoose = require('mongoose');

const BUSINESS_TYPES = [
  'Hotel',
  'Restaurant',
  'Cloud Kitchen',
  'Caterer',
  'Distributor',
  'Institution',
  'QSR',
  'Other',
];

const KIT_TYPES = ['distributor', 'stockist', 'institutional', 'export'];

const LEAD_STATUSES = ['new', 'kit_selected', 'rates_confirmed', 'generated', 'delivered'];

/** Selectable next-action for a lead's follow-up. */
const ACTION_POINTS = [
  'Need to revisit',
  'Send Sample',
  'Send distributor kit',
  'Send institutional kit',
  'Send export kit',
];

/** Allowed forward transitions of the kit pipeline (later steps may be re-run). */
const LEAD_TRANSITIONS = {
  new: ['kit_selected'],
  kit_selected: ['rates_confirmed', 'kit_selected'], // re-selecting kit stays here
  rates_confirmed: ['generated', 'kit_selected'], // can re-edit rates or switch kit
  generated: ['delivered', 'rates_confirmed'], // can regenerate after re-confirming
  delivered: ['delivered', 'generated'], // can re-deliver / regenerate
};

/** Snapshot of one priced line at the time the kit's rates were confirmed. */
const rateLineSchema = new mongoose.Schema(
  {
    rateItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'RateItem' },
    sku: { type: String, default: '' },
    productName: { type: String, required: true },
    packSize: { type: String, default: '' },
    category: { type: String, default: '' },
    included: { type: Boolean, default: true },
    mrp: { type: Number, required: true },
    // Distributor card: `basic` = the base price (exclusive of GST); `dsp` =
    // the suggested distributor selling price (the product's institutional
    // rate). For the distributor card `netRate` holds the editable DLP, which
    // equals the Basic rate — all prices are stated exclusive of GST.
    // Both stay 0 for institutional lines.
    basic: { type: Number, default: 0 },
    dsp: { type: Number, default: 0 },
    standardNetRate: { type: Number, required: true }, // master rate at snapshot time
    netRate: { type: Number, required: true }, // exec-confirmed (may be overridden)
    suggestiveMargin: { type: Number, default: 0 },
    gst: { type: Number, required: true },
    netInclGst: { type: Number, required: true }, // netRate * (1 + gst/100)
    deviationPct: { type: Number, default: 0 }, // % below standard (0 if at/above)
    // Export kits only: shipment quantity (packs) and the weight of one pack in
    // kg — both feed the freight apportionment. Zero for domestic kit lines.
    qty: { type: Number, default: 0 },
    unitWeightKg: { type: Number, default: 0 },
  },
  { _id: false }
);

/**
 * Export-kit shipment configuration, snapshotted when the shipment is
 * confirmed. Country commercials (CIR / part-load freight) are frozen here so
 * later edits to the destination master don't silently reprice an old lead;
 * only the currency conversion uses the live daily rate at generation time.
 */
const exportConfigSchema = new mongoose.Schema(
  {
    rateType: { type: String, enum: ['distributor', 'institution'], default: 'distributor' },
    loadingType: { type: String, enum: ['full', 'part'], default: 'full' },
    containerSize: { type: String, enum: ['', 'ft20', 'ft40'], default: 'ft20' },
    currency: { type: String, enum: ['USD', 'EUR', 'GBP', 'INR'], default: 'USD' },
    countryId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExportCountry' },
    countryName: { type: String, default: '' },
    countryCode: { type: String, default: '' },
    cirPercent: { type: Number, default: 0 },
    partLoadFreightPerKg: { type: Number, default: 0 },
  },
  { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
  {
    from: String,
    to: { type: String, required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

/** A free-text internal note, authored by a team member. Each note tracks its
 *  own createdAt/updatedAt via timestamps so the timeline can show when it was
 *  added or last edited. */
const noteSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 4000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

/** A directive from an admin to the lead's assigned executive. It stays 'open'
 *  and surfaces on the exec's Follow-ups page until they mark it done. */
const instructionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 4000 },
    status: { type: String, enum: ['open', 'done'], default: 'open' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    doneBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    doneAt: { type: Date },
  },
  { timestamps: true }
);

/** An append-only log of completed CRM items (a cleared action point or a closed
 *  follow-up), so the lead keeps a history of them. Done instructions retain
 *  their own record in `instructions`, so they aren't duplicated here. */
const crmHistorySchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['action_point', 'follow_up'], required: true },
    summary: { type: String, default: '' }, // action-point value / follow-up reason note
    note: { type: String, default: '' }, // follow-up closing note
    date: { type: Date }, // follow-up due date, for context
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // who closed/cleared it
  },
  { timestamps: { createdAt: 'at', updatedAt: false } }
);

/** A manually uploaded file (photo, PDF, spreadsheet, …) stored in GridFS. */
const attachmentSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true },
    fileId: { type: String, required: true },
    contentType: { type: String, default: 'application/octet-stream' },
    size: { type: Number, default: 0 },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

const rateEditSchema = new mongoose.Schema(
  {
    productName: String,
    field: { type: String, default: 'netRate' },
    from: Number,
    to: Number,
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const generatedFileSchema = new mongoose.Schema(
  {
    docType: { type: String, required: true },
    label: { type: String, default: '' },
    fileName: { type: String, required: true },
    fileId: { type: String, default: '' },
    url: { type: String, required: true },
    static: { type: Boolean, default: false },
  },
  { _id: false }
);

/** A record of one kit email actually sent — the exact recipients, subject,
 *  message, rendered body and attachment names — kept so the team can review
 *  what went out without digging through a mailbox (SMTP sends, e.g. Hostinger,
 *  don't land in the sender's Sent folder). `reconstructed` marks entries
 *  backfilled from the legacy `delivery` summary, whose original subject/body
 *  weren't captured at send time. */
const emailLogSchema = new mongoose.Schema(
  {
    to: { type: String, default: '' },
    cc: { type: [String], default: [] },
    bcc: { type: [String], default: [] },
    subject: { type: String, default: '' },
    message: { type: String, default: '' }, // exec's custom message (blank => default body used)
    bodyHtml: { type: String, default: '' }, // full rendered HTML actually sent
    attachments: { type: [String], default: [] }, // attached file names
    provider: { type: String, default: '' }, // 'smtp' | 'resend'
    status: { type: String, default: 'sent' }, // 'sent' | 'failed'
    messageId: { type: String, default: '' },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reconstructed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const leadSchema = new mongoose.Schema(
  {
    refNumber: { type: String, required: true, unique: true, index: true },

    // ---- Step 1: client data ----
    businessName: { type: String, required: true, trim: true, index: true },
    contactPerson: { type: String, required: true, trim: true },
    designation: { type: String, trim: true, default: '' },
    mobileNumber: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, default: '' },
    whatsappNumber: { type: String, trim: true, default: '' },
    city: { type: String, required: true, trim: true, index: true },
    state: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    gstin: { type: String, trim: true, uppercase: true, default: '' },
    businessType: { type: String, enum: BUSINESS_TYPES, required: true },

    // ---- CRM metadata ----
    assignedExecId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    leadSource: { type: String, trim: true, default: '' },
    leadDate: { type: Date, default: Date.now },
    // One shared editable internal note. The legacy `notes` array remains only
    // so older records can be consolidated on their next note save.
    internalNotes: { type: String, trim: true, default: '' },
    notes: { type: [noteSchema], default: [] },

    // Admin -> exec directives for this lead. The exec marks each done once
    // actioned; open ones appear on their Follow-ups page.
    instructions: { type: [instructionSchema], default: [] },

    // History of cleared action points + closed follow-ups (instructions keep
    // their own record). Surfaced on the lead's History section.
    crmHistory: { type: [crmHistorySchema], default: [] },

    // Manually uploaded files (photos, PDFs, sheets) kept alongside the lead.
    attachments: { type: [attachmentSchema], default: [] },

    // ---- Action point ----
    // The lead's current next-action, chosen from a preset list. A standalone
    // piece of CRM metadata, independent of whether a follow-up is scheduled.
    actionPoint: { type: String, enum: ['', ...ACTION_POINTS], default: '' },

    // ---- Follow-up ----
    // A scheduled reminder: a due date with an optional note. Closing records a
    // mandatory closing note. Independent of the kit lock — it's CRM metadata.
    followUp: {
      note: { type: String, default: '' },
      date: { type: Date },
      status: { type: String, enum: ['', 'open', 'closed'], default: '' },
      closingNote: { type: String, default: '' },
      closedAt: { type: Date },
      closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },

    // ---- Kit ----
    kitType: { type: String, enum: KIT_TYPES },
    rates: { type: [rateLineSchema], default: [] },
    // Export kits only: the shipment configuration behind the rate card.
    exportConfig: { type: exportConfigSchema, default: undefined },
    customTerms: {
      paymentTerms: { type: String, default: '' },
      creditPeriod: { type: String, default: '' },
      // Editable Terms & Conditions (one clause per line) printed on the kit's
      // main document. Blank => the standard kit-type terms are used.
      termsAndConditions: { type: String, default: '' },
      // Editable distributor agreement rows. One row per line in the format:
      // Particular | Terms & Conditions. Blank => standard agreement terms.
      agreementTermsAndConditions: { type: String, default: '' },
    },

    // ---- Workflow ----
    status: { type: String, enum: LEAD_STATUSES, default: 'new', index: true },
    statusHistory: { type: [statusHistorySchema], default: [] },
    rateEditLog: { type: [rateEditSchema], default: [] },

    // ---- Edit lock ----
    // Set true automatically once a kit is generated: the lead's rates, terms,
    // kit type and regeneration are frozen until someone explicitly unlocks it
    // with the "Edit" action. The already-generated documents stay accessible.
    locked: { type: Boolean, default: false, index: true },
    // Flagged when a generated lead is changed after the fact (i.e. the live
    // data no longer matches the kit the client received, until it's regenerated).
    editedAfterGeneration: { type: Boolean, default: false },
    // Set when a referenced rate item is renamed after this lead's kit was
    // generated: the stored PDFs still show the old product name, so they are
    // lazily rebuilt (name only — prices stay snapshotted) on next download/email.
    pdfStale: { type: Boolean, default: false },

    // ---- Generated output ----
    generatedFiles: { type: [generatedFileSchema], default: [] },
    zipFile: {
      fileName: { type: String, default: '' },
      fileId: { type: String, default: '' },
      url: { type: String, default: '' },
    },
    generatedAt: { type: Date },

    // ---- Delivery ----
    delivery: {
      method: { type: String, default: '' }, // 'email' | 'manual' | 'download'
      sentTo: { type: String, default: '' },
      sentAt: { type: Date },
      status: { type: String, default: '' }, // 'sent' | 'failed'
      messageId: { type: String, default: '' },
      // For manual delivery: how/where the kit was handed over (e.g. WhatsApp).
      note: { type: String, default: '' },
    },

    // Append-only log of every kit email sent (exact recipients, subject, body
    // and attachments), so the team can review what was sent without digging
    // through a mailbox. Historic sends are backfilled as `reconstructed`.
    emailLog: { type: [emailLogSchema], default: [] },

    // Meta (Facebook/Instagram) lead-form id for leads pulled in by the Meta Ads
    // sheet sync. Blank for leads captured by hand. The sync keys off this so
    // re-running it never re-imports a row it has already seen.
    metaLeadId: { type: String, trim: true, default: '' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

leadSchema.index({ createdAt: -1 });
// One lead per Meta lead-form submission. Partial, so the many hand-entered
// leads with no Meta id aren't all treated as duplicates of each other. This is
// what makes the sheet sync safe to run concurrently with itself.
leadSchema.index(
  { metaLeadId: 1 },
  { unique: true, partialFilterExpression: { metaLeadId: { $type: 'string', $gt: '' } } }
);
leadSchema.index({ 'followUp.status': 1, 'followUp.date': 1 });
leadSchema.index({ 'instructions.status': 1 });

leadSchema.statics.canTransition = function (from, to) {
  return (LEAD_TRANSITIONS[from] || []).includes(to);
};

const Lead = mongoose.model('Lead', leadSchema);
Lead.BUSINESS_TYPES = BUSINESS_TYPES;
Lead.KIT_TYPES = KIT_TYPES;
Lead.LEAD_STATUSES = LEAD_STATUSES;
Lead.LEAD_TRANSITIONS = LEAD_TRANSITIONS;
Lead.ACTION_POINTS = ACTION_POINTS;
module.exports = Lead;
