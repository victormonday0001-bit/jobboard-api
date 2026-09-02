const { pool }  = require('../../config/db');
const bcrypt    = require('bcrypt');
const { generateAccessToken, generateRefreshToken } = require('../../config/jwt');

const cleanDatabase = async () => {
  await pool.query(`
    TRUNCATE TABLE
      audit_logs, notifications, saved_jobs,
      applications, job_skills, jobs,
      companies, jobseeker_profiles,
      refresh_tokens, email_verifications,
      password_resets, users
    RESTART IDENTITY CASCADE
  `);
};

const createTestUser = async (overrides = {}) => {
  const defaults = {
    email:       'test@example.com',
    password:    'Password1',
    first_name:  'Test',
    last_name:   'User',
    role:        'jobseeker',
    is_verified: true,
    is_active:   true,
  };

  const data = { ...defaults, ...overrides };
  const hash = await bcrypt.hash(data.password, 10);

  const { rows } = await pool.query(
    `INSERT INTO users
       (email, password_hash, first_name, last_name, role, is_verified, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [data.email, hash, data.first_name, data.last_name,
     data.role, data.is_verified, data.is_active]
  );
  const user = rows[0];

  if (data.role === 'jobseeker') {
    await pool.query(
      'INSERT INTO jobseeker_profiles (user_id) VALUES ($1)',
      [user.id]
    );
  }

  // FIX: Do NOT pre-store refresh token in DB
  // Tests that need tokens will call /api/auth/login to get real tokens
  // Pre-storing caused duplicate key constraint on refresh_tokens
  const accessToken  = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  return { user, accessToken, refreshToken };
};

const createTestCompany = async (ownerId, overrides = {}) => {
  const defaults = {
    name:        'Test Company',
    slug:        'test-company',
    industry:    'Technology',
    location:    'Lagos, Nigeria',
    country:     'Nigeria',
    is_active:   true,
    is_verified: false,
  };
  const data = { ...defaults, ...overrides };
  const { rows } = await pool.query(
    `INSERT INTO companies
       (owner_id, name, slug, industry, location, country, is_active, is_verified)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [ownerId, data.name, data.slug, data.industry,
     data.location, data.country, data.is_active, data.is_verified]
  );
  return rows[0];
};

const createTestJob = async (companyId, postedBy, overrides = {}) => {
  const defaults = {
    title:            'Test Backend Developer',
    slug:             'test-backend-developer',
    description:      'A test job description for automated testing.',
    type:             'full-time',
    experience_level: 'mid',
    status:           'published',
    published_at:     new Date(),
    salary_min:       80000,
    salary_max:       120000,
    salary_currency:  'USD',
    is_salary_visible: true,
  };
  const data = { ...defaults, ...overrides };
  const { rows } = await pool.query(
    `INSERT INTO jobs
       (company_id, posted_by, title, slug, description,
        type, experience_level, status, published_at,
        salary_min, salary_max, salary_currency, is_salary_visible)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [companyId, postedBy, data.title, data.slug, data.description,
     data.type, data.experience_level, data.status, data.published_at,
     data.salary_min, data.salary_max, data.salary_currency, data.is_salary_visible]
  );
  return rows[0];
};

const createTestApplication = async (jobId, applicantId, overrides = {}) => {
  const defaults = {
    cv_url:       '/uploads/cvs/test.pdf',
    cv_filename:  'test-cv.pdf',
    cover_letter: 'I am interested in this role.',
    status:       'pending',
  };
  const data = { ...defaults, ...overrides };
  const { rows } = await pool.query(
    `INSERT INTO applications
       (job_id, applicant_id, cv_url, cv_filename, cover_letter, status)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [jobId, applicantId, data.cv_url,
     data.cv_filename, data.cover_letter, data.status]
  );
  return rows[0];
};

module.exports = {
  cleanDatabase,
  createTestUser,
  createTestCompany,
  createTestJob,
  createTestApplication,
};
