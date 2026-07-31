const { z } = require('zod');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

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

const ACTION_POINTS = [
  'Need to revisit',
  'Send Sample',
  'Send distributor kit',
  'Send institutional kit',
  'Send export kit',
];

// ---------- Auth ----------
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

// ---------- Users ----------
const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: z.enum(['admin', 'sales_exec', 'pr_manager']),
  employeeCode: z.string().min(1).max(20).optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const updateUserSchema = createUserSchema.partial().extend({
  password: z.string().min(8).optional().or(z.literal('')),
  isActive: z.boolean().optional(),
});

// ---------- Rate master ----------
const rateItemSchema = z.object({
  sku: z.string().min(1),
  productName: z.string().min(2),
  packSize: z.string().optional().or(z.literal('')),
  category: z.string().optional().or(z.literal('')),
  kitType: z.enum(['distributor', 'institutional']),
  mrp: z.coerce.number().min(0),
  netRate: z.coerce.number().min(0),
  suggestiveMargin: z.coerce.number().min(0).max(100).optional(),
  gst: z.coerce.number().min(0).max(100),
  isActive: z.boolean().optional(),
});

// ---------- Leads ----------
const leadSchema = z.object({
  businessName: z.string().min(2, 'Business name is required'),
  contactPerson: z.string().min(2, 'Contact person is required'),
  designation: z.string().optional().or(z.literal('')),
  mobileNumber: z.string().min(6, 'Mobile number is required'),
  email: z.string().email().optional().or(z.literal('')),
  whatsappNumber: z.string().optional().or(z.literal('')),
  city: z.string().min(1, 'City is required'),
  state: z.string().optional().or(z.literal('')),
  address: z.string().optional().or(z.literal('')),
  gstin: z.string().max(20).optional().or(z.literal('')),
  businessType: z.enum(BUSINESS_TYPES),
  // Optional: execs & admins self-assign; only managers must pick an exec.
  assignedExecId: objectId.optional().or(z.literal('')),
  leadSource: z.string().optional().or(z.literal('')),
  leadDate: z.coerce.date().optional(),
  internalNotes: z.string().max(4000).optional().or(z.literal('')),
  // CRM metadata captured at creation — the lead's next action and an optional
  // first follow-up (date + note).
  actionPoint: z.enum(ACTION_POINTS).optional().or(z.literal('')),
  followUpDate: z.union([z.literal(''), z.coerce.date()]).optional(),
  followUpNote: z.string().max(4000).optional().or(z.literal('')),
});

const updateLeadSchema = leadSchema.partial();

// Bulk hand-off from the lead list. Unlike single-lead assignment (execs only),
// the target here may be any active user — admin and PR manager included.
const bulkReassignSchema = z.object({
  leadIds: z.array(objectId).min(1, 'Select at least one lead').max(200),
  assignedExecId: objectId,
});

const kitTypeSchema = z.object({
  kitType: z.enum(['distributor', 'stockist', 'institutional', 'export']),
});

const rateLineInputSchema = z.object({
  rateItemId: objectId,
  netRate: z.coerce.number().min(0),
  included: z.boolean().optional(),
});

const customTermsSchema = z.object({
  paymentTerms: z.string().max(1000).optional().or(z.literal('')),
  creditPeriod: z.string().max(200).optional().or(z.literal('')),
  termsAndConditions: z.string().max(8000).optional().or(z.literal('')),
  agreementTermsAndConditions: z.string().max(12000).optional().or(z.literal('')),
});

const ratesConfirmSchema = z.object({
  rates: z.array(rateLineInputSchema).min(1, 'At least one rate line is required'),
  customTerms: customTermsSchema.optional(),
});

// Regenerating from the Deliver step may carry the latest edited terms so the
// rebuilt PDFs reflect them (body is optional — a bare regenerate is still valid).
const generateKitSchema = z.object({
  customTerms: customTermsSchema.optional(),
});

// Standalone save of the editable price-card / agreement terms.
const saveTermsSchema = z.object({
  customTerms: customTermsSchema,
});

const noteSchema = z.object({
  text: z.string().trim().min(1, 'Note text is required').max(4000),
});

const instructionSchema = z.object({
  text: z.string().trim().min(1, 'Instruction text is required').max(4000),
});

const actionPointSchema = z.object({
  actionPoint: z.enum(ACTION_POINTS).optional().or(z.literal('')),
});

const followUpSchema = z.object({
  // Optional free-text reason for the follow-up.
  note: z.string().max(4000).optional().or(z.literal('')),
  // 'YYYY-MM-DD' string (or '' to clear the follow-up).
  date: z.union([z.literal(''), z.coerce.date()]).optional(),
});

const closeFollowUpSchema = z.object({
  closingNote: z.string().trim().min(1, 'A closing note is required').max(4000),
});

const manualDeliverySchema = z.object({
  // How/where the kit was handed over (e.g. WhatsApp, hand delivered).
  note: z.string().max(500).optional().or(z.literal('')),
  // Optional recipient label (name / number / channel).
  sentTo: z.string().max(200).optional().or(z.literal('')),
});

const emailKitSchema = z.object({
  to: z.string().email().optional().or(z.literal('')),
  // One or more CC addresses, comma-separated.
  cc: z
    .string()
    .max(500)
    .optional()
    .refine(
      (val) => !val || val.split(',').every((e) => z.string().email().safeParse(e.trim()).success),
      { message: 'Enter valid CC email address(es), separated by commas' }
    ),
  subject: z.string().max(300).optional().or(z.literal('')),
  message: z.string().max(8000).optional().or(z.literal('')),
});

// ---------- Export kit ----------
const exportCountrySchema = z.object({
  name: z.string().min(2, 'Country name is required'),
  code: z.string().max(3).optional().or(z.literal('')),
  cirPercent: z.coerce.number().min(0).max(100),
  partLoadFreightPerKg: z.coerce.number().min(0),
  isActive: z.boolean().optional(),
});

// Manual override of the stored daily rates (INR per 1 unit of currency).
const exchangeRatesSchema = z.object({
  inrPer: z
    .object({
      USD: z.coerce.number().positive(),
      EUR: z.coerce.number().positive(),
      GBP: z.coerce.number().positive(),
    })
    .partial()
    .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one rate' }),
});

// One shipment product. Weight is optional (defaults to the pack size parsed
// off the master); '' / null mean "not provided".
const exportLineSchema = z.object({
  rateItemId: objectId,
  qty: z.coerce.number().int().min(1),
  unitWeightKg: z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.coerce.number().positive().optional()
  ),
  netRate: z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.coerce.number().min(0).optional()
  ),
});

const requireContainerOnFullLoad = [
  (v) => v.loadingType !== 'full' || Boolean(v.containerSize),
  { message: 'Container size is required for a full-load shipment', path: ['containerSize'] },
];

const exportShipmentBase = z.object({
  rateType: z.enum(['distributor', 'institution']),
  loadingType: z.enum(['full', 'part']),
  containerSize: z.enum(['ft20', 'ft40']).optional(),
  countryId: objectId,
  currency: z.enum(['USD', 'EUR', 'GBP', 'INR']),
  lines: z.array(exportLineSchema).min(1, 'Select at least one product'),
});

// Standalone computation (the live preview shown in the export step).
const exportRateCardSchema = exportShipmentBase.refine(...requireContainerOnFullLoad);

// Confirming an export lead's shipment (may carry edited T&C for the card).
const exportConfirmSchema = exportShipmentBase
  .extend({ customTerms: customTermsSchema.optional() })
  .refine(...requireContainerOnFullLoad);

// ---------- Settings ----------
const exportContainerSchema = z.object({
  label: z.string().max(60).optional(),
  capacityTonsMin: z.coerce.number().min(0).optional(),
  capacityTonsMax: z.coerce.number().min(0).optional(),
  portTransportInr: z.coerce.number().min(0).optional(),
});

const settingsSchema = z.object({
  email: z
    .object({
      host: z.string().optional(),
      port: z.coerce.number().optional(),
      secure: z.boolean().optional(),
      user: z.string().optional(),
      pass: z.string().optional(),
      from: z.string().optional(),
      enabled: z.boolean().optional(),
      kitInbox: z.string().email().optional().or(z.literal('')),
    })
    .optional(),
  company: z
    .object({
      name: z.string().optional(),
      address: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      gstNumber: z.string().optional(),
    })
    .optional(),
  kit: z
    .object({
      defaultPaymentTerms: z.string().max(1000).optional(),
      defaultCreditPeriod: z.string().max(200).optional(),
      termsAndConditions: z.string().max(8000).optional(),
    })
    .optional(),
  export: z
    .object({
      containers: z
        .object({
          ft20: exportContainerSchema.optional(),
          ft40: exportContainerSchema.optional(),
        })
        .optional(),
      rateCardTerms: z.string().max(8000).optional(),
    })
    .optional(),
});

module.exports = {
  objectId,
  BUSINESS_TYPES,
  loginSchema,
  changePasswordSchema,
  createUserSchema,
  updateUserSchema,
  rateItemSchema,
  leadSchema,
  updateLeadSchema,
  bulkReassignSchema,
  kitTypeSchema,
  ratesConfirmSchema,
  generateKitSchema,
  saveTermsSchema,
  noteSchema,
  instructionSchema,
  actionPointSchema,
  followUpSchema,
  closeFollowUpSchema,
  manualDeliverySchema,
  emailKitSchema,
  settingsSchema,
  exportCountrySchema,
  exchangeRatesSchema,
  exportRateCardSchema,
  exportConfirmSchema,
};
