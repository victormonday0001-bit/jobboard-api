# Job Board API

A production-grade REST API for a job board platform, built with Node.js,
Express, and PostgreSQL. Supports three roles — jobseekers, employers, and
admins — with full authentication, job posting and search, applications,
notifications, and an admin dashboard.

**Live API:** https://jobboard-api-1.onrender.com
**API Docs (Swagger):** https://jobboard-api-1.onrender.com/api/docs
**Health Check:** https://jobboard-api-1.onrender.com/health

> **Just want to try it?** Open the [Swagger docs](https://jobboard-api-1.onrender.com/api/docs),
> register an account via `POST /api/auth/register`, copy the `accessToken`
> from the response, click **Authorize**, and paste `Bearer <token>`. No
> local setup required. See [Using Swagger](#using-swagger) for details.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Why Brevo's HTTP API instead of SMTP](#why-brevos-http-api-instead-of-smtp)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Setup Guide](#setup-guide)
- [Environment Variables Reference](#environment-variables-reference)
- [API Overview](#api-overview)
- [Using Swagger](#using-swagger)
- [Running Tests](#running-tests)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

---

## Features

**Authentication & Security**
- JWT authentication — 15-minute access tokens, 7-day refresh tokens
- Refresh tokens hashed (SHA-256) before storage and revocable on logout
- `bcrypt` password hashing (cost factor 12)
- Email verification and password reset flows
- Role-based access control: `jobseeker`, `employer`, `admin`
- Verification status read from the database, never trusted from the JWT —
  so an admin verifying a user takes effect on their very next request
- Rate limiting on auth, upload, and password-reset routes
- SQL injection prevention via parameterized queries throughout
- XSS sanitization on all user-generated HTML
- IDOR prevention — ownership checked on every resource mutation

**Jobs**
- Create, update, close, and soft-delete job postings
- Draft vs published states; drafts return `404` to non-owners
- Full-text search using `websearch_to_tsquery` with an `ILIKE` fallback
  so partial words still match
- Filter by type, experience level, location, remote, and salary range
- Sort by newest, oldest, salary (`NULLS LAST`), or relevance
- Save/unsave jobs via a single toggle endpoint

**Companies**
- One company per employer, enforced at the application layer
- Logo upload with type and size validation
- Slug regenerates automatically when the company name changes
- Admin verification badge
- Cascading soft delete — removing a company soft-deletes its jobs

**Applications**
- Apply with an uploaded CV or the one already on your profile
- Duplicate application prevention
- Status pipeline: `pending → reviewing → shortlisted → interview →
  offered / rejected`
- Per-status timestamps, enabling an application timeline
- Employer notes on each application
- Jobseeker withdrawal, blocked once a decision is final

**Notifications**
- In-app notifications on submission and status change
- Transactional emails for verification, password reset, and status updates
- Automatic cleanup of notifications older than 90 days

**Admin**
- Platform statistics dashboard
- User management — verify, change role, deactivate, delete
- Token revocation on deactivation/deletion, effective immediately
- Company verification, job featuring, full audit log

**Engineering**
- Swagger/OpenAPI 3.0 documentation on every endpoint
- Jest + Supertest suite (unit + integration)
- GitHub Actions CI pipeline
- Structured logging (Winston), centralized error handling
- Soft deletes across all major entities

---

## Tech Stack

| Layer          | Technology                              |
|----------------|------------------------------------------|
| Runtime        | Node.js 18+                              |
| Framework      | Express                                  |
| Database       | PostgreSQL (hosted on Supabase)          |
| Auth           | JWT (`jsonwebtoken`), `bcrypt`           |
| Email          | Brevo Transactional Email **HTTP API**   |
| File uploads   | Multer                                   |
| Validation     | `express-validator`                      |
| Sanitization   | `xss`                                    |
| Docs           | `swagger-jsdoc` + `swagger-ui-express`   |
| Logging        | Winston + Morgan                         |
| Security       | Helmet, CORS, `express-rate-limit`       |
| Testing        | Jest, Supertest                          |
| CI/CD          | GitHub Actions                           |
| Hosting        | Render                                   |

---

## Why Brevo's HTTP API instead of SMTP

Most hosting platforms — Render, Railway, and others — block outbound SMTP
ports (25, 465, 587) on free and lower-tier plans to prevent spam abuse.
This is a platform-level firewall policy that cannot be worked around with
configuration; connections simply time out.

It is also why production systems at companies like Stripe, GitHub, and
Shopify send transactional mail through HTTPS APIs (SendGrid, Postmark,
SES, Mailgun, Brevo) rather than opening raw SMTP sockets from application
servers. HTTPS on port 443 is never blocked, and these APIs add delivery
tracking, analytics, and webhooks that SMTP does not provide.

This project posts to `https://api.brevo.com/v3/smtp/email`. See
`services/email.js`.

---

## Project Structure

```
jobboard/
├── .github/workflows/   CI pipeline — tests and lint on every push
├── config/
│   ├── db.js            PostgreSQL pool + transaction helper
│   ├── jwt.js           Token generation, verification, hashing
│   └── schema.sql       Full database schema and seed data
├── controllers/         Business logic, one file per resource
├── middleware/
│   ├── authenticate.js  JWT verification (and optionalAuth)
│   ├── authorize.js     Role checks + requireVerified (queries the DB)
│   ├── validate.js      express-validator error formatter
│   ├── rateLimit.js     Per-route rate limiters
│   ├── upload.js        Multer config for CVs and logos
│   └── errorHandler.js  Centralized error handling and 404 handler
├── routes/              Route definitions with Swagger annotations
├── services/
│   └── email.js         Brevo HTTP API email service
├── scripts/
│   └── createAdmin.js   CLI script to create an admin user
├── tests/
│   ├── unit/            Pure function tests, no database
│   ├── integration/     Full HTTP tests against a test database
│   └── helpers/         Test database setup and data factories
├── utils/
│   ├── helpers.js       Slugs, pagination, audit logs, notifications
│   └── logger.js        Winston logger configuration
├── uploads/             Local file storage for CVs and logos
├── server.js            Application entry point
└── package.json
```

---

## Prerequisites

- **Node.js 18 or later** — verify with `node -v`
- **PostgreSQL 15+** — either installed locally, or a free Supabase project
- **A Brevo account** — free tier allows 300 emails/day
- **Git**

Total setup time is roughly 15 minutes, most of it waiting for Supabase to
provision.

---

## Setup Guide

### 1. Clone and install

```bash
git clone <your-repo-url>
cd jobboard
npm install
```

---

### 2. Set up the database

Use either Supabase (recommended, and what the live deployment uses) or a
local PostgreSQL install.

#### Option A — Supabase

1. Create a free account at [supabase.com](https://supabase.com).
2. Click **New Project**. Give it a name, set a database password — save
   this, it is not recoverable — and pick a nearby region.
3. Wait for provisioning to finish, roughly two minutes.
4. In the sidebar go to **Project Settings → Database**.
5. Scroll to **Connection String** and open the **Connection Pooling** tab,
   not "Direct Connection". Pooling reuses connections instead of opening a
   new one per request, which is what a web API needs.
6. Record these values for your `.env`:

```
Host:     aws-0-<region>.pooler.supabase.com
Port:     6543
Database: postgres
User:     postgres.<your-project-ref>
Password: the password from step 2
```

> The username includes your project reference after a dot, for example
> `postgres.abcdefghijklm`. Using plain `postgres` fails with
> `ENOIDENTIFIER: no tenant identifier provided`.

#### Option B — Local PostgreSQL

1. Install from [postgresql.org](https://www.postgresql.org/download/).
2. Create the database:

```bash
psql -U postgres -c "CREATE DATABASE jobboard;"
```

3. Your values will be `localhost`, port `5432`, database `jobboard`, user
   `postgres`, and your local password.

---

### 3. Set up Brevo for email

Brevo handles verification emails, password resets, and application status
notifications.

1. **Create an account** at [brevo.com](https://www.brevo.com). The free
   tier allows 300 emails/day and requires no credit card.

2. **Verify a sender address.** Brevo refuses to send from unverified
   addresses.
   - Go to **Settings → Senders, Domains & Dedicated IPs → Senders**
   - Click **Add a Sender**, enter a name and the address emails should
     come from
   - Brevo emails that address a confirmation link — click it
   - Confirm the sender shows a green checkmark before continuing

3. **Generate an API key.**
   - Go to **Settings → SMTP & API**
   - Open the **API Keys** tab — *not* the SMTP tab
   - Click **Generate a new API key**, name it (e.g. `jobboard-local`)
   - Copy it immediately; Brevo displays it only once

   > The key must begin with `xkeysib-`. A key beginning with `xsmtpsib-`
   > is an SMTP key and will not work here — this project uses the HTTP
   > API. They are different credential types and are not interchangeable.

4. **Check IP restrictions.** Brevo may block API calls from unfamiliar IPs.
   - Visit [app.brevo.com/security/authorised_ips](https://app.brevo.com/security/authorised_ips)
   - Either add your IP, or disable IP restriction entirely
   - Disabling is the practical choice when deploying to hosts with dynamic
     outbound IPs (Render and Railway free tiers), where the IP changes
     between deploys. The API key remains the security boundary.

---

### 4. Generate JWT secrets

Two long random strings are needed — one for access tokens, one for refresh
tokens. They must differ from each other.

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Run it twice and keep both outputs. Never commit these.

---

### 5. Configure environment variables

```bash
cp .env.example .env
```

Fill in `.env` with everything gathered above:

```env
NODE_ENV=development
PORT=5000

# Database — from step 2
PG_HOST=aws-0-eu-west-2.pooler.supabase.com
PG_PORT=6543
PG_DATABASE=postgres
PG_USER=postgres.yourprojectref
PG_PASSWORD=your-database-password

# JWT — from step 4
JWT_ACCESS_SECRET=first-random-string
JWT_REFRESH_SECRET=second-random-string
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d

# Email — from step 3
BREVO_API_KEY=xkeysib-your-api-key
EMAIL_FROM=your-verified-sender@example.com

# App
APP_NAME=JobBoard
APP_URL=http://localhost:5000
CLIENT_URL=http://localhost:3000

# Uploads
MAX_CV_SIZE_MB=5
MAX_LOGO_SIZE_MB=2
UPLOADS_DIR=uploads
```

> Do not wrap values in quotes. Some hosting dashboards treat the quotes as
> part of the value, producing connection failures that look like timeouts.

---

### 6. Run the schema

This creates all tables, indexes, and constraints, and seeds the skills
list.

**Supabase:** open the **SQL Editor** in the dashboard, paste the contents
of `config/schema.sql`, and run it.

**Local PostgreSQL:**

```bash
psql -U postgres -d jobboard -f config/schema.sql
```

---

### 7. Create an admin user

Admin accounts cannot be created through public registration — the API
forces `role` to `jobseeker` on self-registration as a security measure.
Use the provided script:

```bash
node scripts/createAdmin.js admin@example.com YourPassword1 Admin User
```

Arguments are `<email> <password> <first_name> <last_name>`.

---

### 8. Start the server

```bash
npm run dev
```

Expected output:

```
✅ PostgreSQL connected: PostgreSQL 15.x
✅ Job Board API running at http://localhost:5000
📚 Swagger docs at http://localhost:5000/api/docs
❤️  Health check at http://localhost:5000/health
✅ Email service ready (Brevo HTTP API)
```

If a line is missing or shows an error, see [Troubleshooting](#troubleshooting).

---

## Environment Variables Reference

| Variable              | Required | Description                                              |
|-----------------------|----------|-----------------------------------------------------------|
| `NODE_ENV`            | Yes      | `development`, `test`, or `production`                    |
| `PORT`                | No       | Defaults to `5000`; hosts inject their own                |
| `PG_HOST`             | Yes      | Database host                                             |
| `PG_PORT`             | Yes      | `6543` for Supabase pooling, `5432` direct or local       |
| `PG_DATABASE`         | Yes      | Database name — `postgres` on Supabase                    |
| `PG_USER`             | Yes      | `postgres.<project-ref>` on Supabase, `postgres` locally  |
| `PG_PASSWORD`         | Yes      | Database password                                         |
| `JWT_ACCESS_SECRET`   | Yes      | Random 64-byte hex string                                 |
| `JWT_REFRESH_SECRET`  | Yes      | A different random 64-byte hex string                     |
| `JWT_ACCESS_EXPIRES`  | No       | Defaults to `15m`                                         |
| `JWT_REFRESH_EXPIRES` | No       | Defaults to `7d`                                          |
| `BREVO_API_KEY`       | Yes      | Brevo **API key** (`xkeysib-…`), not an SMTP key          |
| `EMAIL_FROM`          | Yes      | A sender address verified in your Brevo account           |
| `APP_NAME`            | No       | Shown in emails; defaults to `JobBoard`                   |
| `APP_URL`             | Yes      | Base URL of this API — used to build links inside emails  |
| `CLIENT_URL`          | Yes      | Frontend origin, used for CORS in production              |
| `MAX_CV_SIZE_MB`      | No       | Defaults to `5`                                           |
| `MAX_LOGO_SIZE_MB`    | No       | Defaults to `2`                                           |
| `UPLOADS_DIR`         | No       | Defaults to `uploads`                                     |

---

## API Overview

All endpoints are prefixed with `/api`. Full request and response schemas
are in the Swagger docs.

**Auth** — `/api/auth`
```
POST   /register              Create account, returns tokens immediately
POST   /login                 Authenticate, returns tokens
POST   /refresh-token         Exchange refresh token for a new access token
POST   /logout                Revoke the current refresh token
POST   /logout-all            Revoke every refresh token for this user
GET    /me                    Current user profile
GET    /verify-email          Verify email using the token from the email
POST   /resend-verification   Resend the verification email
POST   /forgot-password       Send a password reset email
POST   /reset-password        Reset password using the emailed token
PUT    /change-password       Change password while logged in
```

**Companies** — `/api/companies`
```
GET    /                      Browse companies (public)
GET    /me                    Current employer's company
GET    /:slug                 Company profile and recent jobs (public)
POST   /                      Create company (verified employers)
PUT    /                      Update own company
DELETE /                      Soft-delete own company and its jobs
PATCH  /:id/verify            Verify a company (admin only)
```

**Jobs** — `/api/jobs`
```
GET    /                      Search and filter published jobs (public)
GET    /skills                List all skills (public)
GET    /saved                 Current user's saved jobs
GET    /me                    Current employer's jobs, drafts included
GET    /:slug                 Single job (public; drafts owner-only)
POST   /                      Create job (verified employers)
PUT    /:slug                 Update own job
DELETE /:slug                 Soft-delete own job
PATCH  /:slug/close           Close job to new applications
POST   /:slug/save            Save or unsave a job (toggle)
```

**Applications** — `/api/applications`
```
GET    /my                    Current jobseeker's applications
GET    /notifications         Current user's notifications
PATCH  /notifications/read    Mark all notifications as read
PUT    /profile               Update jobseeker profile and CV
GET    /jobs/:slug            Applications for a job (job owner only)
POST   /jobs/:slug/apply      Apply to a job (verified jobseekers)
GET    /:id                   Single application (applicant or job owner)
PATCH  /:id/status            Update status (job owner only)
PATCH  /:id/withdraw          Withdraw application (applicant only)
```

**Admin** — `/api/admin` (every route requires the `admin` role)
```
GET    /stats                 Platform statistics
GET    /audit-logs            Audit trail, filterable
GET    /users                 All users, searchable and filterable
PATCH  /users/:id             Update role, active, or verified status
DELETE /users/:id             Soft-delete user and revoke their tokens
GET    /companies             All companies
GET    /jobs                  All jobs, drafts included
PATCH  /jobs/:id/featured     Toggle featured status
DELETE /jobs/:id              Delete any job
```

---

## Using Swagger

Interactive documentation is served at `/api/docs`, both locally and on the
live deployment.

To test protected endpoints:

1. Call `POST /api/auth/register` or `POST /api/auth/login` from within
   Swagger and copy the `accessToken` from the response.
2. Click **Authorize** at the top right of the page.
3. Enter `Bearer <your-access-token>`, click **Authorize**, then **Close**.
4. Every subsequent request will include the token automatically.

Access tokens expire after 15 minutes — log in again and re-authorize when
requests start returning `401`.

Some endpoints require a verified email. On the live deployment, register
and click the link in the verification email. Locally, you can set
`is_verified = TRUE` directly in the database; the check queries the
database on each request, so no new login is needed.

File upload endpoints (CV, company logo) are easier to exercise in Postman
than in Swagger UI.

---

## Running Tests

Tests run against a **separate database**, so development data is never
touched.

```sql
CREATE DATABASE jobboard_test;
```

```bash
psql -U postgres -d jobboard_test -f config/schema.sql
```

Create a `.env.test` file mirroring `.env`, but with `NODE_ENV=test` and
`PG_DATABASE=jobboard_test`.

```bash
npm test
```

Tests run serially (`--runInBand`) to prevent race conditions between files
sharing one database. Each file truncates all tables before and after it
runs.

---

## Deployment

The live version runs on **Render** with the database on **Supabase**.

1. Push your code to GitHub.
2. On [render.com](https://render.com), create a **New Web Service** and
   connect the repository.
3. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
4. Under **Environment**, add every variable from your `.env`, with these
   differences:
   - `NODE_ENV=production`
   - `APP_URL=https://your-service-name.onrender.com`
   - Omit `PORT` — Render injects it
   - No quotes around any value
5. Deploy, then confirm `/health` and `/api/docs` respond.

`.github/workflows/ci.yml` runs on every push to `main`: it installs
dependencies, starts a PostgreSQL service container, applies the schema,
runs the full test suite, and runs ESLint. Render deploys automatically on
successful pushes to `main`.

---

## Troubleshooting

**`ENOIDENTIFIER: no tenant identifier provided`**
You are on Supabase with `PG_USER=postgres`. The connection pooler requires
the project reference in the username: `postgres.<your-project-ref>`. Copy
it from the Connection Pooling tab in Supabase's database settings.

**`Email service error: Connection timeout`**
Something is still attempting SMTP. Confirm `services/email.js` is the HTTP
version and that `BREVO_API_KEY` is set. Free hosting tiers block SMTP
ports entirely, so no SMTP configuration will succeed there.

**`Email service error: unrecognised IP address`**
Brevo's IP allowlist is blocking the call. Add the IP shown in the error at
[app.brevo.com/security/authorised_ips](https://app.brevo.com/security/authorised_ips),
or disable IP restriction — necessary on hosts with dynamic outbound IPs.

**`401 Unauthorized` on every protected route in Swagger**
Either **Authorize** was not clicked, or the access token expired after 15
minutes. Log in again and re-authorize.

**`403 EMAIL_NOT_VERIFIED`**
The account's email is unverified. Click the link in the verification
email, or set `is_verified = TRUE` in the database for local testing. The
check reads the database on every request, so no new login is required.

**Emails land in Gmail's Promotions tab**
Expected when sending from a `gmail.com` address via a third-party
provider — `gmail.com`'s SPF/DKIM records do not authorize Brevo. Sending
from your own domain with Brevo's DNS records configured resolves it.

**Tests fail with duplicate key or foreign key errors**
Make sure tests run with `--runInBand`. Parallel test files sharing one
database cause race conditions.

**First request to the live API is slow**
Render's free tier sleeps services after 15 minutes of inactivity. The
first request after sleep takes 30–60 seconds while the service restarts;
subsequent requests are fast.

---

## License

MIT