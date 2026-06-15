const env = require('../config/env');
const ApiError = require('../utils/ApiError');

function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
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
  // Multer file-size error
  if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    message = `File too large. Max size is ${env.maxFileSizeMb}MB`;
  }

  if (statusCode >= 500) console.error('[error]', err);

  // Never leak internal error details/stacks for 5xx in production.
  if (statusCode >= 500 && env.nodeEnv !== 'development') {
    message = 'Internal server error';
    details = undefined;
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(details ? { details } : {}),
    ...(env.nodeEnv === 'development' && statusCode >= 500 ? { stack: err.stack } : {}),
  });
}

module.exports = { notFoundHandler, errorHandler };
