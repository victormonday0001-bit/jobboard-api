# Job Board API

A production-grade REST API for a job board platform, built with Node.js,
Express, and PostgreSQL. Supports three roles — jobseekers, employers, and
admins — with full authentication, job posting and search, applications,
notifications, and an admin dashboard.

**Live API:** https://jobboard-api-1.onrender.com
**API Docs (Swagger):** https://jobboard-api-1.onrender.com/api/docs
**Health Check:** https://jobboard-api-1.onrender.com/health

---

## Features

- JWT authentication (access + refresh tokens, refresh token revocation)
- Role-based access control (jobseeker, employer, admin)
- Email verification and password reset (via transactional email API)
- Job posting, editing, closing, and soft delete
- Full-text search with `websearch_to_tsquery` + `ILIKE` fallback
- Filtering by type, experience level, location, remote, salary range
- Pagination on all list endpoints
- CV and company logo uploads
- Job applications with status pipeline (pending → reviewing → shortlisted →
  interview → offered / rejected)
- In-app notifications
- Admin dashboard: platform stats, user management, audit logs, job
  moderation
- Rate limiting on sensitive routes (auth, uploads, password reset)
- Centralized error handling and structured logging (Winston)
- Full Swagger/OpenAPI 3.0 documentation
- Automated test suite (Jest + Supertest, unit + integration)
- CI/CD via GitHub Actions

---

## Tech Stack

| Layer          | Technology                                   |
|----------------|-----------------------------------------------|
| Runtime        | Node.js                                       |
| Framework      | Express                                       |
| Database       | PostgreSQL (hosted on Supabase)               |
| Auth           | JWT (jsonwebtoken), bcrypt                    |
| Email          | Brevo Transactional Email **HTTP API**        |
| File uploads   | Multer                                        |
| Validation     | express-validator                             |
| Docs           | swagger-jsdoc + swagger-ui-express            |
| Logging        | Winston                                       |
| Testing        | Jest, Supertest                               |
| CI/CD          | GitHub Actions                                |
| Hosting        | Render                                        |

---

## Why Brevo's HTTP API instead of SMTP

Most free-tier hosting platforms (Render, Railway, and others) block
outbound SMTP ports (25, 465, 587) by default to prevent spam abuse — this
is a platform-level firewall policy, not something fixable through
configuration. This is the same reason companies like Stripe, GitHub, and
Shopify send transactional email through an HTTPS API rather than opening
raw SMTP connections from application servers.

This project sends email via Brevo's REST API (`POST
https://api.brevo.com/v3/smtp/email`) over standard HTTPS, which is never
blocked on any hosting platform, free or paid. See `services/email.js`.

---

## Project Structure

```
jobboard/
├── config/            # Database, JWT, and schema config
├── controllers/       # Business logic per resource
├── middleware/        # Auth, validation, rate limiting, error handling
├── routes/            # Route definitions + Swagger annotations
├── services/          # Email service (Brevo HTTP API)
├── scripts/           # One-off scripts (e.g. create admin user)
├── tests/             # Unit and integration tests
├── utils/             # Shared helpers (pagination, slugs, logging)
├── uploads/           # Local file storage (CVs, logos)
├── server.js          # App entry point
└── package.json
```

---

## Getting Started Locally

### Prerequisites

- Node.js 18+
- PostgreSQL 15+ (or a Supabase project)
- A Brevo account with an API key

### Setup

```bash
git clone <your-repo-url>
cd jobboard
npm install
cp .env.example .env
```

Fill in `.env` with your own values (see [Environment Variables](#environment-variables)
below).

Run the schema against your database:

```bash
psql -U postgres -d jobboard -f config/schema.sql
```

Start the dev server:

```bash
npm run dev
```

The API will be running at `http://localhost:5000`, with Swagger docs at
`http://localhost:5000/api/docs`.

---

## Environment Variables

```env
NODE_ENV=development
PORT=5000

# Database
PG_HOST=
PG_PORT=5432
PG_DATABASE=
PG_USER=
PG_PASSWORD=

# JWT
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d

# Email — Brevo HTTP API (not SMTP)
BREVO_API_KEY=
EMAIL_FROM=

# App
APP_NAME=JobBoard
APP_URL=http://localhost:5000
CLIENT_URL=http://localhost:3000

# Uploads
MAX_CV_SIZE_MB=5
MAX_LOGO_SIZE_MB=2
UPLOADS_DIR=uploads
```

`BREVO_API_KEY` must be an **API key** (starts with `xkeysib-`), generated
under Brevo → Settings → SMTP & API → **API Keys** tab — not an SMTP key
(`xsmtpsib-...`). These are not interchangeable.

`EMAIL_FROM` must be a verified sender in Brevo (Settings → Senders & IPs).

---

## Running Tests

Create a separate test database first:

```sql
CREATE DATABASE jobboard_test;
```

```bash
psql -U postgres -d jobboard_test -f config/schema.sql
npm test
```

Tests run serially (`--runInBand`) against `jobboard_test` to avoid
race conditions between test files.

---

## Deployment (Render)

1. Push your code to GitHub.
2. Create a new Web Service on [Render](https://render.com), connected to
   your repo.
3. Build command: `npm install`
4. Start command: `node server.js`
5. Add all environment variables listed above in the Render dashboard
   (no quotes around values).
6. Database: hosted separately on [Supabase](https://supabase.com) —
   use the **connection pooler** host/port/user shown in Supabase's
   database settings, not the direct connection.
7. Deploy. Confirm `/health` and `/api/docs` respond once live.

Every push to `main` triggers the CI pipeline (tests + lint) via GitHub
Actions before deployment.

---

## API Documentation

Full interactive API documentation is available at `/api/docs` on both the
local server and the live deployment. Every endpoint includes request/response
schemas, required fields, and authentication requirements.

To test protected routes in Swagger: log in via `/api/auth/login`, copy the
`accessToken` from the response, click **Authorize** at the top of the
Swagger page, and enter `Bearer <your-token>`.

---

## License

MIT