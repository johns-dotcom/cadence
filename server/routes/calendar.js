const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');

const router = express.Router();
router.use(authMiddleware, withTenant);

// GET /api/calendar — a unified event feed for the workspace: release dates,
// task due dates, contract signed/expiry dates (admin only) and manual events.
// Every source query is scoped to req.labelId.
router.get('/', async (req, res) => {
  try {
    const isAdmin = ['Superadmin', 'Admin'].includes(req.user.role);
    const [releases, tasks, events, signed, expiring, dspLive] = await Promise.all([
      pool.query(
        `SELECT r.id, r.project_name, r.release_date, a.name AS artist_name
         FROM releases r
         LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
         WHERE r.label_id = $1 AND r.release_date IS NOT NULL AND r.status != 'Archived'`,
        [req.labelId]
      ),
      pool.query(
        `SELECT id, description, due_date FROM tasks
         WHERE label_id = $1 AND due_date IS NOT NULL AND status != 'Done'`,
        [req.labelId]
      ),
      pool.query(
        `SELECT id, title, event_date, description, color FROM calendar_events WHERE label_id = $1`,
        [req.labelId]
      ),
      isAdmin
        ? pool.query(
            `SELECT c.id, c.type, c.date_signed, a.name AS artist_name FROM contracts c
             LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
             WHERE c.label_id = $1 AND c.date_signed IS NOT NULL`,
            [req.labelId]
          )
        : Promise.resolve({ rows: [] }),
      isAdmin
        ? pool.query(
            `SELECT c.id, c.type, c.expiration_date, a.name AS artist_name FROM contracts c
             LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
             WHERE c.label_id = $1 AND c.expiration_date IS NOT NULL AND c.status = 'Active'`,
            [req.labelId]
          )
        : Promise.resolve({ rows: [] }),
      // DSP go-live dates.
      pool.query(
        `SELECT d.id, d.platform, d.live_date, r.project_name, r.id AS release_id
         FROM dsp_submissions d JOIN releases r ON r.id = d.release_id AND r.label_id = d.label_id
         WHERE d.label_id = $1 AND d.live_date IS NOT NULL`,
        [req.labelId]
      ),
    ]);

    const evs = [];
    for (const r of releases.rows) {
      evs.push({ kind: 'release', id: `release-${r.id}`, title: [r.artist_name, r.project_name].filter(Boolean).join(' — '), date: r.release_date, link: `/releases/${r.id}` });
    }
    for (const t of tasks.rows) {
      evs.push({ kind: 'task', id: `task-${t.id}`, title: t.description, date: t.due_date, link: '/my-work' });
    }
    for (const c of signed.rows) {
      evs.push({ kind: 'contract_signed', id: `csign-${c.id}`, title: `Signed: ${[c.artist_name, c.type].filter(Boolean).join(' ')}`, date: c.date_signed, link: '/contracts' });
    }
    for (const c of expiring.rows) {
      evs.push({ kind: 'contract_expiry', id: `cexp-${c.id}`, title: `Expires: ${[c.artist_name, c.type].filter(Boolean).join(' ')}`, date: c.expiration_date, link: '/renewals' });
    }
    for (const d of dspLive.rows) {
      evs.push({ kind: 'dsp', id: `dsp-${d.id}`, title: `${d.platform} live: ${d.project_name}`, date: d.live_date, link: `/releases/${d.release_id}` });
    }
    for (const e of events.rows) {
      evs.push({ kind: 'event', id: `event-${e.id}`, eventId: e.id, title: e.title, date: e.event_date, description: e.description, color: e.color });
    }

    res.json({ success: true, data: evs });
  } catch (error) {
    console.error('Calendar error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/calendar — create a manual event for this workspace.
router.post('/', async (req, res) => {
  try {
    const { title, event_date } = req.body;
    if (!title || !title.trim() || !event_date) {
      return res.status(400).json({ success: false, error: 'Title and date are required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO calendar_events (label_id, title, event_date, description, color, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.labelId, title.trim(), event_date, req.body.description || null, req.body.color || null, req.user.id]
    );
    await logActivity(req, 'Added calendar event', title.trim());
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/calendar/:id — edit a manual event.
router.patch('/:id', async (req, res) => {
  try {
    const fields = ['title', 'event_date', 'description', 'color'];
    const keys = Object.keys(req.body).filter(k => fields.includes(k));
    if (!keys.length) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => req.body[k]);
    values.push(parseInt(req.params.id, 10), req.labelId);
    const { rows } = await pool.query(
      `UPDATE calendar_events SET ${setClauses.join(', ')}
       WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Event not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/calendar/:id — remove a manual event.
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM calendar_events WHERE id = $1 AND label_id = $2',
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'Event not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
