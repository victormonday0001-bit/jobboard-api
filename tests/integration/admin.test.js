const request  = require('supertest');
const app      = require('../../server');
const { pool } = require('../../config/db');
const {
  cleanDatabase,
  createTestUser,
  createTestCompany,
  createTestJob,
} = require('../helpers/testDb');

let adminToken, employerToken, jobseekerToken;
let adminUser, jobseekerUser;
let company, testJob;

beforeAll(async () => {
  await cleanDatabase();

  const admin     = await createTestUser({
    email: 'admin@admin.test', role: 'admin', is_verified: true,
  });
  const employer  = await createTestUser({
    email: 'emp@admin.test', role: 'employer', is_verified: true,
  });
  const jobseeker = await createTestUser({
    email: 'js@admin.test', role: 'jobseeker', is_verified: true,
  });

  adminToken     = admin.accessToken;
  employerToken  = employer.accessToken;
  jobseekerToken = jobseeker.accessToken;
  adminUser      = admin.user;
  jobseekerUser  = jobseeker.user;

  company = await createTestCompany(employer.user.id, {
    name: 'Admin Test Corp', slug: 'admin-test-corp',
  });

  testJob = await createTestJob(company.id, employer.user.id, {
    title: 'Test Job',
    slug:  'test-job-admin',
  });
});

afterAll(async () => {
  await cleanDatabase();
  await pool.end();
});

// ── STATS ─────────────────────────────────────────────────────────
describe('GET /api/admin/stats', () => {
  it('returns platform statistics for admin', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.stats.total_users).toBeDefined();
    expect(res.body.stats.total_companies).toBeDefined();
    expect(res.body.stats.total_jobs).toBeDefined();
    expect(res.body.stats.total_applications).toBeDefined();
    expect(res.body.stats.active_jobs).toBeDefined();
    expect(res.body.stats.new_users_week).toBeDefined();
    expect(res.body.stats.new_jobs_week).toBeDefined();
    expect(Array.isArray(res.body.recent_activity)).toBe(true);
  });

  it('rejects non-admin users', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${jobseekerToken}`);
    expect(res.statusCode).toBe(403);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/admin/stats');
    expect(res.statusCode).toBe(401);
  });
});

// ── GET USERS ─────────────────────────────────────────────────────
describe('GET /api/admin/users', () => {
  it('returns all users for admin', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.users.length).toBeGreaterThan(0);
    expect(res.body.pagination).toBeDefined();
  });

  it('does not expose password_hash', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`);
    res.body.users.forEach(u => {
      expect(u.password_hash).toBeUndefined();
    });
  });

  it('filters by role', async () => {
    const res = await request(app)
      .get('/api/admin/users?role=jobseeker')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    res.body.users.forEach(u => expect(u.role).toBe('jobseeker'));
  });

  it('searches by email', async () => {
    const res = await request(app)
      .get('/api/admin/users?search=admin@admin.test')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.users.length).toBeGreaterThan(0);
    expect(res.body.users[0].email).toBe('admin@admin.test');
  });

  it('paginates results', async () => {
    const res = await request(app)
      .get('/api/admin/users?page=1&limit=2')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.pagination.limit).toBe(2);
    expect(res.body.pagination.page).toBe(1);
  });
});

// ── UPDATE USER ───────────────────────────────────────────────────
describe('PATCH /api/admin/users/:id', () => {
  it('verifies a user', async () => {
    const unverified = await createTestUser({
      email: 'unverified@admin.test', role: 'jobseeker', is_verified: false,
    });

    const res = await request(app)
      .patch(`/api/admin/users/${unverified.user.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_verified: true });

    expect(res.statusCode).toBe(200);
    expect(res.body.user.is_verified).toBe(true);
  });

  it('changes user role', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${jobseekerUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'employer' });
    expect(res.statusCode).toBe(200);
    expect(res.body.user.role).toBe('employer');

    // Reset back
    await request(app)
      .patch(`/api/admin/users/${jobseekerUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'jobseeker' });
  });

  // FIX: Token revocation happens immediately on deactivation
  it('FIX: deactivates user and revokes their tokens immediately', async () => {
    const target = await createTestUser({
      email: 'todeactivate@admin.test', role: 'jobseeker', is_verified: true,
    });

    // Deactivate
    const res = await request(app)
      .patch(`/api/admin/users/${target.user.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: false });
    expect(res.statusCode).toBe(200);
    expect(res.body.user.is_active).toBe(false);

    // Verify refresh tokens are revoked in DB
    const { rows } = await pool.query(
      'SELECT revoked_at FROM refresh_tokens WHERE user_id = $1',
      [target.user.id]
    );
    rows.forEach(r => expect(r.revoked_at).not.toBeNull());

    // Verify deactivated user cannot login
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'todeactivate@admin.test', password: 'Password1' });
    expect(loginRes.statusCode).toBe(403);
  });

  it('prevents admin deactivating own account', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${adminUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: false });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('cannot deactivate');
  });

  it('returns 404 for non-existent user', async () => {
    const res = await request(app)
      .patch('/api/admin/users/999999')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_verified: true });
    expect(res.statusCode).toBe(404);
  });
});

// ── DELETE USER ───────────────────────────────────────────────────
describe('DELETE /api/admin/users/:id', () => {
  // FIX: Token revocation happens on delete
  it('FIX: soft deletes user and revokes all their tokens', async () => {
    const target = await createTestUser({
      email: 'todelete@admin.test', role: 'jobseeker', is_verified: true,
    });

    const res = await request(app)
      .delete(`/api/admin/users/${target.user.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);

    // Verify soft deleted in DB
    const { rows } = await pool.query(
      'SELECT deleted_at FROM users WHERE id = $1',
      [target.user.id]
    );
    expect(rows[0].deleted_at).not.toBeNull();

    // Verify all refresh tokens revoked
    const tokenRows = await pool.query(
      'SELECT revoked_at FROM refresh_tokens WHERE user_id = $1',
      [target.user.id]
    );
    tokenRows.rows.forEach(r => expect(r.revoked_at).not.toBeNull());
  });

  it('prevents admin deleting own account', async () => {
    const res = await request(app)
      .delete(`/api/admin/users/${adminUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('cannot delete');
  });

  it('returns 404 for non-existent user', async () => {
    const res = await request(app)
      .delete('/api/admin/users/999999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(404);
  });
});

// ── GET COMPANIES ─────────────────────────────────────────────────
describe('GET /api/admin/companies', () => {
  it('returns all companies for admin', async () => {
    const res = await request(app)
      .get('/api/admin/companies')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.companies.length).toBeGreaterThan(0);
    // Admin sees owner email
    expect(res.body.companies[0].owner_email).toBeDefined();
  });

  it('searches companies by name', async () => {
    const res = await request(app)
      .get('/api/admin/companies?search=Admin Test')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.companies.length).toBeGreaterThan(0);
  });
});

// ── GET JOBS ──────────────────────────────────────────────────────
describe('GET /api/admin/jobs', () => {
  it('returns all jobs including drafts', async () => {
    const res = await request(app)
      .get('/api/admin/jobs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.jobs.length).toBeGreaterThan(0);
  });

  it('filters by status', async () => {
    const res = await request(app)
      .get('/api/admin/jobs?status=published')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    res.body.jobs.forEach(j => expect(j.status).toBe('published'));
  });

  it('searches by title', async () => {
    const res = await request(app)
      .get('/api/admin/jobs?search=Test Job')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.jobs.length).toBeGreaterThan(0);
  });
});

// ── TOGGLE FEATURED ───────────────────────────────────────────────
describe('PATCH /api/admin/jobs/:id/featured', () => {
  it('toggles job to featured', async () => {
    const res = await request(app)
      .patch(`/api/admin/jobs/${testJob.id}/featured`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.featured).toBe(true);
    expect(res.body.message).toContain('featured');
  });

  it('toggles job back to unfeatured', async () => {
    const res = await request(app)
      .patch(`/api/admin/jobs/${testJob.id}/featured`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.featured).toBe(false);
    expect(res.body.message).toContain('removed');
  });

  it('returns 404 for non-existent job', async () => {
    const res = await request(app)
      .patch('/api/admin/jobs/999999/featured')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(404);
  });
});

// ── DELETE JOB ────────────────────────────────────────────────────
describe('DELETE /api/admin/jobs/:id', () => {
  it('admin can delete any job', async () => {
    const jobToDelete = await createTestJob(company.id, adminUser.id, {
      title: 'Job To Delete',
      slug:  'job-to-delete-admin',
    });

    const res = await request(app)
      .delete(`/api/admin/jobs/${jobToDelete.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);

    // Verify soft deleted
    const { rows } = await pool.query(
      'SELECT deleted_at FROM jobs WHERE id = $1',
      [jobToDelete.id]
    );
    expect(rows[0].deleted_at).not.toBeNull();
  });

  it('returns 404 for non-existent job', async () => {
    const res = await request(app)
      .delete('/api/admin/jobs/999999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(404);
  });
});

// ── AUDIT LOGS ────────────────────────────────────────────────────
describe('GET /api/admin/audit-logs', () => {
  it('returns audit logs for admin', async () => {
    const res = await request(app)
      .get('/api/admin/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(res.body.pagination).toBeDefined();
  });

  it('filters by action', async () => {
    const res = await request(app)
      .get('/api/admin/audit-logs?action=USER_REGISTERED')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    res.body.logs.forEach(l =>
      expect(l.action.toLowerCase()).toContain('user_registered')
    );
  });

  it('filters by user_id', async () => {
    const res = await request(app)
      .get(`/api/admin/audit-logs?user_id=${adminUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
  });

  it('rejects non-admin', async () => {
    const res = await request(app)
      .get('/api/admin/audit-logs')
      .set('Authorization', `Bearer ${jobseekerToken}`);
    expect(res.statusCode).toBe(403);
  });
});

// ── ACCESS CONTROL ────────────────────────────────────────────────
describe('Admin access control', () => {
  it('rejects employer from all admin routes', async () => {
    const routes = [
      { method: 'get',    path: '/api/admin/stats' },
      { method: 'get',    path: '/api/admin/users' },
      { method: 'get',    path: '/api/admin/companies' },
      { method: 'get',    path: '/api/admin/jobs' },
      { method: 'get',    path: '/api/admin/audit-logs' },
    ];

    for (const route of routes) {
      const res = await request(app)
        [route.method](route.path)
        .set('Authorization', `Bearer ${employerToken}`);
      expect(res.statusCode).toBe(403);
    }
  });

  it('rejects unauthenticated from all admin routes', async () => {
    const routes = [
      '/api/admin/stats',
      '/api/admin/users',
      '/api/admin/companies',
      '/api/admin/jobs',
      '/api/admin/audit-logs',
    ];

    for (const path of routes) {
      const res = await request(app).get(path);
      expect(res.statusCode).toBe(401);
    }
  });
});
