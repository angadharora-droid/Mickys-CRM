const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const env = require('../config/env');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const User = require('../models/User');
const tokenService = require('../services/token.service');
const { logActivity } = require('../services/activity.service');
const { verifySsoToken } = require('../lib/ssoClient');
const { passwordAllowedFor, PASSWORD_RULE_MESSAGE } = require('../validators');

// A throwaway hash to compare against when the email doesn't exist, so a
// non-existent account costs the same time as a wrong password. Without this,
// an attacker can enumerate valid emails by timing the response.
const DUMMY_HASH = bcrypt.hashSync('login-timing-guard', 12);

// Pull request metadata recorded on each session for auditing.
const sessionContext = (req) => ({ ip: req.ip, userAgent: req.headers['user-agent'] || '' });

/**
 * Records a failed login for an existing account, locking it once the failure
 * count reaches the configured threshold. (Non-existent emails are ignored so
 * lockout state can't be used as an account-enumeration oracle.)
 */
async function registerFailedAttempt(user) {
  const attempts = (user.failedLoginAttempts || 0) + 1;
  if (attempts >= env.lockout.maxAttempts) {
    await User.updateOne(
      { _id: user._id },
      { $set: { failedLoginAttempts: 0, lockUntil: new Date(Date.now() + env.lockout.lockMs) } }
    );
    await logActivity({
      userId: user._id, action: 'ACCOUNT_LOCKED', entity: 'User', entityId: user._id,
      details: `${user.name}'s account was locked after ${attempts} failed login attempts`,
      ip: user._lastIp || '',
    });
  } else {
    await User.updateOne({ _id: user._id }, { $set: { failedLoginAttempts: attempts } });
  }
}

/**
 * Matches a stored phone number against the login input, ignoring formatting.
 * A number also matches when one side carries a country code the other omits
 * (e.g. "+91 98765 43210" vs "9876543210") by comparing the last 10 digits.
 */
const phoneMatches = (stored, input) => {
  const a = (stored || '').replace(/\D/g, '');
  const b = input.replace(/\D/g, '');
  if (!a || !b) return false;
  return a === b || (a.length >= 10 && b.length >= 10 && a.slice(-10) === b.slice(-10));
};

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const { identifier, password } = req.body;
  const SECRET_FIELDS = '+password +failedLoginAttempts +lockUntil';

  let user;
  if (identifier.includes('@')) {
    user = await User.findOne({ email: identifier }).select(SECRET_FIELDS);
  } else {
    // Phone sign-in is an admin-only convenience; other roles must use email.
    const admins = await User.find({ role: 'admin' }).select(SECRET_FIELDS);
    user = admins.find((a) => phoneMatches(a.phone, identifier));
  }

  // Reject early while locked. This does reveal that the account exists, but the
  // per-IP login limiter is the primary anti-enumeration control and a clear
  // "try again in N minutes" message is far better UX than a silent failure.
  if (user && user.isLocked) {
    const mins = Math.ceil((user.lockUntil.getTime() - Date.now()) / 60000);
    throw ApiError.tooManyRequests(
      `Account locked due to repeated failed logins. Try again in ${mins} minute(s).`
    );
  }

  const passwordOk = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
  if (!user || !passwordOk) {
    if (user) {
      user._lastIp = req.ip;
      await registerFailedAttempt(user);
    }
    throw ApiError.unauthorized('Invalid email/phone or password');
  }
  if (!user.isActive) throw ApiError.forbidden('Your account has been deactivated');

  await completeLogin(req, res, user);
});

/**
 * Everything a successful login does once the caller is authenticated: issue
 * the token pair (recording a session), clear any lockout state, stamp
 * lastLoginAt, log the activity, set the refresh cookie and send the standard
 * { user, accessToken } payload. Shared by password login and central sign-on.
 */
async function completeLogin(req, res, user, details = `${user.name} logged in`) {
  const { accessToken, refreshToken } = await tokenService.issueTokenPair(user, sessionContext(req));
  // Successful login clears any accumulated failure/lock state.
  const now = new Date();
  const reset = user.failedLoginAttempts > 0 || user.lockUntil
    ? { $set: { failedLoginAttempts: 0, lastLoginAt: now }, $unset: { lockUntil: 1 } }
    : { $set: { lastLoginAt: now } };
  await User.updateOne({ _id: user._id }, reset);
  user.lastLoginAt = now; // reflect in the response payload

  await logActivity({
    userId: user._id, action: 'LOGIN', entity: 'User', entityId: user._id,
    details, ip: req.ip,
  });

  res.cookie(tokenService.REFRESH_COOKIE, refreshToken, tokenService.refreshCookieOptions());
  res.json({ success: true, data: { user, accessToken } });
}

// POST /api/auth/sso — central sign-on from the CPG portal. The browser brings
// a hand-off token; the auth service tells us which CRM user it belongs to and
// the rest is the normal login (session, refresh cookie, same payload). Does
// nothing useful until AUTH_SERVICE_URL is set; password login is unchanged.
const ssoLogin = asyncHandler(async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  if (!token) throw ApiError.badRequest('token is required');

  const verified = await verifySsoToken(token);
  if (!verified) throw ApiError.unauthorized('SSO sign-in failed');

  // The link table stores this app's Mongo _id; anything else can't match.
  const user = mongoose.isValidObjectId(verified.localUserId)
    ? await User.findById(verified.localUserId).select('+failedLoginAttempts +lockUntil')
    : null;
  if (!user || !user.isActive) throw ApiError.notFound('No account linked');

  await completeLogin(req, res, user, `${user.name} logged in via portal sign-on`);
});

// POST /api/auth/refresh
const refresh = asyncHandler(async (req, res) => {
  const oldToken = req.cookies[tokenService.REFRESH_COOKIE];
  if (!oldToken) throw ApiError.unauthorized('Refresh token missing');

  const { user, accessToken, refreshToken } = await tokenService.rotateRefreshToken(
    oldToken,
    sessionContext(req)
  );
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
  if (!passwordAllowedFor(user.role, newPassword)) {
    throw ApiError.badRequest(PASSWORD_RULE_MESSAGE);
  }
  user.password = newPassword;
  user.sessions = []; // force re-login on all devices
  await user.save();

  await logActivity({
    userId: user._id, action: 'PASSWORD_CHANGED', entity: 'User', entityId: user._id,
    details: `${user.name} changed their password`, ip: req.ip,
  });
  res.json({ success: true, message: 'Password updated. Please log in again on other devices.' });
});

module.exports = { login, ssoLogin, refresh, logout, me, changePassword };
