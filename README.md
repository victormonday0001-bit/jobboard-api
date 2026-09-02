# Job Board API

A production-grade REST API for a job board platform.

![CI/CD](https://github.com/YOUR_USERNAME/jobboard-api/actions/workflows/ci.yml/badge.svg)

---

## Features

**Auth**
- Register → tokens issued immediately (logged in from first request)
- JWT access tokens (15 min) + refresh tokens (7 days)
- Email verification (unlock posting/applying)
- Forgot/reset password
- Logout single device or all devices
- bcrypt password hashing (12 rounds)

**Security**
- Rate limiting per route type
- Helmet security headers
- CORS
- XSS sanitization
- SQL injection prevention (parameterized queries)
- Input validation on every route
- Refresh tokens stored as SHA256 hashes

**Companies**
- Employer creates/manages one company
- Logo upload (JPEG/PNG/WebP, max 2MB)
- Slug regenerates when name changes
- Admin verification badge

**Jobs**
- Full-text search + ILIKE fallback
- Filter by type, level, salary, location, remote
- Pagination on all listings
- Save/unsave jobs
- Soft delete

**Applications**
- Apply with CV upload (PDF only, max 5MB)
- Complete lifecycle (pending → reviewing → shortlisted → interview → offered/rejected)
- Employer notes
- Withdraw application
- In-app notifications
- Email notifications

**Admin**
- Platform statistics
- User management (update role, deactivate, delete)
- Company verification
- Job featuring
- Audit logs

**Developer**
- Swagger/OpenAPI docs at `/api/docs`
- Postman collection in `/docs`
- 67 Jest tests (unit + integration)
- GitHub Actions CI/CD

---

## Quick Start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# Fill in your .env values

# 3. Database
psql -U postgres -c "CREATE DATABASE jobboard;"
psql -U postgres -d jobboard -f config/schema.sql

# 4. Create first admin
npm run create-admin admin@jobboard.com Admin123! Admin User

# 5. Start
npm run dev
```

Server: `http://localhost:5000`
Docs:   `http://localhost:5000/api/docs`
Health: `http://localhost:5000/health`

---

## Email Setup (Brevo)

This API uses Brevo for transactional email.

1. Create free account at brevo.com
2. Go to SMTP & API → SMTP
3. Copy credentials to `.env`:

```
EMAIL_HOST=smtp-relay.brevo.com
EMAIL_PORT=465
EMAIL_USER=your_brevo_login
EMAIL_PASS=your_brevo_smtp_key
EMAIL_FROM=noreply@yourdomain.com
```

---

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Register + receive tokens |
| POST | /api/auth/login | Login + receive tokens |
| POST | /api/auth/refresh-token | Get new access token |
| POST | /api/auth/logout | Logout current device |
| POST | /api/auth/logout-all | Logout all devices |
| GET | /api/auth/me | Get current user |
| PUT | /api/auth/change-password | Change password |
| POST | /api/auth/forgot-password | Request reset link |
| POST | /api/auth/reset-password | Reset with token |
| GET | /api/auth/verify-email | Verify email |
| POST | /api/auth/resend-verification | Resend verification |

### Companies
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | /api/companies | Public | List all |
| GET | /api/companies/:slug | Public | Get by slug |
| GET | /api/companies/me | Employer | My company |
| POST | /api/companies | Employer + Verified | Create |
| PUT | /api/companies | Employer | Update |
| DELETE | /api/companies | Employer | Soft delete |
| PATCH | /api/companies/:id/verify | Admin | Verify |

### Jobs
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | /api/jobs | Public | Search + filter |
| GET | /api/jobs/:slug | Public | Get by slug |
| GET | /api/jobs/me | Employer | My postings |
| GET | /api/jobs/saved | Auth | Saved jobs |
| GET | /api/jobs/skills | Public | Skills list |
| POST | /api/jobs | Employer + Verified | Create |
| PUT | /api/jobs/:slug | Employer | Update |
| DELETE | /api/jobs/:slug | Employer | Soft delete |
| PATCH | /api/jobs/:slug/close | Employer | Close |
| POST | /api/jobs/:slug/save | Auth | Save/unsave |

### Applications
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | /api/applications/my | Jobseeker | My applications |
| PUT | /api/applications/profile | Jobseeker + Verified | Update profile + CV |
| GET | /api/applications/notifications | Auth | Notifications |
| PATCH | /api/applications/notifications/read | Auth | Mark read |
| POST | /api/applications/jobs/:slug/apply | Jobseeker + Verified | Apply |
| GET | /api/applications/jobs/:slug | Employer | Job applications |
| GET | /api/applications/:id | Auth | Single application |
| PATCH | /api/applications/:id/status | Employer | Update status |
| PATCH | /api/applications/:id/withdraw | Jobseeker | Withdraw |

### Admin
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | /api/admin/stats | Admin | Platform stats |
| GET | /api/admin/audit-logs | Admin | Audit history |
| GET | /api/admin/users | Admin | All users |
| PATCH | /api/admin/users/:id | Admin | Update user |
| DELETE | /api/admin/users/:id | Admin | Soft delete |
| GET | /api/admin/companies | Admin | All companies |
| GET | /api/admin/jobs | Admin | All jobs |
| PATCH | /api/admin/jobs/:id/featured | Admin | Toggle featured |
| DELETE | /api/admin/jobs/:id | Admin | Delete job |

---

## Tests

```bash
# Setup test database
psql -U postgres -c "CREATE DATABASE jobboard_test;"
psql -U postgres -d jobboard_test -f config/schema.sql

# Run all tests
npm test

# With coverage
npm run test:coverage
```

---

## Tech Stack

| | |
|--|--|
| Runtime | Node.js 20 |
| Framework | Express 4 |
| Database | PostgreSQL 15 |
| Auth | JWT (jsonwebtoken) |
| Validation | express-validator |
| Upload | Multer |
| Email | Nodemailer + Brevo |
| Logging | Winston |
| Testing | Jest + Supertest |
| Docs | Swagger/OpenAPI 3.0 |
| CI/CD | GitHub Actions |
| Deployment | Render + Supabase |

---

## Author

**Victor Monday** — Backend Developer
- GitHub: [@victormonday0001-bit](https://github.com/victormonday0001-bit)
