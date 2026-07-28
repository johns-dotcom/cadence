const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const { sendEmail, internalRequestEmail } = require('../lib/email');

const router = express.Router();
router.use(authMiddleware, withTenant);

const KINDS = ['feature', 'bug', 'question'];
// Where internal requests are routed. Falls back to the sender address.
const PLATFORM_INBOX = process.env.INTERNAL_REQUESTS_TO || process.env.PLATFORM_EMAIL || process.env.EMAIL_FROM || 'john@deanst.co';

// GET /api/internal-requests — this workspace's own submissions.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ir.*, u.name AS user_name
         FROM internal_requests ir LEFT JOIN users u ON u.id = ir.user_id AND u.label_id = ir.label_id
        WHERE ir.label_id = $1 ORDER BY ir.created_at DESC LIMIT 100`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List internal requests error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/internal-requests — record + email the platform team.
router.post('/', async (req, res) => {
  try {
    const kind = KINDS.includes(req.body.kind) ? req.body.kind : 'feature';
    const subject = String(req.body.subject || '').trim();
    if (!subject) return res.status(400).json({ success: false, error: 'A subject is required' });
    const body = req.body.body ? String(req.body.body) : null;
    const page = req.body.page_context ? String(req.body.page_context).slice(0, 255) : null;

    const { rows } = await pool.query(
      `INSERT INTO internal_requests (label_id, user_id, kind, subject, body, page_context)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.labelId, req.user.id, kind, subject.slice(0, 255), body, page]
    );

    // Fire the notification email; a delivery failure must not fail the save.
    let email = { sent: false };
    try {
      const { rows: lbl } = await pool.query('SELECT name FROM labels WHERE id = $1', [req.labelId]);
      const tpl = internalRequestEmail({
        userName: req.user.name, userEmail: req.user.email,
        workspaceName: lbl[0]?.name || `Workspace ${req.labelId}`,
        requestType: kind, title: subject, details: body || '', page,
      });
      email = await sendEmail({ to: PLATFORM_INBOX, cc: req.user.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
    } catch (e) { console.error('Internal request email failed:', e.message); }

    res.status(201).json({ success: true, data: rows[0], emailed: !!email.sent });
  } catch (error) {
    console.error('Create internal request error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
