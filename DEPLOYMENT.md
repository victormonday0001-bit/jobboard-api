# Deployment Guide

## Stack
```
Code    → GitHub
Server  → Render.com (free tier)
Database → Supabase (free PostgreSQL)
CI/CD   → GitHub Actions (auto-deploy on push to main)
Email   → Brevo (free, 300 emails/day)
```

---

## Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit - Job Board API"
git remote add origin https://github.com/YOUR_USERNAME/jobboard-api.git
git branch -M main
git push -u origin main
```

---

## Step 2 — Create Supabase Database

1. Go to supabase.com → New Project
2. Name: `jobboard`, choose region, create strong password
3. Wait ~2 minutes for project to ready
4. Go to **Settings → Database → Connection string (URI)**
5. Copy the URI — looks like:
   `postgresql://postgres:[PASSWORD]@db.xxxx.supabase.co:5432/postgres`

**Run schema on Supabase:**
1. Go to **SQL Editor → New query**
2. Paste entire contents of `config/schema.sql`
3. Click **Run**

---

## Step 3 — Deploy to Render

1. Go to render.com → **New → Web Service**
2. Connect GitHub → select `jobboard-api` repo
3. Settings:
   - **Name:** `jobboard-api`
   - **Branch:** `main`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance Type:** Free

4. **Add Environment Variables:**

| Key | Value |
|-----|-------|
| NODE_ENV | production |
| PORT | 5000 |
| PG_USER | postgres |
| PG_HOST | db.xxxx.supabase.co |
| PG_DATABASE | postgres |
| PG_PASSWORD | your_supabase_password |
| PG_PORT | 5432 |
| JWT_ACCESS_SECRET | generate 32+ char random string |
| JWT_ACCESS_EXPIRES | 15m |
| JWT_REFRESH_SECRET | generate DIFFERENT 32+ char string |
| JWT_REFRESH_EXPIRES | 7d |
| EMAIL_HOST | smtp-relay.brevo.com |
| EMAIL_PORT | 465 |
| EMAIL_USER | your_brevo_login |
| EMAIL_PASS | your_brevo_smtp_key |
| EMAIL_FROM | noreply@jobboard.com |
| APP_URL | https://jobboard-api.onrender.com |
| APP_NAME | JobBoard |
| CLIENT_URL | * |
| MAX_CV_SIZE_MB | 5 |
| MAX_LOGO_SIZE_MB | 2 |
| UPLOADS_DIR | uploads |

5. Click **Create Web Service** → wait 3-5 minutes

---

## Step 4 — Create Admin Account

In Render dashboard → your service → **Shell** tab:
```bash
node scripts/createAdmin.js admin@youremail.com YourPassword123! Admin User
```

---

## Step 5 — Add GitHub Actions Secrets

1. GitHub repo → **Settings → Secrets → Actions → New repository secret**

| Secret | Value |
|--------|-------|
| JWT_ACCESS_SECRET | same as Render env var |
| JWT_REFRESH_SECRET | same as Render env var |
| RENDER_API_KEY | Render → Account Settings → API Keys |
| RENDER_SERVICE_ID | Render → your service → Settings → Service ID |

---

## Step 6 — Verify Deployment

```bash
# Health check
curl https://jobboard-api.onrender.com/health

# Swagger docs
open https://jobboard-api.onrender.com/api/docs
```

---

## Keep Server Awake (Free Tier)

Render free tier sleeps after 15 min of inactivity.
Use UptimeRobot (free) to ping every 14 minutes:

1. Go to uptimerobot.com → Create monitor
2. Type: HTTP(s)
3. URL: `https://jobboard-api.onrender.com/health`
4. Interval: 14 minutes

---

## CI/CD Flow

Every push to `main`:
```
git push origin main
        ↓
GitHub Actions:
  1. Install dependencies (npm ci)
  2. Setup test database
  3. Run all tests (67 tests)
  4. Run ESLint
  5. If all pass → trigger Render deploy
        ↓
Render:
  1. Pull latest code
  2. npm install
  3. Restart server
        ↓
Total time: ~3-5 minutes
```
