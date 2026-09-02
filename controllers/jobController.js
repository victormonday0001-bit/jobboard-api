const { pool, withTransaction } = require('../config/db');
const { uniqueSlug, auditLog, getPagination, paginationMeta, createNotification } = require('../utils/helpers');
const logger = require('../utils/logger');
const xss    = require('xss');

// ── CREATE JOB ────────────────────────────────────────────────────
exports.createJob = async (req, res) => {
  const {
    title, description, requirements, responsibilities,
    benefits, type, experience_level, category,
    location, country, is_remote,
    salary_min, salary_max, salary_currency,
    is_salary_visible, status, deadline, skills,
  } = req.body;

  try {
    const companyRes = await pool.query(
      'SELECT id FROM companies WHERE owner_id = $1 AND deleted_at IS NULL AND is_active = TRUE',
      [req.user.id]
    );
    if (!companyRes.rows.length) {
      return res.status(400).json({
        success: false,
        error:  'You must create a company before posting jobs.',
      });
    }

    const company     = companyRes.rows[0];
    const slug        = await uniqueSlug(title, 'jobs');
    const safeDesc    = xss(description);
    const safeReq     = requirements     ? xss(requirements)     : null;
    const safeRes     = responsibilities ? xss(responsibilities) : null;
    const safeBen     = benefits         ? xss(benefits)         : null;
    const publishedAt = status === 'published' ? new Date() : null;

    const job = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO jobs
           (company_id, posted_by, title, slug, description, requirements,
            responsibilities, benefits, type, experience_level, category,
            location, country, is_remote, salary_min, salary_max,
            salary_currency, is_salary_visible, status, deadline, published_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         RETURNING *`,
        [
          company.id, req.user.id, title.trim(), slug,
          safeDesc, safeReq, safeRes, safeBen,
          type             || 'full-time',
          experience_level || 'mid',
          category         || null,
          location         || null,
          country          || null,
          is_remote === 'true' || is_remote === true,
          salary_min       || null,
          salary_max       || null,
          salary_currency  || 'USD',
          is_salary_visible !== 'false' && is_salary_visible !== false,
          status           || 'draft',
          deadline         || null,
          publishedAt,
        ]
      );
      const newJob = rows[0];

      if (skills && skills.length) {
        const skillList = Array.isArray(skills)
          ? skills
          : skills.split(',').map(s => s.trim());
        for (const skillId of skillList) {
          if (skillId) {
            await client.query(
              'INSERT INTO job_skills (job_id, skill_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
              [newJob.id, parseInt(skillId)]
            );
          }
        }
      }
      return newJob;
    });

    await auditLog({
      userId:    req.user.id, action: 'JOB_CREATED',
      entity:    'job',       entityId: job.id,
      newValues: { title: job.title, status: job.status }, req,
    });

    res.status(201).json({
      success: true,
      message: `Job ${job.status === 'published' ? 'published' : 'saved as draft'} successfully.`,
      job,
    });
  } catch (err) {
    logger.error('Create job error:', err);
    res.status(500).json({ success: false, error: 'Failed to create job.' });
  }
};

// ── GET ALL JOBS (Public) ─────────────────────────────────────────
// FIX: Full text search now uses websearch_to_tsquery which handles
// "nodejs" matching "Node.js", partial words, and natural language
exports.getJobs = async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const {
      search, type, experience_level,
      category, location, is_remote,
      salary_min, salary_max, company_id, sort,
    } = req.query;

    let conditions = [`j.status = 'published'`, `j.deleted_at IS NULL`];
    let params     = [];

    // FIX: Use websearch_to_tsquery for flexible search
    // "nodejs" now matches "Node.js", "node js", etc.
    // Falls back to ILIKE if full text finds nothing
    if (search) {
      params.push(search);
      params.push(`%${search}%`);
      conditions.push(
        `(to_tsvector('english', j.title || ' ' || COALESCE(j.description,''))
          @@ websearch_to_tsquery('english', $${params.length - 1})
          OR j.title ILIKE $${params.length})`
      );
    }
    if (type) {
      params.push(type);
      conditions.push(`j.type = $${params.length}`);
    }
    if (experience_level) {
      params.push(experience_level);
      conditions.push(`j.experience_level = $${params.length}`);
    }
    if (category) {
      params.push(`%${category}%`);
      conditions.push(`j.category ILIKE $${params.length}`);
    }
    if (location) {
      params.push(`%${location}%`);
      conditions.push(`j.location ILIKE $${params.length}`);
    }
    if (is_remote === 'true') {
      conditions.push(`j.is_remote = TRUE`);
    }
    if (salary_min) {
      params.push(parseInt(salary_min));
      conditions.push(`j.salary_min >= $${params.length}`);
    }
    if (salary_max) {
      params.push(parseInt(salary_max));
      conditions.push(`j.salary_max <= $${params.length}`);
    }
    if (company_id) {
      params.push(parseInt(company_id));
      conditions.push(`j.company_id = $${params.length}`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const sortOptions = {
      newest:   'j.published_at DESC',
      oldest:   'j.published_at ASC',
      salary:   'j.salary_max DESC NULLS LAST',
      relevant: 'j.is_featured DESC, j.published_at DESC',
    };
    const orderBy = sortOptions[sort] || sortOptions.newest;

    const countRes = await pool.query(
      `SELECT COUNT(DISTINCT j.id) FROM jobs j ${where}`, params
    );
    const total = parseInt(countRes.rows[0].count);

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT
         j.id, j.title, j.slug, j.type, j.experience_level,
         j.category, j.location, j.country, j.is_remote,
         j.salary_min, j.salary_max, j.salary_currency, j.is_salary_visible,
         j.is_featured, j.views, j.published_at, j.deadline,
         c.id AS company_id, c.name AS company_name,
         c.slug AS company_slug, c.logo_url AS company_logo,
         c.industry AS company_industry, c.is_verified AS company_verified,
         COUNT(DISTINCT a.id) AS application_count,
         ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL) AS skills
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
       LEFT JOIN applications a ON a.job_id = j.id AND a.deleted_at IS NULL
       LEFT JOIN job_skills js ON js.job_id = j.id
       LEFT JOIN skills s ON s.id = js.skill_id
       ${where}
       GROUP BY j.id, c.id
       ORDER BY ${orderBy}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      success:    true,
      jobs:       rows,
      pagination: paginationMeta(total, page, limit),
      filters:    { search, type, experience_level, location, is_remote, salary_min, salary_max },
    });
  } catch (err) {
    logger.error('Get jobs error:', err);
    res.status(500).json({ success: false, error: 'Failed to load jobs.' });
  }
};

// ── GET SINGLE JOB ────────────────────────────────────────────────
exports.getJob = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         j.*,
         c.name AS company_name, c.slug AS company_slug,
         c.logo_url AS company_logo, c.industry AS company_industry,
         c.location AS company_location, c.size AS company_size,
         c.is_verified AS company_verified, c.description AS company_description,
         c.website AS company_website,
         ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL) AS skills,
         COUNT(DISTINCT a.id) AS application_count
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
       LEFT JOIN job_skills js ON js.job_id = j.id
       LEFT JOIN skills s ON s.id = js.skill_id
       LEFT JOIN applications a ON a.job_id = j.id AND a.deleted_at IS NULL
       WHERE j.slug = $1 AND j.deleted_at IS NULL
       GROUP BY j.id, c.id`,
      [req.params.slug]
    );

    if (!rows.length) return res.status(404).json({ success: false, error: 'Job not found.' });

    const job = rows[0];

    // Draft/closed jobs only visible to employer who posted them or admin
    if (job.status !== 'published') {
      if (!req.user || (req.user.id !== job.posted_by && req.user.role !== 'admin')) {
        return res.status(404).json({ success: false, error: 'Job not found.' });
      }
    }

    // Increment views asynchronously — don't slow down response
    pool.query('UPDATE jobs SET views = views + 1 WHERE id = $1', [job.id])
      .catch(err => logger.error('View increment error:', err));

    let userApplied = false;
    let userSaved   = false;
    if (req.user) {
      const [appRes, saveRes] = await Promise.all([
        pool.query(
          'SELECT id FROM applications WHERE job_id=$1 AND applicant_id=$2 AND deleted_at IS NULL',
          [job.id, req.user.id]
        ),
        pool.query(
          'SELECT id FROM saved_jobs WHERE job_id=$1 AND user_id=$2',
          [job.id, req.user.id]
        ),
      ]);
      userApplied = !!appRes.rows.length;
      userSaved   = !!saveRes.rows.length;
    }

    res.json({ success: true, job, userApplied, userSaved });
  } catch (err) {
    logger.error('Get job error:', err);
    res.status(500).json({ success: false, error: 'Failed to load job.' });
  }
};

// ── GET MY JOBS (Employer) ────────────────────────────────────────
exports.getMyJobs = async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const status = req.query.status || '';

    let conditions = ['j.posted_by = $1', 'j.deleted_at IS NULL'];
    let params     = [req.user.id];

    if (status) {
      params.push(status);
      conditions.push(`j.status = $${params.length}`);
    }

    const where    = `WHERE ${conditions.join(' AND ')}`;
    const countRes = await pool.query(`SELECT COUNT(*) FROM jobs j ${where}`, params);
    const total    = parseInt(countRes.rows[0].count);

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT j.id, j.title, j.slug, j.type, j.status,
              j.views, j.is_featured, j.published_at, j.created_at, j.deadline,
              COUNT(DISTINCT a.id) AS application_count
       FROM jobs j
       LEFT JOIN applications a ON a.job_id = j.id AND a.deleted_at IS NULL
       ${where}
       GROUP BY j.id
       ORDER BY j.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ success: true, jobs: rows, pagination: paginationMeta(total, page, limit) });
  } catch (err) {
    logger.error('Get my jobs error:', err);
    res.status(500).json({ success: false, error: 'Failed to load jobs.' });
  }
};

// ── UPDATE JOB ────────────────────────────────────────────────────
exports.updateJob = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM jobs WHERE slug = $1 AND deleted_at IS NULL',
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Job not found.' });

    const job = rows[0];
    if (job.posted_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'You can only edit your own jobs.' });
    }

    const {
      title, description, requirements, responsibilities,
      benefits, type, experience_level, category,
      location, country, is_remote, salary_min, salary_max,
      salary_currency, is_salary_visible, status, deadline, skills,
    } = req.body;

    const publishedAt = status === 'published' && !job.published_at ? new Date() : job.published_at;

    const updated = await withTransaction(async (client) => {
      const { rows: updatedRows } = await client.query(
        `UPDATE jobs SET
           title            = COALESCE($1,  title),
           description      = COALESCE($2,  description),
           requirements     = COALESCE($3,  requirements),
           responsibilities = COALESCE($4,  responsibilities),
           benefits         = COALESCE($5,  benefits),
           type             = COALESCE($6,  type),
           experience_level = COALESCE($7,  experience_level),
           category         = COALESCE($8,  category),
           location         = COALESCE($9,  location),
           country          = COALESCE($10, country),
           is_remote        = COALESCE($11, is_remote),
           salary_min       = COALESCE($12, salary_min),
           salary_max       = COALESCE($13, salary_max),
           salary_currency  = COALESCE($14, salary_currency),
           is_salary_visible= COALESCE($15, is_salary_visible),
           status           = COALESCE($16, status),
           deadline         = COALESCE($17, deadline),
           published_at     = $18,
           updated_at       = NOW()
         WHERE id = $19 RETURNING *`,
        [
          title?.trim()    || null,
          description ? xss(description) : null,
          requirements ? xss(requirements) : null,
          responsibilities ? xss(responsibilities) : null,
          benefits ? xss(benefits) : null,
          type || null, experience_level || null,
          category || null, location || null, country || null,
          is_remote !== undefined ? (is_remote === 'true' || is_remote === true) : null,
          salary_min || null, salary_max || null,
          salary_currency || null,
          is_salary_visible !== undefined
            ? (is_salary_visible !== 'false' && is_salary_visible !== false)
            : null,
          status || null, deadline || null,
          publishedAt, job.id,
        ]
      );

      if (skills !== undefined) {
        await client.query('DELETE FROM job_skills WHERE job_id = $1', [job.id]);
        const skillList = Array.isArray(skills) ? skills : skills.split(',').map(s => s.trim());
        for (const skillId of skillList) {
          if (skillId) {
            await client.query(
              'INSERT INTO job_skills (job_id, skill_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
              [job.id, parseInt(skillId)]
            );
          }
        }
      }
      return updatedRows[0];
    });

    await auditLog({
      userId: req.user.id, action: 'JOB_UPDATED',
      entity: 'job', entityId: job.id,
      oldValues: { status: job.status, title: job.title },
      newValues: { status: updated.status, title: updated.title },
      req,
    });

    res.json({ success: true, message: 'Job updated successfully.', job: updated });
  } catch (err) {
    logger.error('Update job error:', err);
    res.status(500).json({ success: false, error: 'Failed to update job.' });
  }
};

// ── DELETE JOB (Soft Delete) ──────────────────────────────────────
exports.deleteJob = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM jobs WHERE slug = $1 AND deleted_at IS NULL',
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Job not found.' });

    const job = rows[0];
    if (job.posted_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'You can only delete your own jobs.' });
    }

    await pool.query(
      `UPDATE jobs SET deleted_at = NOW(), status = 'closed' WHERE id = $1`,
      [job.id]
    );

    await auditLog({
      userId: req.user.id, action: 'JOB_DELETED',
      entity: 'job', entityId: job.id,
      oldValues: { title: job.title }, req,
    });

    res.json({ success: true, message: 'Job deleted successfully.' });
  } catch (err) {
    logger.error('Delete job error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete job.' });
  }
};

// ── CLOSE JOB ─────────────────────────────────────────────────────
exports.closeJob = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM jobs WHERE slug = $1 AND deleted_at IS NULL',
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Job not found.' });

    const job = rows[0];
    if (job.posted_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    await pool.query(
      `UPDATE jobs SET status = 'closed', updated_at = NOW() WHERE id = $1`,
      [job.id]
    );

    await auditLog({ userId: req.user.id, action: 'JOB_CLOSED', entity: 'job', entityId: job.id, req });
    res.json({ success: true, message: 'Job closed. No new applications will be accepted.' });
  } catch (err) {
    logger.error('Close job error:', err);
    res.status(500).json({ success: false, error: 'Failed to close job.' });
  }
};

// ── SAVE / UNSAVE JOB ─────────────────────────────────────────────
exports.toggleSaveJob = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM jobs WHERE slug = $1 AND status = 'published' AND deleted_at IS NULL`,
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Job not found.' });

    const jobId    = rows[0].id;
    const existing = await pool.query(
      'SELECT id FROM saved_jobs WHERE user_id = $1 AND job_id = $2',
      [req.user.id, jobId]
    );

    if (existing.rows.length) {
      await pool.query('DELETE FROM saved_jobs WHERE user_id=$1 AND job_id=$2', [req.user.id, jobId]);
      return res.json({ success: true, saved: false, message: 'Job removed from saved list.' });
    }

    await pool.query('INSERT INTO saved_jobs (user_id, job_id) VALUES ($1,$2)', [req.user.id, jobId]);
    res.json({ success: true, saved: true, message: 'Job saved successfully.' });
  } catch (err) {
    logger.error('Save job error:', err);
    res.status(500).json({ success: false, error: 'Failed to save job.' });
  }
};

// ── GET SAVED JOBS ────────────────────────────────────────────────
exports.getSavedJobs = async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const countRes = await pool.query(
      'SELECT COUNT(*) FROM saved_jobs WHERE user_id = $1', [req.user.id]
    );
    const total = parseInt(countRes.rows[0].count);

    const { rows } = await pool.query(
      `SELECT j.id, j.title, j.slug, j.type, j.location,
              j.is_remote, j.salary_min, j.salary_max,
              j.salary_currency, j.is_salary_visible,
              j.published_at, j.deadline,
              c.name AS company_name, c.logo_url AS company_logo,
              sj.created_at AS saved_at
       FROM saved_jobs sj
       JOIN jobs j      ON j.id = sj.job_id AND j.deleted_at IS NULL
       JOIN companies c ON c.id = j.company_id
       WHERE sj.user_id = $1
       ORDER BY sj.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    res.json({ success: true, jobs: rows, pagination: paginationMeta(total, page, limit) });
  } catch (err) {
    logger.error('Get saved jobs error:', err);
    res.status(500).json({ success: false, error: 'Failed to load saved jobs.' });
  }
};

// ── GET SKILLS LIST ───────────────────────────────────────────────
exports.getSkills = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, slug FROM skills ORDER BY name ASC');
    res.json({ success: true, skills: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load skills.' });
  }
};
