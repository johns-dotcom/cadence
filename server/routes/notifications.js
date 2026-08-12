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

    // "Clear all" watermark — computed alerts created on/before this are hidden.
    const wm = (await pool.query('SELECT notifications_cleared_at FROM users WHERE id = $1', [req.user.id])).rows[0]?.notifications_cleared_at || null;

    const queries = [
      // Upcoming releases (next 21 days) with an incomplete prep checklist.
      pool.query(
        `SELECT r.id, r.project_name, r.release_date, r.created_at, a.name AS artist_name
         FROM releases r
         LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
         WHERE r.label_id = $1 AND r.status != 'Archived'
           AND r.release_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '21 days'
           AND (${incomplete})
         ORDER BY r.release_date ASC LIMIT 25`,
        [req.labelId]
      ),
      // The caller's own tasks that are overdue or due within 3 days. `is_overdue`
      // is decided HERE, in the same query as the 3-day window, so there is one
      // rule instead of two. It used to be recomputed in JS as
      // `new Date(due_date) < new Date(new Date().toDateString())` — which compares
      // a UTC-parsed date against a locally-parsed one, so east of UTC a task due
      // today read as overdue and the bell nagged a day early.
      pool.query(
        `SELECT id, description, due_date, priority, created_at,
                (due_date < CURRENT_DATE) AS is_overdue
           FROM tasks
         WHERE label_id = $1 AND user_id = $2 AND status != 'Done' AND due_date IS NOT NULL
           AND due_date <= CURRENT_DATE + INTERVAL '3 days'
         ORDER BY due_date ASC LIMIT 25`,
        [req.labelId, req.user.id]
      ),
      // Stalled bulk deals — is_bulk_deal rows still unpaid 21+ days after entry.
      isApprover ? pool.query(
        `SELECT id, payee, amount, currency, created_at FROM expenses
         WHERE label_id = $1 AND is_bulk_deal = TRUE AND status = 'approved'
           AND payment_status IN ('Unpaid','Partial') AND (deleted = false OR deleted IS NULL) AND parent_id IS NULL
           AND created_at < NOW() - INTERVAL '21 days'
         ORDER BY created_at ASC LIMIT 25`,
        [req.labelId]
      ) : Promise.resolve({ rows: [] }),
    ];
    if (isAdmin) {
      queries.push(pool.query(
        `SELECT c.id, c.type, c.expiration_date, c.created_at, a.name AS artist_name
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
        `SELECT id, payee, amount, currency, vendor_submitted, created_at FROM expenses
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
    const bulkDeals = results[2].rows;
    let idx = 3;
    const contracts = isAdmin ? results[idx++].rows : [];
    const approvals = isApprover ? results[idx++].rows : [];
    const mentions = results[idx++].rows;

    const fmt = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString()}`;
    // A computed alert is hidden if its underlying row predates the clear-all
    // watermark. Mentions never pass through here.
    const cleared = (createdAt) => wm && createdAt && new Date(createdAt) <= new Date(wm);
    const smart = [];
    for (const r of releases) if (!cleared(r.created_at)) smart.push({ type: 'release', key: `release-${r.id}`, title: [r.artist_name, r.project_name].filter(Boolean).join(' — '), detail: 'Checklist incomplete', date: r.release_date, link: `/releases/${r.id}`, severity: 'warning' });
    for (const t of tasks) { if (cleared(t.created_at)) continue; const overdue = t.is_overdue; smart.push({ type: 'task', key: `task-${t.id}`, title: t.description, detail: overdue ? 'Task overdue' : 'Task due soon', date: t.due_date, link: '/my-work', severity: overdue ? 'danger' : 'warning' }); }
    for (const b of bulkDeals) if (!cleared(b.created_at)) smart.push({ type: 'bulk_deal', key: `bulkdeal-${b.id}`, title: `${b.payee || 'Bulk deal'} · ${fmt(b.amount, b.currency)}`, detail: 'Bulk deal stalled (21+ days unpaid)', date: b.created_at, link: `/ledger?focus=${b.id}`, severity: 'warning' });
    for (const c of contracts) if (!cleared(c.created_at)) smart.push({ type: 'contract', key: `contract-${c.id}`, title: [c.artist_name, c.type].filter(Boolean).join(' '), detail: 'Contract expiring', date: c.expiration_date, link: '/renewals', severity: 'warning' });
    for (const e of approvals) if (!cleared(e.created_at)) smart.push({ type: 'approval', key: `approval-${e.id}`, title: `${e.payee || 'Vendor'} · ${fmt(e.amount, e.currency)}`, detail: e.vendor_submitted ? 'Vendor submission' : 'Awaiting approval', date: null, link: '/ledger', severity: 'info' });

    const mentionItems = mentions.map(m => ({ type: 'mention', key: `mention-${m.id}`, mentionId: m.id, title: `${m.actor_name || 'Someone'} mentioned you`, detail: m.snippet, date: m.created_at, link: m.link || '/', severity: 'info' }));

    // Flat `items` (mentions first) kept for the bell; structured groups added
    // for the /notifications page. total_count powers the badge.
    const items = [...mentionItems, ...smart];
    res.json({ success: true, data: {
      count: items.length, total_count: items.length, items,
      mentions: mentionItems, smart_alerts: smart,
      releases: smart.filter(i => i.type === 'release'), contracts: smart.filter(i => i.type === 'contract'),
    } });
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

// POST /api/notifications/clear — watermark computed alerts as seen. Mentions
// are individually actionable and are deliberately NOT cleared here.
router.post('/clear', async (req, res) => {
  try {
    await pool.query('UPDATE users SET notifications_cleared_at = NOW() WHERE id = $1', [req.user.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Clear notifications error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
