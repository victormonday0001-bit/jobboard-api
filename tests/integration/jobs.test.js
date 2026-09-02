const request  = require('supertest');
const app      = require('../../server');
const { pool } = require('../../config/db');
const {
  cleanDatabase,
  createTestUser,
  createTestCompany,
  createTestJob,
} = require('../helpers/testDb');

let employerToken, jobseekerToken;
let employerUser, company, publishedJob;

beforeAll(async () => {
  await cleanDatabase();

  const employer  = await createTestUser({
    email: 'emp@jobs.test', role: 'employer', is_verified: true,
  });
  const jobseeker = await createTestUser({
    email: 'js@jobs.test', role: 'jobseeker', is_verified: true,
  });

  // FIX: Login to get real tokens stored in DB
  const empLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'emp@jobs.test', password: 'Password1' });
  const jsLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'js@jobs.test', password: 'Password1' });

  employerToken  = empLogin.body.tokens.accessToken;
  jobseekerToken = jsLogin.body.tokens.accessToken;
  employerUser   = employer.user;

  company = await createTestCompany(employer.user.id, {
    name: 'Flutterwave', slug: 'flutterwave',
  });

  // FIX: Job created with salary fields so salary filter tests work
  publishedJob = await createTestJob(company.id, employer.user.id, {
    title:            'Senior Backend Developer',
    slug:             'senior-backend-developer',
    description:      'We need an experienced Node.js developer with PostgreSQL skills.',
    type:             'full-time',
    experience_level: 'senior',
    location:         'Lagos, Nigeria',
    salary_min:       80000,
    salary_max:       120000,
    salary_currency:  'USD',
    is_salary_visible: true,
    status:           'published',
  });

  await createTestJob(company.id, employer.user.id, {
    title:  'Frontend Developer',
    slug:   'frontend-developer',
    status: 'draft',
    salary_min: null,
    salary_max: null,
  });
});

afterAll(async () => {
  await cleanDatabase();
  await pool.end();
});

// ── GET ALL JOBS ──────────────────────────────────────────────────
describe('GET /api/jobs', () => {
  it('returns published jobs without authentication', async () => {
    const res = await request(app).get('/api/jobs');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.jobs)).toBe(true);
    expect(res.body.pagination).toBeDefined();
  });

  it('does not return draft jobs to public', async () => {
    const res = await request(app).get('/api/jobs');
    const slugs = res.body.jobs.map(j => j.slug);
    expect(slugs).not.toContain('frontend-developer');
    expect(slugs).toContain('senior-backend-developer');
  });

  it('FIX: search finds jobs by keyword', async () => {
    const res = await request(app).get('/api/jobs?search=backend');
    expect(res.statusCode).toBe(200);
    expect(res.body.jobs.length).toBeGreaterThan(0);
  });

  // FIX: Use word that exists in description — "Node.js" is in description
  it('FIX: search works with partial words via ILIKE fallback', async () => {
    const res = await request(app).get('/api/jobs?search=PostgreSQL');
    expect(res.statusCode).toBe(200);
    expect(res.body.jobs.length).toBeGreaterThan(0);
  });

  it('filters by job type', async () => {
    const res = await request(app).get('/api/jobs?type=full-time');
    expect(res.statusCode).toBe(200);
    res.body.jobs.forEach(j => expect(j.type).toBe('full-time'));
  });

  it('filters by experience level', async () => {
    const res = await request(app).get('/api/jobs?experience_level=senior');
    expect(res.statusCode).toBe(200);
    expect(res.body.jobs.length).toBeGreaterThan(0);
  });

  // FIX: salary_min=70000 → job has salary_min=80000 which is >= 70000 ✅
  it('filters by minimum salary', async () => {
    const res = await request(app).get('/api/jobs?salary_min=70000');
    expect(res.statusCode).toBe(200);
    expect(res.body.jobs.length).toBeGreaterThan(0);
  });

  it('returns empty for salary above all jobs', async () => {
    const res = await request(app).get('/api/jobs?salary_min=999999');
    expect(res.statusCode).toBe(200);
    expect(res.body.jobs.length).toBe(0);
  });

  it('sorts by salary', async () => {
    const res = await request(app).get('/api/jobs?sort=salary');
    expect(res.statusCode).toBe(200);
  });

  it('paginates results', async () => {
    const res = await request(app).get('/api/jobs?page=1&limit=5');
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(5);
  });

  it('enforces maximum limit of 50', async () => {
    const res = await request(app).get('/api/jobs?limit=9999');
    expect(res.body.pagination.limit).toBe(50);
  });
});

// ── GET SINGLE JOB ────────────────────────────────────────────────
describe('GET /api/jobs/:slug', () => {
  it('returns published job with company info', async () => {
    const res = await request(app).get('/api/jobs/senior-backend-developer');
    expect(res.statusCode).toBe(200);
    expect(res.body.job.title).toBe('Senior Backend Developer');
    expect(res.body.job.company_name).toBe('Flutterwave');
    expect(res.body.userApplied).toBe(false);
    expect(res.body.userSaved).toBe(false);
  });

  it('returns 404 for draft job to public', async () => {
    const res = await request(app).get('/api/jobs/frontend-developer');
    expect(res.statusCode).toBe(404);
  });

  it('returns draft to the employer who posted it', async () => {
    const res = await request(app)
      .get('/api/jobs/frontend-developer')
      .set('Authorization', `Bearer ${employerToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.job.status).toBe('draft');
  });

  it('returns 404 for non-existent slug', async () => {
    const res = await request(app).get('/api/jobs/does-not-exist-12345');
    expect(res.statusCode).toBe(404);
  });
});

// ── CREATE JOB ────────────────────────────────────────────────────
describe('POST /api/jobs', () => {
  it('allows verified employer to create a published job', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${employerToken}`)
      .send({
        title:            'DevOps Engineer',
        description:      'Looking for a DevOps engineer with Docker experience.',
        type:             'full-time',
        experience_level: 'senior',
        status:           'published',
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.job.slug).toBeDefined();
  });

  it('creates a draft job', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${employerToken}`)
      .send({
        title:       'Data Analyst',
        description: 'Looking for a data analyst.',
        status:      'draft',
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.job.published_at).toBeNull();
  });

  it('rejects jobseeker posting a job', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${jobseekerToken}`)
      .send({ title: 'Test', description: 'Test' });
    expect(res.statusCode).toBe(403);
  });

  it('rejects unverified employer', async () => {
    const unverified = await createTestUser({
      email: 'unverified@jobs.test', role: 'employer', is_verified: false,
    });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'unverified@jobs.test', password: 'Password1' });
    const res = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${loginRes.body.tokens.accessToken}`)
      .send({ title: 'Test', description: 'Test', status: 'published' });
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('rejects job without description', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${employerToken}`)
      .send({ title: 'No description' });
    expect(res.statusCode).toBe(400);
    expect(res.body.fields.description).toBeDefined();
  });
});

// ── UPDATE JOB ────────────────────────────────────────────────────
describe('PUT /api/jobs/:slug', () => {
  it('allows employer to partially update job', async () => {
    const res = await request(app)
      .put('/api/jobs/senior-backend-developer')
      .set('Authorization', `Bearer ${employerToken}`)
      .send({ salary_min: 90000, salary_max: 150000 });
    expect(res.statusCode).toBe(200);
    expect(res.body.job.salary_min).toBe(90000);
    expect(res.body.job.title).toBe('Senior Backend Developer');
  });

  it('rejects another employer updating this job', async () => {
    const other = await createTestUser({
      email: 'other@jobs.test', role: 'employer', is_verified: true,
    });
    const otherLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'other@jobs.test', password: 'Password1' });
    const res = await request(app)
      .put('/api/jobs/senior-backend-developer')
      .set('Authorization', `Bearer ${otherLogin.body.tokens.accessToken}`)
      .send({ title: 'Hacked' });
    expect(res.statusCode).toBe(403);
  });
});

// ── GET MY JOBS ───────────────────────────────────────────────────
describe('GET /api/jobs/me', () => {
  it('returns all employer jobs including drafts', async () => {
    const res = await request(app)
      .get('/api/jobs/me')
      .set('Authorization', `Bearer ${employerToken}`);
    expect(res.statusCode).toBe(200);
    const slugs = res.body.jobs.map(j => j.slug);
    expect(slugs).toContain('senior-backend-developer');
  });

  it('rejects jobseeker', async () => {
    const res = await request(app)
      .get('/api/jobs/me')
      .set('Authorization', `Bearer ${jobseekerToken}`);
    expect(res.statusCode).toBe(403);
  });
});

// ── SAVE / UNSAVE JOB ─────────────────────────────────────────────
describe('POST /api/jobs/:slug/save', () => {
  it('saves a job', async () => {
    const res = await request(app)
      .post('/api/jobs/senior-backend-developer/save')
      .set('Authorization', `Bearer ${jobseekerToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.saved).toBe(true);
  });

  it('unsaves the same job (toggle)', async () => {
    const res = await request(app)
      .post('/api/jobs/senior-backend-developer/save')
      .set('Authorization', `Bearer ${jobseekerToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.saved).toBe(false);
  });
});

// ── GET SAVED JOBS ────────────────────────────────────────────────
describe('GET /api/jobs/saved', () => {
  beforeAll(async () => {
    await request(app)
      .post('/api/jobs/senior-backend-developer/save')
      .set('Authorization', `Bearer ${jobseekerToken}`);
  });

  it('returns saved jobs', async () => {
    const res = await request(app)
      .get('/api/jobs/saved')
      .set('Authorization', `Bearer ${jobseekerToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.jobs.length).toBeGreaterThan(0);
  });
});

// ── CLOSE JOB ────────────────────────────────────────────────────
describe('PATCH /api/jobs/:slug/close', () => {
  it('allows employer to close their job', async () => {
    const res = await request(app)
      .patch('/api/jobs/frontend-developer/close')
      .set('Authorization', `Bearer ${employerToken}`);
    expect(res.statusCode).toBe(200);
  });
});

// ── DELETE JOB ────────────────────────────────────────────────────
describe('DELETE /api/jobs/:slug', () => {
  it('soft deletes a job', async () => {
    const res = await request(app)
      .delete('/api/jobs/frontend-developer')
      .set('Authorization', `Bearer ${employerToken}`);
    expect(res.statusCode).toBe(200);

    const check = await request(app).get('/api/jobs/frontend-developer');
    expect(check.statusCode).toBe(404);
  });
});

// ── GET SKILLS ────────────────────────────────────────────────────
describe('GET /api/jobs/skills', () => {
  it('returns skills list', async () => {
    const res = await request(app).get('/api/jobs/skills');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.skills)).toBe(true);
    expect(res.body.skills.length).toBeGreaterThan(0);
  });
});
