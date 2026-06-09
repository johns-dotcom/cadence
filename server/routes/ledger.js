const express = require('express');
const multer = require('multer');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { uploadFile, getSignedFileUrl, deleteFile } = require('../lib/r2');

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
];

// GET /api/ledger/entries — list with optional filters (?status=, ?q=)
router.get('/entries', async (req, res) => {
  try {
    const params = [req.labelId];
    let where = 'label_id = $1 AND (deleted = false OR deleted IS NULL)';
    if (req.query.status) { params.push(req.query.status); where += ` AND status = $${params.length}`; }
    if (req.query.payment_status) { params.push(req.query.payment_status); where += ` AND payment_status = $${params.length}`; }
    if (req.query.q) { params.push(`%${req.query.q}%`); where += ` AND (payee ILIKE $${params.length} OR description ILIKE $${params.length} OR artist ILIKE $${params.length})`; }

    const { rows } = await pool.query(
      `SELECT * FROM expenses WHERE ${where} ORDER BY COALESCE(invoice_date, created_at::date) DESC, id DESC`,
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
    await logActivity(req, 'Added ledger entry', `${b.payee} — ${b.amount}`);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create ledger entry error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/ledger/entries/:id
router.patch('/entries/:id', async (req, res) => {
  try {
    const keys = Object.keys(req.body).filter(k => EDITABLE.includes(k));
    if (keys.length === 0) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => req.body[k]);
    values.push(parseInt(req.params.id, 10), req.labelId);
    const { rows } = await pool.query(
      `UPDATE expenses SET ${setClauses.join(', ')} WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update ledger entry error:', error);
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
      `UPDATE expenses SET payment_status = 'Paid', payment_date = COALESCE($1, CURRENT_DATE), paid_by = $2
       WHERE id = $3 AND label_id = $4 RETURNING *`,
      [req.body.payment_date || null, req.user.name, parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    await logActivity(req, 'Marked paid', `${rows[0].payee} — ${rows[0].amount}`);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Mark paid error:', error);
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
