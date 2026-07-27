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
const artistsRoutes = require('./routes/artists');
const releasesRoutes = require('./routes/releases');
const dealsRoutes = require('./routes/deals');
const contractsRoutes = require('./routes/contracts');
const tasksRoutes = require('./routes/tasks');
const ledgerRoutes = require('./routes/ledger');
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
const adminDocsRoutes = require('./routes/admin-docs');
const flagsRoutes = require('./routes/flags');
const labelWaiversRoutes = require('./routes/label-waivers');
const fullExportRoutes = require('./routes/full-export');
const importRoutes = require('./routes/import');
const clearancesRoutes = require('./routes/clearances');

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
app.use('/api/email', emailRoutes);
app.use('/api/artists', artistsRoutes);
app.use('/api/releases', releasesRoutes);
app.use('/api/deals', dealsRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/ledger', ledgerRoutes);
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
app.use('/api/admin-docs', adminDocsRoutes);
app.use('/api/flags', flagsRoutes);
app.use('/api/label-waivers', labelWaiversRoutes);
app.use('/api/full-export', fullExportRoutes);
app.use('/api/import', importRoutes);
app.use('/api/clearances', clearancesRoutes);

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
      const { rows } = await pool.query('SELECT name FROM labels WHERE vendor_form_token = $1 OR slug = $1 LIMIT 1', [req.params.token]);
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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_invite_token ON users (invite_token)`);

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
    // Consolidate: if an operator email now has a canonical row in HQ, remove
    // any stale duplicate operator rows for that email in other labels. This
    // keeps exactly one operator per email (no login ambiguity) and no orphan
    // rows a workspace deletion could strand. Best-effort.
    try {
      const del = await pool.query(
        `DELETE FROM users a
          WHERE a.is_platform_admin = true AND a.label_id <> $1
            AND EXISTS (SELECT 1 FROM users b WHERE b.label_id = $1 AND LOWER(b.email) = LOWER(a.email))`,
        [hqId]
      );
      if (del.rowCount) console.log(`[platform-home] removed ${del.rowCount} duplicate operator row(s)`);
    } catch (e) { console.warn('[platform-home] dedupe skipped:', e.message); }
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
app.listen(PORT, () => {
  console.log(`Cadence API listening on :${PORT} (${process.env.NODE_ENV || 'development'})`);
  runMigrations()
    .then(autoBootstrap)
    .then(ensurePlatformHome)
    .then(recoverAdmin)
    .then(() => require('./lib/fxStamp').backfillPaidRows().catch(e => console.warn('fx backfill:', e.message)))
    .catch(err => console.error('Migration error:', err.message));
});
