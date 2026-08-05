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
const emailRoutes = require('./routes/email');
const artistCampaignsRoutes = require('./routes/artist-campaigns');
const recordingBudgetsRoutes = require('./routes/recording-budgets');
const artistsRoutes = require('./routes/artists');
const releasesRoutes = require('./routes/releases');
const dealsRoutes = require('./routes/deals');
const contractsRoutes = require('./routes/contracts');
const tasksRoutes = require('./routes/tasks');
const ledgerRoutes = require('./routes/ledger');
const bankStatementsRoutes = require('./routes/bank-statements');
const invoicesRoutes = require('./routes/invoices');
const vendorRoutes = require('./routes/vendor');
const dashboardRoutes = require('./routes/dashboard');
const activityRoutes = require('./routes/activity');
const settingsRoutes = require('./routes/settings');
const searchRoutes = require('./routes/search');
const notificationsRoutes = require('./routes/notifications');
const calendarRoutes = require('./routes/calendar');
const repsRoutes = require('./routes/reps');
const dspRoutes = require('./routes/dsp');
const financialsRoutes = require('./routes/financials');
const salaryRoutes = require('./routes/salary');
const campaignsRoutes = require('./routes/campaigns');
const pendingContractsRoutes = require('./routes/pending-contracts');
const ndasRoutes = require('./routes/ndas');
const ndaDocumentsRoutes = require('./routes/nda-documents');
const internalRequestsRoutes = require('./routes/internal-requests');
const announcementsRoutes = require('./routes/announcements');
const manualRoutes = require('./routes/manual');
const brandAssetsRoutes = require('./routes/brand-assets');
const adminDocsRoutes = require('./routes/admin-docs');
const flagsRoutes = require('./routes/flags');
const labelWaiversRoutes = require('./routes/label-waivers');
const fullExportRoutes = require('./routes/full-export');
const importRoutes = require('./routes/import');
const clearancesRoutes = require('./routes/clearances');
const chatRoutes = require('./routes/chat');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Security headers ────────────────────────────────────────────────────
// Content-Security-Policy — the backstop that makes any stray XSS unable to
// exfiltrate the session. Ships REPORT-ONLY by default (logs violations without
// breaking anything — verify the browser console is clean, then set
// CSP_ENFORCE=true to enforce). script-src omits 'unsafe-inline'/'unsafe-eval'
// so injected inline script won't run when enforced.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    reportOnly: process.env.CSP_ENFORCE !== 'true',
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://accounts.google.com', 'https://apis.google.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],       // React inline style={} + injected styles
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'], // R2 signed URLs, inline logos, blob previews
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'https://accounts.google.com'], // API + same-origin websocket
      frameSrc: ["'self'", 'https://accounts.google.com'],   // Google SSO
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
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

// Bound concurrent in-RAM multipart uploads. multer uses memoryStorage (whole
// files buffered in RAM), so a burst of large uploads can OOM the process.
// Non-multipart requests pass straight through.
const MAX_CONCURRENT_UPLOADS = parseInt(process.env.MAX_CONCURRENT_UPLOADS, 10) || 8;
let uploadsInFlight = 0;
app.use('/api', (req, res, next) => {
  if (!String(req.headers['content-type'] || '').startsWith('multipart/form-data')) return next();
  if (uploadsInFlight >= MAX_CONCURRENT_UPLOADS) {
    return res.status(503).json({ success: false, error: 'Server busy — please retry your upload in a moment.' });
  }
  uploadsInFlight++;
  let released = false;
  const release = () => { if (!released) { released = true; uploadsInFlight--; } };
  res.on('finish', release);
  res.on('close', release);
  next();
});

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
    // Serve with a safe content-type + disposition (inline only for inert types)
    // so an uploaded SVG/HTML can't execute script in the app origin.
    require('./lib/safeFiles').sendFileSafely(res, { mime: rows[0].mime_type, filename: rows[0].original_name, buffer });
  } catch (err) {
    console.error('Upload fetch error:', err.message);
    res.status(500).send('Error');
  }
});

// ── Health check ────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));

// ── API routes ──────────────────────────────────────────────────────────
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/platform', platformRoutes);
app.use('/api/label', labelsRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/artist-campaigns', artistCampaignsRoutes);
app.use('/api/recording-budgets', recordingBudgetsRoutes);
app.use('/api/artists', artistsRoutes);
app.use('/api/releases', releasesRoutes);
app.use('/api/deals', dealsRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/ledger', ledgerRoutes);
app.use('/api/bank-statements', bankStatementsRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/vendor', vendorRoutes); // public (no auth) — label resolved by slug
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/reps', repsRoutes);
app.use('/api/dsp', dspRoutes);
app.use('/api/financials', financialsRoutes);
app.use('/api/salary', salaryRoutes);
app.use('/api/campaigns', campaignsRoutes);
app.use('/api/pending-contracts', pendingContractsRoutes);
app.use('/api/ndas', ndasRoutes);
app.use('/api/nda-documents', ndaDocumentsRoutes);
app.use('/api/internal-requests', internalRequestsRoutes);
app.use('/api/announcements', announcementsRoutes);
app.use('/api/manual', manualRoutes);
app.use('/api/brand-assets', brandAssetsRoutes);
app.use('/api/admin-docs', adminDocsRoutes);
app.use('/api/flags', flagsRoutes);
app.use('/api/label-waivers', labelWaiversRoutes);
app.use('/api/full-export', fullExportRoutes);
app.use('/api/import', importRoutes);
app.use('/api/clearances', clearancesRoutes);
app.use('/api/chat', chatRoutes);

// Unknown API route → JSON 404 (don't fall through to the SPA).
app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'Not found' }));

// ── Serve the built client (production) ─────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  // Hashed build assets are content-addressed and safe to cache forever; but
  // index.html must NEVER be cached, or an open tab keeps loading stale chunk
  // names after a deploy and crashes ("x is not a function"). no-cache forces
  // a revalidate so every load picks up the current asset hashes.
  app.use(express.static(clientDist, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (/\/assets\//.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  // Public vendor form: serve index.html with the label's title/OG tags injected
  // so a shared /submit/<token> link unfurls as that label's vendor form.
  const fs = require('fs');
  const ogEsc = (s) => String(s || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  app.get('/submit/:token', async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    try {
      const { rows } = await pool.query('SELECT name FROM labels WHERE vendor_form_token = $1 LIMIT 1', [req.params.token]);
      let html = fs.readFileSync(path.join(clientDist, 'index.html'), 'utf8');
      if (rows[0]) {
        const title = `Submit an invoice to ${rows[0].name}`;
        const desc = `${rows[0].name} uses Cadence to collect vendor invoices. Submit yours securely — no account needed.`;
        const tags = `<title>${ogEsc(title)}</title>`
          + `<meta name="description" content="${ogEsc(desc)}"/>`
          + `<meta property="og:title" content="${ogEsc(title)}"/>`
          + `<meta property="og:description" content="${ogEsc(desc)}"/>`
          + `<meta property="og:type" content="website"/>`
          + `<meta name="twitter:card" content="summary"/>`;
        html = html.replace(/<title>.*?<\/title>/i, '').replace('</head>', `${tags}</head>`);
      }
      res.type('html').send(html);
    } catch { res.sendFile(path.join(clientDist, 'index.html')); }
  });
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
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
  // Inline logo fallback (a data: URL) for when object storage (R2) isn't
  // configured — keeps branding working out of the box.
  await pool.query(`ALTER TABLE labels ADD COLUMN IF NOT EXISTS logo_data TEXT`);
  // Workspace lifecycle: 'active' | 'suspended'. Suspended blocks all of the
  // label's logins/sessions (platform admins excepted, so they can manage it).
  await pool.query(`ALTER TABLE labels ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'`);
  await pool.query(`ALTER TABLE labels ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMP`);
  // Per-workspace "Funds payable to" / remittance block rendered on issued
  // invoices (company legal name, address, contact, EIN, bank details).
  await pool.query(`ALTER TABLE labels ADD COLUMN IF NOT EXISTS invoice_settings JSONB`);
  // Unguessable public token for the vendor-submission form. Resolves the label
  // by token (not by numeric id or guessable slug). Rotatable by admins.
  await pool.query(`ALTER TABLE labels ADD COLUMN IF NOT EXISTS vendor_form_token TEXT`);
  await pool.query(`UPDATE labels SET vendor_form_token = md5(random()::text || clock_timestamp()::text || id::text) WHERE vendor_form_token IS NULL`);
  await pool.query(`ALTER TABLE labels ALTER COLUMN vendor_form_token SET DEFAULT md5(random()::text || clock_timestamp()::text)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_vendor_form_token ON labels (vendor_form_token)`);
  // System label = the permanent home for platform operators, so no tenant
  // workspace deletion can ever cascade-delete them. Hidden from the console.
  await pool.query(`ALTER TABLE labels ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT FALSE`);
  // Explicit owner pointer — lets the platform owner designate ANY user
  // (including a console operator) as a workspace's owner. When set it wins
  // over the "most-senior Superadmin member" heuristic; SET NULL on delete
  // falls back to that heuristic.
  await pool.query(`ALTER TABLE labels ADD COLUMN IF NOT EXISTS owner_user_id INT REFERENCES users(id) ON DELETE SET NULL`);
  // Owner-customizable workspace settings (tagline, dashboard welcome, home
  // widget config + pinned links). Shallow-merged on PATCH so each Settings
  // sub-section saves independently.
  await pool.query(`ALTER TABLE labels ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb`);

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
  // Platform operator tier: 'owner' (full operator) vs 'admin' (Workspace Admin —
  // enters/manages any workspace but no provisioning/suspend/delete/operator mgmt).
  // Any operator has is_platform_admin = true; platform_role distinguishes power.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_role VARCHAR(20)`);
  // Existing operators become owners (preserve current full powers).
  await pool.query(`UPDATE users SET platform_role = 'owner' WHERE is_platform_admin = TRUE AND platform_role IS NULL`);
  // Invite flow: a newly-added member has no password yet — they activate via
  // an emailed invite link and set their own password.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_expires TIMESTAMP`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at TIMESTAMP`);
  // "Clear all" watermark for computed notifications (mentions are excluded).
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_cleared_at TIMESTAMP`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMP`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_invite_token ON users (invite_token)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users (reset_token)`);

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
    // Expanded set (parity with Boom's 14-item checklist).
    'pitched_amazon', 'pitched_pandora', 'youtube_video', 'official_thread',
    'musixmatch', 'recoup_setup',
  ]) {
    await pool.query(`ALTER TABLE releases ADD COLUMN IF NOT EXISTS ${col} BOOLEAN DEFAULT FALSE`);
  }
  // Release budget cap (line items live in their own table below).
  await pool.query(`ALTER TABLE releases ADD COLUMN IF NOT EXISTS budget_cap NUMERIC(12,2)`);
  await pool.query(`ALTER TABLE releases ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE`);
  // Release owner — the team member responsible for shepherding it out.
  await pool.query(`ALTER TABLE releases ADD COLUMN IF NOT EXISTS assigned_to INT REFERENCES users(id) ON DELETE SET NULL`);
  // Soft-archive an artist without deleting (keeps historical references).
  await pool.query(`ALTER TABLE artists ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE`);

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
  // Card-detail fields for the pipeline: primary contact + freeform links.
  await pool.query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS contact TEXT`);
  await pool.query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS links TEXT`);

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

  // Ledger (money out) — expense entries with an approval workflow. Vendor
  // submissions land here as status='pending' via the public vendor form.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      invoice_date DATE,
      payee TEXT,
      description TEXT,
      category TEXT,
      artist TEXT,
      song TEXT,
      invoice_number TEXT,
      amount NUMERIC(12,2),
      currency TEXT DEFAULT 'USD',
      payment_method TEXT,
      payment_date DATE,
      status TEXT DEFAULT 'approved',
      payment_status TEXT DEFAULT 'Unpaid',
      is_reimbursement BOOLEAN DEFAULT FALSE,
      recoupable BOOLEAN DEFAULT TRUE,
      vendor_submitted BOOLEAN DEFAULT FALSE,
      vendor_name TEXT,
      vendor_email TEXT,
      vendor_address TEXT,
      vendor_bank TEXT,
      rep TEXT,
      notes TEXT,
      invoice_filename TEXT,
      invoice_r2_key TEXT,
      w9_filename TEXT,
      w9_r2_key TEXT,
      receipt_filename TEXT,
      receipt_r2_key TEXT,
      approved_by TEXT,
      approved_at TIMESTAMP,
      rejected_reason TEXT,
      paid_by TEXT,
      deleted BOOLEAN DEFAULT FALSE,
      created_by TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_expenses_label ON expenses (label_id, status)`);
  // Payments / scheduling columns.
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_terms TEXT`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS scheduled_payment_date DATE`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS paid_marked_at TIMESTAMP`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_ref TEXT`);
  // Split invoices: child rows reference their parent. The parent stays in the
  // list showing the combined total; children are hidden unless expanded.
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS parent_id INT REFERENCES expenses(id) ON DELETE CASCADE`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_expenses_parent ON expenses (parent_id)`);
  // Void (reverse a paid/approved entry without deleting it).
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided_by TEXT`);
  // Bulk-deal flag. (The campaign_id link is added after the campaigns table
  // is created, further down — it can't reference a table that doesn't exist
  // yet, or the whole migration would abort here.)
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_bulk_deal BOOLEAN DEFAULT FALSE`);
  // FX rate locked at payment time (audit). NULL = not yet stamped; once set
  // the USD-equivalent never changes. Convention matches lib/fx.js getRates:
  // value of `currency` per 1 USD, so USD = native / fx_rate_to_usd.
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fx_rate_to_usd NUMERIC(18,8)`);
  // AI discrepancy scans, stored so the finding persists across reloads.
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS ai_scan JSONB`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS w9_scan JSONB`);
  // Rush / expedited-payment flag.
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS rush BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS rush_reason TEXT`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS rush_needed_by DATE`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS rush_by TEXT`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS rush_at TIMESTAMP`);
  // Payment-confirmation email tracking.
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_notified BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_notified_at TIMESTAMP`);
  // Artist-campaign hub: per-expense campaign inclusion (NULL = auto by
  // category, TRUE = force in, FALSE = force out) + cobrand flag.
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS artist_campaign BOOLEAN`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS cobrand BOOLEAN DEFAULT FALSE`);
  // Vendor-provided multi-artist allocation: [{ artist, song, amount, socials:[{handle, amount}] }].
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS artist_breakdown JSONB`);
  // Recoupment statement tracking: UFR ("un-recouped funds recovered") marker
  // + when it was stamped (drives the statement month), and entry source.
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS ufr BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS ufr_marked_at TIMESTAMP`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS entry_source TEXT`);
  // Prior-year recoupment tag — moves rows to a dedicated subpage (item 9).
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS prior_year_tag TEXT`);
  // Soft-delete attribution (who/when) for the Archive + restore.
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_by TEXT`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
  // Hold flag (payment paused). Mutually exclusive with rush. Held rows drop
  // out of the Due Soon / Overdue payment queues.
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS on_hold BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS hold_reason TEXT`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS hold_by TEXT`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS hold_at TIMESTAMP`);
  // Proof-of-payment file on partial-payment installments.
  await pool.query(`ALTER TABLE payment_installments ADD COLUMN IF NOT EXISTS proof_r2_key TEXT`);
  await pool.query(`ALTER TABLE payment_installments ADD COLUMN IF NOT EXISTS proof_filename TEXT`);
  // Vendor aliases — alternate spellings that should resolve to one canonical
  // vendor name (used by dup-check, rename, and merge). Label-scoped.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendor_aliases (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      canonical TEXT NOT NULL,
      alias TEXT NOT NULL,
      created_by TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_aliases_uniq ON vendor_aliases (label_id, LOWER(alias))`);
  // Vendor saved emails — multiple labeled addresses per vendor, auto-CC'd on
  // payment confirmations. Keyed to the canonical vendor name.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendor_emails (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      vendor TEXT NOT NULL,
      email TEXT NOT NULL,
      label_text TEXT,
      created_by TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_emails_uniq ON vendor_emails (label_id, LOWER(vendor), LOWER(email))`);
  // Admin-built permission templates — named page-sets applied to users.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS permission_templates (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      pages JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_perm_templates_uniq ON permission_templates (label_id, LOWER(name))`);
  // Bookkeeping-specific audit trail (approvals, rejections, scans, rush, file
  // deletions, confirmation emails). Separate from the general activity_log so
  // the money trail can be queried per expense.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bk_audit_log (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      expense_id INT,
      action TEXT NOT NULL,
      detail TEXT,
      actor TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bk_audit_expense ON bk_audit_log (label_id, expense_id)`);
  // Campaign collaboration: threaded comments + reviewer assignments per expense.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expense_comments (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      expense_id INT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      author TEXT,
      body TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_expense_comments ON expense_comments (label_id, expense_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_assignments (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      expense_id INT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      assignee_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assigned_by TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_review_assign_uniq ON review_assignments (label_id, expense_id, assignee_id)`);

  // ── Artist Campaigns (marketing reconciliation) ──────────────────────────
  // Extra expense columns the campaigns surface needs.
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS social_handles JSONB`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS item_finished BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS item_finished_at TIMESTAMP`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS item_finished_by TEXT`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS flagged BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS flag_reason TEXT`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS flagged_by TEXT`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMP`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bulk_deal_quantity INT`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bulk_deal_unit TEXT`);
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bulk_deal_completed INT DEFAULT 0`);

  // Per-artist metadata (keyed by a normalized artist key).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS artist_meta (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      artist_key TEXT NOT NULL,
      priority TEXT,
      priority_updated_at TIMESTAMP, priority_updated_by TEXT,
      flagged BOOLEAN DEFAULT FALSE, flag_reason TEXT, flagged_at TIMESTAMP, flagged_by TEXT,
      complete BOOLEAN DEFAULT FALSE, complete_at TIMESTAMP, complete_by TEXT,
      ready_for_planning BOOLEAN DEFAULT FALSE, ready_at TIMESTAMP, ready_by TEXT,
      dismissed BOOLEAN DEFAULT FALSE, dismissed_at TIMESTAMP, dismissed_by TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_artist_meta_uniq ON artist_meta (label_id, artist_key)`);
  // Per-artist recoupment notes (item 9).
  await pool.query(`ALTER TABLE artist_meta ADD COLUMN IF NOT EXISTS notes TEXT`);

  // Per-(artist,song) campaign status.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS song_campaign_status (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      artist_key TEXT NOT NULL, song_key TEXT NOT NULL,
      finished BOOLEAN DEFAULT FALSE, finished_at TIMESTAMP, finished_by TEXT,
      notes TEXT, notes_updated_at TIMESTAMP, notes_updated_by TEXT,
      flagged BOOLEAN DEFAULT FALSE, flag_reason TEXT, flagged_at TIMESTAMP, flagged_by TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_song_status_uniq ON song_campaign_status (label_id, artist_key, song_key)`);

  // Per-expense reclassification: 'artist_campaign' (hidden) or
  // 'artist_campaign_not_campaign' (visible-but-segregated).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flag_dismissals (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      expense_id INT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      flag_kind TEXT NOT NULL,
      created_by TEXT, created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_flag_dismiss_uniq ON flag_dismissals (label_id, expense_id, flag_kind)`);

  // Per-page campaign chat rooms + unread watermarks.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_chat_messages (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      room TEXT NOT NULL,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      edited_at TIMESTAMP, deleted BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_campaign_chat_room ON campaign_chat_messages (label_id, room, id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_chat_reads (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      room TEXT NOT NULL, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_read_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_chat_reads_uniq ON campaign_chat_reads (label_id, room, user_id)`);

  // Marketing/influencer campaigns anchored to a ledger row.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS influencer_campaigns (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      artist TEXT, song TEXT, name TEXT,
      planned_amount NUMERIC(12,2), currency TEXT DEFAULT 'USD',
      expense_id INT REFERENCES expenses(id) ON DELETE SET NULL,
      created_by TEXT, created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_influencer_campaigns_label ON influencer_campaigns (label_id, artist)`);

  // Recording budgets: draft → approved → locked, with line items grouped by
  // section and mapped to a ledger category for actual-vs-budget rollups.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recording_budgets (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      artist TEXT,
      status TEXT DEFAULT 'draft',
      contingency_pct NUMERIC(5,2) DEFAULT 0,
      notes TEXT,
      created_by TEXT,
      approved_by TEXT,
      approved_at TIMESTAMP,
      locked_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_recording_budgets ON recording_budgets (label_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recording_budget_items (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      budget_id INT NOT NULL REFERENCES recording_budgets(id) ON DELETE CASCADE,
      section TEXT,
      description TEXT,
      category TEXT,
      amount NUMERIC(12,2) DEFAULT 0
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_recording_budget_items ON recording_budget_items (budget_id)`);

  // Per-entry field-level change history (audit trail for the ledger).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ledger_history (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      expense_id INT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      field VARCHAR(60) NOT NULL,
      old_value TEXT,
      new_value TEXT,
      changed_by TEXT,
      changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ledger_history ON ledger_history (label_id, expense_id, changed_at DESC)`);

  // Bulk-deal line items (deliverables tracked under a parent expense).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bulk_deal_items (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      expense_id INT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      url TEXT,
      position INT DEFAULT 0,
      completed BOOLEAN DEFAULT FALSE,
      completed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bulk_deal_items ON bulk_deal_items (label_id, expense_id)`);

  // Payment installments — partial payments against one expense, each with its
  // own proof-of-payment reference.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_installments (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      expense_id INT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL,
      paid_date DATE,
      method TEXT,
      reference TEXT,
      created_by TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payment_installments ON payment_installments (label_id, expense_id)`);

  // Vendors — contact + W9 on file, keyed by name within a label. Spend is
  // derived from the ledger; this just holds what shouldn't be re-keyed.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vendors (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT,
      address TEXT,
      bank TEXT,
      w9_r2_key TEXT,
      w9_filename TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_label_name ON vendors (label_id, LOWER(name))`);

  // Invoices (money in) — invoices the label issues. Numbered per-label.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      invoice_number INT NOT NULL,
      bill_to TEXT,
      bill_to_address TEXT,
      description TEXT,
      amount NUMERIC(12,2),
      purchase_order TEXT DEFAULT 'N/A',
      due_by TEXT DEFAULT 'UPON RECEIPT',
      line_items JSONB,
      payment_status TEXT DEFAULT 'Unpaid',
      created_by TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (label_id, invoice_number)
    );
  `);
  await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD'`);

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

  // Internal requests — in-app "request a feature / report a bug" to the
  // platform team, with page context.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS internal_requests (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      kind VARCHAR(30) NOT NULL,
      subject VARCHAR(255) NOT NULL,
      body TEXT,
      page_context VARCHAR(255),
      status VARCHAR(30) DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_internal_requests_label ON internal_requests (label_id, created_at DESC)`);

  // Persisted @mentions — one row per (mentioned user, comment). Surfaced in
  // the notification bell and marked read per-item.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_mentions (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      mentioned_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id INT REFERENCES users(id) ON DELETE SET NULL,
      source VARCHAR(40),
      source_id INT,
      snippet TEXT,
      link VARCHAR(255),
      read_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_mentions_unread ON user_mentions (mentioned_user_id, read_at)`);

  // Brand assets — a per-workspace library of team logos and images. Stored in
  // R2 when configured, otherwise inline as a data: URL (same fallback as the
  // workspace logo).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS brand_assets (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      name VARCHAR(200) NOT NULL,
      category VARCHAR(40) DEFAULT 'Other',
      mime_type VARCHAR(100),
      r2_key TEXT,
      data TEXT,
      size_bytes INT,
      uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_brand_assets_label ON brand_assets (label_id, created_at DESC)`);

  // Per-workspace AI usage metering + limits. usage is bucketed by calendar
  // month (ym = 'YYYY-MM'); a per-label monthly_limit overrides the default
  // (NULL = default; -1 = unlimited).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_usage (
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      ym VARCHAR(7) NOT NULL,
      calls INT NOT NULL DEFAULT 0,
      in_tokens BIGINT NOT NULL DEFAULT 0,
      out_tokens BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (label_id, ym)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_limits (
      label_id INT PRIMARY KEY REFERENCES labels(id) ON DELETE CASCADE,
      monthly_limit INT
    );
  `);
  // Whether monthly_limit counts requests or total tokens (in + out).
  await pool.query(`ALTER TABLE ai_limits ADD COLUMN IF NOT EXISTS limit_type VARCHAR(10) DEFAULT 'requests'`);

  // Operator enter-workspace sessions — a platform-level audit of every time an
  // operator dropped into a tenant. Attributed to the operator's REAL user id
  // (not the per-label ghost membership) so it survives ghost churn.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS operator_sessions (
      id SERIAL PRIMARY KEY,
      operator_id INT REFERENCES users(id) ON DELETE SET NULL,
      operator_email VARCHAR(255),
      operator_name VARCHAR(255),
      label_id INT REFERENCES labels(id) ON DELETE CASCADE,
      ip_address VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_operator_sessions_recent ON operator_sessions (created_at DESC)`);

  // Platform announcements — operators broadcast a banner to all or a targeted
  // set of workspaces (target_label_ids NULL/empty = every workspace). Users
  // dismiss per-announcement; dismissals persist.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS announcements (
      id SERIAL PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      body TEXT,
      level VARCHAR(20) DEFAULT 'info',
      target_label_ids INT[],
      starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ends_at TIMESTAMP,
      active BOOLEAN DEFAULT TRUE,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS announcement_dismissals (
      announcement_id INT REFERENCES announcements(id) ON DELETE CASCADE,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      dismissed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (announcement_id, user_id)
    );
  `);

  // Operator permissions (owner-managed, keyed by operator EMAIL since an
  // operator spans many per-label ghost rows). An operator with ANY rows is
  // restricted to that allowlist; no rows = unrestricted. Owners are always
  // unrestricted regardless of these tables.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS operator_workspace_access (
      operator_email VARCHAR(255) NOT NULL,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      PRIMARY KEY (operator_email, label_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS operator_page_access (
      operator_email VARCHAR(255) NOT NULL,
      page VARCHAR(60) NOT NULL,
      PRIMARY KEY (operator_email, page)
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

  // Artist profile depth — social links, imagery and Spotify stats. Columns
  // are additive so existing rosters keep working.
  for (const [col, type] of [
    ['image_url', 'VARCHAR(500)'], ['bio', 'TEXT'], ['website', 'VARCHAR(255)'],
    ['spotify_url', 'VARCHAR(255)'], ['apple_music_url', 'VARCHAR(255)'],
    ['instagram', 'VARCHAR(255)'], ['tiktok', 'VARCHAR(255)'],
    ['youtube', 'VARCHAR(255)'], ['soundcloud', 'VARCHAR(255)'],
    ['spotify_monthly_listeners', 'INTEGER'], ['spotify_followers', 'INTEGER'],
    ['spotify_popularity', 'INTEGER'],
  ]) {
    await pool.query(`ALTER TABLE artists ADD COLUMN IF NOT EXISTS ${col} ${type}`);
  }

  // Artist development log — A&R timeline of meetings, demos, offers, notes.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS artist_dev_log (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      artist_id INT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
      entry_type VARCHAR(50) DEFAULT 'Note',
      note TEXT NOT NULL,
      log_date DATE DEFAULT CURRENT_DATE,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_dev_log_artist ON artist_dev_log (label_id, artist_id)`);

  // Per-release DSP submission tracker — one row per (release, platform).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dsp_submissions (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      release_id INT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
      platform VARCHAR(50) NOT NULL,
      status VARCHAR(30) DEFAULT 'Not Submitted',
      submitted_date DATE,
      live_date DATE,
      notes TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (release_id, platform)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_dsp_release ON dsp_submissions (label_id, release_id)`);

  // Reps — the workspace's curated list of names used in ledger/deal dropdowns.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reps (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_reps_label_name ON reps (label_id, LOWER(name))`);
  await pool.query(`ALTER TABLE reps ADD COLUMN IF NOT EXISTS email TEXT`);

  // Artist income — money in attributed to an artist (streaming, sync, etc.).
  // Paired with recoupable ledger spend to compute recoupment per artist.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS artist_income (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      artist_id INT REFERENCES artists(id) ON DELETE SET NULL,
      source VARCHAR(100),
      description TEXT,
      amount NUMERIC(12,2) NOT NULL,
      currency VARCHAR(10) DEFAULT 'USD',
      income_date DATE DEFAULT CURRENT_DATE,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_artist_income_label ON artist_income (label_id, artist_id)`);

  // Payroll roster + monthly payment tracking.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS salary_employees (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      department VARCHAR(100),
      monthly_amount NUMERIC(12,2) DEFAULT 0,
      currency VARCHAR(10) DEFAULT 'USD',
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_salary_employees_label ON salary_employees (label_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS salary_payments (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      employee_id INT NOT NULL REFERENCES salary_employees(id) ON DELETE CASCADE,
      month INT NOT NULL,
      year INT NOT NULL,
      paid BOOLEAN DEFAULT FALSE,
      amount NUMERIC(12,2),
      paid_at TIMESTAMP,
      marked_by INT REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE (employee_id, month, year)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_salary_payments_label ON salary_payments (label_id, year, month)`);

  // Marketing / influencer campaigns — spend tracking linked to an artist.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      artist_id INT REFERENCES artists(id) ON DELETE SET NULL,
      name VARCHAR(255) NOT NULL,
      platform VARCHAR(100),
      status VARCHAR(50) DEFAULT 'Planned',
      planned_budget NUMERIC(12,2) DEFAULT 0,
      actual_spend NUMERIC(12,2) DEFAULT 0,
      currency VARCHAR(10) DEFAULT 'USD',
      start_date DATE,
      end_date DATE,
      handles TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_campaigns_label ON campaigns (label_id, artist_id)`);
  // Now that campaigns exists, link ledger rows to campaigns (reconciliation).
  await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS campaign_id INT REFERENCES campaigns(id) ON DELETE SET NULL`);

  // Pending contracts — agreements awaiting signature (a lightweight queue
  // separate from executed contracts).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pending_contracts (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      counterparty VARCHAR(255) NOT NULL,
      type VARCHAR(100),
      status VARCHAR(50) DEFAULT 'Not Sent',
      sent_date DATE,
      due_date DATE,
      notes TEXT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pending_contracts_label ON pending_contracts (label_id)`);

  // NDAs — non-disclosure agreement tracking with optional document file.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ndas (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      counterparty VARCHAR(255) NOT NULL,
      status VARCHAR(50) DEFAULT 'Active',
      effective_date DATE,
      expiration_date DATE,
      notes TEXT,
      file_name VARCHAR(255),
      r2_key TEXT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ndas_label ON ndas (label_id)`);

  // Generated NDA documents (the /create-nda builder). Template-driven, with
  // the finished body stored for export/re-edit. Distinct from `ndas` above,
  // which tracks executed counterparty agreements + their signed files.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS nda_documents (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      template VARCHAR(50) NOT NULL,
      title VARCHAR(255),
      data JSONB DEFAULT '{}',
      custom_body TEXT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_nda_documents_label ON nda_documents (label_id)`);

  // Admin docs vault — secure company documents with categories + files.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_docs (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      category VARCHAR(100),
      status VARCHAR(50) DEFAULT 'Active',
      confidentiality VARCHAR(50) DEFAULT 'Internal',
      counterparty VARCHAR(255),
      signed_date DATE,
      expiration_date DATE,
      tags TEXT,
      notes TEXT,
      file_name VARCHAR(255),
      r2_key TEXT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_admin_docs_label ON admin_docs (label_id)`);

  // Release comments — team discussion thread per release.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS release_comments (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      release_id INT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_release_comments ON release_comments (label_id, release_id)`);

  // Release budget line items (planned spend by category).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS release_budget_items (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      release_id INT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
      category VARCHAR(100),
      description TEXT,
      amount NUMERIC(12,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_release_budget_items ON release_budget_items (label_id, release_id)`);

  // Artist clearance charts — per-track rights/credits/royalty documentation,
  // exported as XLSX. tracks holds an array of track objects (flexible shape).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clearances (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      artist_id INT REFERENCES artists(id) ON DELETE SET NULL,
      title VARCHAR(255),
      project_number VARCHAR(100),
      product_commitment VARCHAR(255),
      contractual_members TEXT,
      effective_date DATE,
      royalty_rate VARCHAR(50),
      royalty_account VARCHAR(255),
      tracks JSONB DEFAULT '[]'::jsonb,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_clearances_label ON clearances (label_id, artist_id)`);

  // Label waivers — side-letters waiving the label's exclusivity so a signed
  // artist can appear as co-primary on another label's release. Structured
  // fields + an editable body; the PDF is rendered client-side.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS label_waivers (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      effective_date DATE,
      artist_name VARCHAR(255) NOT NULL,
      releasing_label VARCHAR(255) NOT NULL,
      other_label_artist VARCHAR(255),
      song_title VARCHAR(255) NOT NULL,
      release_date DATE,
      release_format VARCHAR(50),
      royalty_percent NUMERIC(5,2),
      contact_email VARCHAR(255),
      signatory_name VARCHAR(255),
      signatory_title VARCHAR(255),
      custom_body TEXT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_label_waivers_label ON label_waivers (label_id)`);

  // Per-user rep visibility — which reps' ledger entries an Approver may see.
  // Empty for a user = unrestricted (sees all). Admins always see everything.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_visible_reps (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rep_name VARCHAR(255) NOT NULL,
      UNIQUE (user_id, rep_name)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_visible_reps ON user_visible_reps (label_id, user_id)`);

  // Manual calendar events. The calendar view also aggregates release dates,
  // task due dates and contract dates live; this table holds ad-hoc entries.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      event_date DATE NOT NULL,
      description TEXT,
      color VARCHAR(20),
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_calendar_events_label ON calendar_events (label_id, event_date)`);

  // ── Chat / messaging (the Slack-replacement core) ───────────────────────
  // Channels are either named group channels ('channel') or 1:1/group direct
  // messages ('dm'). Membership lives in chat_members; a message can be a
  // top-level post or a threaded reply (thread_root_id → the parent message).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_channels (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      name VARCHAR(120),
      topic TEXT,
      type VARCHAR(20) NOT NULL DEFAULT 'channel',
      is_private BOOLEAN DEFAULT FALSE,
      archived BOOLEAN DEFAULT FALSE,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_channels_label ON chat_channels (label_id, type)`);
  // Object-anchored threads: a channel bound to a specific record (release,
  // deal, expense, artist, campaign). One thread per entity per workspace.
  await pool.query(`ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS entity_type VARCHAR(40)`);
  await pool.query(`ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS entity_id INT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_object ON chat_channels (label_id, entity_type, entity_id) WHERE type = 'object'`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_members (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      channel_id INT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      muted BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (channel_id, user_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members (user_id, label_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      channel_id INT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      thread_root_id INT REFERENCES chat_messages(id) ON DELETE CASCADE,
      edited_at TIMESTAMP,
      deleted BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages (channel_id, id DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages (thread_root_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_reactions (
      id SERIAL PRIMARY KEY,
      message_id INT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji VARCHAR(16) NOT NULL,
      UNIQUE (message_id, user_id, emoji)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_reactions_msg ON chat_reactions (message_id)`);

  // File/image attachments on chat messages. Same R2-or-inline model as the
  // rest of the app: r2_key when object storage is configured, else raw base64
  // in `data` (served by streaming, never embedded in the message JSON).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_attachments (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      message_id INT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      r2_key TEXT,
      data TEXT,
      mime_type VARCHAR(120),
      original_name VARCHAR(255),
      size_bytes INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_attachments_msg ON chat_attachments (message_id)`);

  // Activity-stream bot: system messages authored by "Cadence" (user_id NULL),
  // meta carries an icon + deep-link for the client to render.
  await pool.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS meta JSONB`);

  // ── Bank statements / reconciliation (item 8, premium finance) ──────────
  // Statements are a LENS over the master ledger — no staging copy. A parsed
  // statement holds its transactions; matching/booking writes straight to
  // expenses. Admin-only surface (balances are sensitive).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bank_statements (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      account VARCHAR(60) NOT NULL,
      filename VARCHAR(255),
      r2_key TEXT,
      period_start DATE,
      period_end DATE,
      txn_count INT DEFAULT 0,
      status VARCHAR(16) DEFAULT 'ready',
      error TEXT,
      import_summary JSONB,
      uploaded_by TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bank_statements_label ON bank_statements (label_id, created_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bank_transactions (
      id SERIAL PRIMARY KEY,
      statement_id INT NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      txn_date DATE,
      description TEXT,
      payee_guess TEXT,
      amount NUMERIC(18,2),
      direction VARCHAR(8),
      currency VARCHAR(8) DEFAULT 'USD',
      reference TEXT,
      fee NUMERIC(18,2),
      matched_expense_id INT,
      match_method VARCHAR(24),
      match_score NUMERIC(4,3),
      matched_by TEXT,
      matched_at TIMESTAMP,
      booked BOOLEAN DEFAULT FALSE,
      dismissed BOOLEAN DEFAULT FALSE,
      dismissed_reason VARCHAR(24),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bank_txns_statement ON bank_transactions (statement_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bank_txns_match ON bank_transactions (label_id, matched_expense_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS statement_dismiss_rules (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      pattern TEXT NOT NULL,
      created_by TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS statement_category_rules (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      pattern TEXT NOT NULL,
      category VARCHAR(80),
      created_by TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS statement_payee_map (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      bank_payee TEXT NOT NULL,
      ledger_payee TEXT NOT NULL,
      created_by TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_statement_payee_map_uniq ON statement_payee_map (label_id, LOWER(bank_payee))`);
  // Per-label configurable bank-account list (seed-less; defaults applied in the route).
  await pool.query(`ALTER TABLE labels ADD COLUMN IF NOT EXISTS bank_accounts JSONB`);

  // ── Data-quality: dismissals + artist normalization map (item 10) ───────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS data_quality_dismissals (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      flag_key TEXT NOT NULL,
      kind VARCHAR(40),
      note TEXT,
      dismissed_by TEXT,
      dismissed_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_dq_dismissals_uniq ON data_quality_dismissals (label_id, flag_key)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS artist_normalization_map (
      id SERIAL PRIMARY KEY,
      label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      pattern TEXT NOT NULL,
      base_artist TEXT NOT NULL,
      created_by TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_artist_norm_uniq ON artist_normalization_map (label_id, LOWER(pattern))`);

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
// Ensure a permanent "Platform HQ" system label exists and that every platform
// operator is homed there — never in a deletable tenant workspace. Idempotent;
// collision-safe (skips an operator whose email already exists in HQ).
async function ensurePlatformHome() {
  try {
    await pool.query(`ALTER TABLE labels ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT FALSE`);
    let hq = await pool.query(`SELECT id FROM labels WHERE is_system = true ORDER BY id LIMIT 1`);
    if (!hq.rows.length) {
      hq = await pool.query(
        `INSERT INTO labels (name, slug, status, is_system, created_at)
         VALUES ('Platform HQ', 'platform-hq', 'active', true, NOW())
         ON CONFLICT (slug) DO UPDATE SET is_system = true RETURNING id`
      );
    }
    const hqId = hq.rows[0].id;
    const { rowCount } = await pool.query(
      `UPDATE users u SET label_id = $1
        WHERE u.is_platform_admin = true AND u.label_id <> $1
          AND NOT EXISTS (SELECT 1 FROM users x WHERE x.label_id = $1 AND LOWER(x.email) = LOWER(u.email))`,
      [hqId]
    );
    if (rowCount) console.log(`[platform-home] relocated ${rowCount} operator(s) to Platform HQ`);
    // NOTE: we deliberately do NOT delete an operator's per-workspace rows here.
    // "Enter workspace" mints a ghost operator row (is_platform_admin=true,
    // label_id=<workspace>) that the active session token points at; deleting it
    // on boot would 401 that session ("account no longer exists") and log the
    // operator out on every restart. Ghosts are passwordless so login/rosters
    // already exclude them, and they cascade-delete with their label — so
    // keeping them is harmless. (Login ambiguity is prevented at the login
    // query, not here.)
  } catch (err) {
    console.error('ensurePlatformHome error:', err.message);
  }
}

// Break-glass admin recovery. If RECOVER_ADMIN_EMAIL + RECOVER_ADMIN_PASSWORD
// are set in the environment, restore that email as a platform OWNER homed in
// Platform HQ with the given password — creating or resetting it — regardless
// of current state. Deterministic (no dependence on remembering SEED values).
// REMOVE the two env vars after logging in. Runs after ensurePlatformHome.
async function recoverAdmin() {
  const email = (process.env.RECOVER_ADMIN_EMAIL || '').trim().toLowerCase();
  const pw = process.env.RECOVER_ADMIN_PASSWORD;
  if (!email || !pw) return;
  try {
    const bcrypt = require('bcryptjs');
    const hqRes = await pool.query(`SELECT id FROM labels WHERE is_system = true ORDER BY id LIMIT 1`);
    const hqId = hqRes.rows[0]?.id;
    if (!hqId) { console.error('[recover] no Platform HQ yet — skipping'); return; }

    // IDEMPOTENT: if the HQ account already exists with this exact password, do
    // NOTHING — importantly, never bump token_version, or a redeploy would kill
    // the operator's live session (that was the repeat-signout bug).
    const ex = await pool.query('SELECT id, password_hash, is_platform_admin, platform_role FROM users WHERE label_id = $1 AND LOWER(email) = $2', [hqId, email]);
    if (ex.rows.length) {
      const row = ex.rows[0];
      const already = row.password_hash && await bcrypt.compare(pw, row.password_hash);
      if (already && row.is_platform_admin && row.platform_role === 'owner') {
        console.log(`[recover] ${email} already restored — no-op`);
        return;
      }
      const hash = already ? row.password_hash : await bcrypt.hash(pw, 10);
      await pool.query(
        `UPDATE users SET password_hash = $1, is_platform_admin = TRUE, platform_role = 'owner', invite_token = NULL, invite_expires = NULL WHERE id = $2`,
        [hash, row.id]
      );
      console.log(`[recover] platform owner ${email} restored in Platform HQ (remove RECOVER_* env now)`);
      return;
    }
    // No HQ account yet — create it (fresh row; no session to preserve).
    const hash = await bcrypt.hash(pw, 10);
    await pool.query(
      `INSERT INTO users (label_id, name, email, password_hash, role, department, hierarchy_level, is_platform_admin, platform_role, created_at)
       VALUES ($1, 'Recovered Admin', $2, $3, 'Superadmin', 'Executive', 1, TRUE, 'owner', NOW())`,
      [hqId, email, hash]
    );
    console.log(`[recover] platform owner ${email} created in Platform HQ (remove RECOVER_* env now)`);
  } catch (err) {
    console.error('recoverAdmin error:', err.message);
  }
}

const autoBootstrap = async () => {
  if (!process.env.SEED_ADMIN_PASSWORD) return;
  try {
    // Self-heal: reseed whenever there is NO usable platform admin — not only
    // on a fresh DB. This recovers from a workspace deletion that cascade-
    // removed the operator's account (their home label was deleted).
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE is_platform_admin = true AND password_hash IS NOT NULL`
    );
    if (rows[0].n > 0) return; // a usable platform admin already exists
    console.log('No platform admin found — (re)bootstrapping from SEED_* env…');
    await require('./seed')();
  } catch (err) {
    console.error('Bootstrap error:', err.message);
  }
};

// ── Boot ────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`Cadence API listening on :${PORT} (${process.env.NODE_ENV || 'development'})`);
  try {
    const r2 = require('./lib/r2');
    console.log('R2 storage:', r2.isConfigured() ? 'configured ✓' : 'NOT configured (using inline fallback)', JSON.stringify(r2.configReport()));
    console.log('AI (Claude):', require('./lib/claude').isEnabled() ? 'configured ✓' : 'NOT configured');
  } catch (e) { /* diagnostics only */ }
  // Realtime chat transport shares the same http server + JWT auth.
  try { require('./lib/realtime').init(server); console.log('Realtime (chat): attached ✓'); }
  catch (e) { console.warn('Realtime init failed:', e.message); }
  runMigrations()
    .then(autoBootstrap)
    .then(ensurePlatformHome)
    .then(recoverAdmin)
    .then(() => require('./lib/fxStamp').backfillPaidRows().catch(e => console.warn('fx backfill:', e.message)))
    .catch(err => console.error('Migration error:', err.message));
});

// Graceful shutdown — Railway sends SIGTERM to retire an old container during a
// rolling deploy. Exit cleanly (code 0) so it doesn't surface as an npm error.
function shutdown(signal) {
  console.log(`${signal} received — shutting down gracefully.`);
  try { require('./lib/realtime').close(); } catch { /* not attached */ }
  server.close(() => process.exit(0));
  // Don't hang forever if a connection is slow to drain.
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
