const request  = require('supertest');
const app      = require('../../server');
const { pool } = require('../../config/db');
const {
  cleanDatabase,
  createTestUser,
  createTestCompany,
} = require('../helpers/testDb');

let employerToken, jobseekerToken, adminToken, employerUser;

beforeAll(async () => {
  await cleanDatabase();

  const employer  = await createTestUser({
    email: 'emp@co.test', role: 'employer', is_verified: true,
  });
  const jobseeker = await createTestUser({
    email: 'js@co.test', role: 'jobseeker', is_verified: true,
  });
  const admin = await createTestUser({
    email: 'admin@co.test', role: 'admin', is_verified: true,
  });

  // FIX: Login to get real tokens with valid refresh tokens in DB
  const empLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'emp@co.test', password: 'Password1' });
  const jsLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'js@co.test', password: 'Password1' });
  const adminLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@co.test', password: 'Password1' });

  employerToken  = empLogin.body.tokens.accessToken;
  jobseekerToken = jsLogin.body.tokens.accessToken;
  adminToken     = adminLogin.body.tokens.accessToken;
  employerUser   = employer.user;
});

afterAll(async () => {
  await cleanDatabase();
  await pool.end();
});

// ── CREATE COMPANY ────────────────────────────────────────────────
describe('POST /api/companies', () => {
  it('allows verified employer to create a company', async () => {
    const res = await request(app)
      .post('/api/companies')
      .set('Authorization', `Bearer ${employerToken}`)
      .field('name', 'Andela Nigeria')
      .field('industry', 'Technology')
      .field('location', 'Lagos, Nigeria')
      .field('country', 'Nigeria')
      .field('size', '201-500');

    expect(res.statusCode).toBe(201);
    expect(res.body.company.name).toBe('Andela Nigeria');
    expect(res.body.company.slug).toBe('andela-nigeria');
  });

  it('prevents creating a second company', async () => {
    const res = await request(app)
      .post('/api/companies')
      .set('Authorization', `Bearer ${employerToken}`)
      .field('name', 'Second Company');
    expect(res.statusCode).toBe(409);
  });

  it('rejects jobseeker creating a company', async () => {
    const res = await request(app)
      .post('/api/companies')
      .set('Authorization', `Bearer ${jobseekerToken}`)
      .field('name', 'Test');
    expect(res.statusCode).toBe(403);
  });

  it('rejects unverified employer', async () => {
    const unverified = await createTestUser({
      email: 'unverified@co.test', role: 'employer', is_verified: false,
    });
    const unvLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'unverified@co.test', password: 'Password1' });
    const res = await request(app)
      .post('/api/companies')
      .set('Authorization', `Bearer ${unvLogin.body.tokens.accessToken}`)
      .field('name', 'Unverified Company');
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('allows access after DB verification without new token', async () => {
    const newEmp = await createTestUser({
      email: 'newverify@co.test', role: 'employer', is_verified: false,
    });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'newverify@co.test', password: 'Password1' });
    const token = loginRes.body.tokens.accessToken;

    const before = await request(app)
      .post('/api/companies')
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'New Verify Company');
    expect(before.statusCode).toBe(403);

    await pool.query(
      'UPDATE users SET is_verified = TRUE WHERE id = $1',
      [newEmp.user.id]
    );

    const after = await request(app)
      .post('/api/companies')
      .set('Authorization', `Bearer ${token}`)
      .field('name', 'New Verify Company');
    expect(after.statusCode).toBe(201);
  });
});

// ── GET COMPANIES (PUBLIC) ────────────────────────────────────────
describe('GET /api/companies', () => {
  it('returns companies without authentication', async () => {
    const res = await request(app).get('/api/companies');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.companies)).toBe(true);
    expect(res.body.pagination).toBeDefined();
  });

  it('supports search by name', async () => {
    const res = await request(app).get('/api/companies?search=Andela');
    expect(res.statusCode).toBe(200);
    expect(res.body.companies.length).toBeGreaterThan(0);
  });

  it('enforces maximum limit of 50', async () => {
    const res = await request(app).get('/api/companies?limit=9999');
    expect(res.body.pagination.limit).toBe(50);
  });
});

// ── GET MY COMPANY ────────────────────────────────────────────────
describe('GET /api/companies/me', () => {
  it('returns employer own company', async () => {
    const res = await request(app)
      .get('/api/companies/me')
      .set('Authorization', `Bearer ${employerToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.company.name).toBe('Andela Nigeria');
  });

  it('returns 403 for jobseeker', async () => {
    const res = await request(app)
      .get('/api/companies/me')
      .set('Authorization', `Bearer ${jobseekerToken}`);
    expect(res.statusCode).toBe(403);
  });
});

// ── GET COMPANY BY SLUG ───────────────────────────────────────────
describe('GET /api/companies/:slug', () => {
  it('returns company without authentication', async () => {
    const res = await request(app).get('/api/companies/andela-nigeria');
    expect(res.statusCode).toBe(200);
    expect(res.body.company.name).toBe('Andela Nigeria');
  });

  it('does not expose owner_id', async () => {
    const res = await request(app).get('/api/companies/andela-nigeria');
    expect(res.body.company.owner_id).toBeUndefined();
  });

  it('returns 404 for non-existent slug', async () => {
    const res = await request(app).get('/api/companies/does-not-exist');
    expect(res.statusCode).toBe(404);
  });
});

// ── UPDATE COMPANY ────────────────────────────────────────────────
// FIX: Update tests BEFORE delete test
describe('PUT /api/companies', () => {
  it('regenerates slug when name changes', async () => {
    const res = await request(app)
      .put('/api/companies')
      .set('Authorization', `Bearer ${employerToken}`)
      .field('name', 'Andela Africa');

    expect(res.statusCode).toBe(200);
    expect(res.body.company.name).toBe('Andela Africa');
    expect(res.body.company.slug).toBe('andela-africa');
  });

  it('keeps same slug when only industry is updated', async () => {
    const res = await request(app)
      .put('/api/companies')
      .set('Authorization', `Bearer ${employerToken}`)
      .field('industry', 'Software');

    expect(res.statusCode).toBe(200);
    expect(res.body.company.slug).toBe('andela-africa');
  });

  it('updates description', async () => {
    const res = await request(app)
      .put('/api/companies')
      .set('Authorization', `Bearer ${employerToken}`)
      .field('description', 'Updated company description');

    expect(res.statusCode).toBe(200);
    expect(res.body.company.description).toBe('Updated company description');
  });
});

// ── VERIFY COMPANY ────────────────────────────────────────────────
describe('PATCH /api/companies/:id/verify', () => {
  it('allows admin to verify a company', async () => {
    const compRes = await request(app)
      .get('/api/companies/me')
      .set('Authorization', `Bearer ${employerToken}`);
    const companyId = compRes.body.company.id;

    const res = await request(app)
      .patch(`/api/companies/${companyId}/verify`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
  });

  it('rejects non-admin', async () => {
    const compRes = await request(app)
      .get('/api/companies/me')
      .set('Authorization', `Bearer ${employerToken}`);
    const companyId = compRes.body.company.id;

    const res = await request(app)
      .patch(`/api/companies/${companyId}/verify`)
      .set('Authorization', `Bearer ${employerToken}`);
    expect(res.statusCode).toBe(403);
  });
});

// ── DELETE COMPANY — must be LAST ─────────────────────────────────
describe('DELETE /api/companies', () => {
  it('soft deletes the company', async () => {
    const res = await request(app)
      .delete('/api/companies')
      .set('Authorization', `Bearer ${employerToken}`);
    expect(res.statusCode).toBe(200);

    const check = await request(app).get('/api/companies/andela-africa');
    expect(check.statusCode).toBe(404);
  });
});
