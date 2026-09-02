const { pool, withTransaction } = require('../config/db');
const { auditLog, getPagination, paginationMeta, createNotification } = require('../utils/helpers');
const {
  sendApplicationConfirmation,
  sendApplicationStatusUpdate,
  sendNewApplicationAlert,
} = require('../services/email');
const xss    = require('xss');
const logger = require('../utils/logger');
const fs     = require('fs');
const path   = require('path');

// ── APPLY TO JOB ──────────────────────────────────────────────────
exports.applyToJob = async (req, res) => {
  const { cover_letter } = req.body;

  try {
    // FIX: Direct ownership check — employer cannot apply to own job
    const jobRes = await pool.query(
      `SELECT j.*, c.name AS company_name, c.owner_id,
              u.email AS employer_email, u.first_name AS employer_name
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
       JOIN users u     ON u.id = c.owner_id
       WHERE j.slug = $1 AND j.deleted_at IS NULL`,
      [req.params.slug]
    );

    if (!jobRes.rows.length) {
      return res.status(404).json({ success: false, error: 'Job not found.' });
    }

    const job = jobRes.rows[0];

    if (job.status !== 'published') {
      return res.status(400).json({ success: false, error: 'This job is no longer accepting applications.' });
    }

    if (job.deadline && new Date() > new Date(job.deadline)) {
      return res.status(400).json({ success: false, error: 'The application deadline has passed.' });
    }

    // FIX: Check both direct ownership AND company ownership
    if (job.owner_id === req.user.id) {
      return res.status(400).json({ success: false, error: 'You cannot apply to your own job posting.' });
    }

    const existing = await pool.query(
      'SELECT id FROM applications WHERE job_id = $1 AND applicant_id = $2 AND deleted_at IS NULL',
      [job.id, req.user.id]
    );
    if (existing.rows.length) {
      return res.status(409).json({ success: false, error: 'You have already applied to this job.' });
    }

    // Get applicant profile
    const profileRes = await pool.query(
      `SELECT jp.cv_url, jp.cv_filename, u.first_name, u.last_name, u.email
       FROM users u
       LEFT JOIN jobseeker_profiles jp ON jp.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    const applicant = profileRes.rows[0];

    // Use uploaded CV or fall back to profile CV
    let cvUrl      = applicant.cv_url     || null;
    let cvFilename = applicant.cv_filename || null;

    if (req.file) {
      cvUrl      = `/uploads/cvs/${req.file.filename}`;
      cvFilename = req.file.originalname;
    }

    if (!cvUrl) {
      return res.status(400).json({
        success: false,
        error:  'Please upload a CV to apply. You can upload one now or add it to your profile first.',
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO applications
         (job_id, applicant_id, cv_url, cv_filename, cover_letter, status)
       VALUES ($1,$2,$3,$4,$5,'pending')
       RETURNING *`,
      [job.id, req.user.id, cvUrl, cvFilename, cover_letter ? xss(cover_letter) : null]
    );

    const application = rows[0];

    // Notifications
    await Promise.all([
      createNotification({
        userId:  req.user.id,
        type:    'application_submitted',
        title:   'Application Submitted',
        message: `Your application for ${job.title} at ${job.company_name} has been submitted.`,
        link:    `/api/applications/my`,
      }),
      createNotification({
        userId:  job.owner_id,
        type:    'new_application',
        title:   'New Application',
        message: `${applicant.first_name} ${applicant.last_name} applied for ${job.title}.`,
        link:    `/api/applications/${application.id}`,
      }),
    ]);

    // Emails — don't block response if they fail
    Promise.all([
      sendApplicationConfirmation(
        applicant.email,
        applicant.first_name,
        job.title,
        job.company_name
      ),
      sendNewApplicationAlert(
        job.employer_email,
        job.employer_name,
        `${applicant.first_name} ${applicant.last_name}`,
        job.title
      ),
    ]).catch(err => logger.error('Application email error:', err.message));

    await auditLog({
      userId:    req.user.id, action: 'JOB_APPLICATION_SUBMITTED',
      entity:    'application', entityId: application.id,
      newValues: { job_id: job.id, job_title: job.title }, req,
    });

    res.status(201).json({
      success: true,
      message: `Application submitted successfully for ${job.title}.`,
      application: {
        id:           application.id,
        status:       application.status,
        job_title:    job.title,
        company_name: job.company_name,
        created_at:   application.created_at,
      },
    });
  } catch (err) {
    logger.error('Apply to job error:', err);
    res.status(500).json({ success: false, error: 'Failed to submit application.' });
  }
};

// ── GET MY APPLICATIONS (Jobseeker) ──────────────────────────────
exports.getMyApplications = async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const status = req.query.status || '';

    let conditions = ['a.applicant_id = $1', 'a.deleted_at IS NULL'];
    let params     = [req.user.id];

    if (status) {
      params.push(status);
      conditions.push(`a.status = $${params.length}`);
    }

    const where    = `WHERE ${conditions.join(' AND ')}`;
    const countRes = await pool.query(`SELECT COUNT(*) FROM applications a ${where}`, params);
    const total    = parseInt(countRes.rows[0].count);

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT
         a.id, a.status, a.cover_letter, a.cv_url, a.cv_filename,
         a.created_at, a.reviewed_at, a.shortlisted_at, a.rejected_at,
         j.title AS job_title, j.slug AS job_slug, j.type AS job_type,
         j.location AS job_location, j.is_remote,
         c.name AS company_name, c.slug AS company_slug, c.logo_url AS company_logo
       FROM applications a
       JOIN jobs j      ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ success: true, applications: rows, pagination: paginationMeta(total, page, limit) });
  } catch (err) {
    logger.error('Get my applications error:', err);
    res.status(500).json({ success: false, error: 'Failed to load applications.' });
  }
};

// ── GET JOB APPLICATIONS (Employer) ──────────────────────────────
exports.getJobApplications = async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const status = req.query.status || '';

    // FIX: Strict ownership check — employer must own this specific job
    const jobRes = await pool.query(
      `SELECT j.id, j.title
       FROM jobs j
       WHERE j.slug = $1 AND j.posted_by = $2 AND j.deleted_at IS NULL`,
      [req.params.slug, req.user.id]
    );
    if (!jobRes.rows.length) {
      return res.status(404).json({ success: false, error: 'Job not found or access denied.' });
    }

    const job  = jobRes.rows[0];
    let conditions = ['a.job_id = $1', 'a.deleted_at IS NULL'];
    let params     = [job.id];

    if (status) {
      params.push(status);
      conditions.push(`a.status = $${params.length}`);
    }

    const where    = `WHERE ${conditions.join(' AND ')}`;
    const countRes = await pool.query(`SELECT COUNT(*) FROM applications a ${where}`, params);
    const total    = parseInt(countRes.rows[0].count);

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT
         a.id, a.status, a.cover_letter, a.cv_url, a.cv_filename,
         a.created_at, a.reviewed_at, a.shortlisted_at, a.employer_notes,
         u.id AS applicant_id, u.first_name, u.last_name, u.email, u.avatar,
         jp.headline, jp.location, jp.years_experience, jp.linkedin, jp.github
       FROM applications a
       JOIN users u ON u.id = a.applicant_id
       LEFT JOIN jobseeker_profiles jp ON jp.user_id = u.id
       ${where}
       ORDER BY
         CASE a.status
           WHEN 'shortlisted' THEN 1
           WHEN 'reviewing'   THEN 2
           WHEN 'pending'     THEN 3
           ELSE 4
         END,
         a.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      success:      true,
      job_title:    job.title,
      applications: rows,
      pagination:   paginationMeta(total, page, limit),
    });
  } catch (err) {
    logger.error('Get job applications error:', err);
    res.status(500).json({ success: false, error: 'Failed to load applications.' });
  }
};

// ── GET SINGLE APPLICATION ────────────────────────────────────────
exports.getApplication = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*,
              j.title AS job_title, j.slug AS job_slug, j.posted_by,
              c.name AS company_name,
              u.first_name, u.last_name, u.email, u.avatar,
              jp.headline, jp.bio, jp.location, jp.years_experience,
              jp.linkedin, jp.github, jp.website
       FROM applications a
       JOIN jobs j      ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
       JOIN users u     ON u.id = a.applicant_id
       LEFT JOIN jobseeker_profiles jp ON jp.user_id = u.id
       WHERE a.id = $1 AND a.deleted_at IS NULL`,
      [req.params.id]
    );

    if (!rows.length) return res.status(404).json({ success: false, error: 'Application not found.' });

    const application = rows[0];
    const isApplicant = application.applicant_id === req.user.id;
    const isJobOwner  = application.posted_by     === req.user.id;
    const isAdmin     = req.user.role             === 'admin';

    if (!isApplicant && !isJobOwner && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    res.json({ success: true, application });
  } catch (err) {
    logger.error('Get application error:', err);
    res.status(500).json({ success: false, error: 'Failed to load application.' });
  }
};

// ── UPDATE APPLICATION STATUS (Employer) ─────────────────────────
exports.updateStatus = async (req, res) => {
  const { status, employer_notes } = req.body;

  const validStatuses = ['reviewing', 'shortlisted', 'interview', 'offered', 'rejected'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      error:  `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
    });
  }

  try {
    // FIX: Single query with JOIN ensures employer owns the job
    // Cannot update status on applications for jobs they don't own
    const { rows } = await pool.query(
      `SELECT a.*, j.title AS job_title, j.posted_by,
              c.name AS company_name,
              u.email AS applicant_email, u.first_name AS applicant_name
       FROM applications a
       JOIN jobs j      ON j.id = a.job_id AND j.posted_by = $2
       JOIN companies c ON c.id = j.company_id
       JOIN users u     ON u.id = a.applicant_id
       WHERE a.id = $1 AND a.deleted_at IS NULL`,
      [req.params.id, req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Application not found or access denied.' });
    }

    const application = rows[0];

    // Build timestamp updates based on new status
    const timestampSQL = {
      reviewing:   ', reviewed_at = NOW()',
      shortlisted: ', shortlisted_at = NOW()',
      rejected:    ', rejected_at = NOW()',
    }[status] || '';

    const updated = await pool.query(
      `UPDATE applications SET
         status         = $1,
         employer_notes = COALESCE($2, employer_notes),
         updated_at     = NOW()
         ${timestampSQL}
       WHERE id = $3
       RETURNING *`,
      [status, employer_notes ? xss(employer_notes) : null, application.id]
    );

    // Notify applicant
    await createNotification({
      userId:  application.applicant_id,
      type:    'application_update',
      title:   'Application Update',
      message: `Your application for ${application.job_title} has been updated to: ${status}.`,
      link:    `/api/applications/my`,
    });

    // Email applicant
    sendApplicationStatusUpdate(
      application.applicant_email,
      application.applicant_name,
      application.job_title,
      status,
      application.company_name
    ).catch(err => logger.error('Status update email error:', err.message));

    await auditLog({
      userId:    req.user.id, action: 'APPLICATION_STATUS_UPDATED',
      entity:    'application', entityId: application.id,
      oldValues: { status: application.status },
      newValues: { status }, req,
    });

    res.json({
      success:     true,
      message:     `Application status updated to ${status}.`,
      application: updated.rows[0],
    });
  } catch (err) {
    logger.error('Update status error:', err);
    res.status(500).json({ success: false, error: 'Failed to update application status.' });
  }
};

// ── WITHDRAW APPLICATION (Jobseeker) ─────────────────────────────
exports.withdrawApplication = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM applications WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Application not found.' });

    const application = rows[0];
    if (application.applicant_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'You can only withdraw your own applications.' });
    }

    if (['offered', 'rejected'].includes(application.status)) {
      return res.status(400).json({
        success: false,
        error:  'Cannot withdraw an application that has already been decided.',
      });
    }

    await pool.query(
      `UPDATE applications SET status = 'withdrawn', deleted_at = NOW() WHERE id = $1`,
      [application.id]
    );

    await auditLog({
      userId:    req.user.id, action: 'APPLICATION_WITHDRAWN',
      entity:    'application', entityId: application.id, req,
    });

    res.json({ success: true, message: 'Application withdrawn successfully.' });
  } catch (err) {
    logger.error('Withdraw application error:', err);
    res.status(500).json({ success: false, error: 'Failed to withdraw application.' });
  }
};

// ── UPDATE PROFILE + CV UPLOAD ────────────────────────────────────
exports.updateProfile = async (req, res) => {
  const {
    headline, bio, location, website,
    linkedin, github, years_experience,
    desired_role, desired_salary, job_type, is_open_to_work,
  } = req.body;

  try {
    const { rows } = await pool.query(
      'SELECT * FROM jobseeker_profiles WHERE user_id = $1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Profile not found.' });

    const profile      = rows[0];
    let cvUrl          = profile.cv_url;
    let cvFilename     = profile.cv_filename;
    const cvUpdatedAt  = req.file ? new Date() : profile.cv_updated_at;

    if (req.file) {
      // Delete old CV from disk
      if (profile.cv_url) {
        const oldPath = path.join(__dirname, '..', profile.cv_url);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      cvUrl      = `/uploads/cvs/${req.file.filename}`;
      cvFilename = req.file.originalname;
    }

    const updated = await pool.query(
      `UPDATE jobseeker_profiles SET
         headline         = COALESCE($1,  headline),
         bio              = COALESCE($2,  bio),
         location         = COALESCE($3,  location),
         website          = COALESCE($4,  website),
         linkedin         = COALESCE($5,  linkedin),
         github           = COALESCE($6,  github),
         years_experience = COALESCE($7,  years_experience),
         desired_role     = COALESCE($8,  desired_role),
         desired_salary   = COALESCE($9,  desired_salary),
         job_type         = COALESCE($10, job_type),
         is_open_to_work  = COALESCE($11, is_open_to_work),
         cv_url           = $12,
         cv_filename      = $13,
         cv_updated_at    = $14,
         updated_at       = NOW()
       WHERE user_id = $15
       RETURNING *`,
      [
        headline || null, bio || null, location || null,
        website || null, linkedin || null, github || null,
        years_experience ? parseInt(years_experience) : null,
        desired_role || null,
        desired_salary ? parseInt(desired_salary) : null,
        job_type || null,
        is_open_to_work !== undefined
          ? (is_open_to_work === 'true' || is_open_to_work === true)
          : null,
        cvUrl, cvFilename, cvUpdatedAt,
        req.user.id,
      ]
    );

    res.json({
      success: true,
      message: req.file ? 'Profile and CV updated successfully.' : 'Profile updated successfully.',
      profile: updated.rows[0],
    });
  } catch (err) {
    logger.error('Update profile error:', err);
    res.status(500).json({ success: false, error: 'Failed to update profile.' });
  }
};

// ── GET NOTIFICATIONS ─────────────────────────────────────────────
// FIX: Auto-cleanup notifications older than 90 days
exports.getNotifications = async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query);

    // Cleanup old notifications silently
    pool.query(
      `DELETE FROM notifications
       WHERE user_id = $1 AND created_at < NOW() - INTERVAL '90 days'`,
      [req.user.id]
    ).catch(err => logger.error('Notification cleanup error:', err.message));

    const countRes  = await pool.query('SELECT COUNT(*) FROM notifications WHERE user_id = $1', [req.user.id]);
    const unreadRes = await pool.query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = FALSE',
      [req.user.id]
    );

    const { rows } = await pool.query(
      `SELECT * FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    res.json({
      success:       true,
      notifications: rows,
      unread:        parseInt(unreadRes.rows[0].count),
      pagination:    paginationMeta(parseInt(countRes.rows[0].count), page, limit),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load notifications.' });
  }
};

// ── MARK NOTIFICATIONS READ ───────────────────────────────────────
exports.markNotificationsRead = async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET is_read = TRUE WHERE user_id = $1',
      [req.user.id]
    );
    res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to mark notifications.' });
  }
};
