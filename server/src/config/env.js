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
  // Symmetric key for reversibly encrypting linked-mailbox SMTP passwords
  // (utils/credCrypto.js). Required in production before users can link their
  // official email accounts; any long random string works.
  credEncryptionKey: process.env.CRED_ENCRYPTION_KEY || '',
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
  // Shared secret for the Tally-side stock push agent (X-Tally-Key header on
  // POST /api/stock/sync). Empty disables key-based sync — manual admin
  // upload in the dashboard still works.
  tallySyncKey: process.env.TALLY_SYNC_KEY || '',
  // Stock reservation timing (services/stockAvailability.service.js).
  // closeSettleMinutes: how long after an order is closed the operator is
  // assumed to still be keying the invoice into Tally — the goods are counted
  // as reserved until a sync lands past that window, otherwise a refresh
  // pressed minutes after closing would release stock Tally still shows.
  // closeReserveMaxDays: hard backstop so a closed order can never hold a
  // reservation forever when the sync evidence never arrives.
  stock: {
    closeSettleMinutes: parseInt(process.env.CLOSE_SETTLE_MINUTES || '120', 10),
    closeReserveMaxDays: parseInt(process.env.CLOSE_RESERVE_MAX_DAYS || '7', 10),
  },
  // Meta Ads lead-form sheet poller. On by default so a fresh deploy keeps
  // pulling leads without any external scheduler; set META_SYNC_ENABLED=false
  // to turn it off, or run it by hand with `npm run sync:meta`.
  metaSync: {
    enabled: process.env.META_SYNC_ENABLED !== 'false',
    intervalMin: parseInt(process.env.META_SYNC_INTERVAL_MIN || '15', 10),
    sheetId: process.env.META_SHEET_ID || '',
    gid: process.env.META_SHEET_GID || '',
    csvUrl: process.env.META_SHEET_CSV_URL || '',
  },
  // Export-kit exchange-rate refresher. On by default (daily); set
  // FX_SYNC_ENABLED=false to turn it off, or FX_API_URL to change the feed.
  fxSync: {
    enabled: process.env.FX_SYNC_ENABLED !== 'false',
    intervalHours: parseInt(process.env.FX_SYNC_INTERVAL_HOURS || '24', 10),
    apiUrl: process.env.FX_API_URL || 'https://open.er-api.com/v6/latest/INR',
  },
  // Daily activity digest emailed every morning with yesterday's numbers
  // (IST). On by default; set DAILY_REPORT_ENABLED=false to turn it off.
  dailyReport: {
    enabled: process.env.DAILY_REPORT_ENABLED !== 'false',
    to: process.env.DAILY_REPORT_TO || 'report@cpgh.in',
    hourIst: parseInt(process.env.DAILY_REPORT_HOUR_IST || '8', 10),
    minuteIst: parseInt(process.env.DAILY_REPORT_MINUTE_IST || '0', 10),
  },
};

module.exports = env;
