const rateLimit = require('express-rate-limit');
const { sanitizeMongo } = require('../utils/sanitize');

/**
 * Strips MongoDB operator/dotted keys from every request input source, blocking
 * NoSQL operator injection (e.g. ?status[$ne]=draft, { email: { $gt: "" } }).
 * req.params is rebuilt per-route by Express, so it's cleaned in routing too,
 * but body/query are the realistic vectors and are handled here once globally.
 */
function mongoSanitize(req, _res, next) {
  if (req.body) sanitizeMongo(req.body);
  if (req.query) sanitizeMongo(req.query);
  if (req.params) sanitizeMongo(req.params);
  next();
}

const jsonMessage = (message) => ({ success: false, message });

/** Broad ceiling for the whole API to blunt scraping / brute force / DoS. */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage('Too many requests. Please slow down and try again shortly.'),
});

/** Tight limiter for the login endpoint; successful logins don't count toward the cap. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: jsonMessage('Too many login attempts. Try again in 15 minutes.'),
});

/** Limiter for other sensitive auth actions (refresh, change-password). */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage('Too many authentication requests. Please try again later.'),
});

/**
 * Limiter for kit generation — each call renders multiple PDFs + a ZIP, so it's
 * CPU/IO heavy. Cap it to stop a single client pinning the server.
 */
const generateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage('Too many kit-generation requests. Please wait a moment and try again.'),
});

/**
 * Limiter for outbound email — protects the shared mailbox/Resend quota and
 * stops the endpoint being used to spam third parties from our domain.
 */
const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage('Email sending limit reached. Please try again later.'),
});

module.exports = {
  mongoSanitize,
  globalLimiter,
  loginLimiter,
  authLimiter,
  generateLimiter,
  emailLimiter,
};
