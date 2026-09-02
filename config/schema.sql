-- ═══════════════════════════════════════════════════════════════
--  JOB BOARD API — DATABASE SCHEMA
--  Run: psql -U postgres -d jobboard -f config/schema.sql
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
  id                    SERIAL PRIMARY KEY,
  email                 VARCHAR(255) UNIQUE NOT NULL,
  password_hash         TEXT         NOT NULL,
  role                  VARCHAR(20)  NOT NULL DEFAULT 'jobseeker'
                          CHECK (role IN ('admin','employer','jobseeker')),
  first_name            VARCHAR(50)  NOT NULL,
  last_name             VARCHAR(50)  NOT NULL,
  phone                 VARCHAR(20)  DEFAULT NULL,
  avatar                TEXT         DEFAULT NULL,
  is_verified           BOOLEAN      DEFAULT FALSE,
  is_active             BOOLEAN      DEFAULT TRUE,
  last_login_at         TIMESTAMP    DEFAULT NULL,
  created_at            TIMESTAMP    DEFAULT NOW(),
  updated_at            TIMESTAMP    DEFAULT NOW(),
  deleted_at            TIMESTAMP    DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  device_info TEXT        DEFAULT NULL,
  ip_address  VARCHAR(45) DEFAULT NULL,
  expires_at  TIMESTAMP   NOT NULL,
  created_at  TIMESTAMP   DEFAULT NOW(),
  revoked_at  TIMESTAMP   DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS email_verifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT      NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_resets (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT      NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used       BOOLEAN   DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobseeker_profiles (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  headline         VARCHAR(200) DEFAULT NULL,
  bio              TEXT         DEFAULT NULL,
  location         VARCHAR(100) DEFAULT NULL,
  website          VARCHAR(255) DEFAULT NULL,
  linkedin         VARCHAR(255) DEFAULT NULL,
  github           VARCHAR(255) DEFAULT NULL,
  years_experience INTEGER      DEFAULT 0,
  cv_url           TEXT         DEFAULT NULL,
  cv_filename      TEXT         DEFAULT NULL,
  cv_updated_at    TIMESTAMP    DEFAULT NULL,
  desired_role     VARCHAR(100) DEFAULT NULL,
  desired_salary   INTEGER      DEFAULT NULL,
  job_type         VARCHAR(20)  DEFAULT NULL
                     CHECK (job_type IN ('full-time','part-time','contract','remote',NULL)),
  is_open_to_work  BOOLEAN      DEFAULT TRUE,
  created_at       TIMESTAMP    DEFAULT NOW(),
  updated_at       TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS skills (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(50) UNIQUE NOT NULL,
  slug       VARCHAR(60) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobseeker_skills (
  jobseeker_id INTEGER REFERENCES jobseeker_profiles(id) ON DELETE CASCADE,
  skill_id     INTEGER REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (jobseeker_id, skill_id)
);

CREATE TABLE IF NOT EXISTS companies (
  id           SERIAL PRIMARY KEY,
  owner_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(150) NOT NULL,
  slug         VARCHAR(180) UNIQUE NOT NULL,
  description  TEXT         DEFAULT NULL,
  website      VARCHAR(255) DEFAULT NULL,
  email        VARCHAR(255) DEFAULT NULL,
  phone        VARCHAR(20)  DEFAULT NULL,
  logo_url     TEXT         DEFAULT NULL,
  industry     VARCHAR(100) DEFAULT NULL,
  size         VARCHAR(30)  DEFAULT NULL
                 CHECK (size IN ('1-10','11-50','51-200','201-500','501-1000','1000+',NULL)),
  founded_year INTEGER      DEFAULT NULL,
  location     VARCHAR(150) DEFAULT NULL,
  country      VARCHAR(80)  DEFAULT NULL,
  is_verified  BOOLEAN      DEFAULT FALSE,
  is_active    BOOLEAN      DEFAULT TRUE,
  created_at   TIMESTAMP    DEFAULT NOW(),
  updated_at   TIMESTAMP    DEFAULT NOW(),
  deleted_at   TIMESTAMP    DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id                 SERIAL PRIMARY KEY,
  company_id         INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  posted_by          INTEGER REFERENCES users(id)     ON DELETE CASCADE,
  title              VARCHAR(200) NOT NULL,
  slug               VARCHAR(250) UNIQUE NOT NULL,
  description        TEXT         NOT NULL,
  requirements       TEXT         DEFAULT NULL,
  responsibilities   TEXT         DEFAULT NULL,
  benefits           TEXT         DEFAULT NULL,
  type               VARCHAR(20)  NOT NULL DEFAULT 'full-time'
                       CHECK (type IN ('full-time','part-time','contract','internship','remote')),
  experience_level   VARCHAR(20)  NOT NULL DEFAULT 'mid'
                       CHECK (experience_level IN ('entry','mid','senior','lead','executive')),
  category           VARCHAR(80)  DEFAULT NULL,
  location           VARCHAR(150) DEFAULT NULL,
  country            VARCHAR(80)  DEFAULT NULL,
  is_remote          BOOLEAN      DEFAULT FALSE,
  salary_min         INTEGER      DEFAULT NULL,
  salary_max         INTEGER      DEFAULT NULL,
  salary_currency    VARCHAR(10)  DEFAULT 'USD',
  is_salary_visible  BOOLEAN      DEFAULT TRUE,
  status             VARCHAR(20)  NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','published','closed','expired')),
  is_featured        BOOLEAN      DEFAULT FALSE,
  views              INTEGER      DEFAULT 0,
  deadline           TIMESTAMP    DEFAULT NULL,
  published_at       TIMESTAMP    DEFAULT NULL,
  created_at         TIMESTAMP    DEFAULT NOW(),
  updated_at         TIMESTAMP    DEFAULT NOW(),
  deleted_at         TIMESTAMP    DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS job_skills (
  job_id   INTEGER REFERENCES jobs(id)   ON DELETE CASCADE,
  skill_id INTEGER REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (job_id, skill_id)
);

CREATE TABLE IF NOT EXISTS applications (
  id               SERIAL PRIMARY KEY,
  job_id           INTEGER REFERENCES jobs(id)  ON DELETE CASCADE,
  applicant_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  cv_url           TEXT        DEFAULT NULL,
  cv_filename      TEXT        DEFAULT NULL,
  cover_letter     TEXT        DEFAULT NULL,
  status           VARCHAR(30) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','reviewing','shortlisted','interview','offered','rejected','withdrawn')),
  employer_notes   TEXT        DEFAULT NULL,
  reviewed_at      TIMESTAMP   DEFAULT NULL,
  shortlisted_at   TIMESTAMP   DEFAULT NULL,
  rejected_at      TIMESTAMP   DEFAULT NULL,
  created_at       TIMESTAMP   DEFAULT NOW(),
  updated_at       TIMESTAMP   DEFAULT NOW(),
  deleted_at       TIMESTAMP   DEFAULT NULL,
  UNIQUE (job_id, applicant_id)
);

CREATE TABLE IF NOT EXISTS saved_jobs (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  job_id     INTEGER REFERENCES jobs(id)  ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, job_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(50)  NOT NULL,
  title      VARCHAR(200) NOT NULL,
  message    TEXT         NOT NULL,
  link       TEXT         DEFAULT NULL,
  is_read    BOOLEAN      DEFAULT FALSE,
  created_at TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     VARCHAR(100) NOT NULL,
  entity     VARCHAR(50)  DEFAULT NULL,
  entity_id  INTEGER      DEFAULT NULL,
  old_values JSONB        DEFAULT NULL,
  new_values JSONB        DEFAULT NULL,
  ip_address VARCHAR(45)  DEFAULT NULL,
  user_agent TEXT         DEFAULT NULL,
  created_at TIMESTAMP    DEFAULT NOW()
);

-- ── INDEXES ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_email      ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role       ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_deleted    ON users(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_user     ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_hash     ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_companies_owner  ON companies(owner_id);
CREATE INDEX IF NOT EXISTS idx_companies_slug   ON companies(slug);
CREATE INDEX IF NOT EXISTS idx_jobs_company     ON jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status      ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_deleted     ON jobs(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_search      ON jobs USING gin(
  to_tsvector('english', title || ' ' || COALESCE(description,''))
);
CREATE INDEX IF NOT EXISTS idx_apps_job         ON applications(job_id);
CREATE INDEX IF NOT EXISTS idx_apps_applicant   ON applications(applicant_id);
CREATE INDEX IF NOT EXISTS idx_apps_status      ON applications(status);
CREATE INDEX IF NOT EXISTS idx_audit_user       ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created    ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifs_user      ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifs_unread    ON notifications(user_id) WHERE is_read = FALSE;

-- ── SEED SKILLS ───────────────────────────────────────────────────
INSERT INTO skills (name, slug) VALUES
  ('JavaScript','javascript'), ('TypeScript','typescript'),
  ('Node.js','nodejs'),        ('Python','python'),
  ('Java','java'),             ('Go','go'),
  ('Rust','rust'),             ('C++','cpp'),
  ('React','react'),           ('Vue.js','vuejs'),
  ('Angular','angular'),       ('PostgreSQL','postgresql'),
  ('MySQL','mysql'),           ('MongoDB','mongodb'),
  ('Redis','redis'),           ('Docker','docker'),
  ('Kubernetes','kubernetes'), ('AWS','aws'),
  ('Git','git'),               ('REST APIs','rest-apis'),
  ('GraphQL','graphql'),       ('Linux','linux'),
  ('CI/CD','cicd'),            ('SQL','sql')
ON CONFLICT (slug) DO NOTHING;
