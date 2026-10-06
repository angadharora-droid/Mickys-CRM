const env = require('../config/env');
const ApiError = require('../utils/ApiError');

function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

const xmlText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let details = err.details;

  // Mongoose: bad ObjectId
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid value for ${err.path}`;
  }
  // Mongoose: duplicate key
  if (err.code === 11000) {
    statusCode = 409;
    const fields = Object.keys(err.keyValue || {}).join(', ');
    message = `Duplicate value for: ${fields}`;
  }
  // Mongoose: validation error
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
    details = Object.values(err.errors).map((e) => e.message);
  }
  // Multer upload errors (bad multipart, too many files, etc.)
  if (err.name === 'MulterError') {
    statusCode = 400;
    message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `File too large. Max size is ${env.maxFileSizeMb}MB`
        : err.code === 'LIMIT_FILE_COUNT'
          ? 'Too many files. Upload up to 10 at a time.'
          : `Upload failed: ${err.message}`;
  }

  if (statusCode >= 500) console.error('[error]', err);

  // Never leak internal error details/stacks for 5xx in production.
  if (statusCode >= 500 && env.nodeEnv !== 'development') {
    message = 'Internal server error';
    details = undefined;
  }

  // The Tally add-on (key-authenticated push) can only show a reply in its
  // own RESPONSE format, and only when it arrives as a success — a JSON error
  // reads on the Tally screen as "nothing happened". So Tally gets the
  // failure as STATUS 0 with the reason, which Ctrl+F10 then displays.
  // (A ?key= request is the add-on too, even when the key itself was refused.)
  if (req?.tallyPush || typeof req?.query?.key === 'string') {
    // The reason lands in the server log too (Railway shows only the status
    // code otherwise), with the sync key masked.
    const url = String(req.originalUrl || '').replace(/([?&]key=)[^&]*/, '$1***');
    const body = typeof req.body === 'string' ? `${req.body.length} chars` : `body ${req.headers?.['content-type'] || 'no content-type'}`;
    console.warn(`[tally] ${req.method} ${url} -> ${statusCode}: ${message} (${body})`);
    return res
      .status(200)
      .type('text/xml')
      .send(`<RESPONSE><STATUS>0</STATUS><MESSAGE>Mickys CRM: ${xmlText(message)}</MESSAGE></RESPONSE>`);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(details ? { details } : {}),
    ...(env.nodeEnv === 'development' && statusCode >= 500 ? { stack: err.stack } : {}),
  });
}

module.exports = { notFoundHandler, errorHandler };
