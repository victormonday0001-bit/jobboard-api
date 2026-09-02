const logger = require('../utils/logger');

const errorHandler = (err, req, res, _next) => {
  logger.error(`[${req.method}] ${req.path} — ${err.message}`, {
    stack:  err.stack,
    userId: req.user?.id || null,
    ip:     req.ip,
  });

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      error:  `File too large. Maximum allowed is ${process.env.MAX_CV_SIZE_MB || 5}MB.`,
    });
  }

  if (err.message?.includes('Only PDF') || err.message?.includes('Only JPEG')) {
    return res.status(400).json({ success: false, error: err.message });
  }

  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      error:  'A record with this value already exists.',
    });
  }

  if (err.code === '23503') {
    return res.status(400).json({
      success: false,
      error:  'Related record not found.',
    });
  }

  const status = err.status || 500;
  res.status(status).json({
    success: false,
    error:   status === 500
      ? 'Something went wrong on our end. Please try again.'
      : err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    error:  `Route ${req.method} ${req.originalUrl} not found.`,
  });
};

module.exports = { errorHandler, notFound };
