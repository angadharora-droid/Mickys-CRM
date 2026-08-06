const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const User = require('../models/User');
const { getPagination, buildMeta } = require('../utils/pagination');
const { logActivity } = require('../services/activity.service');
const { searchRegex } = require('../utils/sanitize');
const { passwordAllowedFor, PASSWORD_RULE_MESSAGE } = require('../validators');

// GET /api/users?role=&search=&isActive=&page=&limit=
const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const isAdmin = req.user.role === 'admin';
  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.isActive !== undefined && req.query.isActive !== '') {
    filter.isActive = req.query.isActive === 'true';
  }
  if (req.query.search) {
    const rx = searchRegex(req.query.search);
    filter.$or = [{ name: rx }, { email: rx }, { employeeCode: rx }];
  }

  // Non-admins only ever need the lead-assignment picker: limit them to active
  // sales execs and the few fields it renders, so they can't enumerate admin
  // accounts or harvest other users' PII (phone, last-login, etc.).
  let projection;
  if (!isAdmin) {
    filter.role = 'sales_exec';
    filter.isActive = true;
    projection = 'name email employeeCode role';
  }

  const [users, total] = await Promise.all([
    User.find(filter, projection).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  res.json({ success: true, data: users, meta: buildMeta(total, page, limit) });
});

// GET /api/users/:id
const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  res.json({ success: true, data: user });
});

// POST /api/users
const createUser = asyncHandler(async (req, res) => {
  const exists = await User.findOne({ email: req.body.email });
  if (exists) throw ApiError.conflict('A user with this email already exists');

  const user = await User.create(req.body);
  await logActivity({
    userId: req.user._id, action: 'USER_CREATED', entity: 'User', entityId: user._id,
    details: `Created ${user.role.replace('_', ' ')} "${user.name}"`, ip: req.ip,
  });
  res.status(201).json({ success: true, data: user });
});

// PUT /api/users/:id
const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('+password');
  if (!user) throw ApiError.notFound('User not found');

  const { password, ...rest } = req.body;
  // Validate against the role the user will have after this update, since a
  // role change and a password reset can arrive in the same request.
  if (password && !passwordAllowedFor(rest.role || user.role, password)) {
    throw ApiError.badRequest(PASSWORD_RULE_MESSAGE);
  }
  Object.assign(user, rest);
  if (password) user.password = password;
  await user.save();

  await logActivity({
    userId: req.user._id, action: 'USER_UPDATED', entity: 'User', entityId: user._id,
    details: `Updated user "${user.name}"`, ip: req.ip,
  });
  res.json({ success: true, data: user });
});

// DELETE /api/users/:id  (soft delete -> deactivate)
const deleteUser = asyncHandler(async (req, res) => {
  if (req.params.id === req.user._id.toString()) {
    throw ApiError.badRequest('You cannot deactivate your own account');
  }
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isActive: false, sessions: [] },
    { new: true }
  );
  if (!user) throw ApiError.notFound('User not found');

  await logActivity({
    userId: req.user._id, action: 'USER_DEACTIVATED', entity: 'User', entityId: user._id,
    details: `Deactivated user "${user.name}"`, ip: req.ip,
  });
  res.json({ success: true, message: 'User deactivated', data: user });
});

module.exports = { listUsers, getUser, createUser, updateUser, deleteUser };
