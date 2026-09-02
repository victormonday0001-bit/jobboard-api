const { pool } = require('../config/db');
const logger   = require('./logger');

// ── SLUG ──────────────────────────────────────────────────────────
const slugify = (text) => {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');
};

// FIX: Single database query instead of one per attempt
// Gets all existing slugs matching the base, finds first available
const uniqueSlug = async (text, table, column = 'slug') => {
  const base = slugify(text);

  const { rows } = await pool.query(
    `SELECT ${column} FROM ${table}
     WHERE (${column} = $1 OR ${column} LIKE $2)
     AND deleted_at IS NULL`,
    [base, `${base}-%`]
  );

  const taken = new Set(rows.map(r => r[column]));

  let slug  = base;
  let count = 1;
  while (taken.has(slug)) {
    slug = `${base}-${count++}`;
  }
  return slug;
};

// ── AUDIT LOG ─────────────────────────────────────────────────────
const auditLog = async ({ userId, action, entity, entityId, oldValues, newValues, req }) => {
  try {
    await pool.query(
      `INSERT INTO audit_logs
         (user_id, action, entity, entity_id, old_values, new_values, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        userId    || null,
        action,
        entity    || null,
        entityId  || null,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        req?.ip   || null,
        req?.headers?.['user-agent'] || null,
      ]
    );
  } catch (err) {
    logger.error('Audit log error:', err.message);
  }
};

// ── NOTIFICATION ──────────────────────────────────────────────────
const createNotification = async ({ userId, type, title, message, link }) => {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, link)
       VALUES ($1,$2,$3,$4,$5)`,
      [userId, type, title, message, link || null]
    );
  } catch (err) {
    logger.error('Notification error:', err.message);
  }
};

// ── PAGINATION ─────────────────────────── ────────────────────────
const getPagination = (query) => {
  const page   = Math.max(1, parseInt(query.page)  || 1);
  const limit  = Math.min(50, parseInt(query.limit) || 10);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

const paginationMeta = (total, page, limit) => ({
  total,
  page,
  limit,
  pages:   Math.ceil(total / limit),
  hasNext: page < Math.ceil(total / limit),
  hasPrev: page > 1,
});

module.exports = {
  slugify,
  uniqueSlug,
  auditLog,
  createNotification,
  getPagination,
  paginationMeta,
};
