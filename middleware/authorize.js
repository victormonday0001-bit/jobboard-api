const { pool } = require('../config/db');

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error:  `Access denied. Required role: ${roles.join(' or ')}.`,
      });
    }
    next();
  };
};

// FIX: Now queries database directly — is_verified is always current
// Admin setting is_verified=true takes effect on very next request
// No need to logout and login again
const requireVerified = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT is_verified, is_active
       FROM users
       WHERE id = $1 AND deleted_at IS NULL`,
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(401).json({
        success: false,
        error:  'Account not found.',
      });
    }

    if (!rows[0].is_active) {
      return res.status(403).json({
        success: false,
        error:  'Your account has been deactivated. Please contact support.',
      });
    }

    if (!rows[0].is_verified) {
      return res.status(403).json({
        success: false,
        error:  'Please verify your email address to access this feature.',
        code:   'EMAIL_NOT_VERIFIED',
      });
    }

    next();
  } catch (err) {
    res.status(500).json({ success: false, error: 'Authorization failed.' });
  }
};

const isAdmin     = authorize('admin');
const isEmployer  = authorize('employer', 'admin');
const isJobseeker = authorize('jobseeker', 'admin');

module.exports = { authorize, requireVerified, isAdmin, isEmployer, isJobseeker };