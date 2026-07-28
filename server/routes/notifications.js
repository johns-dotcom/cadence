const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');

const router = express.Router();
router.use(authMiddleware, withTenant);

const CHECKLIST_COLS = [
  'cover_art_received', 'audio_uploaded', 'pitched_spotify', 'pitched_apple',
  'marketing_plan', 'content_ready', 'dsp_email_sent', 'lyrics_submitted',
];

// GET /api/notifications — smart alerts computed live from the workspace's own
// data. Nothing is stored; every query is scoped to req.labelId. Role gates
// mirror the pages each alert links to (approvals/contracts are privileged).
router.get('/', async (req, res) => {
  try {
    const isApprover = ['Superadmin', 'Admin', 'Approver'].includes(req.user.role);
    const isAdmin = ['Superadmin', 'Admin'].includes(req.user.role);
    const incomplete = CHECKLIST_COLS.map(c => `${c} = FALSE`).join(' OR ');

    const queries = [
      // Upcoming releases (next 21 days) with an incomplete prep checklist.
      pool.query(
        `SELECT r.id, r.project_name, r.release_date, a.name AS artist_name
         FROM releases r
         LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
         WHERE r.label_id = $1 AND r.status != 'Archived'
           AND r.release_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '21 days'
           AND (${incomplete})
         ORDER BY r.release_date ASC LIMIT 25`,
        [req.labelId]
      ),
      // The caller's own tasks that are overdue or due within 3 days.
      pool.query(
        `SELECT id, description, due_date, priority FROM tasks
         WHERE label_id = $1 AND user_id = $2 AND status != 'Done' AND due_date IS NOT NULL
           AND due_date <= CURRENT_DATE + INTERVAL '3 days'
         ORDER BY due_date ASC LIMIT 25`,
        [req.labelId, req.user.id]
      ),
    ];
    if (isAdmin) {
      queries.push(pool.query(
        `SELECT c.id, c.type, c.expiration_date, a.name AS artist_name
         FROM contracts c
         LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
         WHERE c.label_id = $1 AND c.status = 'Active' AND c.expiration_date IS NOT NULL
           AND c.expiration_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days'
         ORDER BY c.expiration_date ASC LIMIT 25`,
        [req.labelId]
      ));
    }
    if (isApprover) {
      queries.push(pool.query(
        `SELECT id, payee, amount, currency, vendor_submitted FROM expenses
         WHERE label_id = $1 AND status = 'pending' AND (deleted = false OR deleted IS NULL)
         ORDER BY created_at DESC LIMIT 25`,
        [req.labelId]
      ));
    }

    // Unread persisted @mentions for the caller (everyone).
    queries.push(pool.query(
      `SELECT m.id, m.snippet, m.link, m.created_at, u.name AS actor_name
         FROM user_mentions m LEFT JOIN users u ON u.id = m.actor_id AND u.label_id = m.label_id
        WHERE m.label_id = $1 AND m.mentioned_user_id = $2 AND m.read_at IS NULL
        ORDER BY m.created_at DESC LIMIT 25`,
      [req.labelId, req.user.id]
    ));

    const results = await Promise.all(queries);
    const releases = results[0].rows;
    const tasks = results[1].rows;
    let idx = 2;
    const contracts = isAdmin ? results[idx++].rows : [];
    const approvals = isApprover ? results[idx++].rows : [];
    const mentions = results[idx++].rows;

    const fmt = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString()}`;
    const items = [];
    for (const r of releases) {
      items.push({ type: 'release', key: `release-${r.id}`, title: [r.artist_name, r.project_name].filter(Boolean).join(' — '), detail: 'Checklist incomplete', date: r.release_date, link: `/releases/${r.id}`, severity: 'warning' });
    }
    for (const t of tasks) {
      const overdue = new Date(t.due_date) < new Date(new Date().toDateString());
      items.push({ type: 'task', key: `task-${t.id}`, title: t.description, detail: overdue ? 'Task overdue' : 'Task due soon', date: t.due_date, link: '/my-work', severity: overdue ? 'danger' : 'warning' });
    }
    for (const c of contracts) {
      items.push({ type: 'contract', key: `contract-${c.id}`, title: [c.artist_name, c.type].filter(Boolean).join(' '), detail: 'Contract expiring', date: c.expiration_date, link: '/renewals', severity: 'warning' });
    }
    for (const e of approvals) {
      items.push({ type: 'approval', key: `approval-${e.id}`, title: `${e.payee || 'Vendor'} · ${fmt(e.amount, e.currency)}`, detail: e.vendor_submitted ? 'Vendor submission' : 'Awaiting approval', date: null, link: '/ledger', severity: 'info' });
    }
    // Mentions first — they're the most personal signal.
    for (const m of mentions) {
      items.unshift({ type: 'mention', key: `mention-${m.id}`, mentionId: m.id, title: `${m.actor_name || 'Someone'} mentioned you`, detail: m.snippet, date: m.created_at, link: m.link || '/', severity: 'info' });
    }

    res.json({ success: true, data: { count: items.length, items } });
  } catch (error) {
    console.error('Notifications error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/notifications/mentions/read — mark one (by id) or all read.
router.post('/mentions/read', async (req, res) => {
  try {
    if (req.body.id) {
      await pool.query(
        'UPDATE user_mentions SET read_at = NOW() WHERE id = $1 AND mentioned_user_id = $2 AND label_id = $3',
        [parseInt(req.body.id, 10), req.user.id, req.labelId]
      );
    } else {
      await pool.query(
        'UPDATE user_mentions SET read_at = NOW() WHERE mentioned_user_id = $1 AND label_id = $2 AND read_at IS NULL',
        [req.user.id, req.labelId]
      );
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Mark mention read error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
