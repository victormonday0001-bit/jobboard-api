const request  = require('supertest');
const app      = require('../../server');
const { pool } = require('../../config/db');
const { cleanDatabase, createTestUser } = require('../helpers/testDb');

beforeAll(async () => { await cleanDatabase(); });
afterAll(async ()  => { await cleanDatabase(); await pool.end(); });

// ── REGISTER ─────────────────────────────────────────────────────
describe('POST /api/auth/register', () => {
  it('creates account and returns tokens immediately', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email:      'new@test.com',
        password:   'Password1',
        first_name: 'New',
        last_name:  'User',
        role:       'jobseeker',
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.tokens).toBeDefined();
    expect(res.body.tokens.accessToken).toBeDefined();
    expect(res.body.tokens.refreshToken).toBeDefined();
    expect(res.body.tokens.expiresIn).toBe(900);
    expect(res.body.user.is_verified).toBe(false);
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it('creates employer account with correct role', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email:      'employer@test.com',
        password:   'Password1',
        first_name: 'John',
        last_name:  'Doe',
        role:       'employer',
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.user.role).toBe('employer');
  });

  it('rejects duplicate email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email:      'new@test.com',
        password:   'Password1',
        first_name: 'Dupe',
        last_name:  'User',
        role:       'jobseeker',
      });
    expect(res.statusCode).toBe(409);
  });

  it('rejects missing required fields', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'bad@test.com' });
    expect(res.statusCode).toBe(400);
    expect(res.body.fields).toBeDefined();
  });

  it('rejects weak password without uppercase', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email:      'weak1@test.com',
        password:   'password1',
        first_name: 'Test',
        last_name:  'User',
      });
    expect(res.statusCode).toBe(400);
  });

  it('rejects password without number', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email:      'weak2@test.com',
        password:   'Password',
        first_name: 'Test',
        last_name:  'User',
      });
    expect(res.statusCode).toBe(400);
  });

});

// ── LOGIN ─────────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  it('returns tokens on valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'new@test.com', password: 'Password1' });

    expect(res.statusCode).toBe(200);
    expect(res.body.tokens.accessToken).toBeDefined();
    expect(res.body.tokens.refreshToken).toBeDefined();
    expect(res.body.tokens.expiresIn).toBe(900);
  });

  it('rejects wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'new@test.com', password: 'WrongPassword1' });
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Invalid email or password.');
  });

  // FIX: 401 not 429 — rate limiting disabled in test env
  it('rejects non-existent email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody999@test.com', password: 'Password1' });
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Invalid email or password.');
  });

  it('rejects invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'notanemail', password: 'Password1' });
    expect(res.statusCode).toBe(400);
  });

  // FIX: normalizeEmail lowercases — login with uppercase should work
  it('normalizes email to lowercase', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'NEW@TEST.COM', password: 'Password1' });
    expect(res.statusCode).toBe(200);
  });
});

// ── GET ME ────────────────────────────────────────────────────────
describe('GET /api/auth/me', () => {
  let accessToken;

  beforeAll(async () => {
  await createTestUser({
    email: 'getme@test.com',
    password: 'Password1',
    role: 'jobseeker',
  });
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'getme@test.com', password: 'Password1' });
  accessToken = res.body.tokens.accessToken;
});

  it('returns current user when authenticated', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.statusCode).toBe(200);
   expect(res.body.user.email).toBe('getme@test.com');
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it('returns 401 without token', async () => {
    expect((await request(app).get('/api/auth/me')).statusCode).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    expect(
      (await request(app).get('/api/auth/me').set('Authorization', 'Bearer invalid.token')).statusCode
    ).toBe(401);
  });

  it('returns 401 with malformed authorization header', async () => {
    expect(
      (await request(app).get('/api/auth/me').set('Authorization', 'Token notbearer')).statusCode
    ).toBe(401);
  });
});

// ── REFRESH TOKEN ─────────────────────────────────────────────────
describe('POST /api/auth/refresh-token', () => {
  let refreshToken;

 beforeAll(async () => {
  // Use a fresh user never logged in before
  // Previous tests may have revoked tokens for new@test.com
  await createTestUser({
    email:    'refresh@test.com',
    password: 'Password1',
    role:     'jobseeker',
  });
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'refresh@test.com', password: 'Password1' });
  refreshToken = res.body.tokens.refreshToken;
});

  it('returns new access token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh-token')
      .send({ refresh_token: refreshToken });
    expect(res.statusCode).toBe(200);
    expect(res.body.tokens.accessToken).toBeDefined();
  });

  it('rejects invalid refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh-token')
      .send({ refresh_token: 'invalid.token.here' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects missing refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh-token')
      .send({});
    expect(res.statusCode).toBe(400);
  });
});

// ── LOGOUT ────────────────────────────────────────────────────────
describe('POST /api/auth/logout', () => {
  let accessToken, refreshToken;

beforeAll(async () => {
  await createTestUser({
    email: 'logout@test.com',
    password: 'Password1',
    role: 'jobseeker',
  });
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'logout@test.com', password: 'Password1' });
  accessToken  = res.body.tokens.accessToken;
  refreshToken = res.body.tokens.refreshToken;
});

  it('logs out successfully', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refresh_token: refreshToken });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('revoked token cannot be used to refresh', async () => {
    const res = await request(app)
      .post('/api/auth/refresh-token')
      .send({ refresh_token: refreshToken });
    expect(res.statusCode).toBe(401);
  });
});

// ── LOGOUT ALL ────────────────────────────────────────────────────
describe('POST /api/auth/logout-all', () => {
  let accessToken;

 beforeAll(async () => {
  await createTestUser({
    email: 'logoutall@test.com',
    password: 'Password1',
    role: 'jobseeker',
  });
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'logoutall@test.com', password: 'Password1' });
  accessToken = res.body.tokens.accessToken;
});

  it('logs out from all devices', async () => {
    const res = await request(app)
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toContain('device');
  });
});

// ── DEACTIVATED ACCOUNT ───────────────────────────────────────────
describe('Deactivated account cannot login', () => {
  it('returns 403 for deactivated account', async () => {
    await createTestUser({
      email:     'deactivated@test.com',
      is_active: false,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'deactivated@test.com', password: 'Password1' });
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('deactivated');
  });
});

// ── FORGOT PASSWORD ───────────────────────────────────────────────
describe('POST /api/auth/forgot-password', () => {
  it('always returns success to prevent email enumeration', async () => {
    const res1 = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'doesnotexist9999@test.com' });
    expect(res1.statusCode).toBe(200);

    const res2 = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'new@test.com' });
    expect(res2.statusCode).toBe(200);

    expect(res1.body.message).toBe(res2.body.message);
  });

  it('rejects invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'notanemail' });
    expect(res.statusCode).toBe(400);
  });
});
