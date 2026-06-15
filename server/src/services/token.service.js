const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');

const REFRESH_COOKIE = 'mickys_refresh';

function signAccessToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessExpires,
  });
}

function signRefreshToken(user) {
  return jwt.sign({ sub: user._id.toString(), type: 'refresh' }, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshExpires,
  });
}

/** Issues both tokens and persists the refresh token hash on the user. */
async function issueTokenPair(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  const hash = User.hashToken(refreshToken);
  // Keep at most 5 active sessions per user
  await User.updateOne(
    { _id: user._id },
    { $push: { refreshTokens: { $each: [hash], $slice: -5 } } }
  );
  return { accessToken, refreshToken };
}

/** Verifies + rotates a refresh token. Throws 401 on any failure. */
async function rotateRefreshToken(oldToken) {
  let payload;
  try {
    payload = jwt.verify(oldToken, env.jwt.refreshSecret);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  const oldHash = User.hashToken(oldToken);
  const user = await User.findById(payload.sub).select('+refreshTokens');
  if (!user || !user.isActive) throw ApiError.unauthorized('Account not found or deactivated');
  if (!user.refreshTokens.includes(oldHash)) {
    // Possible token reuse — revoke all sessions for safety.
    await User.updateOne({ _id: user._id }, { $set: { refreshTokens: [] } });
    throw ApiError.unauthorized('Refresh token has been revoked');
  }

  await User.updateOne({ _id: user._id }, { $pull: { refreshTokens: oldHash } });
  const tokens = await issueTokenPair(user);
  return { user, ...tokens };
}

async function revokeRefreshToken(token) {
  if (!token) return;
  try {
    const payload = jwt.verify(token, env.jwt.refreshSecret, { ignoreExpiration: true });
    await User.updateOne(
      { _id: payload.sub },
      { $pull: { refreshTokens: User.hashToken(token) } }
    );
  } catch {
    /* token unparseable — nothing to revoke */
  }
}

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: env.nodeEnv === 'production' ? 'none' : 'lax',
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

module.exports = {
  REFRESH_COOKIE,
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  refreshCookieOptions,
};
