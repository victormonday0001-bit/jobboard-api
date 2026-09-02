const rateLimit = require('express-rate-limit');
const logger    = require('../utils/logger');

const createLimiter = (windowMinutes, max, message) => rateLimit({
  windowMs:        windowMinutes * 60 * 1000,
  max,
  message:         { success: false, error: message },
  standardHeaders: true,
  legacyHeaders:   false,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res, _next, options) => {
    logger.warn(`Rate limit hit: ${req.ip} on ${req.path}`);
    res.status(429).json(options.message);
  },
});

module.exports = {
  generalLimiter: createLimiter(15, 100, 'Too many requests. Please slow down.'),
  authLimiter:    createLimiter(15, 10,  'Too many auth attempts. Try again in 15 minutes.'),
  resetLimiter:   createLimiter(60, 3,   'Too many reset requests. Try again in 1 hour.'),
  uploadLimiter:  createLimiter(60, 20,  'Too many uploads. Try again later.'),
};
