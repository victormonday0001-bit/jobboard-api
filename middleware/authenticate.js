const { verifyAccessToken } = require('../config/jwt');
const logger = require('../utils/logger');

const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Access token required.',
      });
    }

    const token  = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Access token expired.',
        code:  'TOKEN_EXPIRED',
      });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid access token.',
      });
    }
    logger.error('Authentication error:', err);
    res.status(500).json({ success: false, error: 'Authentication failed.' });
  }
};

const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      req.user = verifyAccessToken(authHeader.split(' ')[1]);
    }
  } catch {
    req.user = null;
  }
  next();
};

module.exports = { authenticate, optionalAuth };
