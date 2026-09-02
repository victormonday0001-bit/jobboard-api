const bcrypt  = require('bcrypt');
const { v4: uuid } = require('uuid');
const { pool, withTransaction } = require('../config/db');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
} = require('../config/jwt');
const {
  sendVerificationEmail,
  sendPasswordResetEmail,
} = require('../services/email');
const { auditLog } = require('../utils/helpers');
const logger = require('../utils/logger');

// Helper — issue both tokens and store refresh token in DB
const issueTokens = async (user, req) => {
  const accessToken  = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  const tokenHash    = hashToken(refreshToken);
  const expiresAt    = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO refresh_tokens
       (user_id, token_hash, device_info, ip_address, expires_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [user.id, tokenHash, req.headers['user-agent'] || null, req.ip, expiresAt]
  );

  return { accessToken, refreshToken };
};

// ── REGISTER ──────────────────────────────────────────────────────
// FIX: Now issues tokens immediately on register
// User is logged in right away — same as Facebook, Twitter, LinkedIn
exports.register = async (req, res) => {
  const { email, password, first_name, last_name, role } = req.body;

  // Only jobseeker and employer can self-register
  // Admin accounts are created via script only
  const allowedRoles = ['jobseeker', 'employer'];
  const userRole     = allowedRoles.includes(role) ? role : 'jobseeker';

  try {
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email.trim().toLowerCase()]
    );
    if (existing.rows.length) {
      return res.status(409).json({
        success: false,
        error:  'An account with this email already exists.',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await withTransaction(async (client) => {
      // Create user
      const { rows } = await client.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, role, last_login_at)
         VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
        [email.trim().toLowerCase(), passwordHash, first_name.trim(), last_name.trim(), userRole]
      );
      const newUser = rows[0];

      // Create jobseeker profile automatically
      if (userRole === 'jobseeker') {
        await client.query(
          'INSERT INTO jobseeker_profiles (user_id) VALUES ($1)',
          [newUser.id]
        );
      }

      // Create email verification token
      const token     = uuid();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await client.query(
        'INSERT INTO email_verifications (user_id, token, expires_at) VALUES ($1,$2,$3)',
        [newUser.id, token, expiresAt]
      );

      // Send verification email — don't block registration if it fails
      try {
        await sendVerificationEmail(newUser.email, newUser.first_name, token);
      } catch (emailErr) {
        logger.error(`Verification email failed for ${newUser.email}: ${emailErr.message}`);
      }

      return newUser;
    });

    // FIX: Issue tokens immediately so user is logged in after register
    const { accessToken, refreshToken } = await issueTokens(user, req);

    await auditLog({
      userId:    user.id,
      action:    'USER_REGISTERED',
      entity:    'user',
      entityId:  user.id,
      newValues: { email: user.email, role: user.role },
      req,
    });

    res.status(201).json({
      success: true,
      message: 'Account created successfully. Please verify your email to unlock all features.',
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: 900,
      },
      user: {
        id:          user.id,
        email:       user.email,
        first_name:  user.first_name,
        last_name:   user.last_name,
        role:        user.role,
        is_verified: false,
      },
    });
  } catch (err) {
    logger.error('Register error:', err);
    res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
  }
};

// ── LOGIN ─────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email.toLowerCase()]
    );
    const user = rows[0];

    if (!user) {
      return res.status(401).json({
        success: false,
        error:  'Invalid email or password.',
      });
    }

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        error:  'Your account has been deactivated. Please contact support.',
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      await auditLog({ userId: user.id, action: 'LOGIN_FAILED', entity: 'user', entityId: user.id, req });
      return res.status(401).json({
        success: false,
        error:  'Invalid email or password.',
      });
    }

    // Update last login
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const { accessToken, refreshToken } = await issueTokens(user, req);

    await auditLog({ userId: user.id, action: 'USER_LOGIN', entity: 'user', entityId: user.id, req });

    res.json({
      success: true,
      message: 'Login successful.',
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: 900,
      },
      user: {
        id:          user.id,
        email:       user.email,
        first_name:  user.first_name,
        last_name:   user.last_name,
        role:        user.role,
        is_verified: user.is_verified,
        avatar:      user.avatar,
      },
    });
  } catch (err) {
    logger.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
  }
};

// ── REFRESH TOKEN ─────────────────────────────────────────────────
exports.refreshToken = async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    return res.status(400).json({ success: false, error: 'Refresh token required.' });
  }

  try {
    verifyRefreshToken(refresh_token); // check signature + expiry

    const tokenHash = hashToken(refresh_token);
    const { rows } = await pool.query(
      `SELECT rt.*, u.role, u.email, u.is_verified, u.is_active
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1
         AND rt.expires_at > NOW()
         AND rt.revoked_at IS NULL
         AND u.deleted_at  IS NULL`,
      [tokenHash]
    );

    if (!rows.length) {
      return res.status(401).json({ success: false, error: 'Invalid or expired refresh token.' });
    }

    const record = rows[0];
    if (!record.is_active) {
      return res.status(403).json({ success: false, error: 'Account has been deactivated.' });
    }

    // Issue new access token with latest user data
    const newAccessToken = generateAccessToken({
      id:          record.user_id,
      role:        record.role,
      email:       record.email,
      is_verified: record.is_verified,
    });

    res.json({
      success: true,
      tokens: { accessToken: newAccessToken, expiresIn: 900 },
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, error: 'Invalid refresh token.' });
    }
    logger.error('Refresh token error:', err);
    res.status(500).json({ success: false, error: 'Token refresh failed.' });
  }
};

// ── LOGOUT ────────────────────────────────────────────────────────
exports.logout = async (req, res) => {
  const { refresh_token } = req.body;
  try {
    if (refresh_token) {
      await pool.query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1',
        [hashToken(refresh_token)]
      );
    }
    await auditLog({ userId: req.user.id, action: 'USER_LOGOUT', entity: 'user', entityId: req.user.id, req });
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    logger.error('Logout error:', err);
    res.status(500).json({ success: false, error: 'Logout failed.' });
  }
};

// ── LOGOUT ALL DEVICES ────────────────────────────────────────────
exports.logoutAll = async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
      [req.user.id]
    );
    await auditLog({ userId: req.user.id, action: 'LOGOUT_ALL_DEVICES', entity: 'user', entityId: req.user.id, req });
    res.json({
      success: true,
      message: `Logged out from ${rowCount} device${rowCount !== 1 ? 's' : ''}.`,
    });
  } catch (err) {
    logger.error('Logout all error:', err);
    res.status(500).json({ success: false, error: 'Logout failed.' });
  }
};

// ── VERIFY EMAIL ──────────────────────────────────────────────────
exports.verifyEmail = async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ success: false, error: 'Verification token required.' });

  try {
    const { rows } = await pool.query(
      'SELECT * FROM email_verifications WHERE token = $1 AND expires_at > NOW()',
      [token]
    );
    if (!rows.length) {
      return res.status(400).json({ success: false, error: 'Invalid or expired verification link.' });
    }

    const verification = rows[0];
    await withTransaction(async (client) => {
      await client.query('UPDATE users SET is_verified = TRUE, updated_at = NOW() WHERE id = $1', [verification.user_id]);
      await client.query('DELETE FROM email_verifications WHERE id = $1', [verification.id]);
    });

    await auditLog({ userId: verification.user_id, action: 'EMAIL_VERIFIED', entity: 'user', entityId: verification.user_id, req });

    res.json({ success: true, message: 'Email verified successfully. All features are now unlocked.' });
  } catch (err) {
    logger.error('Email verification error:', err);
    res.status(500).json({ success: false, error: 'Verification failed.' });
  }
};

// ── RESEND VERIFICATION ───────────────────────────────────────────
// FIX: Returns generic message to prevent email enumeration
exports.resendVerification = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = rows[0];

    // Always return success — prevent email enumeration
    if (user.is_verified) {
      return res.json({ success: true, message: 'If your email is unverified, a new link has been sent.' });
    }

    await pool.query('DELETE FROM email_verifications WHERE user_id = $1', [user.id]);
    const token     = uuid();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query(
      'INSERT INTO email_verifications (user_id, token, expires_at) VALUES ($1,$2,$3)',
      [user.id, token, expiresAt]
    );

    try {
      await sendVerificationEmail(user.email, user.first_name, token);
    } catch (emailErr) {
      logger.error(`Resend verification email failed: ${emailErr.message}`);
    }

    res.json({ success: true, message: 'If your email is unverified, a new link has been sent.' });
  } catch (err) {
    logger.error('Resend verification error:', err);
    res.status(500).json({ success: false, error: 'Failed to process request.' });
  }
};

// ── FORGOT PASSWORD ───────────────────────────────────────────────
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email.toLowerCase()]
    );

    // Always return success — prevent email enumeration
    if (!rows.length) {
      return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
    }

    const user      = rows[0];
    const token     = uuid();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query('DELETE FROM password_resets WHERE user_id = $1', [user.id]);
    await pool.query(
      'INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1,$2,$3)',
      [user.id, token, expiresAt]
    );

    try {
      await sendPasswordResetEmail(user.email, user.first_name, token);
    } catch (emailErr) {
      logger.error(`Password reset email failed: ${emailErr.message}`);
    }

    await auditLog({ userId: user.id, action: 'PASSWORD_RESET_REQUESTED', entity: 'user', entityId: user.id, req });
    res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    logger.error('Forgot password error:', err);
    res.status(500).json({ success: false, error: 'Something went wrong.' });
  }
};

// ── RESET PASSWORD ────────────────────────────────────────────────
exports.resetPassword = async (req, res) => {
  const { token, password } = req.body;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM password_resets WHERE token = $1 AND expires_at > NOW() AND used = FALSE',
      [token]
    );
    if (!rows.length) {
      return res.status(400).json({ success: false, error: 'Invalid or expired reset link.' });
    }

    const reset = rows[0];
    const hash  = await bcrypt.hash(password, 12);

    await withTransaction(async (client) => {
      await client.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, reset.user_id]);
      await client.query('UPDATE password_resets SET used = TRUE WHERE id = $1', [reset.id]);
      // Revoke all refresh tokens — force re-login on all devices after password reset
      await client.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1', [reset.user_id]);
    });

    await auditLog({ userId: reset.user_id, action: 'PASSWORD_RESET_COMPLETED', entity: 'user', entityId: reset.user_id, req });
    res.json({ success: true, message: 'Password reset successfully. Please sign in with your new password.' });
  } catch (err) {
    logger.error('Reset password error:', err);
    res.status(500).json({ success: false, error: 'Password reset failed.' });
  }
};

// ── GET ME ────────────────────────────────────────────────────────
exports.getMe = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role,
              u.phone, u.avatar, u.is_verified, u.last_login_at, u.created_at,
              jp.headline, jp.bio, jp.location, jp.cv_url, jp.is_open_to_work
       FROM users u
       LEFT JOIN jobseeker_profiles jp ON jp.user_id = u.id
       WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'User not found.' });
    res.json({ success: true, user: rows[0] });
  } catch (err) {
    logger.error('Get me error:', err);
    res.status(500).json({ success: false, error: 'Failed to load profile.' });
  }
};

// ── CHANGE PASSWORD ───────────────────────────────────────────────
exports.changePassword = async (req, res) => {
  const { current_password, new_password } = req.body;
  try {
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const isMatch  = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Current password is incorrect.' });
    }

    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.user.id]);

    // Revoke all other refresh tokens — force re-login on other devices
    await pool.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1',
      [req.user.id]
    );

    await auditLog({ userId: req.user.id, action: 'PASSWORD_CHANGED', entity: 'user', entityId: req.user.id, req });
    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    logger.error('Change password error:', err);
    res.status(500).json({ success: false, error: 'Failed to change password.' });
  }
};
