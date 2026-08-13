const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

const env = require('./config/env');
const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/error');
const { mongoSanitize, globalLimiter } = require('./middleware/security');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS allow-list (supports multiple comma-separated origins via CORS_ORIGINS).
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow same-origin / non-browser clients (no Origin header) and listed origins.
      // Disallowed origins get no CORS headers (browser blocks) rather than a 500.
      if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  })
);

// Body parsers with explicit ceilings to limit payload/parameter-pollution abuse.
app.use(express.json({ limit: '2mb' }));
// Raw XML bodies for the Tally stock push (POST /api/stock/sync). ~600 stock
// items is ~0.5MB; 5mb leaves headroom for catalogue growth. text/plain is
// included because Tally's HTTP Post content-type varies across releases.
app.use(express.text({ type: ['text/xml', 'application/xml', 'text/plain'], limit: '5mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb', parameterLimit: 100 }));
app.use(cookieParser());
app.use(mongoSanitize);
if (env.nodeEnv === 'development') app.use(morgan('dev'));

// NOTE: Generated kit PDFs/ZIPs (which contain confidential pricing) are NOT served
// statically. They live in GridFS and are streamed only through the per-lead,
// authenticated, ownership-checked routes (/api/leads/:id/documents/:idx, /kit.zip).
// Serving the uploads/ tree publicly would let anyone fetch those docs by guessing
// the semi-predictable ref-number path, bypassing auth — so there is no static mount.

app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
app.use('/api', globalLimiter, routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
