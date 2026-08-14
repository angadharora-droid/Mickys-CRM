const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/User');

/** Verifies the Bearer access token and attaches req.user. */
const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw ApiError.unauthorized('Access token missing');

  let payload;
  try {
    payload = jwt.verify(token, env.jwt.accessSecret);
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw ApiError.unauthorized('Access token expired');
    throw ApiError.unauthorized('Invalid access token');
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw ApiError.unauthorized('Account not found or deactivated');

  req.user = user;
  next();
});

/** Role guard: authorize('admin', 'sales_exec') */
const authorize = (...roles) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!roles.includes(req.user.role)) {
    return next(ApiError.forbidden('You do not have permission to perform this action'));
  }
  next();
};

/**
 * Module-assignment guard: requireModule('sales_orders'). Admins bypass;
 * accounts with no assignments fall back to the Leads CRM (legacy default).
 */
const requireModule = (name) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (req.user.role === 'admin') return next();
  const modules = req.user.modules?.length ? req.user.modules : ['leads'];
  if (!modules.includes(name)) {
    return next(ApiError.forbidden('This module is not assigned to you'));
  }
  next();
};

module.exports = { authenticate, authorize, requireModule };
