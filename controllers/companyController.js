const { pool, withTransaction } = require('../config/db');
const { uniqueSlug, auditLog, getPagination, paginationMeta } = require('../utils/helpers');
const logger = require('../utils/logger');
const xss    = require('xss');
const fs     = require('fs');
const path   = require('path');

// ── CREATE COMPANY ────────────────────────────────────────────────
exports.createCompany = async (req, res) => {
  const { name, description, website, email, phone, industry, size, founded_year, location, country } = req.body;

  try {
    const existing = await pool.query(
      'SELECT id FROM companies WHERE owner_id = $1 AND deleted_at IS NULL',
      [req.user.id]
    );
    if (existing.rows.length) {
      return res.status(409).json({
        success: false,
        error:  'You already have a company. Update it instead of creating a new one.',
      });
    }

    const slug     = await uniqueSlug(name, 'companies');
    const safeDesc = description ? xss(description) : null;
    const logoUrl  = req.file ? `/uploads/logos/${req.file.filename}` : null;

    const { rows } = await pool.query(
      `INSERT INTO companies
         (owner_id, name, slug, description, website, email, phone,
          logo_url, industry, size, founded_year, location, country)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        req.user.id, name.trim(), slug, safeDesc,
        website || null, email || null, phone || null,
        logoUrl, industry || null, size || null,
        founded_year || null, location || null, country || null,
      ]
    );

    const company = rows[0];
    await auditLog({
      userId: req.user.id, action: 'COMPANY_CREATED',
      entity: 'company', entityId: company.id,
      newValues: { name: company.name, slug: company.slug }, req,
    });

    res.status(201).json({ success: true, message: 'Company created successfully.', company });
  } catch (err) {
    logger.error('Create company error:', err);
    res.status(500).json({ success: false, error: 'Failed to create company.' });
  }
};

// ── GET MY COMPANY ────────────────────────────────────────────────
exports.getMyCompany = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*,
              COUNT(DISTINCT j.id) FILTER (WHERE j.deleted_at IS NULL) AS total_jobs,
              COUNT(DISTINCT j.id) FILTER (WHERE j.status='published' AND j.deleted_at IS NULL) AS active_jobs
       FROM companies c
       LEFT JOIN jobs j ON j.company_id = c.id
       WHERE c.owner_id = $1 AND c.deleted_at IS NULL
       GROUP BY c.id`,
      [req.user.id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'You have not created a company yet.' });
    }
    res.json({ success: true, company: rows[0] });
  } catch (err) {
    logger.error('Get my company error:', err);
    res.status(500).json({ success: false, error: 'Failed to load company.' });
  }
};

// ── GET COMPANY BY SLUG (Public) ──────────────────────────────────
exports.getCompany = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.slug, c.description, c.website, c.email,
              c.logo_url, c.industry, c.size, c.founded_year,
              c.location, c.country, c.is_verified, c.created_at,
              COUNT(DISTINCT j.id) FILTER (WHERE j.status='published' AND j.deleted_at IS NULL) AS active_jobs
       FROM companies c
       LEFT JOIN jobs j ON j.company_id = c.id
       WHERE c.slug = $1 AND c.deleted_at IS NULL AND c.is_active = TRUE
       GROUP BY c.id`,
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Company not found.' });

    const jobsRes = await pool.query(
      `SELECT id, title, slug, type, experience_level, location,
              is_remote, salary_min, salary_max, salary_currency,
              is_salary_visible, published_at, deadline
       FROM jobs
       WHERE company_id = $1 AND status = 'published' AND deleted_at IS NULL
       ORDER BY published_at DESC LIMIT 10`,
      [rows[0].id]
    );

    res.json({ success: true, company: rows[0], jobs: jobsRes.rows });
  } catch (err) {
    logger.error('Get company error:', err);
    res.status(500).json({ success: false, error: 'Failed to load company.' });
  }
};

// ── GET ALL COMPANIES (Public) ────────────────────────────────────
exports.getCompanies = async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const search   = req.query.search   || '';
    const industry = req.query.industry || '';
    const size     = req.query.size     || '';

    let conditions = ['c.deleted_at IS NULL', 'c.is_active = TRUE'];
    let params     = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(c.name ILIKE $${params.length} OR c.industry ILIKE $${params.length})`);
    }
    if (industry) {
      params.push(industry);
      conditions.push(`c.industry = $${params.length}`);
    }
    if (size) {
      params.push(size);
      conditions.push(`c.size = $${params.length}`);
    }

    const where    = `WHERE ${conditions.join(' AND ')}`;
    const countRes = await pool.query(`SELECT COUNT(*) FROM companies c ${where}`, params);
    const total    = parseInt(countRes.rows[0].count);

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.slug, c.logo_url, c.industry, c.size,
              c.location, c.country, c.is_verified,
              COUNT(DISTINCT j.id) FILTER (WHERE j.status='published' AND j.deleted_at IS NULL) AS active_jobs
       FROM companies c
       LEFT JOIN jobs j ON j.company_id = c.id
       ${where}
       GROUP BY c.id
       ORDER BY c.is_verified DESC, active_jobs DESC, c.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ success: true, companies: rows, pagination: paginationMeta(total, page, limit) });
  } catch (err) {
    logger.error('Get companies error:', err);
    res.status(500).json({ success: false, error: 'Failed to load companies.' });
  }
};

// ── UPDATE COMPANY ────────────────────────────────────────────────
// FIX: Slug now regenerates when company name changes
exports.updateCompany = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM companies WHERE owner_id = $1 AND deleted_at IS NULL',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Company not found.' });

    const company  = rows[0];
    const { name, description, website, email, phone, industry, size, founded_year, location, country } = req.body;

    const safeDesc = description ? xss(description) : company.description;
    const logoUrl  = req.file ? `/uploads/logos/${req.file.filename}` : company.logo_url;

    // Delete old logo if new one uploaded
    if (req.file && company.logo_url) {
      const oldPath = path.join(__dirname, '..', company.logo_url);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    // FIX: Regenerate slug when name changes
    let newSlug = company.slug;
    const trimmedName = name?.trim();
    if (trimmedName && trimmedName !== company.name) {
      newSlug = await uniqueSlug(trimmedName, 'companies');
    }

    const updated = await pool.query(
      `UPDATE companies SET
         name         = $1, slug        = $2,  description  = $3,
         website      = $4, email       = $5,  phone        = $6,
         logo_url     = $7, industry    = $8,  size         = $9,
         founded_year = $10, location   = $11, country      = $12,
         updated_at   = NOW()
       WHERE id = $13 RETURNING *`,
      [
        trimmedName      || company.name,
        newSlug,
        safeDesc,
        website          || company.website,
        email            || company.email,
        phone            || company.phone,
        logoUrl,
        industry         || company.industry,
        size             || company.size,
        founded_year     || company.founded_year,
        location         || company.location,
        country          || company.country,
        company.id,
      ]
    );

    await auditLog({
      userId: req.user.id, action: 'COMPANY_UPDATED',
      entity: 'company', entityId: company.id,
      oldValues: { name: company.name, slug: company.slug },
      newValues: { name: updated.rows[0].name, slug: updated.rows[0].slug },
      req,
    });

    res.json({ success: true, message: 'Company updated successfully.', company: updated.rows[0] });
  } catch (err) {
    logger.error('Update company error:', err);
    res.status(500).json({ success: false, error: 'Failed to update company.' });
  }
};

// ── DELETE COMPANY (Soft Delete) ──────────────────────────────────
exports.deleteCompany = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM companies WHERE owner_id = $1 AND deleted_at IS NULL',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Company not found.' });

    const company = rows[0];
    await withTransaction(async (client) => {
      await client.query('UPDATE companies SET deleted_at = NOW() WHERE id = $1', [company.id]);
      await client.query('UPDATE jobs SET deleted_at = NOW() WHERE company_id = $1 AND deleted_at IS NULL', [company.id]);
    });

    await auditLog({
      userId: req.user.id, action: 'COMPANY_DELETED',
      entity: 'company', entityId: company.id,
      oldValues: { name: company.name }, req,
    });

    res.json({ success: true, message: 'Company and all its jobs have been removed.' });
  } catch (err) {
    logger.error('Delete company error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete company.' });
  }
};

// ── VERIFY COMPANY (Admin Only) ───────────────────────────────────
exports.verifyCompany = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM companies WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Company not found.' });

    await pool.query('UPDATE companies SET is_verified = TRUE, updated_at = NOW() WHERE id = $1', [req.params.id]);

    await auditLog({
      userId: req.user.id, action: 'COMPANY_VERIFIED',
      entity: 'company', entityId: parseInt(req.params.id), req,
    });

    res.json({ success: true, message: 'Company verified successfully.' });
  } catch (err) {
    logger.error('Verify company error:', err);
    res.status(500).json({ success: false, error: 'Failed to verify company.' });
  }
};
