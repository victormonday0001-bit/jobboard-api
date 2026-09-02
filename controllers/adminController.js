const { pool } = require('../config/db');
const { auditLog, getPagination, paginationMeta } = require('../utils/helpers');
const logger = require('../utils/logger');

// ── DASHBOARD STATS ───────────────────────────────────────────────
exports.getStats = async (req, res) => {
  try {
    const [
      usersRes, companiesRes, jobsRes,
      applicationsRes, activeJobsRes, recentLogsRes,
      newUsersRes, newJobsRes,
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM users WHERE deleted_at IS NULL`),
      pool.query(`SELECT COUNT(*) FROM companies WHERE deleted_at IS NULL`),
      pool.query(`SELECT COUNT(*) FROM jobs WHERE deleted_at IS NULL`),
      pool.query(`SELECT COUNT(*) FROM applications WHERE deleted_at IS NULL`),
      pool.query(`SELECT COUNT(*) FROM jobs WHERE status='published' AND deleted_at IS NULL`),
      pool.query(
        `SELECT al.*, u.email FROM audit_logs al
         LEFT JOIN users u ON u.id = al.user_id
         ORDER BY al.created_at DESC LIMIT 10`
      ),
      pool.query(
        `SELECT COUNT(*) FROM users
         WHERE created_at > NOW() - INTERVAL '7 days' AND deleted_at IS NULL`
      ),
      pool.query(
        `SELECT COUNT(*) FROM jobs
         WHERE created_at > NOW() - INTERVAL '7 days' AND deleted_at IS NULL`
      ),
    ]);

    res.json({
      success: true,
      stats: {
        total_users:        parseInt(usersRes.rows[0].count),
        total_companies:    parseInt(companiesRes.rows[0].count),
        total_jobs:         parseInt(jobsRes.rows[0].count),
        total_applications: parseInt(applicationsRes.rows[0].count),
        active_jobs:        parseInt(activeJobsRes.rows[0].count),
        new_users_week:     parseInt(newUsersRes.rows[0].count),
        new_jobs_week:      parseInt(newJobsRes.rows[0].count),
      },
      recent_activity: recentLogsRes.rows,
    });
  } catch (err) {
    logger.error('Admin stats error:', err);
    res.status(500).json({ success: false, error: 'Failed to load stats.' });
  }
};

// ── GET ALL USERS ─────────────────────────────────────────────────
exports.getUsers = async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const search = req.query.search || '';
    const role   = req.query.role   || '';

    let conditions = ['deleted_at IS NULL'];
    let params     = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(
        `(email ILIKE $${params.length} OR first_name ILIKE $${params.length} OR last_name ILIKE $${params.length})`
      );
    }
    if (role) {
      params.push(role);
      conditions.push(`role = $${params.length}`);
    }

    const where    = `WHERE ${conditions.join(' AND ')}`;
    const countRes = await pool.query(`SELECT COUNT(*) FROM users ${where}`, params);
    const total    = parseInt(countRes.rows[0].count);

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT id, email, first_name, last_name, role,
              is_verified, is_active, last_login_at, created_at
       FROM users ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ success: true, users: rows, pagination: paginationMeta(total, page, limit) });
  } catch (err) {
    logger.error('Admin get users error:', err);
    res.status(500).json({ success: false, error: 'Failed to load users.' });
  }
};

// ── UPDATE USER ───────────────────────────────────────────────────
exports.updateUser = async (req, res) => {
  const { role, is_active, is_verified } = req.body;

  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'User not found.' });

    if (parseInt(req.params.id) === req.user.id && is_active === false) {
      return res.status(400).json({ success: false, error: 'You cannot deactivate your own account.' });
    }

    const oldUser = rows[0];

    // FIX: Revoke all refresh tokens when user is deactivated
    // so they cannot get new access tokens after deactivation
    if (is_active === false || is_active === 'false') {
      await pool.query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
        [req.params.id]
      );
    }

    const updated = await pool.query(
      `UPDATE users SET
         role        = COALESCE($1, role),
         is_active   = COALESCE($2, is_active),
         is_verified = COALESCE($3, is_verified),
         updated_at  = NOW()
       WHERE id = $4
       RETURNING id, email, first_name, last_name, role, is_active, is_verified`,
      [role || null, is_active ?? null, is_verified ?? null, req.params.id]
    );

    await auditLog({
      userId:    req.user.id, action: 'ADMIN_USER_UPDATED',
      entity:    'user', entityId: parseInt(req.params.id),
      oldValues: { role: oldUser.role, is_active: oldUser.is_active },
      newValues: { role: updated.rows[0].role, is_active: updated.rows[0].is_active },
      req,
    });

    res.json({ success: true, message: 'User updated.', user: updated.rows[0] });
  } catch (err) {
    logger.error('Admin update user error:', err);
    res.status(500).json({ success: false, error: 'Failed to update user.' });
  }
};

// ── DELETE USER ───────────────────────────────────────────────────
// FIX: Revoke all refresh tokens on delete so user cannot
// continue using the app with existing tokens
exports.deleteUser = async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ success: false, error: 'You cannot delete your own account.' });
    }

    const { rows } = await pool.query(
      'SELECT id, email FROM users WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'User not found.' });

    // FIX: Revoke all tokens immediately so user is logged out everywhere
    await pool.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
      [req.params.id]
    );

    // Soft delete
    await pool.query(
      'UPDATE users SET deleted_at = NOW(), is_active = FALSE WHERE id = $1',
      [req.params.id]
    );

    await auditLog({
      userId:    req.user.id, action: 'ADMIN_USER_DELETED',
      entity:    'user', entityId: parseInt(req.params.id),
      oldValues: { email: rows[0].email }, req,
    });

    res.json({ success: true, message: 'User deleted successfully.' });
  } catch (err) {
    logger.error('Admin delete user error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete user.' });
  }
};

// ── GET ALL COMPANIES ─────────────────────────────────────────────
exports.getCompanies = async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const search = req.query.search || '';

    let conditions = ['c.deleted_at IS NULL'];
    let params     = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`c.name ILIKE $${params.length}`);
    }

    const where    = `WHERE ${conditions.join(' AND ')}`;
    const countRes = await pool.query(`SELECT COUNT(*) FROM companies c ${where}`, params);
    const total    = parseInt(countRes.rows[0].count);

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.slug, c.industry, c.is_verified,
              c.is_active, c.created_at,
              u.email AS owner_email,
              COUNT(DISTINCT j.id) FILTER (WHERE j.deleted_at IS NULL) AS total_jobs
       FROM companies c
       JOIN users u ON u.id = c.owner_id
       LEFT JOIN jobs j ON j.company_id = c.id
       ${where}
       GROUP BY c.id, u.email
       ORDER BY c.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ success: true, companies: rows, pagination: paginationMeta(total, page, limit) });
  } catch (err) {
    logger.error('Admin get companies error:', err);
    res.status(500).json({ success: false, error: 'Failed to load companies.' });
  }
};

// ── GET ALL JOBS ──────────────────────────────────────────────────
exports.getJobs = async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const status = req.query.status || '';
    const search = req.query.search || '';

    let conditions = ['j.deleted_at IS NULL'];
    let params     = [];

    if (status) {
      params.push(status);
      conditions.push(`j.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`j.title ILIKE $${params.length}`);
    }

    const where    = `WHERE ${conditions.join(' AND ')}`;
    const countRes = await pool.query(`SELECT COUNT(*) FROM jobs j ${where}`, params);
    const total    = parseInt(countRes.rows[0].count);

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT j.id, j.title, j.slug, j.status, j.type,
              j.views, j.is_featured, j.created_at, j.published_at,
              c.name AS company_name,
              COUNT(DISTINCT a.id) AS application_count
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
       LEFT JOIN applications a ON a.job_id = j.id AND a.deleted_at IS NULL
       ${where}
       GROUP BY j.id, c.name
       ORDER BY j.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ success: true, jobs: rows, pagination: paginationMeta(total, page, limit) });
  } catch (err) {
    logger.error('Admin get jobs error:', err);
    res.status(500).json({ success: false, error: 'Failed to load jobs.' });
  }
};

// ── TOGGLE FEATURED ───────────────────────────────────────────────
exports.toggleFeatured = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, title, is_featured FROM jobs WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Job not found.' });

    const job         = rows[0];
    const newFeatured = !job.is_featured;

    await pool.query(
      'UPDATE jobs SET is_featured = $1, updated_at = NOW() WHERE id = $2',
      [newFeatured, job.id]
    );

    await auditLog({
      userId:   req.user.id,
      action:   newFeatured ? 'JOB_FEATURED' : 'JOB_UNFEATURED',
      entity:   'job', entityId: job.id, req,
    });

    res.json({
      success:  true,
      message:  `Job ${newFeatured ? 'marked as featured' : 'removed from featured'}.`,
      featured: newFeatured,
    });
  } catch (err) {
    logger.error('Toggle featured error:', err);
    res.status(500).json({ success: false, error: 'Failed to update job.' });
  }
};

// ── DELETE JOB (Admin) ────────────────────────────────────────────
exports.deleteJob = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, title FROM jobs WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Job not found.' });

    await pool.query(
      `UPDATE jobs SET deleted_at = NOW(), status = 'closed' WHERE id = $1`,
      [req.params.id]
    );

    await auditLog({
      userId:    req.user.id, action: 'ADMIN_JOB_DELETED',
      entity:    'job', entityId: parseInt(req.params.id),
      oldValues: { title: rows[0].title }, req,
    });

    res.json({ success: true, message: 'Job deleted successfully.' });
  } catch (err) {
    logger.error('Admin delete job error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete job.' });
  }
};

// ── GET AUDIT LOGS ────────────────────────────────────────────────
exports.getAuditLogs = async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const action = req.query.action  || '';
    const userId = req.query.user_id || '';

    let conditions = [];
    let params     = [];
 
    if (action) {
      params.push(`%${action}%`);
      conditions.push(`al.action ILIKE $${params.length}`);
    }
    if (userId) {
      params.push(parseInt(userId));
      conditions.push(`al.user_id = $${params.length}`);
    }

    const where    = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRes = await pool.query(`SELECT COUNT(*) FROM audit_logs al ${where}`, params);
    const total    = parseInt(countRes.rows[0].count);

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT al.*, u.email, u.first_name, u.last_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ success: true, logs: rows, pagination: paginationMeta(total, page, limit) });
  } catch (err) {
    logger.error('Audit logs error:', err);
    res.status(500).json({ success: false, error: 'Failed to load audit logs.' });
  }
};
