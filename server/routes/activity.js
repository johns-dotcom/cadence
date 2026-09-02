const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');

const router = express.Router();
router.use(authMiddleware, withTenant);

/**
 * Category buckets over a FREE-TEXT action vocabulary.
 *
 * boom could filter with exact `action IN (...)` lists because its ~40 action
 * strings were a closed set. Cadence logs 150+ and gains more every phase, so
 * an IN-list would silently stop matching the moment somebody wrote a new
 * string — the filter would look like it worked and quietly hide events.
 * Keyword patterns instead: a future "Approved <whatever>" lands in Finance
 * with nobody updating a list.
 *
 * Matching is inclusive (an event can satisfy two buckets). The per-row icon
 * on the client uses a PRECEDENCE-ordered classifier instead, because a row
 * can only wear one chip — same split boom had.
 */
const CATEGORY_PATTERNS = {
  auth: ['%sign%', '%invite%', '%password%', '%impersonat%', '%logged in%'],
  releases: ['%release%', '%dsp%', '%catalog%', '%checklist%'],
  artists: ['%artist%', '%campaign%', '%roster%'],
  contracts: ['%contract%', '%nda%', '%waiver%', '%clearance%', '%admin document%', '%legal%'],
  deals: ['%deal%'],
  team: ['%team member%', '%task%', '%employee%', '% rep%', '%permission%', '%salary%', '%department%'],
  financials: [
    '%invoice%', '%ledger%', '%payment%', '%paid%', '%vendor%', '%expense%',
    '%bank%', '%statement%', '%budget%', '%recoup%', '%income%', '%report%',
    '%creator%', '%w9%', '%approv%', '%reject%', '%split%', '%categor%',
    '%spend%', '%export%', '%import%', '%fx%',
  ],
};

const SORTABLE = { asc: 'ASC', desc: 'DESC' };

// GET /api/activity — filterable, paginated audit trail for this label (admins).
// Params: user_id, category, from, to, search, methods, department, sort, page, limit
router.get('/', requireAdmin, async (req, res) => {
  try {
    const {
      user_id, category, from, to, search, methods, department,
      sort = 'desc', page = '1',
    } = req.query;

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (pageNum - 1) * limit;

    // $1 is always the label — every branch below appends after it.
    const params = [req.labelId];
    const conditions = ['al.label_id = $1'];

    if (user_id && user_id !== 'all') {
      const uid = parseInt(user_id, 10);
      // A NaN would reach Postgres as the literal "NaN" and 500 the request.
      if (Number.isInteger(uid)) {
        params.push(uid);
        conditions.push(`al.user_id = $${params.length}`);
      }
    }

    if (from) {
      params.push(from);
      conditions.push(`al.created_at >= $${params.length}::timestamptz`);
    }
    if (to) {
      // Inclusive of the whole "to" day.
      params.push(to);
      conditions.push(`al.created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }

    if (category && category !== 'all' && CATEGORY_PATTERNS[category]) {
      params.push(CATEGORY_PATTERNS[category]);
      conditions.push(`al.action ILIKE ANY($${params.length}::text[])`);
    }

    if (methods && String(methods).trim()) {
      const list = String(methods).split(',').map(m => m.trim().toUpperCase()).filter(Boolean);
      if (list.length) {
        params.push(list);
        conditions.push(`al.method = ANY($${params.length}::text[])`);
      }
    }

    if (department && department !== 'all') {
      params.push(department);
      conditions.push(`u.department = $${params.length}`);
    }

    if (search && String(search).trim()) {
      params.push(`%${String(search).trim().toLowerCase()}%`);
      const p = `$${params.length}`;
      conditions.push(
        `(LOWER(al.action) LIKE ${p} OR LOWER(COALESCE(al.detail, '')) LIKE ${p}
          OR LOWER(COALESCE(al.entry_payee, '')) LIKE ${p}
          OR LOWER(COALESCE(u.name, '')) LIKE ${p} OR LOWER(COALESCE(u.email, '')) LIKE ${p})`
      );
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const orderDir = SORTABLE[String(sort).toLowerCase()] || 'DESC';
    // The user join is label-constrained so a filter can never reach across tenants.
    const joined = `FROM activity_log al
       LEFT JOIN users u ON u.id = al.user_id AND u.label_id = al.label_id
       ${where}`;

    const dataParams = [...params, limit, offset];
    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT al.id, al.action, al.detail, al.ip_address, al.method, al.endpoint,
                al.entry_id, al.entry_payee, al.created_at,
                u.id AS user_id, u.name AS user_name, u.email AS user_email,
                u.role, u.department
         ${joined}
         ORDER BY al.created_at ${orderDir}, al.id ${orderDir}
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams
      ),
      pool.query(`SELECT COUNT(*)::int AS n ${joined}`, params),
    ]);

    res.json({
      success: true,
      data: dataRes.rows,
      total: countRes.rows[0]?.n || 0,
      page: pageNum,
      limit,
    });
  } catch (error) {
    console.error('Activity error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/activity/users — distinct actors in this label's trail, for the
// filter dropdown. Only people who actually appear, so the list stays short.
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT u.id, u.name, u.department, u.role
       FROM activity_log al
       JOIN users u ON u.id = al.user_id AND u.label_id = al.label_id
       WHERE al.label_id = $1
       ORDER BY u.name ASC`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Activity users error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
