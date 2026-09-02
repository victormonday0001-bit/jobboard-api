const request  = require('supertest');
const app      = require('../../server');
const { pool } = require('../../config/db');
const {
  cleanDatabase,
  createTestUser,
  createTestCompany,
  createTestJob,
} = require('../helpers/testDb');

let employerToken, jobseekerToken, otherEmployerToken;
let employerUser, jobseekerUser;
let company, job, applicationId;

beforeAll(async () => {
  await cleanDatabase();

  const employer      = await createTestUser({ email: 'emp@app.test', role: 'employer', is_verified: true });
  const jobseeker     = await createTestUser({ email: 'js@app.test', role: 'jobseeker', is_verified: true });
  const otherEmployer = await createTestUser({ email: 'other@app.test', role: 'employer', is_verified: true });

  employerUser  = employer.user;
  jobseekerUser = jobseeker.user;

  // FIX: Login to get real tokens stored in DB
  const empLogin   = await request(app).post('/api/auth/login').send({ email: 'emp@app.test', password: 'Password1' });
  const jsLogin    = await request(app).post('/api/auth/login').send({ email: 'js@app.test', password: 'Password1' });
  const otherLogin = await request(app).post('/api/auth/login').send({ email: 'other@app.test', password: 'Password1' });

  employerToken      = empLogin.body.tokens.accessToken;
  jobseekerToken     = jsLogin.body.tokens.accessToken;
  otherEmployerToken = otherLogin.body.tokens.accessToken;

  company = await createTestCompany(employer.user.id, { name: 'Test Corp', slug: 'test-corp' });
  job     = await createTestJob(company.id, employer.user.id, { title: 'Backend Developer', slug: 'backend-developer' });

  // Give jobseeker a CV
  await pool.query(
    `UPDATE jobseeker_profiles SET cv_url=$1, cv_filename=$2 WHERE user_id=$3`,
    ['/uploads/cvs/test.pdf', 'test-cv.pdf', jobseeker.user.id]
  );
});

afterAll(async () => {
  await cleanDatabase();
  await pool.end();
});

// ── UPDATE PROFILE ────────────────────────────────────────────────
describe('PUT /api/applications/profile', () => {
  it('allows verified jobseeker to update profile', async () => {
    const res = await request(app)
      .put('/api/applications/profile')
      .set('Authorization', `Bearer ${jobseekerToken}`)
      .field('headline', 'Senior Backend Developer')
      .field('location', 'Lagos, Nigeria')
      .field('years_experience', '3');
    expect(res.statusCode).toBe(200);
    expect(res.body.profile.headline).toBe('Senior Backend Developer');
  });

  it('rejects employer', async () => {
    const res = await request(app)
      .put('/api/applications/profile')
      .set('Authorization', `Bearer ${employerToken}`)
      .field('headline', 'Test');
    expect(res.statusCode).toBe(403);
  });

  it('rejects unverified jobseeker', async () => {
    const unverified = await createTestUser({ email: 'unverified@app.test', role: 'jobseeker', is_verified: false });
    const loginRes   = await request(app).post('/api/auth/login').send({ email: 'unverified@app.test', password: 'Password1' });
    const res = await request(app)
      .put('/api/applications/profile')
      .set('Authorization', `Bearer ${loginRes.body.tokens.accessToken}`)
      .field('headline', 'Test');
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });
});

// ── APPLY TO JOB ──────────────────────────────────────────────────
describe('POST /api/applications/jobs/:slug/apply', () => {
  it('allows verified jobseeker to apply using profile CV', async () => {
    const res = await request(app)
      .post(`/api/applications/jobs/${job.slug}/apply`)
      .set('Authorization', `Bearer ${jobseekerToken}`)
      .field('cover_letter', 'I am very interested in this role.');
    expect(res.statusCode).toBe(201);
    expect(res.body.application.status).toBe('pending');
    applicationId = res.body.application.id;
  });

  it('prevents applying twice', async () => {
    const res = await request(app)
      .post(`/api/applications/jobs/${job.slug}/apply`)
      .set('Authorization', `Bearer ${jobseekerToken}`)
      .field('cover_letter', 'Applying again.');
    expect(res.statusCode).toBe(409);
  });

  it('rejects employer applying', async () => {
    const res = await request(app)
      .post(`/api/applications/jobs/${job.slug}/apply`)
      .set('Authorization', `Bearer ${employerToken}`);
    expect(res.statusCode).toBe(403);
  });

  it('rejects unverified jobseeker', async () => {
    const unverified = await createTestUser({ email: 'unverified2@app.test', role: 'jobseeker', is_verified: false });
    const loginRes   = await request(app).post('/api/auth/login').send({ email: 'unverified2@app.test', password: 'Password1' });
    const res = await request(app)
      .post(`/api/applications/jobs/${job.slug}/apply`)
      .set('Authorization', `Bearer ${loginRes.body.tokens.accessToken}`);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('rejects jobseeker with no CV', async () => {
    const noCV     = await createTestUser({ email: 'nocv@app.test', role: 'jobseeker', is_verified: true });
    const loginRes = await request(app).post('/api/auth/login').send({ email: 'nocv@app.test', password: 'Password1' });
    const otherJob = await createTestJob(company.id, employerUser.id, { title: 'No CV Job', slug: 'no-cv-job' });
    const res = await request(app)
      .post(`/api/applications/jobs/${otherJob.slug}/apply`)
      .set('Authorization', `Bearer ${loginRes.body.tokens.accessToken}`);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('CV');
  });
});

// ── GET MY APPLICATIONS ───────────────────────────────────────────
describe('GET /api/applications/my', () => {
  it('returns jobseeker applications', async () => {
    const res = await request(app)
      .get('/api/applications/my')
      .set('Authorization', `Bearer ${jobseekerToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.applications.length).toBeGreaterThan(0);
  });

  it('returns 401 without auth', async () => {
    expect((await request(app).get('/api/applications/my')).statusCode).toBe(401);
  });
});

// ── GET JOB APPLICATIONS ──────────────────────────────────────────
describe('GET /api/applications/jobs/:slug', () => {
  it('allows employer to view their job applications', async () => {
    const res = await request(app)
      .get(`/api/applications/jobs/${job.slug}`)
      .set('Authorization', `Bearer ${employerToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.applications.length).toBeGreaterThan(0);
  });

  it('rejects other employer', async () => {
    const res = await request(app)
      .get(`/api/applications/jobs/${job.slug}`)
      .set('Authorization', `Bearer ${otherEmployerToken}`);
    expect(res.statusCode).toBe(404);
  });
});

// ── GET SINGLE APPLICATION ────────────────────────────────────────
describe('GET /api/applications/:id', () => {
  it('allows applicant to view their application', async () => {
    const res = await request(app)
      .get(`/api/applications/${applicationId}`)
      .set('Authorization', `Bearer ${jobseekerToken}`);
    expect(res.statusCode).toBe(200);
  });

  it('rejects other employer', async () => {
    const res = await request(app)
      .get(`/api/applications/${applicationId}`)
      .set('Authorization', `Bearer ${otherEmployerToken}`);
    expect(res.statusCode).toBe(403);
  });
});

// ── UPDATE STATUS ─────────────────────────────────────────────────
describe('PATCH /api/applications/:id/status', () => {
  it('allows employer to update status', async () => {
    const res = await request(app)
      .patch(`/api/applications/${applicationId}/status`)
      .set('Authorization', `Bearer ${employerToken}`)
      .send({ status: 'reviewing', employer_notes: 'Strong candidate' });
    expect(res.statusCode).toBe(200);
    expect(res.body.application.status).toBe('reviewing');
    expect(res.body.application.reviewed_at).toBeDefined();
  });

  it('moves to shortlisted', async () => {
    const res = await request(app)
      .patch(`/api/applications/${applicationId}/status`)
      .set('Authorization', `Bearer ${employerToken}`)
      .send({ status: 'shortlisted' });
    expect(res.statusCode).toBe(200);
    expect(res.body.application.shortlisted_at).toBeDefined();
  });

  it('rejects invalid status', async () => {
    const res = await request(app)
      .patch(`/api/applications/${applicationId}/status`)
      .set('Authorization', `Bearer ${employerToken}`)
      .send({ status: 'approved' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects other employer', async () => {
    const res = await request(app)
      .patch(`/api/applications/${applicationId}/status`)
      .set('Authorization', `Bearer ${otherEmployerToken}`)
      .send({ status: 'offered' });
    expect(res.statusCode).toBe(404);
  });
});

// ── NOTIFICATIONS ─────────────────────────────────────────────────
describe('GET /api/applications/notifications', () => {
  it('returns notifications', async () => {
    const res = await request(app)
      .get('/api/applications/notifications')
      .set('Authorization', `Bearer ${jobseekerToken}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.notifications)).toBe(true);
  });
});

describe('PATCH /api/applications/notifications/read', () => {
  it('marks all as read', async () => {
    const res = await request(app)
      .patch('/api/applications/notifications/read')
      .set('Authorization', `Bearer ${jobseekerToken}`);
    expect(res.statusCode).toBe(200);

    const check = await request(app)
      .get('/api/applications/notifications')
      .set('Authorization', `Bearer ${jobseekerToken}`);
    expect(check.body.unread).toBe(0);
  });
});

// ── WITHDRAW ──────────────────────────────────────────────────────
describe('PATCH /api/applications/:id/withdraw', () => {
  it('allows jobseeker to withdraw', async () => {
    const res = await request(app)
      .patch(`/api/applications/${applicationId}/withdraw`)
      .set('Authorization', `Bearer ${jobseekerToken}`);
    expect(res.statusCode).toBe(200);
  });

  it('rejects employer withdrawing', async () => {
    const newJobseeker = await createTestUser({ email: 'newjs@app.test', role: 'jobseeker', is_verified: true });
    const jsLogin      = await request(app).post('/api/auth/login').send({ email: 'newjs@app.test', password: 'Password1' });
    await pool.query(`UPDATE jobseeker_profiles SET cv_url=$1 WHERE user_id=$2`, ['/uploads/cvs/test.pdf', newJobseeker.user.id]);

    const applyRes = await request(app)
      .post(`/api/applications/jobs/${job.slug}/apply`)
      .set('Authorization', `Bearer ${jsLogin.body.tokens.accessToken}`);
    const newAppId = applyRes.body.application.id;

    const res = await request(app)
      .patch(`/api/applications/${newAppId}/withdraw`)
      .set('Authorization', `Bearer ${employerToken}`);
    expect(res.statusCode).toBe(403);
  });
});
