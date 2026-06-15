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

module.exports = { mongoSanitize, globalLimiter, loginLimiter, authLimiter };
