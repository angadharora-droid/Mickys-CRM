const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const AppointedCustomer = require('../models/AppointedCustomer');
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
});

// POST /api/sales-customers — appoint (freeze rates)
const createCustomer = asyncHandler(async (req, res) => {
  const existing = await AppointedCustomer.findOne({
    companyName: String(req.body.companyName).trim().toUpperCase(),
  });
  if (existing) {
    throw ApiError.badRequest(
      `${existing.companyName} is already appointed — open it from the Customers page to edit the frozen rates`
    );
  }

  const customer = await AppointedCustomer.create({
    ...pickBody(req.body),
    lead: req.body.leadId || undefined,
    frozenAt: new Date(),
    appointedBy: req.user._id,
  });

  await logActivity({
    userId: req.user._id,
    action: 'CUSTOMER_APPOINTED',
    entity: 'AppointedCustomer',
    entityId: customer._id,
    details: `Appointed ${customer.companyName} as customer with ${customer.items.length} frozen rates`,
    ip: req.ip,
  });

  res.status(201).json({
    success: true,
    message: `${customer.companyName} appointed — rates frozen`,
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

  Object.assign(customer, pickBody(req.body));
  customer.frozenAt = new Date();
  await customer.save();

  await logActivity({
    userId: req.user._id,
    action: 'CUSTOMER_RATES_REFROZEN',
    entity: 'AppointedCustomer',
    entityId: customer._id,
    details: `Updated ${customer.companyName} — ${customer.items.length} rates re-frozen`,
    ip: req.ip,
  });

  res.json({ success: true, message: `${customer.companyName} updated — rates re-frozen`, data: customer });
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
