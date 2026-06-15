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
  role: z.enum(['admin', 'sales_exec']),
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
  floorPrice: z.coerce.number().min(0),
  isActive: z.boolean().optional(),
});

// ---------- Leads ----------
const leadSchema = z.object({
  businessName: z.string().min(2, 'Business name is required'),
  contactPerson: z.string().min(2, 'Contact person is required'),
  designation: z.string().optional().or(z.literal('')),
  mobileNumber: z.string().min(6, 'Mobile number is required'),
  email: z.string().email(),
  whatsappNumber: z.string().optional().or(z.literal('')),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  address: z.string().optional().or(z.literal('')),
  gstin: z.string().max(20).optional().or(z.literal('')),
  businessType: z.enum(BUSINESS_TYPES),
  // Optional: execs & admins self-assign; only managers must pick an exec.
  assignedExecId: objectId.optional().or(z.literal('')),
  leadSource: z.string().optional().or(z.literal('')),
  leadDate: z.coerce.date().optional(),
  internalNotes: z.string().max(4000).optional().or(z.literal('')),
});

const updateLeadSchema = leadSchema.partial();

const kitTypeSchema = z.object({
  kitType: z.enum(['distributor', 'institutional']),
});

const rateLineInputSchema = z.object({
  rateItemId: objectId,
  netRate: z.coerce.number().min(0),
});

const ratesConfirmSchema = z.object({
  rates: z.array(rateLineInputSchema).min(1, 'At least one rate line is required'),
  customTerms: z
    .object({
      paymentTerms: z.string().max(1000).optional().or(z.literal('')),
      creditPeriod: z.string().max(200).optional().or(z.literal('')),
      termsAndConditions: z.string().max(8000).optional().or(z.literal('')),
      agreementTermsAndConditions: z.string().max(12000).optional().or(z.literal('')),
    })
    .optional(),
});

const emailKitSchema = z.object({
  to: z.string().email().optional().or(z.literal('')),
  subject: z.string().max(300).optional().or(z.literal('')),
  message: z.string().max(8000).optional().or(z.literal('')),
});

// ---------- Settings ----------
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
  kitTypeSchema,
  ratesConfirmSchema,
  emailKitSchema,
  settingsSchema,
};
