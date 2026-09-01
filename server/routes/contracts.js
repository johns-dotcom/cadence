const express = require('express');
const multer = require('multer');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { uploadFile, getSignedFileUrl, deleteFile } = require('../lib/r2');
const { draftClause, scanContract, isEnabled: aiEnabled } = require('../lib/claude');
const { usdOf, round2 } = require('../lib/usd');

const router = express.Router();
router.use(authMiddleware, withTenant);

// Contracts carry sensitive terms — restrict the whole surface to
// Approver/Admin/Superadmin (mirrors the admin-only contract gate in Boom).
router.use(requireApprover);

// Contract documents are PDFs only — enforced server-side on both multer
// instances (boom parity; a client check alone is bypassable).
const pdfOnly = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') cb(null, true);
  else cb(new Error('Only PDF files are allowed'), false);
};
const upload = multer({ storage: multer.memoryStorage(), fileFilter: pdfOnly, limits: { fileSize: 25 * 1024 * 1024 } });
const scanUpload = multer({ storage: multer.memoryStorage(), fileFilter: pdfOnly, limits: { fileSize: 20 * 1024 * 1024 } });

// Multer's fileFilter error surfaces as a 500 without this shim.
const pdfGate = (uploader) => (req, res, next) =>
  uploader(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message === 'Only PDF files are allowed' ? err.message : 'File upload failed' });
    next();
  });

const UPDATABLE = [
  'artist_id', 'type', 'status', 'date_signed', 'expiration_date',
  'royalty_split', 'advance', 'territory', 'num_releases', 'notes', 'financial_terms',
];

// Keep only the shape the UI edits; drop AI bookkeeping keys and cap rows.
function cleanTerms(terms) {
  if (!Array.isArray(terms)) return [];
  return terms.slice(0, 50)
    .map(t => ({
      label: String(t?.label || '').trim().slice(0, 200),
      amount: t?.amount == null ? null : (typeof t.amount === 'number' ? t.amount : String(t.amount).trim().slice(0, 100)),
      recoupable: !!t?.recoupable,
      note: t?.note ? String(t.note).trim().slice(0, 500) : null,
    }))
    .filter(t => t.label || (t.amount !== null && t.amount !== ''));
}

const numOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// POST /api/contracts/draft-clause — AI-assisted clause drafting. Degrades
// gracefully (503 with a clear message) when no ANTHROPIC_API_KEY is set.
router.post('/draft-clause', async (req, res) => {
  try {
    const { kind, context } = req.body || {};
    if (!kind || !String(kind).trim()) return res.status(400).json({ success: false, error: 'Clause kind is required' });
    if (!aiEnabled()) return res.status(503).json({ success: false, error: 'AI drafting is not configured on this workspace.' });
    const result = await draftClause({ kind: String(kind).trim(), context });
    if (!result.ok) return res.status(502).json({ success: false, error: result.error || 'Drafting failed' });
    res.json({ success: true, data: { text: result.text } });
  } catch (error) {
    console.error('Draft clause error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/contracts/scan — extract fields from a contract PDF via Claude.
// Parses only — the client holds the File and attaches it after create via
// POST /:id/files.
router.post('/scan', pdfGate(scanUpload.single('file')), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    if (!aiEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'Contract scanning requires ANTHROPIC_API_KEY to be configured.',
        setup_required: true,
      });
    }
    const result = await scanContract({ buffer: req.file.buffer, mimeType: req.file.mimetype });
    if (!result.ok) {
      return res.status(result.limitReached ? 429 : 502).json({ success: false, error: result.error || 'Contract scan failed' });
    }
    const extracted = result.data || {};
    if (!Array.isArray(extracted.financial_obligations)) extracted.financial_obligations = [];
    // Clamp confidence values to the documented enum so a hallucinated
    // "very-high" doesn't trip the client's chip-rendering logic.
    if (!extracted._confidence || typeof extracted._confidence !== 'object') extracted._confidence = {};
    const VALID_CONF = new Set(['high', 'medium', 'low']);
    for (const k of Object.keys(extracted._confidence)) {
      if (!VALID_CONF.has(extracted._confidence[k])) delete extracted._confidence[k];
    }
    extracted.financial_obligations = extracted.financial_obligations.map(o => ({
      ...o,
      _confidence: VALID_CONF.has(o?._confidence) ? o._confidence : undefined,
    }));
    res.json({ success: true, data: extracted });
  } catch (error) {
    console.error('Contract scan error:', error);
    res.status(500).json({ success: false, error: 'Contract scan failed' });
  }
});

// Reusable per-contract file roll-up (count + latest upload metadata) so the
// list can show the Doc preview cell without N+1 fetches. Label-scoped.
const FILE_SUBQUERIES = `
  (SELECT COUNT(*)::int FROM entity_files ef
    WHERE ef.label_id = c.label_id AND ef.entity_type = 'contract' AND ef.entity_id = c.id) AS file_count,
  (SELECT ef.id FROM entity_files ef
    WHERE ef.label_id = c.label_id AND ef.entity_type = 'contract' AND ef.entity_id = c.id
    ORDER BY ef.created_at DESC, ef.id DESC LIMIT 1) AS latest_file_id,
  (SELECT ef.original_name FROM entity_files ef
    WHERE ef.label_id = c.label_id AND ef.entity_type = 'contract' AND ef.entity_id = c.id
    ORDER BY ef.created_at DESC, ef.id DESC LIMIT 1) AS latest_file_name`;

// GET /api/contracts — contracts for the label, with artist name, per-row file
// roll-up, and optional ?artist= (name search) / ?type= / ?status= filters.
// Ordered by expiration ASC (renewal urgency first — boom parity).
router.get('/', async (req, res) => {
  try {
    const { artist, type, status } = req.query;
    let query = `
      SELECT c.*, a.name AS artist_name, ${FILE_SUBQUERIES}
      FROM contracts c LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
      WHERE c.label_id = $1`;
    const params = [req.labelId];
    if (artist) { params.push(`%${artist}%`); query += ` AND LOWER(a.name) LIKE LOWER($${params.length})`; }
    if (type)   { params.push(type);          query += ` AND c.type = $${params.length}`; }
    if (status) { params.push(status);        query += ` AND c.status = $${params.length}`; }
    query += ' ORDER BY c.expiration_date ASC NULLS LAST, c.id DESC';
    const { rows } = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List contracts error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/contracts/missing — three buckets of contract hygiene issues:
// artists with releases but no contract, contracts with no uploaded document,
// and expired contracts with no active same-type replacement.
router.get('/missing', async (req, res) => {
  try {
    const [noContract, noFile, expired] = await Promise.all([
      pool.query(
        `SELECT a.id, a.name, a.genre, COUNT(r.id)::int AS release_count,
                MIN(r.release_date) AS first_release, MAX(r.release_date) AS latest_release
           FROM artists a
           JOIN releases r ON r.artist_id = a.id AND r.label_id = a.label_id
                          AND (r.archived IS NULL OR r.archived = FALSE)
           LEFT JOIN contracts c ON c.artist_id = a.id AND c.label_id = a.label_id
          WHERE a.label_id = $1 AND (a.archived IS NULL OR a.archived = FALSE) AND c.id IS NULL
          GROUP BY a.id, a.name, a.genre
          ORDER BY release_count DESC`,
        [req.labelId]
      ),
      pool.query(
        `SELECT c.id AS contract_id, COALESCE(a.name, '(unassigned)') AS artist_name, c.type, c.status,
                c.date_signed, c.expiration_date
           FROM contracts c
           LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
          WHERE c.label_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM entity_files ef
               WHERE ef.label_id = c.label_id AND ef.entity_type = 'contract' AND ef.entity_id = c.id)
          ORDER BY a.name NULLS LAST, c.type`,
        [req.labelId]
      ),
      pool.query(
        `SELECT a.id, a.name, c.type, c.expiration_date
           FROM contracts c
           JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
          WHERE c.label_id = $1 AND c.status = 'Expired'
            AND NOT EXISTS (
              SELECT 1 FROM contracts c2
               WHERE c2.label_id = c.label_id AND c2.artist_id = c.artist_id
                 AND c2.type = c.type AND c2.status = 'Active')
          ORDER BY c.expiration_date DESC`,
        [req.labelId]
      ),
    ]);
    res.json({
      success: true,
      data: { noContract: noContract.rows, noFile: noFile.rows, expiredUnreplaced: expired.rows },
    });
  } catch (error) {
    console.error('Get missing contracts error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/contracts/expiring — active contracts expiring within 90 days,
// with a computed days_until_expiry for the color buckets.
router.get('/expiring', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, a.name AS artist_name, ${FILE_SUBQUERIES},
              (c.expiration_date - CURRENT_DATE) AS days_until_expiry
         FROM contracts c LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
        WHERE c.label_id = $1
          AND c.expiration_date IS NOT NULL
          AND c.expiration_date >= CURRENT_DATE
          AND c.expiration_date <= CURRENT_DATE + INTERVAL '90 days'
          AND c.status = 'Active'
        ORDER BY c.expiration_date ASC`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Get expiring contracts error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/contracts/renewals — active contracts expiring within N days
// (default 90). Consumer is the Renewals page — shape unchanged.
router.get('/renewals', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 90, 365);
    const { rows } = await pool.query(
      `SELECT c.*, a.name AS artist_name
       FROM contracts c LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
       WHERE c.label_id = $1
         AND c.expiration_date IS NOT NULL
         AND c.status = 'Active'
         AND c.expiration_date <= CURRENT_DATE + ($2 || ' days')::interval
       ORDER BY c.expiration_date ASC`,
      [req.labelId, String(days)]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Renewals error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/contracts/:id/linked — every dashboard-side number we can pin to
// this contract: releases, expenses (with recoupment breakdown) and income.
// Releases/income join on artist_id; ledger expenses join on the artist NAME
// (the ledger has no artist FK — case-insensitive trim match). Money is
// USD-converted per row via lib/usd (locked fx_rate_to_usd always wins) and
// rounded at the row. Leaf rows only (children when split, else the parent) —
// cadence's canonical per-artist slicing, so a split invoice counts once.
router.get('/:id(\\d+)/linked', async (req, res) => {
  try {
    const { rows: contractRows } = await pool.query(
      `SELECT c.id, c.artist_id, c.date_signed, c.expiration_date, a.name AS artist_name
         FROM contracts c LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
        WHERE c.id = $1 AND c.label_id = $2`,
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!contractRows.length) return res.status(404).json({ success: false, error: 'Contract not found' });
    const { artist_id, artist_name, date_signed, expiration_date } = contractRows[0];

    const EMPTY = {
      releases: { total: 0, during_term: 0, recent: [] },
      expenses: { count: 0, total: 0, recoupable_total: 0, recoupable_count: 0, ufr_total: 0, ufr_count: 0, unpaid_total: 0, unpaid_count: 0, by_category: [] },
      income: { total: 0, during_term: 0, by_type: [] },
    };
    if (!artist_id) return res.json({ success: true, data: EMPTY });

    const termStart = date_signed || '1900-01-01';
    const termEnd = expiration_date || '2999-12-31';

    const [releaseTotals, recentReleases, expenseRows, incomeRows] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total,
                COALESCE(SUM(CASE WHEN release_date BETWEEN $3 AND $4 THEN 1 ELSE 0 END), 0)::int AS during_term
           FROM releases
          WHERE label_id = $1 AND artist_id = $2 AND (archived IS NULL OR archived = FALSE)`,
        [req.labelId, artist_id, termStart, termEnd]
      ),
      pool.query(
        `SELECT id, project_name, release_date, status
           FROM releases
          WHERE label_id = $1 AND artist_id = $2 AND (archived IS NULL OR archived = FALSE)
          ORDER BY release_date DESC NULLS LAST LIMIT 5`,
        [req.labelId, artist_id]
      ),
      pool.query(
        `SELECT e.amount, e.currency, e.fx_rate_to_usd, e.recoupable, e.ufr,
                e.payment_status, e.category
           FROM expenses e
          WHERE e.label_id = $1
            AND LOWER(TRIM(e.artist)) = LOWER(TRIM($2))
            AND COALESCE(e.status, 'approved') = 'approved'
            AND (e.deleted IS NULL OR e.deleted = FALSE)
            AND NOT EXISTS (SELECT 1 FROM expenses ch WHERE ch.parent_id = e.id
                              AND (ch.deleted IS NULL OR ch.deleted = FALSE))`,
        [req.labelId, artist_name]
      ),
      pool.query(
        `SELECT amount, currency, source, income_date
           FROM artist_income
          WHERE label_id = $1 AND artist_id = $2`,
        [req.labelId, artist_id]
      ),
    ]);

    const exp = { count: 0, total: 0, recoupable_total: 0, recoupable_count: 0, ufr_total: 0, ufr_count: 0, unpaid_total: 0, unpaid_count: 0 };
    const byCategory = new Map();
    for (const r of expenseRows.rows) {
      const usd = round2(usdOf(r.amount, r.currency, r.fx_rate_to_usd));
      exp.count += 1; exp.total += usd;
      if (r.recoupable) { exp.recoupable_total += usd; exp.recoupable_count += 1; }
      if (r.ufr) { exp.ufr_total += usd; exp.ufr_count += 1; }
      if (r.payment_status !== 'Paid') { exp.unpaid_total += usd; exp.unpaid_count += 1; }
      if (r.category) {
        const cur = byCategory.get(r.category) || { category: r.category, total: 0, count: 0 };
        cur.total += usd; cur.count += 1;
        byCategory.set(r.category, cur);
      }
    }
    for (const k of ['total', 'recoupable_total', 'ufr_total', 'unpaid_total']) exp[k] = round2(exp[k]);

    const inc = { total: 0, during_term: 0 };
    const byType = new Map();
    for (const r of incomeRows.rows) {
      const usd = round2(usdOf(r.amount, r.currency, null));
      inc.total += usd;
      const d = r.income_date ? String(r.income_date).slice(0, 10) : null;
      if (d && d >= String(termStart).slice(0, 10) && d <= String(termEnd).slice(0, 10)) inc.during_term += usd;
      const type = r.source || 'Other';
      const cur = byType.get(type) || { income_type: type, total: 0 };
      cur.total += usd;
      byType.set(type, cur);
    }

    res.json({
      success: true,
      data: {
        releases: {
          total: releaseTotals.rows[0].total || 0,
          during_term: releaseTotals.rows[0].during_term || 0,
          recent: recentReleases.rows,
        },
        expenses: {
          ...exp,
          by_category: [...byCategory.values()].sort((a, b) => b.total - a.total).slice(0, 6)
            .map(c => ({ ...c, total: round2(c.total) })),
        },
        income: {
          total: round2(inc.total),
          during_term: round2(inc.during_term),
          by_type: [...byType.values()].sort((a, b) => b.total - a.total).slice(0, 6)
            .map(t => ({ ...t, total: round2(t.total) })),
        },
      },
    });
  } catch (error) {
    console.error('Get contract linked-data error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/contracts/:id — single contract (+ a short-lived signed URL for the
// legacy single-slot file, kept for older callers).
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, a.name AS artist_name, ${FILE_SUBQUERIES}
       FROM contracts c LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
       WHERE c.id = $1 AND c.label_id = $2`,
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Contract not found' });
    const contract = rows[0];
    if (contract.r2_key) {
      try { contract.file_url = await getSignedFileUrl(contract.r2_key, 3600); } catch { contract.file_url = null; }
    }
    res.json({ success: true, data: contract });
  } catch (error) {
    console.error('Get contract error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/contracts
// NOTE: artist_id stays optional server-side — the Pending Contracts promote
// flow creates artist-less rows. The Contracts page itself requires
// artist + type before enabling Create (boom parity).
router.post('/', async (req, res) => {
  try {
    const { type } = req.body;
    if (!type || !type.trim()) return res.status(400).json({ success: false, error: 'Contract type is required' });

    if (req.body.artist_id) {
      const { rows: a } = await pool.query('SELECT 1 FROM artists WHERE id = $1 AND label_id = $2', [req.body.artist_id, req.labelId]);
      if (!a.length) return res.status(400).json({ success: false, error: 'Artist not found in this workspace' });
    }

    const { rows } = await pool.query(
      `INSERT INTO contracts (label_id, artist_id, type, status, date_signed, expiration_date,
        royalty_split, advance, territory, num_releases, notes, financial_terms, created_at, updated_at)
       VALUES ($1,$2,$3,COALESCE($4,'Active'),$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
       RETURNING *`,
      [
        req.labelId, req.body.artist_id || null, type.trim(), req.body.status || null,
        req.body.date_signed || null, req.body.expiration_date || null,
        numOrNull(req.body.royalty_split), req.body.advance || null, req.body.territory || null,
        req.body.num_releases || null, req.body.notes || null,
        JSON.stringify(cleanTerms(req.body.financial_terms)),
      ]
    );
    await logActivity(req, 'Created contract', `${type} #${rows[0].id}`);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create contract error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/contracts/:id
router.patch('/:id(\\d+)', async (req, res) => {
  try {
    if (req.body.artist_id) {
      const { rows: a } = await pool.query('SELECT 1 FROM artists WHERE id = $1 AND label_id = $2', [req.body.artist_id, req.labelId]);
      if (!a.length) return res.status(400).json({ success: false, error: 'Artist not found in this workspace' });
    }
    const keys = Object.keys(req.body).filter(k => UPDATABLE.includes(k));
    if (keys.length === 0) return res.status(400).json({ success: false, error: 'No updatable fields provided' });

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => {
      if (k === 'financial_terms') return JSON.stringify(cleanTerms(req.body[k]));
      if (k === 'royalty_split') return numOrNull(req.body[k]);
      return req.body[k] === '' ? null : req.body[k];
    });
    values.push(parseInt(req.params.id, 10), req.labelId);

    const { rows } = await pool.query(
      `UPDATE contracts SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Contract not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update contract error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Contract documents (entity_files — multi-file with revision history) ──

// POST /api/contracts/:id/files — upload a document (PDF, R2). Also keeps the
// legacy single-slot columns pointed at the newest upload for older callers.
router.post('/:id(\\d+)/files', pdfGate(upload.single('file')), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    const id = parseInt(req.params.id, 10);
    const owner = await pool.query('SELECT 1 FROM contracts WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!owner.rows.length) return res.status(404).json({ success: false, error: 'Contract not found' });

    const safe = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `label-${req.labelId}/contracts/${id}-${Date.now()}-${safe}`;
    await uploadFile(key, req.file.buffer, req.file.mimetype);

    const { rows } = await pool.query(
      `INSERT INTO entity_files (label_id, entity_type, entity_id, filename, original_name, mime_type, r2_key, file_size, uploaded_by)
       VALUES ($1, 'contract', $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, original_name, mime_type, file_size, created_at`,
      [req.labelId, id, key, req.file.originalname, req.file.mimetype, key, req.file.size, req.user?.id || null]
    );
    // Legacy single-slot columns track the latest upload (no delete — the
    // revision history in entity_files is the point).
    await pool.query(
      'UPDATE contracts SET file_name = $1, r2_key = $2, updated_at = NOW() WHERE id = $3 AND label_id = $4',
      [req.file.originalname, key, id, req.labelId]
    );
    await logActivity(req, 'Uploaded contract file', `contract #${id}`);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Contract file upload error:', error);
    res.status(500).json({ success: false, error: 'File upload failed' });
  }
});

// GET /api/contracts/:id/files — metadata only (newest first).
router.get('/:id(\\d+)/files', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ef.id, ef.original_name, ef.mime_type, ef.file_size, ef.created_at,
              u.name AS uploaded_by_name
         FROM entity_files ef
         LEFT JOIN users u ON u.id = ef.uploaded_by
        WHERE ef.label_id = $1 AND ef.entity_type = 'contract' AND ef.entity_id = $2
        ORDER BY ef.created_at DESC, ef.id DESC`,
      [req.labelId, parseInt(req.params.id, 10)]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List contract files error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/contracts/:id/files/:fileId — short-lived signed URL.
router.get('/:id(\\d+)/files/:fileId(\\d+)', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r2_key FROM entity_files
        WHERE id = $1 AND label_id = $2 AND entity_type = 'contract' AND entity_id = $3`,
      [parseInt(req.params.fileId, 10), req.labelId, parseInt(req.params.id, 10)]
    );
    if (!rows.length || !rows[0].r2_key) return res.status(404).json({ success: false, error: 'File not found' });
    const url = await getSignedFileUrl(rows[0].r2_key, 3600);
    res.json({ success: true, data: { url } });
  } catch (error) {
    console.error('Contract file url error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/contracts/:id/files/:fileId
router.delete('/:id(\\d+)/files/:fileId(\\d+)', async (req, res) => {
  try {
    const contractId = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      `DELETE FROM entity_files
        WHERE id = $1 AND label_id = $2 AND entity_type = 'contract' AND entity_id = $3
        RETURNING r2_key`,
      [parseInt(req.params.fileId, 10), req.labelId, contractId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'File not found' });
    if (rows[0].r2_key) deleteFile(rows[0].r2_key).catch(() => {});
    // Re-point the legacy single-slot columns at whatever upload remains.
    const { rows: latest } = await pool.query(
      `SELECT original_name, r2_key FROM entity_files
        WHERE label_id = $1 AND entity_type = 'contract' AND entity_id = $2
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [req.labelId, contractId]
    );
    await pool.query(
      'UPDATE contracts SET file_name = $1, r2_key = $2, updated_at = NOW() WHERE id = $3 AND label_id = $4',
      [latest[0]?.original_name || null, latest[0]?.r2_key || null, contractId, req.labelId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Delete contract file error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/contracts/:id — removes the contract row and every attached
// document (entity_files rows first, then best-effort R2 cleanup).
router.delete('/:id(\\d+)', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query('SELECT type, r2_key FROM contracts WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Contract not found' });

    const { rows: files } = await pool.query(
      `SELECT r2_key FROM entity_files WHERE label_id = $1 AND entity_type = 'contract' AND entity_id = $2`,
      [req.labelId, id]
    );
    await pool.query(`DELETE FROM entity_files WHERE label_id = $1 AND entity_type = 'contract' AND entity_id = $2`, [req.labelId, id]);
    await pool.query('DELETE FROM contracts WHERE id = $1 AND label_id = $2', [id, req.labelId]);

    // Best-effort R2 cleanup — the DB rows are already gone, so an orphan key
    // is cheaper than failing a delete the user has confirmed.
    const keys = new Set(files.map(f => f.r2_key).filter(Boolean));
    if (rows[0].r2_key) keys.add(rows[0].r2_key);
    for (const key of keys) deleteFile(key).catch(() => {});

    await logActivity(req, 'Deleted contract', `${rows[0].type} #${id}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete contract error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
