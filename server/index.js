const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
require('dotenv').config();

const pool = require('./db');
const sanitize = require('./middleware/sanitize');

const authRoutes = require('./routes/auth');
const platformRoutes = require('./routes/platform');
const labelsRoutes = require('./routes/labels');
const teamRoutes = require('./routes/team');
const artistsRoutes = require('./routes/artists');
const releasesRoutes = require('./routes/releases');
const dealsRoutes = require('./routes/deals');
const contractsRoutes = require('./routes/contracts');
const tasksRoutes = require('./routes/tasks');
const dashboardRoutes = require('./routes/dashboard');
const activityRoutes = require('./routes/activity');
const settingsRoutes = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Security headers ────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: { policy: 'unsafe-none' }, // Required for Google SSO popup flow
}));

// Trust the platform proxy (Railway/Render/etc.) so req.ip is the real client.
app.set('trust proxy', 1);

// ── Rate limiting ───────────────────────────────────────────────────────
// Auth: strict — counts only FAILED attempts so a legit user fat-fingering a
// password once doesn't burn the quota.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { success: false, error: 'Too many attempts. Please try again in 15 minutes.' },
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please slow down.' },
});
app.use('/api', generalLimiter);

// ── CORS ────────────────────────────────────────────────────────────────
// In production the API and the built client are same-origin (Express serves
// the Vite build), so CORS only matters in dev (Vite :5173 → Express :3001).
if (process.env.NODE_ENV !== 'production') {
  app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3001'], credentials: true }));
} else {
  app.use('/api', cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
}

app.use(express.json({ limit: '5mb' }));
app.use(sanitize);

// ── Uploads ─────────────────────────────────────────────────────────────
// Serve uploaded files: try local disk first, then fall back to the
// entity_files table (which may carry an R2 key or inline base64). Object
// keys are tenant-namespaced (`label-<id>/…`) so cross-tenant reads aren't
// possible by guessing a filename.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.get('/uploads/:filename', async (req, res) => {
  try {
    const { loadFileBuffer } = require('./lib/r2');
    const { rows } = await pool.query(
      'SELECT r2_key, file_data, mime_type, original_name FROM entity_files WHERE filename = $1 LIMIT 1',
      [req.params.filename]
    );
    if (!rows.length) return res.status(404).send('Not found');
    const buffer = await loadFileBuffer(rows[0].r2_key, rows[0].file_data);
    if (!buffer) return res.status(404).send('Not found');
    if (rows[0].mime_type) res.type(rows[0].mime_type);
    res.send(buffer);
  } catch (err) {
    console.error('Upload fetch error:', err.message);
    res.status(500).send('Error');
  }
});

// ── Health check ────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));

// ── API routes ──────────────────────────────────────────────────────────
app.use('/api/auth/login', authLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/platform', platformRoutes);
app.use('/api/label', labelsRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/artists', artistsRoutes);
app.use('/api/releases', releasesRoutes);
app.use('/api/deals', dealsRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/settings', settingsRoutes);

// Unknown API route → JSON 404 (don't fall through to the SPA).
app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'Not found' }));

// ── Serve the built client (production) ─────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// ── Schema + migrations ─────────────────────────────────────────────────
// Idempotent: safe to run on every boot. Creates the multi-tenant base schema
// if it doesn't exist, then applies incremental ADD COLUMN migrations. New
// one-off changes can live here, or as a standalone script in migrations/.
//
// The cardinal rule: every tenant-owned table carries
//   label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE
// so deleting a label cleanly removes all of its data, and no query can ever
// see across tenants.
const runMigrations = async () => {
  // labels = the tenant root.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS labels (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(100) UNIQUE NOT NULL,
      accent_color VARCHAR(20),
      logo_r2_key TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // Per-workspace branding (for labels created before these columns existed).
  await pool.query(`ALTER TABLE labels ADD COLUMN IF NOT EXISTS accent_color VARCHAR(20)`);
  await pool.query(`ALTER TABLE labels ADD COLUMN IF NOT EXISTS logo_r2_key TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255),
      role VARCHAR(50) DEFAULT 'User',
      department VARCHAR(100),
      hierarchy_level INT DEFAULT 99,
      theme VARCHAR(10) DEFAULT 'light',
      is_platform_admin BOOLEAN DEFAULT FALSE,
      token_version INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (label_id, email)
    );
  `);
  // For databases created before is_platform_admin existed.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN DEFAULT FALSE`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS artists (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      genre VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (label_id, name)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS releases (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      artist_id INT REFERENCES artists(id) ON DELETE SET NULL,
      project_name VARCHAR(255) NOT NULL,
      release_date DATE,
      release_type VARCHAR(50),
      genre VARCHAR(100),
      status VARCHAR(50) DEFAULT 'Draft',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // Distribution metadata (mirrors migrations/add_release_fields.js so a fresh
  // boot has the full shape without running the standalone script).
  await pool.query(`ALTER TABLE releases ADD COLUMN IF NOT EXISTS upc VARCHAR(30)`);
  await pool.query(`ALTER TABLE releases ADD COLUMN IF NOT EXISTS isrc VARCHAR(30)`);
  await pool.query(`ALTER TABLE releases ADD COLUMN IF NOT EXISTS spotify_uri VARCHAR(255)`);
  await pool.query(`ALTER TABLE releases ADD COLUMN IF NOT EXISTS cover_art_url VARCHAR(500)`);
  await pool.query(`ALTER TABLE releases ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'Standard'`);
  await pool.query(`ALTER TABLE releases ADD COLUMN IF NOT EXISTS notes TEXT`);
  await pool.query(`ALTER TABLE releases ADD COLUMN IF NOT EXISTS producer VARCHAR(255)`);
  await pool.query(`ALTER TABLE releases ADD COLUMN IF NOT EXISTS featured_artists VARCHAR(500)`);
  // Release prep checklist (mirrors RELEASE_CHECKLIST in client/src/constants.js).
  for (const col of [
    'cover_art_received', 'audio_uploaded', 'pitched_spotify', 'pitched_apple',
    'marketing_plan', 'content_ready', 'dsp_email_sent', 'lyrics_submitted',
  ]) {
    await pool.query(`ALTER TABLE releases ADD COLUMN IF NOT EXISTS ${col} BOOLEAN DEFAULT FALSE`);
  }

  // A&R deal pipeline.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deals (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      artist_name VARCHAR(255) NOT NULL,
      genre VARCHAR(100),
      stage VARCHAR(50) DEFAULT 'Scouting',
      ar_rep VARCHAR(255),
      source VARCHAR(100),
      deal_type VARCHAR(50),
      offer_amount NUMERIC(12,2),
      spotify_monthly_listeners INTEGER,
      last_contact_date DATE,
      next_followup_date DATE,
      priority VARCHAR(10) DEFAULT 'Medium',
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_deals_label ON deals (label_id)`);

  // Contracts (per-artist agreements; files stored in R2 via entity_files).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contracts (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      artist_id INT REFERENCES artists(id) ON DELETE SET NULL,
      type VARCHAR(100) NOT NULL,
      status VARCHAR(50) DEFAULT 'Active',
      date_signed DATE,
      expiration_date DATE,
      royalty_split VARCHAR(100),
      advance VARCHAR(100),
      territory VARCHAR(100),
      num_releases VARCHAR(100),
      notes TEXT,
      file_name VARCHAR(255),
      r2_key TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_contracts_label ON contracts (label_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      assigned_by INT REFERENCES users(id) ON DELETE SET NULL,
      description TEXT NOT NULL,
      priority VARCHAR(20) DEFAULT 'Medium',
      status VARCHAR(50) DEFAULT 'To Do',
      due_date DATE,
      release_id INT REFERENCES releases(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(255) NOT NULL,
      detail TEXT,
      ip_address VARCHAR(100),
      method VARCHAR(10),
      endpoint VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_login_logs (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      logged_in_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ip_address VARCHAR(100),
      user_agent TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_page_permissions (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      page VARCHAR(100) NOT NULL,
      UNIQUE (user_id, page)
    );
  `);

  // Generic file attachment table — R2 key + optional inline fallback. Files
  // belong to a label and an arbitrary (entity_type, entity_id) owner.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entity_files (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      entity_type VARCHAR(50) NOT NULL,
      entity_id INT NOT NULL,
      filename VARCHAR(255) UNIQUE NOT NULL,
      original_name VARCHAR(255),
      mime_type TEXT,
      r2_key TEXT,
      file_data TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Helpful indexes for the hot tenant-scoped lookups.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_releases_label ON releases (label_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_artists_label ON artists (label_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_activity_label ON activity_log (label_id, created_at DESC)`);

  console.log('Schema ready.');
};

// Bootstrap the first platform admin + their label. Because there's no public
// signup, the platform needs a way to create its very first account. If
// SEED_ADMIN_PASSWORD is set and no labels exist yet, run the seed (idempotent)
// so a fresh deploy can come up with a usable platform-admin login.
const autoBootstrap = async () => {
  if (!process.env.SEED_ADMIN_PASSWORD) return;
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM labels');
    if (rows[0].n > 0) return; // already bootstrapped
    console.log('No labels found — bootstrapping the first platform admin from SEED_* env…');
    await require('./seed')();
  } catch (err) {
    console.error('Bootstrap error:', err.message);
  }
};

// ── Boot ────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Cadence API listening on :${PORT} (${process.env.NODE_ENV || 'development'})`);
  runMigrations()
    .then(autoBootstrap)
    .catch(err => console.error('Migration error:', err.message));
});
