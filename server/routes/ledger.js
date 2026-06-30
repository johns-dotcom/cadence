const express = require('express');
const multer = require('multer');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { uploadFile, getSignedFileUrl, deleteFile, loadFileBuffer } = require('../lib/r2');
const { computeDueDate } = require('../lib/payments');
const { upsertVendor } = require('../lib/vendors');
const claude = require('../lib/claude');
const { sendEmail, vendorDecisionEmail, paymentConfirmationEmail } = require('../lib/email');
const { stampFxRateAsync } = require('../lib/fxStamp');
const { normalizeInvoiceNum } = require('../lib/normalizeInvoiceNum');
const aiScan = require('../lib/aiScan');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const { buildZip, toCsv } = require('../lib/zip');

// Canonical invoice-number key — shared with vendor-submit, bulk-zip, dup-check.
const normInv = normalizeInvoiceNum;
const fileExt = (key) => (/\.pdf$/i.test(key) ? 'pdf' : /\.png$/i.test(key) ? 'png' : /\.jpe?g$/i.test(key) ? 'jpg' : 'bin');
const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80);

// Best-effort notify a vendor about a decision/payment on their submission.
async function notifyVendor(labelId, entry, kind, extra = {}) {
  try {
    if (!entry?.vendor_email) return;
    const label = await pool.query('SELECT name FROM labels WHERE id = $1', [labelId]);
    const workspaceName = label.rows[0]?.name || 'the label';
    const common = { vendorName: entry.vendor_name || entry.payee || 'there', workspaceName, invoiceNumber: entry.invoice_number, amount: entry.amount, currency: entry.currency };
    const msg = kind === 'paid'
      ? paymentConfirmationEmail({ ...common, method: extra.method, date: extra.date })
      : vendorDecisionEmail({ ...common, approved: kind === 'approved', reason: extra.reason });
    await sendEmail({ to: entry.vendor_email, subject: msg.subject, html: msg.html, text: msg.text });
  } catch (_) { /* best-effort */ }
}

const router = express.Router();
router.use(authMiddleware, withTenant);

// The ledger handles money out — finance surface, so Approver+ only.
router.use(requireApprover);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const fileFields = upload.fields([
  { name: 'invoice_file', maxCount: 1 },
  { name: 'w9_file', maxCount: 1 },
  { name: 'receipt_file', maxCount: 1 },
]);

// Map a multipart file → R2 and return { filename, r2_key }. Tenant-namespaced.
async function storeFile(labelId, file, kind) {
  const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `label-${labelId}/ledger/${kind}-${Date.now()}-${safe}`;
  await uploadFile(key, file.buffer, file.mimetype);
  return { filename: file.originalname, key };
}

const EDITABLE = [
  'invoice_date', 'payee', 'description', 'category', 'artist', 'song',
  'invoice_number', 'amount', 'currency', 'payment_method', 'payment_date',
  'is_reimbursement', 'recoupable', 'rep', 'notes', 'payment_status',
  'payment_terms', 'scheduled_payment_date',
];

// Rep visibility: Admins/Superadmins see all. An Approver with a configured
// visible-rep set sees only those reps (plus unattributed rows); an Approver
// with no set configured is unrestricted. Returns a list of rep names or null
// (null = no restriction).
async function visibleReps(req) {
  if (['Superadmin', 'Admin'].includes(req.user.role)) return null;
  const { rows } = await pool.query('SELECT rep_name FROM user_visible_reps WHERE user_id = $1 AND label_id = $2', [req.user.id, req.labelId]);
  return rows.length ? rows.map(r => r.rep_name) : null;
}

// GET /api/ledger/entries — list with optional filters (?status=, ?q=)
router.get('/entries', async (req, res) => {
  try {
    const params = [req.labelId];
    // Child rows of a split are hidden from the main list (the parent carries
    // the combined total); pass ?parent=<id> to fetch a split's children.
    let where = 'label_id = $1 AND (deleted = false OR deleted IS NULL)';
    if (req.query.parent) { params.push(parseInt(req.query.parent, 10)); where += ` AND parent_id = $${params.length}`; }
    else where += ' AND parent_id IS NULL';
    if (req.query.status) { params.push(req.query.status); where += ` AND status = $${params.length}`; }
    if (req.query.payment_status) { params.push(req.query.payment_status); where += ` AND payment_status = $${params.length}`; }
    if (req.query.category) { params.push(req.query.category); where += ` AND category = $${params.length}`; }
    if (req.query.artist) { params.push(`%${req.query.artist}%`); where += ` AND artist ILIKE $${params.length}`; }
    if (req.query.q) { params.push(`%${req.query.q}%`); where += ` AND (payee ILIKE $${params.length} OR description ILIKE $${params.length} OR artist ILIKE $${params.length} OR invoice_number ILIKE $${params.length})`; }

    const reps = await visibleReps(req);
    if (reps) { params.push(reps); where += ` AND (rep = ANY($${params.length}) OR rep IS NULL)`; }

    const { rows } = await pool.query(
      `SELECT e.*, (SELECT COUNT(*)::int FROM expenses c WHERE c.parent_id = e.id) AS split_count
       FROM expenses e WHERE ${where} ORDER BY COALESCE(invoice_date, created_at::date) DESC, id DESC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List ledger error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/pending-count — for the nav badge
router.get('/pending-count', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM expenses WHERE label_id = $1 AND status = 'pending' AND (deleted = false OR deleted IS NULL)`,
      [req.labelId]
    );
    res.json({ success: true, data: { count: rows[0].n } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries — create an entry (optionally with files). Staff-
// created entries default to approved; vendor submissions come in as pending
// through the public route.
router.post('/entries', fileFields, async (req, res) => {
  try {
    const b = req.body;
    if (!b.payee || !b.amount) {
      return res.status(400).json({ success: false, error: 'Payee and amount are required' });
    }

    const files = {};
    for (const [field, kind] of [['invoice_file', 'invoice'], ['w9_file', 'w9'], ['receipt_file', 'receipt']]) {
      const f = req.files?.[field]?.[0];
      if (f) files[kind] = await storeFile(req.labelId, f, kind);
    }

    const { rows } = await pool.query(
      `INSERT INTO expenses (
        label_id, invoice_date, payee, description, category, artist, song, invoice_number,
        amount, currency, payment_method, payment_date, status, payment_status,
        is_reimbursement, recoupable, rep, notes,
        invoice_filename, invoice_r2_key, w9_filename, w9_r2_key, receipt_filename, receipt_r2_key,
        created_by, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,'USD'),$11,$12,
        COALESCE($13,'approved'),COALESCE($14,'Unpaid'),$15,$16,$17,$18,
        $19,$20,$21,$22,$23,$24,$25,NOW()
      ) RETURNING *`,
      [
        req.labelId, b.invoice_date || null, b.payee, b.description || null, b.category || null,
        b.artist || null, b.song || null, b.invoice_number || null, b.amount, b.currency,
        b.payment_method || null, b.payment_date || null, b.status, b.payment_status,
        b.is_reimbursement === 'true' || b.is_reimbursement === true,
        b.recoupable === undefined ? true : (b.recoupable === 'true' || b.recoupable === true),
        b.rep || null, b.notes || null,
        files.invoice?.filename || null, files.invoice?.key || null,
        files.w9?.filename || null, files.w9?.key || null,
        files.receipt?.filename || null, files.receipt?.key || null,
        req.user.name,
      ]
    );
    // Keep the vendor record current (contact + W9 if one was attached).
    await upsertVendor(pool, req.labelId, {
      name: b.vendor_name || b.payee,
      email: b.vendor_email, address: b.vendor_address, bank: b.vendor_bank,
      w9_r2_key: files.w9?.key || null, w9_filename: files.w9?.filename || null,
    }).catch(() => {});

    await logActivity(req, 'Added ledger entry', `${b.payee} — ${b.amount}`);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create ledger entry error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/ledger/entries/:id — update + record field-level history.
router.patch('/entries/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const keys = Object.keys(req.body).filter(k => EDITABLE.includes(k));
    if (keys.length === 0) return res.status(400).json({ success: false, error: 'No updatable fields provided' });

    // Snapshot current values so we can diff for the audit trail.
    const before = await pool.query('SELECT * FROM expenses WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!before.rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    const prev = before.rows[0];

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => req.body[k]);
    values.push(id, req.labelId);
    const { rows } = await pool.query(
      `UPDATE expenses SET ${setClauses.join(', ')} WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );

    // Log each changed field (best-effort; never blocks the response).
    const norm = (v) => (v === null || v === undefined ? '' : String(v));
    for (const k of keys) {
      if (norm(prev[k]) !== norm(rows[0][k])) {
        pool.query(
          `INSERT INTO ledger_history (label_id, expense_id, field, old_value, new_value, changed_by, changed_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
          [req.labelId, id, k, norm(prev[k]) || null, norm(rows[0][k]) || null, req.user.name]
        ).catch(() => {});
      }
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update ledger entry error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/entries/:id/history — field-level change log for one entry.
router.get('/entries/:id/history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT field, old_value, new_value, changed_by, changed_at FROM ledger_history
       WHERE label_id = $1 AND expense_id = $2 ORDER BY changed_at DESC, id DESC`,
      [req.labelId, parseInt(req.params.id, 10)]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Ledger history error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/approve
router.post('/entries/:id/approve', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE expenses SET status = 'approved', approved_by = $1, approved_at = NOW()
       WHERE id = $2 AND label_id = $3 RETURNING *`,
      [req.user.name, parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    await logActivity(req, 'Approved ledger entry', `${rows[0].payee} — ${rows[0].amount}`);
    if (rows[0].vendor_submitted) notifyVendor(req.labelId, rows[0], 'approved');
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Approve error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/reject
router.post('/entries/:id/reject', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE expenses SET status = 'rejected', rejected_reason = $1, approved_by = $2, approved_at = NOW()
       WHERE id = $3 AND label_id = $4 RETURNING *`,
      [req.body.reason || null, req.user.name, parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    await logActivity(req, 'Rejected ledger entry', rows[0].payee);
    if (rows[0].vendor_submitted) notifyVendor(req.labelId, rows[0], 'rejected', { reason: req.body.reason });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Reject error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/mark-paid
router.post('/entries/:id/mark-paid', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE expenses SET payment_status = 'Paid', payment_date = COALESCE($1, CURRENT_DATE),
         payment_method = COALESCE($2, payment_method), payment_ref = COALESCE($3, payment_ref),
         paid_by = $4, paid_marked_at = NOW()
       WHERE id = $5 AND label_id = $6 AND status = 'approved' RETURNING *`,
      [req.body.payment_date || null, req.body.payment_method || null, req.body.payment_ref || null,
       req.user.name, parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found or not approved' });
    stampFxRateAsync(rows[0].id);
    await logActivity(req, 'Marked paid', `${rows[0].payee} — ${rows[0].amount}`);
    if (rows[0].vendor_email) notifyVendor(req.labelId, rows[0], 'paid', { method: rows[0].payment_method, date: rows[0].payment_date });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Mark paid error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Payments / scheduling ───────────────────────────────────────────────

// GET /api/ledger/payables — approved & unpaid (the payment queue). Sorted by
// scheduled (due) date so the most urgent rises to the top.
router.get('/payables', async (req, res) => {
  try {
    const params = [req.labelId];
    let where = `label_id = $1 AND status = 'approved' AND payment_status IN ('Unpaid', 'Partial')
       AND (deleted = false OR deleted IS NULL) AND (voided = false OR voided IS NULL)`;
    const reps = await visibleReps(req);
    if (reps) { params.push(reps); where += ` AND (rep = ANY($${params.length}) OR rep IS NULL)`; }
    const { rows } = await pool.query(
      `SELECT * FROM expenses WHERE ${where}
       ORDER BY scheduled_payment_date ASC NULLS LAST, invoice_date ASC NULLS LAST, id ASC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Payables error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/schedule — set terms and/or a due date. If only
// terms are given, the due date is derived from the invoice date.
router.post('/entries/:id/schedule', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { payment_terms } = req.body;
    let scheduled = req.body.scheduled_payment_date || null;

    if (!scheduled && payment_terms) {
      const { rows: e } = await pool.query('SELECT invoice_date FROM expenses WHERE id = $1 AND label_id = $2', [id, req.labelId]);
      if (e.length) scheduled = computeDueDate(e[0].invoice_date, payment_terms);
    }

    const { rows } = await pool.query(
      `UPDATE expenses SET
         payment_terms = COALESCE($1, payment_terms),
         scheduled_payment_date = COALESCE($2, scheduled_payment_date)
       WHERE id = $3 AND label_id = $4 RETURNING *`,
      [payment_terms || null, scheduled, id, req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Schedule error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/batch-pay — mark many approved entries paid in one go.
router.post('/batch-pay', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'No entries selected' });

    const { rows } = await pool.query(
      `UPDATE expenses SET payment_status = 'Paid',
         payment_date = COALESCE($1, CURRENT_DATE),
         payment_method = COALESCE($2, payment_method),
         paid_by = $3, paid_marked_at = NOW()
       WHERE label_id = $4 AND status = 'approved' AND payment_status = 'Unpaid' AND id = ANY($5::int[])
       RETURNING id`,
      [req.body.payment_date || null, req.body.payment_method || null, req.user.name, req.labelId, ids]
    );
    rows.forEach(r => stampFxRateAsync(r.id));
    await logActivity(req, 'Batch paid', `${rows.length} entries`);
    res.json({ success: true, data: { paid: rows.length } });
  } catch (error) {
    console.error('Batch pay error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Vendors ─────────────────────────────────────────────────────────────

// GET /api/ledger/vendors — spend aggregated by payee, joined to the vendors
// table for W9-on-file + contact. W9 is "on file" if any approved invoice
// carries one OR the vendor record has one.
router.get('/vendors', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         agg.payee AS name,
         agg.invoice_count,
         agg.total_spent,
         agg.paid_amount,
         agg.last_invoice,
         (agg.entry_has_w9 OR v.w9_r2_key IS NOT NULL) AS w9_on_file,
         COALESCE(v.email, agg.vendor_email) AS email,
         v.address, v.bank
       FROM (
         SELECT
           payee,
           COUNT(*) FILTER (WHERE status = 'approved')::int AS invoice_count,
           COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0) AS total_spent,
           COALESCE(SUM(amount) FILTER (WHERE status = 'approved' AND payment_status = 'Paid'), 0) AS paid_amount,
           MAX(invoice_date) FILTER (WHERE status = 'approved') AS last_invoice,
           BOOL_OR(w9_r2_key IS NOT NULL) AS entry_has_w9,
           MAX(vendor_email) AS vendor_email
         FROM expenses
         WHERE label_id = $1 AND (deleted = false OR deleted IS NULL)
           AND payee IS NOT NULL AND payee != '' AND status = 'approved'
         GROUP BY payee
       ) agg
       LEFT JOIN vendors v ON v.label_id = $1 AND LOWER(v.name) = LOWER(agg.payee)
       ORDER BY agg.total_spent DESC`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Vendors error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/vendors/:name — vendor record + their ledger entries
router.get('/vendors/:name', async (req, res) => {
  try {
    const name = req.params.name;
    const { rows: vrows } = await pool.query(
      'SELECT id, name, email, address, bank, w9_filename, w9_r2_key, notes FROM vendors WHERE label_id = $1 AND LOWER(name) = LOWER($2)',
      [req.labelId, name]
    );
    const vendor = vrows[0] || { name };
    if (vendor.w9_r2_key) { vendor.w9_url = await getSignedFileUrl(vendor.w9_r2_key, 3600).catch(() => null); }
    delete vendor.w9_r2_key;

    const { rows: entries } = await pool.query(
      `SELECT id, invoice_date, invoice_number, amount, currency, category, status, payment_status, scheduled_payment_date, w9_r2_key
       FROM expenses WHERE label_id = $1 AND LOWER(payee) = LOWER($2) AND (deleted = false OR deleted IS NULL)
       ORDER BY COALESCE(invoice_date, created_at::date) DESC`,
      [req.labelId, name]
    );
    res.json({ success: true, data: { vendor, entries: entries.map(e => ({ ...e, has_w9: !!e.w9_r2_key, w9_r2_key: undefined })) } });
  } catch (error) {
    console.error('Vendor detail error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/ledger/vendors/:name — edit contact details / notes
router.patch('/vendors/:name', async (req, res) => {
  try {
    const id = await upsertVendor(pool, req.labelId, {
      name: req.params.name, email: req.body.email, address: req.body.address, bank: req.body.bank,
    });
    if (req.body.notes !== undefined) {
      await pool.query('UPDATE vendors SET notes = $1, updated_at = NOW() WHERE id = $2', [req.body.notes, id]);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Vendor update error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/vendors/:name/w9 — upload/replace the vendor's W9 on file
router.post('/vendors/:name/w9', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    const { filename, key } = await storeFile(req.labelId, req.file, 'w9');
    await upsertVendor(pool, req.labelId, { name: req.params.name, w9_r2_key: key, w9_filename: filename });
    await logActivity(req, 'Uploaded vendor W9', req.params.name);
    res.json({ success: true, data: { w9_filename: filename } });
  } catch (error) {
    console.error('Vendor W9 upload error:', error);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

// ── Vendor management: rename, merge, aliases, suggest, batch W9 scan ───────

// GET /api/ledger/vendor-suggest?q= — typeahead of payees with W9-on-file flag.
// Resolves aliases so a known alias surfaces its canonical vendor.
router.get('/vendor-suggest', async (req, res) => {
  try {
    const q = `%${String(req.query.q || '').toLowerCase()}%`;
    const { rows } = await pool.query(
      `SELECT payee AS name,
              BOOL_OR(w9_r2_key IS NOT NULL) AS w9_on_file,
              COUNT(*) FILTER (WHERE status = 'approved')::int AS invoices
         FROM expenses
        WHERE label_id = $1 AND payee IS NOT NULL AND payee <> '' AND LOWER(payee) LIKE $2
          AND (deleted = false OR deleted IS NULL)
        GROUP BY payee ORDER BY invoices DESC LIMIT 12`,
      [req.labelId, q]
    );
    const { rows: aliases } = await pool.query(
      `SELECT canonical, alias FROM vendor_aliases WHERE label_id = $1 AND LOWER(alias) LIKE $2 LIMIT 12`,
      [req.labelId, q]
    );
    res.json({ success: true, data: { vendors: rows, aliases } });
  } catch (error) {
    console.error('Vendor suggest error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/ledger/vendors/rename { from, to } — rename a vendor everywhere
// (expenses.payee + vendor record). The old name becomes an alias.
router.put('/vendors/rename', requireAdmin, async (req, res) => {
  try {
    const from = String(req.body.from || '').trim();
    const to = String(req.body.to || '').trim();
    if (!from || !to) return res.status(400).json({ success: false, error: 'from and to are required' });
    if (from.toLowerCase() === to.toLowerCase()) return res.status(400).json({ success: false, error: 'Names are the same' });
    const upd = await pool.query(`UPDATE expenses SET payee = $1 WHERE label_id = $2 AND LOWER(payee) = LOWER($3)`, [to, req.labelId, from]);
    // Move the vendor record (or merge into an existing `to`).
    const existing = await pool.query('SELECT id FROM vendors WHERE label_id = $1 AND LOWER(name) = LOWER($2)', [req.labelId, to]);
    if (existing.rows.length) {
      await pool.query('DELETE FROM vendors WHERE label_id = $1 AND LOWER(name) = LOWER($2)', [req.labelId, from]);
    } else {
      await pool.query('UPDATE vendors SET name = $1, updated_at = NOW() WHERE label_id = $2 AND LOWER(name) = LOWER($3)', [to, req.labelId, from]);
    }
    await pool.query(
      `INSERT INTO vendor_aliases (label_id, canonical, alias, created_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (label_id, LOWER(alias)) DO UPDATE SET canonical = EXCLUDED.canonical`,
      [req.labelId, to, from, req.user.name]
    );
    await logActivity(req, 'Renamed vendor', `${from} → ${to}`);
    res.json({ success: true, data: { updated: upd.rowCount } });
  } catch (error) {
    console.error('Vendor rename error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/vendors/merge { from, into } — fold one vendor into another.
router.post('/vendors/merge', requireAdmin, async (req, res) => {
  try {
    const from = String(req.body.from || '').trim();
    const into = String(req.body.into || '').trim();
    if (!from || !into) return res.status(400).json({ success: false, error: 'from and into are required' });
    if (from.toLowerCase() === into.toLowerCase()) return res.status(400).json({ success: false, error: 'Pick two different vendors' });
    const upd = await pool.query(`UPDATE expenses SET payee = $1 WHERE label_id = $2 AND LOWER(payee) = LOWER($3)`, [into, req.labelId, from]);
    await pool.query('DELETE FROM vendors WHERE label_id = $1 AND LOWER(name) = LOWER($2)', [req.labelId, from]);
    await pool.query(
      `INSERT INTO vendor_aliases (label_id, canonical, alias, created_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (label_id, LOWER(alias)) DO UPDATE SET canonical = EXCLUDED.canonical`,
      [req.labelId, into, from, req.user.name]
    );
    await logActivity(req, 'Merged vendor', `${from} → ${into}`);
    res.json({ success: true, data: { moved: upd.rowCount } });
  } catch (error) {
    console.error('Vendor merge error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET/POST/DELETE aliases for a canonical vendor.
router.get('/vendors/:name/aliases', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, alias FROM vendor_aliases WHERE label_id = $1 AND LOWER(canonical) = LOWER($2) ORDER BY alias', [req.labelId, req.params.name]);
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.post('/vendors/:name/aliases', async (req, res) => {
  try {
    const alias = String(req.body.alias || '').trim();
    if (!alias) return res.status(400).json({ success: false, error: 'Alias is required' });
    await pool.query(
      `INSERT INTO vendor_aliases (label_id, canonical, alias, created_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (label_id, LOWER(alias)) DO UPDATE SET canonical = EXCLUDED.canonical`,
      [req.labelId, req.params.name, alias, req.user.name]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.delete('/vendors/aliases/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM vendor_aliases WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// POST /api/ledger/vendors/scan-w9s — batch-validate every vendor's W9 on file.
// Returns one result per vendor (form type, name match, signature, notes).
router.post('/vendors/scan-w9s', requireAdmin, async (req, res) => {
  try {
    if (!claude.isEnabled()) return res.status(400).json({ success: false, error: 'AI is not configured on the server' });
    // One representative W9-bearing entry per payee.
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (LOWER(payee)) id, payee, w9_r2_key, w9_filename
         FROM expenses
        WHERE label_id = $1 AND w9_r2_key IS NOT NULL AND payee IS NOT NULL
          AND (deleted = false OR deleted IS NULL)
        ORDER BY LOWER(payee), id DESC`,
      [req.labelId]
    );
    const out = [];
    for (const e of rows) {
      const r = await aiScan.rescanW9(req.labelId, e.id);
      out.push({
        vendor: e.payee,
        ok: r.ok,
        reason: r.ok ? null : r.reason,
        flags: r.ok ? (r.scan.discrepancies || []) : [],
        summary: r.ok ? r.scan.summary : null,
      });
    }
    await logActivity(req, 'Batch W9 scan', `${out.length} vendors`);
    res.json({ success: true, data: out });
  } catch (error) {
    console.error('Batch W9 scan error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/entries/:id/file/:type — signed URL for invoice|w9|receipt
router.get('/entries/:id/file/:type', async (req, res) => {
  try {
    const col = { invoice: 'invoice_r2_key', w9: 'w9_r2_key', receipt: 'receipt_r2_key' }[req.params.type];
    if (!col) return res.status(400).json({ success: false, error: 'Invalid file type' });
    const { rows } = await pool.query(
      `SELECT ${col} AS key FROM expenses WHERE id = $1 AND label_id = $2`,
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length || !rows[0].key) return res.status(404).json({ success: false, error: 'File not found' });
    const url = await getSignedFileUrl(rows[0].key, 3600);
    res.json({ success: true, data: { url } });
  } catch (error) {
    console.error('File url error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/bulk-approve — approve many pending entries at once.
router.post('/bulk-approve', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'No entries selected' });
    const { rows } = await pool.query(
      `UPDATE expenses SET status = 'approved', approved_by = $1, approved_at = NOW()
       WHERE label_id = $2 AND status = 'pending' AND id = ANY($3::int[]) RETURNING id`,
      [req.user.name, req.labelId, ids]
    );
    await logActivity(req, 'Bulk approved', `${rows.length} entries`);
    res.json({ success: true, data: { approved: rows.length } });
  } catch (error) {
    console.error('Bulk approve error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/restore — undo a soft delete.
router.post('/entries/:id/restore', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE expenses SET deleted = false WHERE id = $1 AND label_id = $2 RETURNING *',
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Restore error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/split — divide a parent entry into child rows
// (one per { artist, amount }). The parent is retained as the container and
// excluded from totals (its children carry the real amounts).
router.post('/entries/:id/split', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const splits = Array.isArray(req.body.splits) ? req.body.splits : [];
    if (splits.length < 2) return res.status(400).json({ success: false, error: 'Provide at least two splits' });

    await client.query('BEGIN');
    const { rows: prows } = await client.query('SELECT * FROM expenses WHERE id = $1 AND label_id = $2 AND parent_id IS NULL FOR UPDATE', [id, req.labelId]);
    if (!prows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Entry not found or already a child' }); }
    const parent = prows[0];

    for (const s of splits) {
      const amount = parseFloat(s.amount);
      if (!amount || amount <= 0) continue;
      await client.query(
        `INSERT INTO expenses (label_id, parent_id, invoice_date, payee, description, category, artist, song,
           invoice_number, amount, currency, payment_method, status, payment_status, is_reimbursement, recoupable, rep, notes, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())`,
        [req.labelId, id, parent.invoice_date, parent.payee, parent.description, parent.category,
         s.artist || parent.artist, parent.song, parent.invoice_number, amount, parent.currency,
         parent.payment_method, parent.status, parent.payment_status, parent.is_reimbursement,
         parent.recoupable, parent.rep, parent.notes, req.user.name]
      );
    }
    await client.query('COMMIT');
    await logActivity(req, 'Split ledger entry', `${parent.payee} → ${splits.length} parts`);
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Split error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// DELETE /api/ledger/entries/:id/splits — merge children back into the parent.
router.delete('/entries/:id/splits', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM expenses WHERE parent_id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]);
    res.json({ success: true, data: { removed: rowCount } });
  } catch (error) {
    console.error('Unsplit error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/import — bulk create entries from parsed rows (CSV wizard
// on the client posts a JSON array). Inserted in one transaction.
router.post('/import', async (req, res) => {
  const client = await pool.connect();
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ success: false, error: 'No rows to import' });
    if (rows.length > 1000) return res.status(400).json({ success: false, error: 'Too many rows (max 1000 per import)' });

    await client.query('BEGIN');
    let inserted = 0;
    for (const r of rows) {
      if (!r.payee || !r.amount) continue;
      await client.query(
        `INSERT INTO expenses (label_id, invoice_date, payee, description, category, artist, invoice_number,
           amount, currency, payment_method, status, payment_status, rep, notes, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'USD'),$10,COALESCE($11,'approved'),COALESCE($12,'Unpaid'),$13,$14,$15,NOW())`,
        [req.labelId, r.invoice_date || null, String(r.payee).trim(), r.description || null, r.category || null,
         r.artist || null, r.invoice_number || null, parseFloat(r.amount) || 0, r.currency || null,
         r.payment_method || null, r.status || null, r.payment_status || null, r.rep || null, r.notes || null, req.user.name]
      );
      inserted += 1;
    }
    await client.query('COMMIT');
    await logActivity(req, 'Imported ledger entries', `${inserted} rows`);
    res.status(201).json({ success: true, data: { inserted } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Import error:', error);
    res.status(500).json({ success: false, error: 'Import failed' });
  } finally {
    client.release();
  }
});

// POST /api/ledger/parse-invoice — AI-extract fields from an uploaded invoice
// (for auto-filling the add-entry form). Does not persist anything.
router.post('/parse-invoice', upload.single('file'), async (req, res) => {
  try {
    if (!claude.isEnabled()) return res.status(400).json({ success: false, error: 'AI is not configured on the server' });
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    const r = await claude.parseInvoice({ buffer: req.file.buffer, mimeType: req.file.mimetype });
    if (!r.ok) return res.status(502).json({ success: false, error: r.error || 'Could not parse invoice' });
    res.json({ success: true, data: r.data });
  } catch (error) {
    console.error('Parse invoice error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/scan?type=invoice|w9 — AI-check the stored file
// against the entry (invoice discrepancies, or W9 name/type/signature).
router.post('/entries/:id/scan', async (req, res) => {
  try {
    if (!claude.isEnabled()) return res.status(400).json({ success: false, error: 'AI is not configured on the server' });
    const type = req.query.type === 'w9' ? 'w9' : 'invoice';
    const col = type === 'w9' ? 'w9_r2_key' : 'invoice_r2_key';
    const { rows } = await pool.query(`SELECT payee, amount, currency, invoice_number, ${col} AS key FROM expenses WHERE id = $1 AND label_id = $2`, [parseInt(req.params.id, 10), req.labelId]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    if (!rows[0].key) return res.status(400).json({ success: false, error: `No ${type} file on this entry` });
    const buffer = await loadFileBuffer(rows[0].key, null);
    if (!buffer) return res.status(404).json({ success: false, error: 'File not found' });
    // Infer mime from the key extension (R2 keys preserve the original name).
    const mimeType = /\.pdf$/i.test(rows[0].key) ? 'application/pdf' : (/\.png$/i.test(rows[0].key) ? 'image/png' : 'image/jpeg');
    const r = type === 'w9'
      ? await claude.validateW9({ buffer, mimeType, vendorName: rows[0].payee })
      : await claude.scanInvoice({ buffer, mimeType, entry: rows[0] });
    if (!r.ok) return res.status(502).json({ success: false, error: r.error || 'Scan failed' });
    res.json({ success: true, data: r.data });
  } catch (error) {
    console.error('Scan error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── AI discrepancy scans (persisted) ──────────────────────────────────────

// POST /api/ledger/entries/:id/rescan?type=invoice|w9|both — run the AI
// discrepancy scan and STORE the result on the entry (ai_scan / w9_scan).
router.post('/entries/:id/rescan', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const type = req.query.type || 'both';
    const out = {};
    if (type === 'invoice' || type === 'both') out.invoice = await aiScan.rescanInvoice(req.labelId, id);
    if (type === 'w9' || type === 'both') out.w9 = await aiScan.rescanW9(req.labelId, id);
    await logActivity(req, 'AI rescan', `entry ${id} (${type})`);
    res.json({ success: true, data: out });
  } catch (error) {
    console.error('Rescan error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/dismiss-scan?type=invoice|w9|both — clear a scan
// (acknowledges the finding so it stops flagging).
router.post('/entries/:id/dismiss-scan', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const type = req.query.type || 'both';
    const cols = [];
    if (type === 'invoice' || type === 'both') cols.push('ai_scan = NULL');
    if (type === 'w9' || type === 'both') cols.push('w9_scan = NULL');
    if (!cols.length) return res.status(400).json({ success: false, error: 'Nothing to dismiss' });
    const { rowCount } = await pool.query(`UPDATE expenses SET ${cols.join(', ')} WHERE id = $1 AND label_id = $2`, [id, req.labelId]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Dismiss scan error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/flagged — entries whose stored scans found discrepancies.
router.get('/flagged', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, payee, amount, currency, invoice_number, status, ai_scan, w9_scan
         FROM expenses
        WHERE label_id = $1 AND (deleted = false OR deleted IS NULL)
          AND ((ai_scan IS NOT NULL AND jsonb_array_length(COALESCE(ai_scan->'discrepancies','[]')) > 0)
            OR (w9_scan IS NOT NULL AND jsonb_array_length(COALESCE(w9_scan->'discrepancies','[]')) > 0))
        ORDER BY id DESC`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Flagged error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Duplicate-invoice check ────────────────────────────────────────────────

// GET /api/ledger/check-dup?payee=&invoice_number=[&exclude=] — does an entry
// already exist for this payee + normalized invoice#? Used by the add forms
// and the vendor portal to stop double submissions.
router.get('/check-dup', async (req, res) => {
  try {
    const payee = String(req.query.payee || '').trim();
    const key = normInv(req.query.invoice_number);
    if (!payee || !key) return res.json({ success: true, data: { duplicate: false } });
    const exclude = parseInt(req.query.exclude, 10) || 0;
    const { rows } = await pool.query(
      `SELECT id, invoice_number, amount, currency, invoice_date, status, payment_status
         FROM expenses
        WHERE label_id = $1 AND LOWER(TRIM(payee)) = LOWER($2)
          AND (deleted = false OR deleted IS NULL) AND id <> $3`,
      [req.labelId, payee, exclude]
    );
    const match = rows.find(r => normInv(r.invoice_number) === key);
    res.json({ success: true, data: { duplicate: !!match, match: match || null } });
  } catch (error) {
    console.error('Dup check error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Rush / expedited payment ───────────────────────────────────────────────

// POST /api/ledger/entries/:id/rush — flag for expedited payment.
router.post('/entries/:id/rush', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE expenses SET rush = TRUE, rush_reason = $1, rush_needed_by = $2, rush_by = $3, rush_at = NOW()
         WHERE id = $4 AND label_id = $5 RETURNING *`,
      [req.body.reason || null, req.body.needed_by || null, req.user.name, parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    await logActivity(req, 'Flagged rush', `${rows[0].payee} — ${rows[0].amount}`);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Rush error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/ledger/entries/:id/rush — clear the rush flag.
router.delete('/entries/:id/rush', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE expenses SET rush = FALSE, rush_reason = NULL, rush_needed_by = NULL, rush_by = NULL, rush_at = NULL
         WHERE id = $1 AND label_id = $2 RETURNING id`,
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Clear rush error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/rush-bulk { ids:[], reason } — rush several at once.
router.post('/rush-bulk', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'No entries selected' });
    const { rowCount } = await pool.query(
      `UPDATE expenses SET rush = TRUE, rush_reason = $1, rush_needed_by = $2, rush_by = $3, rush_at = NOW()
         WHERE label_id = $4 AND id = ANY($5::int[])`,
      [req.body.reason || null, req.body.needed_by || null, req.user.name, req.labelId, ids]
    );
    await logActivity(req, 'Bulk rush', `${rowCount} entries`);
    res.json({ success: true, data: { rushed: rowCount } });
  } catch (error) {
    console.error('Bulk rush error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Payment-confirmation emails ────────────────────────────────────────────

// POST /api/ledger/entries/:id/send-confirmation — email the payee that their
// invoice was paid; record it as notified.
router.post('/entries/:id/send-confirmation', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM expenses WHERE id = $1 AND label_id = $2 AND payment_status = 'Paid'`,
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Paid entry not found' });
    const e = rows[0];
    if (!e.vendor_email) return res.status(400).json({ success: false, error: 'No vendor email on this entry' });
    await notifyVendor(req.labelId, e, 'paid', { method: e.payment_method, date: e.payment_date });
    await pool.query(`UPDATE expenses SET payment_notified = TRUE, payment_notified_at = NOW() WHERE id = $1 AND label_id = $2`, [e.id, req.labelId]);
    await logActivity(req, 'Sent payment confirmation', `${e.payee} — ${e.amount}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Send confirmation error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/send-confirmations-bulk { ids:[] } — confirm many at once
// (skips entries with no email / not paid). De-dupes by entry id.
router.post('/send-confirmations-bulk', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? [...new Set(req.body.ids.map(n => parseInt(n, 10)).filter(Boolean))] : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'No entries selected' });
    const { rows } = await pool.query(
      `SELECT * FROM expenses WHERE label_id = $1 AND id = ANY($2::int[]) AND payment_status = 'Paid' AND vendor_email IS NOT NULL`,
      [req.labelId, ids]
    );
    let sent = 0;
    for (const e of rows) {
      await notifyVendor(req.labelId, e, 'paid', { method: e.payment_method, date: e.payment_date });
      await pool.query(`UPDATE expenses SET payment_notified = TRUE, payment_notified_at = NOW() WHERE id = $1`, [e.id]);
      sent++;
    }
    await logActivity(req, 'Bulk payment confirmations', `${sent} sent`);
    res.json({ success: true, data: { sent } });
  } catch (error) {
    console.error('Bulk confirmation error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/mark-sent  &  /mark-unsent — toggle the notified
// flag manually (e.g. confirmed out-of-band).
router.post('/entries/:id/mark-sent', async (req, res) => {
  try {
    await pool.query(`UPDATE expenses SET payment_notified = TRUE, payment_notified_at = NOW() WHERE id = $1 AND label_id = $2`, [parseInt(req.params.id, 10), req.labelId]);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.post('/entries/:id/mark-unsent', async (req, res) => {
  try {
    await pool.query(`UPDATE expenses SET payment_notified = FALSE, payment_notified_at = NULL WHERE id = $1 AND label_id = $2`, [parseInt(req.params.id, 10), req.labelId]);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// GET /api/ledger/export — CSV of all (non-deleted) entries for the workspace.
router.get('/export', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT invoice_date, payee, description, category, artist, invoice_number, amount, currency,
              payment_method, status, payment_status, payment_date, rep, notes
       FROM expenses WHERE label_id = $1 AND (deleted = false OR deleted IS NULL) AND parent_id IS NULL
       ORDER BY COALESCE(invoice_date, created_at::date) DESC`,
      [req.labelId]
    );
    const cols = ['invoice_date', 'payee', 'description', 'category', 'artist', 'invoice_number', 'amount', 'currency', 'payment_method', 'status', 'payment_status', 'payment_date', 'rep', 'notes'];
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="ledger-export.csv"');
    res.send(csv);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/void — reverse an approved/paid entry without
// deleting it (keeps the audit trail; excluded from payable/spend totals).
router.post('/entries/:id/void', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE expenses SET voided = TRUE, voided_at = NOW(), voided_by = $1, payment_status = 'Unpaid'
       WHERE id = $2 AND label_id = $3 RETURNING *`,
      [req.user.name, parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    await logActivity(req, 'Voided ledger entry', `${rows[0].payee} — ${rows[0].amount}`);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Void error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/unvoid — restore a voided entry.
router.post('/entries/:id/unvoid', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE expenses SET voided = FALSE, voided_at = NULL, voided_by = NULL
       WHERE id = $1 AND label_id = $2 RETURNING *`,
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Unvoid error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/bulk-reject — reject many pending entries at once.
router.post('/bulk-reject', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'No entries selected' });
    const { rows } = await pool.query(
      `UPDATE expenses SET status = 'rejected', rejected_reason = $1, approved_by = $2, approved_at = NOW()
       WHERE label_id = $3 AND status = 'pending' AND id = ANY($4::int[]) RETURNING id`,
      [req.body.reason || null, req.user.name, req.labelId, ids]
    );
    await logActivity(req, 'Bulk rejected', `${rows.length} entries`);
    res.json({ success: true, data: { rejected: rows.length } });
  } catch (error) {
    console.error('Bulk reject error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Bulk-deal items ──────────────────────────────────────────────────────
async function expenseInLabel(id, labelId) {
  const { rows } = await pool.query('SELECT 1 FROM expenses WHERE id = $1 AND label_id = $2', [id, labelId]);
  return rows.length > 0;
}

// GET /api/ledger/entries/:id/bulk-items
router.get('/entries/:id/bulk-items', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM bulk_deal_items WHERE label_id = $1 AND expense_id = $2 ORDER BY position, id',
      [req.labelId, parseInt(req.params.id, 10)]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List bulk items error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/bulk-items — add a deliverable (also flags the
// parent expense as a bulk deal).
router.post('/entries/:id/bulk-items', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await expenseInLabel(id, req.labelId))) return res.status(404).json({ success: false, error: 'Entry not found' });
    const title = (req.body.title || '').trim();
    if (!title) return res.status(400).json({ success: false, error: 'Title is required' });
    await pool.query('UPDATE expenses SET is_bulk_deal = TRUE WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    const { rows } = await pool.query(
      `INSERT INTO bulk_deal_items (label_id, expense_id, title, url, position)
       VALUES ($1,$2,$3,$4,COALESCE($5,0)) RETURNING *`,
      [req.labelId, id, title, req.body.url || null, req.body.position]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create bulk item error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/ledger/bulk-items/:itemId — toggle completion / edit.
router.patch('/bulk-items/:itemId', async (req, res) => {
  try {
    const fields = [];
    const values = [];
    if (typeof req.body.completed === 'boolean') { fields.push(`completed = $${fields.length + 1}`); values.push(req.body.completed); fields.push(`completed_at = ${req.body.completed ? 'NOW()' : 'NULL'}`); }
    if (typeof req.body.title === 'string' && req.body.title.trim()) { fields.push(`title = $${fields.length + 1}`); values.push(req.body.title.trim()); }
    if (req.body.url !== undefined) { fields.push(`url = $${fields.length + 1}`); values.push(req.body.url || null); }
    if (!fields.length) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    values.push(parseInt(req.params.itemId, 10), req.labelId);
    const { rows } = await pool.query(
      `UPDATE bulk_deal_items SET ${fields.join(', ')} WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Item not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update bulk item error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/ledger/bulk-items/:itemId
router.delete('/bulk-items/:itemId', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM bulk_deal_items WHERE id = $1 AND label_id = $2', [parseInt(req.params.itemId, 10), req.labelId]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Item not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete bulk item error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Payment installments ─────────────────────────────────────────────────

// GET /api/ledger/entries/:id/installments
router.get('/entries/:id/installments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM payment_installments WHERE label_id = $1 AND expense_id = $2 ORDER BY paid_date, id',
      [req.labelId, parseInt(req.params.id, 10)]
    );
    const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    res.json({ success: true, data: { installments: rows, total } });
  } catch (error) {
    console.error('List installments error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/entries/:id/installments — record a partial payment. If the
// installments now cover the full amount, the entry is marked Paid.
router.post('/entries/:id/installments', upload.single('proof'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const amount = parseFloat(req.body.amount);
    if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'A valid amount is required' });
    const exp = await pool.query('SELECT amount FROM expenses WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!exp.rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    // Optional proof-of-payment file.
    let proof = { key: null, filename: null };
    if (req.file) { const s = await storeFile(req.labelId, req.file, 'proof'); proof = s; }
    const { rows } = await pool.query(
      `INSERT INTO payment_installments (label_id, expense_id, amount, paid_date, method, reference, proof_r2_key, proof_filename, created_by)
       VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7,$8,$9) RETURNING *`,
      [req.labelId, id, amount, req.body.paid_date || null, req.body.method || null, req.body.reference || null, proof.key, proof.filename, req.user.name]
    );
    // Settle / mark partial based on cumulative installments.
    const sum = await pool.query('SELECT COALESCE(SUM(amount),0) AS paid FROM payment_installments WHERE label_id = $1 AND expense_id = $2', [req.labelId, id]);
    const paid = Number(sum.rows[0].paid);
    const full = Number(exp.rows[0].amount || 0);
    const status = paid >= full && full > 0 ? 'Paid' : 'Partial';
    await pool.query(
      `UPDATE expenses SET payment_status = $1,
         payment_date = CASE WHEN $1 = 'Paid' THEN COALESCE(payment_date, CURRENT_DATE) ELSE payment_date END,
         paid_by = CASE WHEN $1 = 'Paid' THEN COALESCE(paid_by, $4) ELSE paid_by END
       WHERE id = $2 AND label_id = $3`,
      [status, id, req.labelId, req.user.name]
    );
    if (status === 'Paid') stampFxRateAsync(id);  // lock the rate once fully settled
    res.status(201).json({ success: true, data: { installment: rows[0], paid, payment_status: status } });
  } catch (error) {
    console.error('Create installment error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/installments/:installmentId/proof — signed URL for the proof file.
router.get('/installments/:installmentId/proof', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT proof_r2_key FROM payment_installments WHERE id = $1 AND label_id = $2', [parseInt(req.params.installmentId, 10), req.labelId]);
    if (!rows.length || !rows[0].proof_r2_key) return res.status(404).json({ success: false, error: 'No proof on file' });
    const url = await getSignedFileUrl(rows[0].proof_r2_key, 3600);
    res.json({ success: true, data: { url } });
  } catch (error) {
    console.error('Installment proof error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/ledger/installments/:installmentId — remove + recompute status.
router.delete('/installments/:installmentId', async (req, res) => {
  try {
    const del = await pool.query('DELETE FROM payment_installments WHERE id = $1 AND label_id = $2 RETURNING expense_id', [parseInt(req.params.installmentId, 10), req.labelId]);
    if (!del.rows.length) return res.status(404).json({ success: false, error: 'Installment not found' });
    const id = del.rows[0].expense_id;
    const exp = await pool.query('SELECT amount FROM expenses WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    const sum = await pool.query('SELECT COALESCE(SUM(amount),0) AS paid FROM payment_installments WHERE label_id = $1 AND expense_id = $2', [req.labelId, id]);
    const paid = Number(sum.rows[0].paid);
    const full = Number(exp.rows[0]?.amount || 0);
    const status = paid <= 0 ? 'Unpaid' : (paid >= full && full > 0 ? 'Paid' : 'Partial');
    await pool.query('UPDATE expenses SET payment_status = $1 WHERE id = $2 AND label_id = $3', [status, id, req.labelId]);
    res.json({ success: true, data: { paid, payment_status: status } });
  } catch (error) {
    console.error('Delete installment error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/ledger/1099-report — vendors with a W9 on file and their approved
// spend for the given year (default current), for 1099 preparation.
router.get('/1099-report', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const { rows } = await pool.query(
      `SELECT e.payee AS vendor,
              COALESCE(MAX(v.email), MAX(e.vendor_email)) AS email,
              MAX(v.address) AS address,
              SUM(e.amount)::numeric AS total_paid,
              COUNT(*)::int AS invoice_count,
              BOOL_OR(e.w9_r2_key IS NOT NULL) OR BOOL_OR(v.w9_r2_key IS NOT NULL) AS has_w9
       FROM expenses e
       LEFT JOIN vendors v ON v.label_id = e.label_id AND LOWER(v.name) = LOWER(e.payee)
       WHERE e.label_id = $1 AND e.status = 'approved' AND e.payment_status = 'Paid'
         AND (e.deleted = false OR e.deleted IS NULL) AND (e.voided = false OR e.voided IS NULL)
         AND e.parent_id IS NULL AND e.payee IS NOT NULL AND e.payee != ''
         AND EXTRACT(YEAR FROM COALESCE(e.payment_date, e.invoice_date, e.created_at::date)) = $2
       GROUP BY e.payee
       HAVING SUM(e.amount) >= 600
       ORDER BY total_paid DESC`,
      [req.labelId, year]
    );
    res.json({ success: true, data: { year, vendors: rows.map(r => ({ ...r, total_paid: Number(r.total_paid) })) } });
  } catch (error) {
    console.error('1099 report error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Build a branded XLSX ledger for a set of expense rows.
async function vendorLedgerXlsx(vendorName, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Ledger');
  const cols = ['Invoice date', 'Invoice #', 'Artist', 'Category', 'Amount', 'Currency', 'Status', 'Payment', 'Paid date', 'Method', 'Notes'];
  const title = ws.addRow([`${vendorName} — invoice ledger`]); title.font = { bold: true, size: 14 }; ws.mergeCells(`A1:${String.fromCharCode(64 + cols.length)}1`);
  const head = ws.addRow(cols); head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }; });
  ws.views = [{ state: 'frozen', ySplit: 2 }];
  let total = 0;
  for (const e of rows) {
    total += Number(e.amount || 0);
    ws.addRow([
      e.invoice_date ? String(e.invoice_date).slice(0, 10) : '', e.invoice_number || '', e.artist || '', e.category || '',
      Number(e.amount || 0), e.currency || 'USD', e.status || '', e.payment_status || '',
      e.payment_date ? String(e.payment_date).slice(0, 10) : '', e.payment_method || '', e.notes || '',
    ]);
  }
  const totalRow = ws.addRow(['', '', '', 'TOTAL', total]); totalRow.font = { bold: true };
  ws.columns.forEach(c => { c.width = 18; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// GET /api/ledger/vendor-zip?payee= — ZIP with a vendor's invoices + W9 + a
// branded Excel ledger.
router.get('/vendor-zip', async (req, res) => {
  try {
    const payee = (req.query.payee || '').trim();
    if (!payee) return res.status(400).json({ success: false, error: 'payee is required' });
    const { rows } = await pool.query(
      `SELECT * FROM expenses WHERE label_id = $1 AND LOWER(payee) = LOWER($2)
         AND (deleted = false OR deleted IS NULL) AND status != 'rejected' AND parent_id IS NULL
       ORDER BY invoice_date DESC NULLS LAST`,
      [req.labelId, payee]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'No invoices found for that vendor' });

    const entries = [{ name: `00 - ${safe(payee)} ledger.xlsx`, content: await vendorLedgerXlsx(payee, rows) }];
    let w9Key = null;
    for (const e of rows) {
      if (e.invoice_r2_key) {
        const buf = await loadFileBuffer(e.invoice_r2_key, null).catch(() => null);
        if (buf) entries.push({ name: `invoices/${safe(e.invoice_number || e.id)}.${fileExt(e.invoice_r2_key)}`, content: buf });
      }
      if (!w9Key && e.w9_r2_key) w9Key = e.w9_r2_key;
    }
    if (!w9Key) {
      const v = await pool.query('SELECT w9_r2_key FROM vendors WHERE label_id = $1 AND LOWER(name) = LOWER($2)', [req.labelId, payee]);
      w9Key = v.rows[0]?.w9_r2_key || null;
    }
    if (w9Key) {
      const buf = await loadFileBuffer(w9Key, null).catch(() => null);
      if (buf) entries.push({ name: `W9 - ${safe(payee)}.${fileExt(w9Key)}`, content: buf });
    }

    const zip = buildZip(entries, Math.floor(Date.now() / 1000));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safe(payee)}.zip"`);
    res.send(zip);
  } catch (error) {
    console.error('Vendor zip error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/ledger/bulk-zip — upload a spreadsheet of vendor + invoice# and get
// back a ZIP of every matching invoice file + W9s + a per-sheet matches.csv.
router.post('/bulk-zip', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No spreadsheet provided' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });

    // Index this label's invoices by vendor_lc|normInv for fast lookup.
    const { rows: all } = await pool.query(
      `SELECT id, payee, invoice_number, invoice_r2_key, w9_r2_key FROM expenses
       WHERE label_id = $1 AND (deleted = false OR deleted IS NULL) AND parent_id IS NULL`,
      [req.labelId]
    );
    const byKey = new Map();
    const w9ByVendor = new Map();
    for (const e of all) {
      if (e.payee && e.invoice_number) byKey.set(`${e.payee.toLowerCase()}|${normInv(e.invoice_number)}`, e);
      if (e.w9_r2_key && e.payee && !w9ByVendor.has(e.payee.toLowerCase())) w9ByVendor.set(e.payee.toLowerCase(), { key: e.w9_r2_key, payee: e.payee });
    }

    const entries = [];
    const seenW9 = new Set();
    const summary = [];
    const matchHeaderRe = /vendor|payee|supplier|company|bill ?to/i;
    const invHeaderRe = /invoice ?#?|inv ?#?|invoice ?number/i;

    for (const sheetName of wb.SheetNames) {
      const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false });
      if (!grid.length) continue;
      // Find the header row + vendor/invoice columns in the first 15 rows.
      let headerRow = -1, vCol = -1, iCol = -1;
      for (let r = 0; r < Math.min(15, grid.length); r++) {
        const row = grid[r] || [];
        const vc = row.findIndex(c => matchHeaderRe.test(String(c)));
        const ic = row.findIndex(c => invHeaderRe.test(String(c)));
        if (vc !== -1 && ic !== -1) { headerRow = r; vCol = vc; iCol = ic; break; }
      }
      if (headerRow === -1) { entries.push({ name: `${safe(sheetName)}/_SKIPPED.txt`, content: 'Could not find VENDOR and INVOICE # columns in the first 15 rows.' }); continue; }

      const csv = [['vendor', 'invoice', 'status']];
      let matched = 0, missing = 0;
      for (let r = headerRow + 1; r < grid.length; r++) {
        const row = grid[r] || [];
        const vendor = String(row[vCol] || '').trim();
        const inv = String(row[iCol] || '').trim();
        if (!vendor || !inv) { csv.push([vendor, inv, 'missing_field']); continue; }
        const hit = byKey.get(`${vendor.toLowerCase()}|${normInv(inv)}`);
        if (!hit) { csv.push([vendor, inv, 'not_found']); missing++; continue; }
        if (!hit.invoice_r2_key) { csv.push([vendor, inv, 'no_file']); continue; }
        const buf = await loadFileBuffer(hit.invoice_r2_key, null).catch(() => null);
        if (!buf) { csv.push([vendor, inv, 'no_file']); continue; }
        entries.push({ name: `${safe(sheetName)}/${safe(vendor)}-${safe(inv)}.${fileExt(hit.invoice_r2_key)}`, content: buf });
        csv.push([vendor, inv, 'matched']); matched++;
        // collect this vendor's W9
        const w9 = w9ByVendor.get(vendor.toLowerCase());
        if (w9 && !seenW9.has(vendor.toLowerCase())) {
          seenW9.add(vendor.toLowerCase());
          const wbuf = await loadFileBuffer(w9.key, null).catch(() => null);
          if (wbuf) entries.push({ name: `W9s/${safe(w9.payee)}.${fileExt(w9.key)}`, content: wbuf });
        }
      }
      entries.push({ name: `${safe(sheetName)}/matches.csv`, content: toCsv(['vendor', 'invoice', 'status'], csv.slice(1).map(([vendor, invoice, status]) => ({ vendor, invoice, status }))) });
      summary.push(`${sheetName}: ${matched} matched, ${missing} not found`);
    }

    entries.unshift({ name: 'summary.txt', content: summary.join('\n') || 'No sheets processed.' });
    const zip = buildZip(entries, Math.floor(Date.now() / 1000));
    await logActivity(req, 'Bulk invoice ZIP', summary.join('; '));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="invoices.zip"');
    res.send(zip);
  } catch (error) {
    console.error('Bulk zip error:', error);
    res.status(500).json({ success: false, error: 'Could not process the spreadsheet' });
  }
});

// DELETE /api/ledger/entries/:id — soft delete
router.delete('/entries/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'UPDATE expenses SET deleted = true WHERE id = $1 AND label_id = $2',
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete ledger entry error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
