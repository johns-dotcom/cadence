const express = require('express');
const multer = require('multer');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { uploadFile, getSignedFileUrl, deleteFile } = require('../lib/r2');
const { computeDueDate } = require('../lib/payments');
const { upsertVendor } = require('../lib/vendors');

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
    await logActivity(req, 'Marked paid', `${rows[0].payee} — ${rows[0].amount}`);
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
router.post('/entries/:id/installments', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const amount = parseFloat(req.body.amount);
    if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'A valid amount is required' });
    const exp = await pool.query('SELECT amount FROM expenses WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!exp.rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    const { rows } = await pool.query(
      `INSERT INTO payment_installments (label_id, expense_id, amount, paid_date, method, reference, created_by)
       VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7) RETURNING *`,
      [req.labelId, id, amount, req.body.paid_date || null, req.body.method || null, req.body.reference || null, req.user.name]
    );
    // Settle / mark partial based on cumulative installments.
    const sum = await pool.query('SELECT COALESCE(SUM(amount),0) AS paid FROM payment_installments WHERE label_id = $1 AND expense_id = $2', [req.labelId, id]);
    const paid = Number(sum.rows[0].paid);
    const full = Number(exp.rows[0].amount || 0);
    const status = paid >= full && full > 0 ? 'Paid' : 'Partial';
    await pool.query('UPDATE expenses SET payment_status = $1 WHERE id = $2 AND label_id = $3', [status, id, req.labelId]);
    res.status(201).json({ success: true, data: { installment: rows[0], paid, payment_status: status } });
  } catch (error) {
    console.error('Create installment error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/ledger/installments/:installmentId
router.delete('/installments/:installmentId', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM payment_installments WHERE id = $1 AND label_id = $2', [parseInt(req.params.installmentId, 10), req.labelId]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Installment not found' });
    res.json({ success: true });
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
