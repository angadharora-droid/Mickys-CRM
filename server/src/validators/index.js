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
// Everyone signs in with their email; admins may also use their phone number.
const phonePattern = /^\+?[\d\s()-]{7,20}$/;
const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, 'Email or phone number is required')
    .refine(
      (value) => z.string().email().safeParse(value).success || phonePattern.test(value),
      'Enter a valid email or phone number'
    ),
  password: z.string().min(1, 'Password is required'),
});

// Admins may use a short numeric PIN (4 or 6 digits) as their password for
// quick sign-in; every other role must use a text password of 8+ characters.
const ADMIN_PIN_PATTERN = /^(\d{4}|\d{6})$/;
const PASSWORD_RULE_MESSAGE =
  'Password must be at least 8 characters, or a 4/6-digit PIN for admin accounts';
const passwordAllowedFor = (role, password) =>
  password.length >= 8 || (role === 'admin' && ADMIN_PIN_PATTERN.test(password));

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  // Only a basic floor here — the role-aware rule needs the logged-in user's
  // role, which the controller checks via passwordAllowedFor().
  newPassword: z.string().min(4, PASSWORD_RULE_MESSAGE),
});

// ---------- Users ----------
const createUserBase = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: z.enum(['admin', 'sales_exec', 'pr_manager']),
  // Module assignments — which app sections the user can access.
  modules: z
    .array(z.enum(['leads', 'sales_orders', 'invoicing', 'dispatch']))
    .min(1, 'Assign at least one module')
    .optional(),
  employeeCode: z.string().min(1).max(20).optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  password: z.string().min(4, PASSWORD_RULE_MESSAGE),
});

const createUserSchema = createUserBase.superRefine((data, ctx) => {
  if (!passwordAllowedFor(data.role, data.password)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['password'], message: PASSWORD_RULE_MESSAGE });
  }
});

const updateUserSchema = createUserBase.partial().extend({
  // Role-aware check happens in the controller against the user's final role,
  // since the role field may be absent (or changing) in an update.
  password: z.string().min(4, PASSWORD_RULE_MESSAGE).optional().or(z.literal('')),
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

// Recording a visit may also derive the lead's next follow-up and action point
// from what happened in the meeting — all three land in one save.
const visitReportSchema = z.object({
  visitDate: z.coerce.date(),
  note: z.string().trim().min(1, 'Visit note is required').max(4000),
  actionPoint: z.enum(ACTION_POINTS).optional().or(z.literal('')),
  followUpDate: z.union([z.literal(''), z.coerce.date()]).optional(),
  followUpNote: z.string().max(4000).optional().or(z.literal('')),
});

// Editing an existing visit only touches the visit itself (date + note) — the
// derived follow-up / action point are managed in their own section.
const updateVisitReportSchema = visitReportSchema.pick({ visitDate: true, note: true });

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

// ---------- Per-user linked mailbox (Email settings) ----------
// Preset providers resolve host/port/secure on the server; only "custom"
// takes a free-form host/port from the client.
const emailSettingsSchema = z
  .object({
    provider: z.enum(['rediffmail', 'hostinger', 'gmail', 'custom']),
    email: z.string().trim().email('Enter a valid email address'),
    password: z.string().min(1, 'Mailbox password is required').max(200),
    host: z.string().trim().max(255).optional().or(z.literal('')),
    port: z.coerce.number().int().min(1).max(65535).optional(),
    secure: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.provider === 'custom') {
      if (!data.host) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['host'], message: 'SMTP host is required for a custom provider' });
      }
      if (!data.port) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['port'], message: 'SMTP port is required for a custom provider' });
      }
    }
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

// FOB prices are destination-independent (FOB Nhava Sheva), so no country is
// collected for them; the destination-priced rate types still require one.
const requireCountryOffFob = [
  (v) => v.rateType === 'fob' || Boolean(v.countryId),
  { message: 'Destination country is required', path: ['countryId'] },
];

const exportShipmentBase = z.object({
  rateType: z.enum(['distributor', 'institution', 'fob']),
  loadingType: z.enum(['full', 'part']),
  containerSize: z.enum(['ft20', 'ft40']).optional(),
  countryId: objectId.optional(),
  currency: z.enum(['USD', 'EUR', 'GBP', 'INR']),
  lines: z.array(exportLineSchema).min(1, 'Select at least one product'),
});

// Standalone computation (the live preview shown in the export step).
const exportRateCardSchema = exportShipmentBase
  .refine(...requireContainerOnFullLoad)
  .refine(...requireCountryOffFob);

// Confirming an export lead's shipment (may carry edited T&C for the card).
const exportConfirmSchema = exportShipmentBase
  .extend({ customTerms: customTermsSchema.optional() })
  .refine(...requireContainerOnFullLoad)
  .refine(...requireCountryOffFob);

// ---------- Settings ----------
const exportContainerSchema = z.object({
  label: z.string().max(60).optional(),
  capacityTonsMin: z.coerce.number().min(0).optional(),
  capacityTonsMax: z.coerce.number().min(0).optional(),
  portTransportInr: z.coerce.number().min(0).optional(),
});

// One Standard Mixed-Load FOB assumption set (per load option).
const fobVariantSchema = z.object({
  label: z.string().max(60).optional(),
  commonCostInr: z.coerce.number().min(0).optional(),
  bufferPercent: z.coerce.number().min(0).max(100).optional(),
  marginPercent: z.coerce.number().min(0).max(99).optional(),
});

// The accounts mailing list. The settings form sends one comma-separated
// field, older/other callers may send an array — both land as a clean,
// lowercased, deduped list, so the same address typed twice in different case
// never mails the desk twice.
const accountsEmailsSchema = z
  .preprocess(
    (v) =>
      (Array.isArray(v) ? v : String(v ?? '').split(','))
        .map((e) => String(e).trim().toLowerCase())
        .filter(Boolean),
    z
      .array(z.string().email('Enter valid accounts email address(es), separated by commas'))
      .max(20, 'At most 20 accounts email addresses')
  )
  .transform((list) => [...new Set(list)]);

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
  salesOrder: z
    .object({
      accountsEmails: accountsEmailsSchema.optional(),
      emailAccountsOnConfirm: z.boolean().optional(),
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
      fob: z
        .object({
          payloadKg: z.coerce.number().positive().optional(),
          overheadPercent: z.coerce.number().min(0).max(100).optional(),
          variants: z
            .object({
              ft20: fobVariantSchema.optional(),
              ft40: fobVariantSchema.optional(),
              ton5: fobVariantSchema.optional(),
            })
            .optional(),
        })
        .optional(),
      fobRateCardTerms: z.string().max(8000).optional(),
      rateCardTerms: z.string().max(8000).optional(),
    })
    .optional(),
});

// ---------- Meta Ads lead sheets ----------
// The pasted Google Sheet link is parsed server-side (metaSync.service's
// parseSheetUrl) to pull out the sheet id / tab gid, so this only checks it
// looks like something worth trying.
const metaSheetSchema = z.object({
  label: z.string().trim().max(120).optional().or(z.literal('')),
  url: z.string().trim().min(10, 'Paste the Google Sheet link').max(2000),
  enabled: z.boolean().optional(),
});

// ---------- Daily report ----------
// Manual "send now" trigger: an optional IST day (defaults to yesterday) and
// an optional recipient override for test sends.
const dailyReportEmailSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
    .optional(),
  to: z.string().email().optional().or(z.literal('')),
});

// ---------- Web push ----------
// Shape produced by PushSubscription.toJSON() in the browser; unknown extras
// (expirationTime, …) are stripped by zod.
const pushSubscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(1000),
    keys: z.object({
      p256dh: z.string().min(1).max(300),
      auth: z.string().min(1).max(300),
    }),
  }),
});

const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
});

// ---------- Appointed customers (rate freeze) ----------
// All details are stored in CAPS by the model except email (lowercase).
// Company, email, GSTIN, mobile and address are all required.
const appointedCustomerSchema = z.object({
  companyName: z.string().trim().min(2).max(200),
  email: z.string().trim().email().max(200),
  gstin: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z]{15}$/, 'GSTIN must be the 15-character number'),
  mobile: z.string().trim().min(7).max(20),
  address: z.string().trim().min(3).max(500),
  // The last day these rates may be booked against. Always stated, on
  // appointment and on every edit — an edit re-freezes the rates, so it has to
  // say how long the new ones stand.
  // One message for missing and unparseable alike: coercion turns an absent
  // value into an invalid date, so required_error never fires on its own.
  validUntil: z.coerce.date({
    errorMap: () => ({ message: 'Enter the date these frozen rates are valid until' }),
  }),
  items: z
    .array(
      z.object({
        sku: z.string().trim().max(40).optional().or(z.literal('')),
        name: z.string().trim().min(1).max(200),
        packSize: z.string().trim().max(60).optional().or(z.literal('')),
        rate: z.number().min(0),
      })
    )
    .min(1, 'Keep at least one item in the frozen rate list'),
  // Commercial terms frozen alongside the rates (same shape as the lead's
  // editable kit terms, minus the distributor agreement rows).
  terms: customTermsSchema.omit({ agreementTermsAndConditions: true }).optional(),
});

// Creation is only allowed from a delivered lead — leadId is mandatory.
const appointedCustomerCreateSchema = appointedCustomerSchema.extend({
  leadId: objectId,
});

// ---------- Stock availability ----------
// Batch lookup for the order dialog. POSTed rather than queried because an
// appointed customer's frozen list is dozens of long item names; excludeOrder
// is the order being edited, whose own lines must not count against it.
const stockAvailabilitySchema = z.object({
  names: z.array(z.string().trim().min(1).max(200)).min(1).max(500),
  excludeOrder: objectId.optional(),
});

// ---------- Sales orders ----------
// Amounts are recomputed server-side; the client only sends qty and rate.
const salesOrderSchema = z.object({
  customerName: z.string().trim().min(2).max(200),
  customerId: objectId.optional(), // appointed customer → frozen list enforced
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        qty: z.number().positive(),
        rate: z.number().min(0),
      })
    )
    .min(1, 'Add at least one item'),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

// Open and Confirmed are the two the status control offers; closing and
// cancelling are deliberate endings the client raises separately, and only an
// admin moves an order out of them again (see controllers/salesOrder.controller.js).
const salesOrderStatusSchema = z.object({
  status: z.enum(['open', 'confirmed', 'closed', 'cancelled']),
});

// Manual send of the order PDF to the customer. Everything is optional: the
// recipient falls back to the appointed customer's address and the subject and
// body to the standard covering note.
const salesOrderEmailSchema = z.object({
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

module.exports = {
  objectId,
  BUSINESS_TYPES,
  passwordAllowedFor,
  PASSWORD_RULE_MESSAGE,
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
  visitReportSchema,
  updateVisitReportSchema,
  actionPointSchema,
  followUpSchema,
  closeFollowUpSchema,
  manualDeliverySchema,
  emailKitSchema,
  emailSettingsSchema,
  settingsSchema,
  metaSheetSchema,
  dailyReportEmailSchema,
  exportCountrySchema,
  exchangeRatesSchema,
  exportRateCardSchema,
  exportConfirmSchema,
  pushSubscribeSchema,
  pushUnsubscribeSchema,
  stockAvailabilitySchema,
  salesOrderSchema,
  salesOrderStatusSchema,
  salesOrderEmailSchema,
  appointedCustomerSchema,
  appointedCustomerCreateSchema,
};
