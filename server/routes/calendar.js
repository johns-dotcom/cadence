const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');

const router = express.Router();
router.use(authMiddleware, withTenant);

// The feed is a UNION of six independent sources. Run each behind safeQuery:
// one missing column or one slow table should cost the calendar that bucket,
// not the whole month. Without it a single failure 500s a page whose other
// five feeds were fine.
async function safeQuery(label, sql, params) {
  try {
    return await pool.query(sql, params);
  } catch (err) {
    console.error(`Calendar source "${label}" failed:`, err.message);
    return { rows: [], failed: true };
  }
}

// Normalize a pg DATE (or timestamp) to 'YYYY-MM-DD' without a TZ round-trip.
// `new Date(d).toISOString()` shifts the day for anything east of UTC; reading
// the local parts off the Date pg already built keeps the calendar day intact.
function d(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// GET /api/calendar — unified event feed for the workspace.
// Every source query is scoped to req.labelId.
router.get('/', async (req, res) => {
  try {
    // Contract dates carry deal terms, so they are role-gated — but Approver is
    // inside the gate: an approver signs off on the money those contracts
    // govern and cannot do that blind to renewal dates.
    const canSeeContracts = ['Superadmin', 'Admin', 'Approver'].includes(req.user.role);

    const [releases, tasks, events, signed, expiring, dsp] = await Promise.all([
      safeQuery('releases',
        `SELECT r.id, r.project_name, r.release_date, r.release_type, a.name AS artist_name
         FROM releases r
         LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
         WHERE r.label_id = $1 AND r.release_date IS NOT NULL AND r.status != 'Archived'`,
        [req.labelId]
      ),
      // Own tasks only. A workspace-wide task feed turns every teammate's due
      // dates into your calendar noise, and exposes work assigned outside your
      // department — the task surface itself gates that by department.
      safeQuery('tasks',
        `SELECT t.id, t.description, t.due_date, t.priority, u.name AS assignee
           FROM tasks t
           LEFT JOIN users u ON u.id = t.user_id AND u.label_id = t.label_id
          WHERE t.label_id = $1 AND t.user_id = $2
            AND t.due_date IS NOT NULL AND t.status != 'Done'`,
        [req.labelId, req.user.id]
      ),
      safeQuery('events',
        `SELECT id, title, event_date, description, color, event_type FROM calendar_events WHERE label_id = $1`,
        [req.labelId]
      ),
      canSeeContracts
        ? safeQuery('contracts_signed',
            `SELECT c.id, c.type, c.date_signed, a.name AS artist_name FROM contracts c
             LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
             WHERE c.label_id = $1 AND c.date_signed IS NOT NULL`,
            [req.labelId]
          )
        : Promise.resolve({ rows: [] }),
      canSeeContracts
        ? safeQuery('contracts_expiring',
            `SELECT c.id, c.type, c.expiration_date, a.name AS artist_name FROM contracts c
             LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
             WHERE c.label_id = $1 AND c.expiration_date IS NOT NULL AND c.status = 'Active'`,
            [req.labelId]
          )
        : Promise.resolve({ rows: [] }),
      // BOTH DSP milestones. `submitted_date` is stored and is the date the
      // release-tracker actually chases; feeding only `live_date` hid half the
      // distribution timeline.
      safeQuery('dsp',
        `SELECT d.id, d.platform, d.live_date, d.submitted_date, d.status,
                r.project_name, r.id AS release_id
         FROM dsp_submissions d JOIN releases r ON r.id = d.release_id AND r.label_id = d.label_id
         WHERE d.label_id = $1 AND (d.live_date IS NOT NULL OR d.submitted_date IS NOT NULL)`,
        [req.labelId]
      ),
    ]);

    const evs = [];
    for (const r of releases.rows) {
      evs.push({
        kind: 'release', id: `release-${r.id}`,
        title: r.project_name,
        subtitle: r.artist_name || null,
        meta: r.release_type || null,
        date: d(r.release_date), link: `/releases/${r.id}`,
      });
    }
    for (const t of tasks.rows) {
      evs.push({
        kind: 'task', id: `task-${t.id}`,
        title: t.description,
        subtitle: t.assignee ? `Assigned to ${t.assignee}` : null,
        meta: t.priority || null,
        date: d(t.due_date), link: '/my-work',
      });
    }
    for (const c of signed.rows) {
      evs.push({
        kind: 'contract_signed', id: `csign-${c.id}`,
        title: `${c.artist_name || 'Contract'} — signed`,
        subtitle: c.type || null,
        date: d(c.date_signed), link: '/contracts',
      });
    }
    for (const c of expiring.rows) {
      evs.push({
        kind: 'contract_expiry', id: `cexp-${c.id}`,
        title: `${c.artist_name || 'Contract'} — expires`,
        subtitle: c.type || null,
        date: d(c.expiration_date), link: '/renewals',
      });
    }
    for (const s of dsp.rows) {
      if (s.live_date) {
        evs.push({
          kind: 'dsp_live', id: `dsplive-${s.id}`,
          title: `${s.project_name} — live on ${s.platform}`,
          subtitle: s.platform, meta: s.status || null,
          date: d(s.live_date), link: `/releases/${s.release_id}`,
        });
      }
      if (s.submitted_date) {
        evs.push({
          kind: 'dsp_submitted', id: `dspsub-${s.id}`,
          title: `${s.project_name} — submitted to ${s.platform}`,
          subtitle: s.platform, meta: s.status || null,
          date: d(s.submitted_date), link: `/releases/${s.release_id}`,
        });
      }
    }
    for (const e of events.rows) {
      evs.push({
        kind: 'event', id: `event-${e.id}`, eventId: e.id,
        title: e.title,
        subtitle: e.event_type && e.event_type !== 'manual' ? e.event_type : null,
        date: d(e.event_date), description: e.description, color: e.color,
        event_type: e.event_type || 'manual', deletable: true,
      });
    }

    // Which buckets degraded, so the client can say "some events couldn't load"
    // rather than quietly showing a thinner month.
    const failed = [
      releases.failed && 'releases', tasks.failed && 'tasks', events.failed && 'events',
      signed.failed && 'contracts', expiring.failed && 'contracts', dsp.failed && 'dsp',
    ].filter(Boolean);

    res.json({ success: true, data: evs, degraded: [...new Set(failed)] });
  } catch (error) {
    console.error('Calendar error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const EVENT_TYPES = ['manual', 'meeting', 'deadline', 'travel', 'other'];

// POST /api/calendar — create a manual event for this workspace.
router.post('/', async (req, res) => {
  try {
    const { title, event_date } = req.body;
    if (!title || !title.trim() || !event_date) {
      return res.status(400).json({ success: false, error: 'Title and date are required' });
    }
    const eventType = req.body.event_type || 'manual';
    if (!EVENT_TYPES.includes(eventType)) {
      return res.status(400).json({ success: false, error: 'Invalid event type' });
    }
    const { rows } = await pool.query(
      `INSERT INTO calendar_events (label_id, title, event_date, description, color, event_type, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.labelId, title.trim(), event_date, req.body.description || null, req.body.color || null, eventType, req.user.id]
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
    const fields = ['title', 'event_date', 'description', 'color', 'event_type'];
    const keys = Object.keys(req.body).filter(k => fields.includes(k));
    if (!keys.length) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    if (keys.includes('event_type') && !EVENT_TYPES.includes(req.body.event_type)) {
      return res.status(400).json({ success: false, error: 'Invalid event type' });
    }
    if (keys.includes('title') && !String(req.body.title || '').trim()) {
      return res.status(400).json({ success: false, error: 'Title is required' });
    }
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => (k === 'title' ? String(req.body.title).trim() : req.body[k]));
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
