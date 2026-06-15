const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const User = require('../models/User');
const tokenService = require('../services/token.service');
const { logActivity } = require('../services/activity.service');

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  if (!user.isActive) throw ApiError.forbidden('Your account has been deactivated');

  const { accessToken, refreshToken } = await tokenService.issueTokenPair(user);
  user.lastLoginAt = new Date();
  await user.save();

  await logActivity({
    userId: user._id, action: 'LOGIN', entity: 'User', entityId: user._id,
    details: `${user.name} logged in`, ip: req.ip,
  });

  res.cookie(tokenService.REFRESH_COOKIE, refreshToken, tokenService.refreshCookieOptions());
  res.json({ success: true, data: { user, accessToken } });
});

// POST /api/auth/refresh
const refresh = asyncHandler(async (req, res) => {
  const oldToken = req.cookies[tokenService.REFRESH_COOKIE];
  if (!oldToken) throw ApiError.unauthorized('Refresh token missing');

  const { user, accessToken, refreshToken } = await tokenService.rotateRefreshToken(oldToken);
  res.cookie(tokenService.REFRESH_COOKIE, refreshToken, tokenService.refreshCookieOptions());
  res.json({ success: true, data: { user, accessToken } });
});

// POST /api/auth/logout
const logout = asyncHandler(async (req, res) => {
  const token = req.cookies[tokenService.REFRESH_COOKIE];
  await tokenService.revokeRefreshToken(token);
  res.clearCookie(tokenService.REFRESH_COOKIE, { ...tokenService.refreshCookieOptions(), maxAge: 0 });
  res.json({ success: true, message: 'Logged out' });
});

// GET /api/auth/me
const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: req.user } });
});

// POST /api/auth/change-password
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(currentPassword))) {
    throw ApiError.badRequest('Current password is incorrect');
  }
  user.password = newPassword;
  user.refreshTokens = []; // force re-login on all other devices
  await user.save();

  await logActivity({
    userId: user._id, action: 'PASSWORD_CHANGED', entity: 'User', entityId: user._id,
    details: `${user.name} changed their password`, ip: req.ip,
  });
  res.json({ success: true, message: 'Password updated. Please log in again on other devices.' });
});

module.exports = { login, refresh, logout, me, changePassword };
