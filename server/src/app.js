const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require('path');

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
      if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

// Body parsers with explicit ceilings to limit payload/parameter-pollution abuse.
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb', parameterLimit: 100 }));
app.use(cookieParser());
app.use(mongoSanitize);
if (env.nodeEnv === 'development') app.use(morgan('dev'));

// Static serving of uploaded attachments + generated PDFs.
// Access is via unguessable, randomised filenames; deny dotfiles and directory listings.
app.use(
  '/uploads',
  express.static(path.join(__dirname, '..', 'uploads'), {
    dotfiles: 'deny',
    index: false,
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  })
);

app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
app.use('/api', globalLimiter, routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
