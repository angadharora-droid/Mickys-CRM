require('dotenv').config();

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

const DEV_ACCESS_SECRET = 'dev-access-secret';
const DEV_REFRESH_SECRET = 'dev-refresh-secret';

const accessSecret = process.env.JWT_ACCESS_SECRET || DEV_ACCESS_SECRET;
const refreshSecret = process.env.JWT_REFRESH_SECRET || DEV_REFRESH_SECRET;

/**
 * In production, refuse to start with missing/weak/duplicate JWT secrets — a
 * predictable secret lets anyone forge access tokens for any account.
 */
if (isProd) {
  const problems = [];
  if (accessSecret === DEV_ACCESS_SECRET) problems.push('JWT_ACCESS_SECRET is unset or using the insecure dev default');
  if (refreshSecret === DEV_REFRESH_SECRET) problems.push('JWT_REFRESH_SECRET is unset or using the insecure dev default');
  if (accessSecret.length < 32) problems.push('JWT_ACCESS_SECRET must be at least 32 characters');
  if (refreshSecret.length < 32) problems.push('JWT_REFRESH_SECRET must be at least 32 characters');
  if (accessSecret === refreshSecret) problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
  if (problems.length) {
    console.error(`[env] Refusing to start in production:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
}

const env = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv,
  isProd,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  // Comma-separated allow-list; defaults to CLIENT_URL when unset.
  corsOrigins: (process.env.CORS_ORIGINS || process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mickys_po',
  jwt: {
    accessSecret,
    refreshSecret,
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '7d',
  },
  // Session timing. A refresh token is rejected once it has been idle longer than
  // idleTimeoutMs (sliding window, reset on each refresh) OR once the session is
  // older than absoluteTimeoutMs since first login (hard cap, survives rotation).
  session: {
    idleTimeoutMs: parseInt(process.env.SESSION_IDLE_TIMEOUT_MIN || '30', 10) * 60 * 1000,
    absoluteTimeoutMs: parseInt(process.env.SESSION_ABSOLUTE_TIMEOUT_HOURS || '168', 10) * 60 * 60 * 1000,
    maxConcurrent: parseInt(process.env.SESSION_MAX_CONCURRENT || '5', 10),
  },
  // Per-account login lockout (defence-in-depth on top of the per-IP rate limiter).
  // After maxAttempts consecutive failures the account is locked for lockMinutes.
  lockout: {
    maxAttempts: parseInt(process.env.LOGIN_MAX_ATTEMPTS || '8', 10),
    lockMs: parseInt(process.env.LOGIN_LOCK_MINUTES || '15', 10) * 60 * 1000,
  },
  // Resend is preferred when RESEND_API_KEY is set; SMTP is the fallback.
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || "Micky's Sales <no-reply@mickys.com>",
  },
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || '10', 10),
};

module.exports = env;
