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

// Refresh tokens are signed with an explicit lifetime in seconds. On a fresh
// login that's the full absolute session lifetime; on rotation it's only the
// time remaining, so the JWT itself can never outlive the absolute cap.
function signRefreshToken(user, expiresInSec) {
  return jwt.sign({ sub: user._id.toString(), type: 'refresh' }, env.jwt.refreshSecret, {
    expiresIn: expiresInSec,
  });
}

/** Appends a session record, capped at the configured max concurrent sessions. */
async function pushSession(userId, session) {
  await User.updateOne(
    { _id: userId },
    { $push: { sessions: { $each: [session], $slice: -env.session.maxConcurrent } } }
  );
}

/**
 * Issues a fresh token pair for a brand-new login. `ctx` carries request
 * metadata (ip, userAgent) recorded on the session for auditing.
 */
async function issueTokenPair(user, ctx = {}) {
  const accessToken = signAccessToken(user);
  const absoluteSec = Math.floor(env.session.absoluteTimeoutMs / 1000);
  const refreshToken = signRefreshToken(user, absoluteSec);
  const now = new Date();

  await pushSession(user._id, {
    tokenHash: User.hashToken(refreshToken),
    createdAt: now,
    lastUsedAt: now,
    ip: ctx.ip || '',
    userAgent: ctx.userAgent || '',
  });

  return { accessToken, refreshToken };
}

/**
 * Verifies + rotates a refresh token, enforcing both the idle timeout (sliding,
 * reset each refresh) and the absolute session lifetime (fixed from first login).
 * Throws 401 on any failure. On suspected reuse of an already-rotated token, all
 * of the user's sessions are revoked.
 */
async function rotateRefreshToken(oldToken, ctx = {}) {
  let payload;
  try {
    payload = jwt.verify(oldToken, env.jwt.refreshSecret);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  const oldHash = User.hashToken(oldToken);
  const user = await User.findById(payload.sub).select('+sessions');
  if (!user || !user.isActive) throw ApiError.unauthorized('Account not found or deactivated');

  const session = user.sessions.find((s) => s.tokenHash === oldHash);
  if (!session) {
    // The token verified but isn't on file — it was already rotated away (reuse)
    // or revoked. Treat as compromise and drop every session for this user.
    await User.updateOne({ _id: user._id }, { $set: { sessions: [] } });
    throw ApiError.unauthorized('Refresh token has been revoked');
  }

  const now = Date.now();
  const idleFor = now - session.lastUsedAt.getTime();
  const aliveFor = now - session.createdAt.getTime();

  if (idleFor > env.session.idleTimeoutMs) {
    await User.updateOne({ _id: user._id }, { $pull: { sessions: { tokenHash: oldHash } } });
    throw ApiError.unauthorized('Session expired due to inactivity. Please log in again.');
  }
  if (aliveFor > env.session.absoluteTimeoutMs) {
    await User.updateOne({ _id: user._id }, { $pull: { sessions: { tokenHash: oldHash } } });
    throw ApiError.unauthorized('Session has reached its maximum lifetime. Please log in again.');
  }

  // Sign the replacement with only the lifetime the session has left.
  const remainingSec = Math.max(
    60,
    Math.floor((env.session.absoluteTimeoutMs - aliveFor) / 1000)
  );
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user, remainingSec);

  // Swap the old session record for the new one, preserving the original
  // createdAt so the absolute-lifetime cap keeps counting from first login.
  await User.updateOne({ _id: user._id }, { $pull: { sessions: { tokenHash: oldHash } } });
  await pushSession(user._id, {
    tokenHash: User.hashToken(refreshToken),
    createdAt: session.createdAt,
    lastUsedAt: new Date(),
    ip: ctx.ip || session.ip || '',
    userAgent: ctx.userAgent || session.userAgent || '',
  });

  return { user, accessToken, refreshToken };
}

async function revokeRefreshToken(token) {
  if (!token) return;
  try {
    const payload = jwt.verify(token, env.jwt.refreshSecret, { ignoreExpiration: true });
    await User.updateOne(
      { _id: payload.sub },
      { $pull: { sessions: { tokenHash: User.hashToken(token) } } }
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
    maxAge: env.session.absoluteTimeoutMs,
  };
}

module.exports = {
  REFRESH_COOKIE,
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  refreshCookieOptions,
};
