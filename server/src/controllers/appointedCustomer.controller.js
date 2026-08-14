const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const AppointedCustomer = require('../models/AppointedCustomer');
const Lead = require('../models/Lead');
const { logActivity } = require('../services/activity.service');
const { searchRegex } = require('../utils/sanitize');

const pickBody = (body) => ({
  companyName: body.companyName,
  email: body.email,
  gstin: body.gstin || '',
  mobile: body.mobile,
  address: body.address,
  items: body.items.map((i) => ({
    sku: i.sku || '',
    name: i.name,
    packSize: i.packSize || '',
    rate: i.rate,
  })),
  terms: {
    paymentTerms: body.terms?.paymentTerms || '',
    creditPeriod: body.terms?.creditPeriod || '',
    termsAndConditions: body.terms?.termsAndConditions || '',
  },
});

// POST /api/sales-customers — appoint (freeze rates).
// Customers can ONLY be created from a delivered lead — never from scratch.
const createCustomer = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.body.leadId);
  if (!lead) throw ApiError.badRequest('Customers can only be appointed from a lead');
  if (lead.status !== 'delivered') {
    throw ApiError.badRequest('The kit must be delivered before this lead can be appointed as a customer');
  }

  const [byLead, byName] = await Promise.all([
    AppointedCustomer.findOne({ lead: lead._id }),
    AppointedCustomer.findOne({ companyName: String(req.body.companyName).trim().toUpperCase() }),
  ]);
  const existing = byLead || byName;
  if (existing) {
    throw ApiError.badRequest(
      `${existing.companyName} is already appointed — open it from the Customers page to edit the frozen rates`
    );
  }

  const data = pickBody(req.body);
  // Request without terms (older client) → freeze what the kit itself said.
  if (!req.body.terms) {
    data.terms = {
      paymentTerms: lead.customTerms?.paymentTerms || '',
      creditPeriod: lead.customTerms?.creditPeriod || '',
      termsAndConditions: lead.customTerms?.termsAndConditions || '',
    };
  }

  const customer = await AppointedCustomer.create({
    ...data,
    lead: lead._id,
    frozenAt: new Date(),
    appointedBy: req.user._id,
  });

  await logActivity({
    userId: req.user._id,
    action: 'CUSTOMER_APPOINTED',
    entity: 'AppointedCustomer',
    entityId: customer._id,
    details: `Appointed ${customer.companyName} as customer with ${customer.items.length} frozen rates & terms`,
    ip: req.ip,
  });

  res.status(201).json({
    success: true,
    message: `${customer.companyName} appointed — rates & terms frozen`,
    data: customer,
  });
});

// GET /api/sales-customers?search=&lead=
const listCustomers = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.lead) filter.lead = req.query.lead;
  if (req.query.search) {
    const rx = searchRegex(req.query.search);
    filter.$or = [{ companyName: rx }, { gstin: rx }, { mobile: rx }];
  }
  const customers = await AppointedCustomer.find(filter)
    .sort({ companyName: 1 })
    .limit(500)
    .populate('appointedBy', 'name');
  res.json({ success: true, data: customers });
});

// GET /api/sales-customers/:id
const getCustomer = asyncHandler(async (req, res) => {
  const customer = await AppointedCustomer.findById(req.params.id).populate('appointedBy', 'name');
  if (!customer) throw ApiError.notFound('Customer not found');
  res.json({ success: true, data: customer });
});

// PUT /api/sales-customers/:id — edit details/rates; re-freezes
const updateCustomer = asyncHandler(async (req, res) => {
  const customer = await AppointedCustomer.findById(req.params.id);
  if (!customer) throw ApiError.notFound('Customer not found');

  const data = pickBody(req.body);
  // A terms-less update (older client) keeps the frozen terms untouched.
  if (!req.body.terms) delete data.terms;
  Object.assign(customer, data);
  customer.frozenAt = new Date();
  await customer.save();

  await logActivity({
    userId: req.user._id,
    action: 'CUSTOMER_RATES_REFROZEN',
    entity: 'AppointedCustomer',
    entityId: customer._id,
    details: `Updated ${customer.companyName} — ${customer.items.length} rates & terms re-frozen`,
    ip: req.ip,
  });

  res.json({ success: true, message: `${customer.companyName} updated — rates & terms re-frozen`, data: customer });
});

// DELETE /api/sales-customers/:id — admin only (route-gated)
const deleteCustomer = asyncHandler(async (req, res) => {
  const customer = await AppointedCustomer.findByIdAndDelete(req.params.id);
  if (!customer) throw ApiError.notFound('Customer not found');

  await logActivity({
    userId: req.user._id,
    action: 'CUSTOMER_UNAPPOINTED',
    entity: 'AppointedCustomer',
    entityId: customer._id,
    details: `Removed appointed customer ${customer.companyName}`,
    ip: req.ip,
  });

  res.json({ success: true, message: `${customer.companyName} removed` });
});

module.exports = { createCustomer, listCustomers, getCustomer, updateCustomer, deleteCustomer };
