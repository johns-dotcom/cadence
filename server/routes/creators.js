// Creator payments — small PayPal payments to influencers that never have
// invoices. A creator payment IS an `expenses` row with
// entry_source='creator_payment'. That one column buys: Recoupments and
// Artist Campaigns inclusion (they exclude bank rows, not creator rows),
// single-count in the P&L, and statement matching that records
// match_method='creator' so these never count as invoice-backed.
//
// Creator rows NEVER create `vendors` records — their directory is here, and
// its question is W9/1099 exposure per calendar YEAR, not terms and aliases.

const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { isCreatorRow, CREATOR_SOURCE, reportingThresholdFor,
  restoreMatchPlan, CREATOR_MATCH_DETAIL: MATCH_DETAIL_PREFIX } = require('../lib/ledgerSource');
const { rowUsd2, round2 } = require('../lib/usd');
const { stampFxRateAsync } = require('../lib/fxStamp');
const bankEvidence = require('../lib/bankEvidence');
const { accountsFor } = require('../lib/bankReconcile');
const activityBot = require('../lib/activityBot');

const router = express.Router();
router.use(authMiddleware, withTenant, requireApprover);

const LIVE = `e.label_id = $1 AND (e.deleted IS NULL OR e.deleted = FALSE)
  AND (e.voided IS NULL OR e.voided = FALSE) AND ${isCreatorRow('e')}`;

// One required-fields list, shared by POST and batch — the server is the gate.
const REQUIRED_FIELDS = [
  ['payee', 'creator name'], ['amount', 'amount'], ['artist', 'artist'], ['song', 'song'],
  ['vendor_email', 'email'], ['paypal_handle', 'PayPal handle'], ['social_handles', 'socials'],
];
function missingRequired(b) {
  const out = [];
  for (const [key, label] of REQUIRED_FIELDS) {
    const v = b[key];
    if (key === 'amount') { if (!(Number(v) > 0)) out.push(label); continue; }
    if (key === 'vendor_email') { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || ''))) out.push(label); continue; }
    if (key === 'social_handles') { if (!Array.isArray(v) || !v.length) out.push(label); continue; }
    if (!String(v || '').trim()) out.push(label);
  }
  return out;
}

// PAID is the default (the payment is usually made and then logged); an
// explicit Unpaid records "we owe this creator". payment_status and
// payment_date MOVE TOGETHER — Paid with no date, or a date on an unpaid
// row, reads one way to the state chip and another to every dated report.
function paidState(b) {
  const unpaid = b.payment_status === 'Unpaid' || b.paid === false;
  if (unpaid) return { payment_status: 'Unpaid', payment_date: null };
  return { payment_status: 'Paid', payment_date: String(b.payment_date || '').slice(0, 10) || new Date().toISOString().slice(0, 10) };
}

async function loadAccounts(labelId) {
  const row = (await pool.query(`SELECT bank_accounts FROM labels WHERE id = $1`, [labelId])).rows[0] || {};
  return accountsFor(row);
}

// GET /api/creators — the payments list. MUST select payment_status (omitting
// a column the client branches on once rendered every paid row as Unpaid).
router.get('/', async (req, res) => {
  try {
    const accounts = await loadAccounts(req.labelId);
    const params = [req.labelId];
    const put = (v) => { params.push(v); return `$${params.length}`; };
    let where = LIVE;
    if (req.query.artist) where += ` AND LOWER(TRIM(e.artist)) = LOWER(TRIM(${put(req.query.artist)}))`;
    if (req.query.creator) where += ` AND LOWER(TRIM(e.payee)) = LOWER(TRIM(${put(req.query.creator)}))`;
    if (req.query.from) where += ` AND COALESCE(e.payment_date, e.invoice_date) >= ${put(req.query.from)}`;
    if (req.query.to) where += ` AND COALESCE(e.payment_date, e.invoice_date) <= ${put(req.query.to)}`;
    if (req.query.q) {
      const like = put(`%${String(req.query.q).toLowerCase()}%`);
      where += ` AND (LOWER(e.payee) LIKE ${like} OR LOWER(COALESCE(e.artist,'')) LIKE ${like} OR LOWER(COALESCE(e.song,'')) LIKE ${like}
                   OR LOWER(COALESCE(e.paypal_handle,'')) LIKE ${like} OR LOWER(COALESCE(e.vendor_email,'')) LIKE ${like})`;
    }
    const { rows } = await pool.query(
      `SELECT e.id, e.payee, e.vendor_email, e.paypal_handle, e.social_handles, e.artist, e.song,
              e.amount, COALESCE(e.currency, 'USD') AS currency, e.fx_rate_to_usd, e.category,
              e.payment_status, e.payment_date, e.invoice_date, e.payment_method, e.notes, e.rep,
              e.recoupable, e.ufr, e.is_bulk_deal, e.created_at, e.created_by, e.w9_r2_key,
              ${bankEvidence.bankEvidenceCols('e', accounts)}
         FROM expenses e
        WHERE ${where}
        ORDER BY e.payment_date DESC NULLS LAST, e.id DESC
        LIMIT 1000`,
      params
    );
    // Round AT THE ROW, then sum the rounded figures. The reference app sums
    // raw and rounds once; here the total is printed BESIDE the rows it is made
    // of, so it has to equal what a reader can add up on screen. Same rule the
    // spend sheets use (lib/usd.js rowUsd2).
    let total = 0;
    for (const r of rows) {
      r.amount_usd_calc = await rowUsd2(r);
      total += r.amount_usd_calc;
    }
    res.json({ success: true, data: { rows, total: round2(total), count: rows.length } });
  } catch (e) { console.error('creators list error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

// GET /api/creators/directory — one row per creator, W9/1099 exposure per
// calendar YEAR (counting per row reports 51% when the real figure is 97% —
// the W9 is shared per PERSON, keyed on payee or shared email).
router.get('/directory', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.payee, e.vendor_email, e.paypal_handle, e.social_handles, e.artist, e.amount,
              COALESCE(e.currency, 'USD') AS currency, e.fx_rate_to_usd,
              e.payment_status, e.payment_date, e.invoice_date,
              (e.w9_r2_key IS NOT NULL OR e.w9_filename IS NOT NULL) AS has_w9
         FROM expenses e WHERE ${LIVE}`,
      [req.labelId]
    );
    // node-pg returns DATE as a JS Date — String(d).slice(0,4) yields "Mon ",
    // which silently buckets everything under one garbage year.
    const yearOf = (d) => {
      if (!d) return null;
      if (d instanceof Date) return String(d.getFullYear());
      return String(d).slice(0, 4);
    };
    const dayOf = (d) => {
      if (!d) return null;
      if (d instanceof Date) return d.toISOString().slice(0, 10);
      return String(d).slice(0, 10);
    };
    const byCreator = new Map();
    // A W9 belongs to the PERSON. It is shared across their rows by payee and —
    // broader than the reference app — across payee spellings by email, since
    // one creator invoiced under two names is the normal case here.
    const w9ByEmail = new Set();
    for (const r of rows) if (r.has_w9 && r.vendor_email) w9ByEmail.add(String(r.vendor_email).toLowerCase());
    for (const r of rows) {
      const key = String(r.payee || '').trim().toLowerCase();
      const c = byCreator.get(key) || {
        key, name: r.payee, email: null, paypal_handle: null, social_handles: null,
        artists: new Set(), by_year: {}, total: 0, n: 0, w9_on_file: false, last_payment: null,
      };
      // First non-empty wins — a later blank row must not erase contact details
      // somebody already recorded.
      c.email = c.email || r.vendor_email;
      c.paypal_handle = c.paypal_handle || r.paypal_handle;
      if (!c.social_handles && Array.isArray(r.social_handles) && r.social_handles.length) c.social_handles = r.social_handles;
      if (r.artist) c.artists.add(String(r.artist).trim());
      const usd = await rowUsd2(r);
      c.total += usd; c.n += 1;
      if (r.payment_status === 'Paid') {
        const y = yearOf(r.payment_date) || yearOf(r.invoice_date);
        // Accumulate RAW, round once per year at the end — the threshold is a
        // dollar figure and a per-add round can flip $599.995 either way.
        if (y) c.by_year[y] = (c.by_year[y] || 0) + usd;
        const day = dayOf(r.payment_date);
        if (day && (!c.last_payment || day > c.last_payment)) c.last_payment = day;
      }
      if (r.has_w9 || (r.vendor_email && w9ByEmail.has(String(r.vendor_email).toLowerCase()))) c.w9_on_file = true;
      byCreator.set(key, c);
    }
    const creators = [...byCreator.values()].map((c) => {
      const byYear = Object.fromEntries(Object.entries(c.by_year).map(([y, v]) => [y, round2(v)]));
      const yearsOver = Object.entries(byYear)
        .filter(([y, v]) => v >= reportingThresholdFor(Number(y)))
        .map(([y, v]) => ({ year: y, total: v, threshold: reportingThresholdFor(Number(y)) }));
      return {
        ...c, artists: [...c.artists].sort(), by_year: byYear, total: round2(c.total),
        years_over: yearsOver,
        w9_required: yearsOver.length > 0,
        w9_missing: yearsOver.length > 0 && !c.w9_on_file,
      };
    }).sort((a, b) => b.total - a.total);
    const missing = creators.filter((c) => c.w9_missing);
    res.json({
      success: true,
      data: {
        creators,
        summary: {
          creators: creators.length,
          total: round2(creators.reduce((s, c) => s + c.total, 0)),
          w9_missing: missing.length,
          w9_missing_value: round2(missing.reduce((s, c) => s + c.total, 0)),
          threshold_note: '1099 reporting threshold: $600 through 2025, $2,000 from tax year 2026 (OBBBA)',
        },
      },
    });
  } catch (e) { console.error('creators directory error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

async function insertCreator(client, labelId, b, userName) {
  const st = paidState(b);
  const { rows } = await client.query(
    `INSERT INTO expenses (label_id, payee, vendor_email, paypal_handle, social_handles, artist, song,
        amount, currency, category, description, notes, invoice_date, payment_method, payment_status,
        payment_date, paid_by, paid_marked_at, status, entry_source, rep, is_bulk_deal, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, CURRENT_DATE, 'PayPal', $13,
             $14, $15, ${st.payment_status === 'Paid' ? 'NOW()' : 'NULL'}, 'approved', '${CREATOR_SOURCE}', $16, $17, $18, NOW())
     RETURNING id`,
    [labelId, String(b.payee).replace(/\s+/g, ' ').trim(), String(b.vendor_email).toLowerCase().trim(),
     String(b.paypal_handle).trim(), JSON.stringify(b.social_handles), String(b.artist).trim(), String(b.song).trim(),
     Number(b.amount), b.currency || 'USD', b.category || 'Marketing', b.description || null, b.notes || null,
     st.payment_status, st.payment_date, st.payment_status === 'Paid' ? userName : null,
     b.rep || userName, b.is_bulk_deal === true, userName]
  );
  if (st.payment_status === 'Paid') stampFxRateAsync(rows[0].id);
  return rows[0].id;
}

// POST /api/creators — one payment. NEVER calls any vendor upsert.
router.post('/', async (req, res) => {
  try {
    const missing = missingRequired(req.body || {});
    if (missing.length) return res.status(400).json({ success: false, error: `Creator payment needs: ${missing.join(', ')}` });
    const id = await insertCreator(pool, req.labelId, req.body, req.user.name);
    await logActivity(req, 'Added creator payment', `#${id} · ${req.body.payee} · ${req.body.amount}`);
    res.json({ success: true, data: { id } });
  } catch (e) { console.error('creator add error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

// POST /api/creators/batch — N SEPARATE rows, never a split family: PayPal
// sends one transaction per recipient, so five creators is five statement
// lines and must be five matchable rows. All-or-nothing.
router.post('/batch', async (req, res) => {
  const client = await pool.connect();
  try {
    const list = Array.isArray(req.body.payments) ? req.body.payments : [];
    if (!list.length || list.length > 100) return res.status(400).json({ success: false, error: '1-100 payments per batch' });
    const defaults = {
      artist: req.body.artist, song: req.body.song, currency: req.body.currency,
      payment_status: req.body.payment_status, paid: req.body.paid, payment_date: req.body.payment_date,
      is_bulk_deal: req.body.is_bulk_deal === true, notes: req.body.notes, rep: req.body.rep,
    };
    // Validate EVERY row before writing ANY.
    const errors = [];
    const merged = list.map((p, i) => {
      const row = { ...defaults, ...p, is_bulk_deal: defaults.is_bulk_deal };
      const missing = missingRequired(row);
      if (missing.length) errors.push(`Creator ${i + 1}${p.payee ? ` (${p.payee})` : ''} needs: ${missing.join(', ')}`);
      return row;
    });
    if (errors.length) return res.status(400).json({ success: false, error: errors.join(' · ') });
    await client.query('BEGIN');
    const ids = [];
    for (const row of merged) ids.push(await insertCreator(client, req.labelId, row, req.user.name));
    await client.query('COMMIT');
    await logActivity(req, 'Added creator payment batch', `${ids.length} payments`);
    activityBot.postEvent(req.labelId, { text: `💸 ${ids.length} creator payment(s) logged by ${req.user.name}`, icon: 'users', link: '/creators' });
    res.json({ success: true, data: { created: ids.length, ids } });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('creator batch error:', e);
    res.status(500).json({ success: false, error: 'Batch failed — nothing was written' });
  } finally { client.release(); }
});

// PUT /api/creators/:id — entry_source is DELIBERATELY not editable (the
// match exemption stays keyed to rows born here). payment_status and
// payment_date are handled together, outside the whitelist loop.
router.put('/:id(\\d+)', async (req, res) => {
  try {
    // `ufr` is here because a creator payment is recoupable spend like any
    // other and gets claimed on a statement; without it the only way to claim
    // one was to leave this API. Booleans are validated, never coerced — a
    // string "false" through a boolean column reads as TRUE.
    const WHITELIST = ['payee', 'vendor_email', 'paypal_handle', 'artist', 'song', 'amount', 'currency',
      'category', 'description', 'notes', 'rep', 'recoupable', 'ufr'];
    const BOOLS = ['recoupable', 'ufr'];
    for (const key of BOOLS) {
      if (req.body[key] !== undefined && typeof req.body[key] !== 'boolean') {
        return res.status(400).json({ success: false, error: `${key} must be true or false` });
      }
    }
    const sets = [];
    const params = [req.labelId, parseInt(req.params.id, 10)];
    const statusMoving = req.body.payment_status === 'Paid' || req.body.payment_status === 'Unpaid';
    for (const key of WHITELIST) {
      if (req.body[key] === undefined) continue;
      params.push(req.body[key]);
      sets.push(`${key} = $${params.length}`);
    }
    // Claiming stamps the statement month; PRESERVE an existing stamp, the
    // same rule /recoupments/ufr-bulk implements — a re-claim must not move an
    // item off a statement a partner has already received.
    if (req.body.ufr === true) sets.push(`ufr_marked_at = COALESCE(ufr_marked_at, NOW())`);
    if (req.body.ufr === false) sets.push(`ufr_marked_at = NULL`);
    if (req.body.social_handles !== undefined) {
      if (!Array.isArray(req.body.social_handles)) return res.status(400).json({ success: false, error: 'social_handles must be an array' });
      params.push(JSON.stringify(req.body.social_handles));
      sets.push(`social_handles = $${params.length}::jsonb`);
    }
    if (statusMoving) {
      if (req.body.payment_status === 'Paid') {
        params.push(String(req.body.payment_date || '').slice(0, 10) || new Date().toISOString().slice(0, 10));
        sets.push(`payment_status = 'Paid'`, `payment_date = $${params.length}`, `paid_by = '${req.user.name.replace(/'/g, "''")}'`, `paid_marked_at = NOW()`);
      } else {
        sets.push(`payment_status = 'Unpaid'`, `payment_date = NULL`, `paid_by = NULL`, `paid_marked_at = NULL`, `fx_rate_to_usd = NULL`);
      }
    } else if (req.body.payment_date !== undefined) {
      params.push(String(req.body.payment_date || '').slice(0, 10) || null);
      sets.push(`payment_date = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ success: false, error: 'Nothing to update' });
    const { rows } = await pool.query(
      `UPDATE expenses e SET ${sets.join(', ')} WHERE e.id = $2 AND ${isCreatorRow('e')} AND e.label_id = $1 RETURNING e.id, e.payment_status`,
      params
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'No such creator payment' });
    if (statusMoving && req.body.payment_status === 'Paid') stampFxRateAsync(rows[0].id);
    res.json({ success: true, data: rows[0] });
  } catch (e) { console.error('creator update error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

router.delete('/:id(\\d+)', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE expenses e SET deleted = TRUE, deleted_by = $3, deleted_at = NOW()
        WHERE e.id = $2 AND e.label_id = $1 AND ${isCreatorRow('e')} RETURNING e.id`,
      [req.labelId, parseInt(req.params.id, 10), req.user.name]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'No such creator payment' });
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});

// ── Move-in: rows added on Artist Campaigns / Recoupments that are really
// creator payments (Marketing-ish, small, PayPal-shaped). ──────────────────
const SOURCE_PAGES = ['artist_campaigns', 'recoupment']; // cadence spellings
const CONVERT_MAX_USD = 5000;

router.get('/convertible', async (req, res) => {
  try {
    // Convert-eligible categories = the 'campaign' ui_group (data-driven).
    const catRows = (await pool.query(
      `SELECT name FROM categories WHERE label_id = $1 AND kind = 'expense' AND ui_group = 'campaign' AND active = TRUE`,
      [req.labelId]
    )).rows.map((r) => r.name.toLowerCase());
    const convertCats = catRows.length ? catRows : ['marketing', 'pr'];
    const { rows } = await pool.query(
      `SELECT e.id, e.payee, e.vendor_email, e.paypal_handle, e.artist, e.song, e.category,
              e.amount, COALESCE(e.currency, 'USD') AS currency, e.fx_rate_to_usd,
              e.payment_status, e.payment_date, e.invoice_date, e.entry_source, e.social_handles,
              EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.label_id = e.label_id AND bt.matched_expense_id = e.id AND bt.dismissed = FALSE) AS already_matched
         FROM expenses e
        WHERE e.label_id = $1 AND e.entry_source = ANY($2)
          AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
          AND NOT EXISTS (SELECT 1 FROM expenses c WHERE c.parent_id = e.id AND (c.deleted IS NULL OR c.deleted = FALSE))
        ORDER BY e.created_at DESC LIMIT 500`,
      [req.labelId, SOURCE_PAGES]
    );
    const out = [];
    for (const r of rows) {
      const usd = await rowUsd2(r);
      const reasons = [];
      if (!convertCats.includes(String(r.category || '').toLowerCase())) reasons.push(`category "${r.category || '—'}" is not campaign spend`);
      if (usd > CONVERT_MAX_USD) reasons.push(`${usd.toFixed(2)} is larger than a typical creator payment`);
      const missing = [];
      if (!r.vendor_email) missing.push('email');
      if (!r.paypal_handle) missing.push('PayPal handle');
      if (!Array.isArray(r.social_handles) || !r.social_handles?.length) missing.push('socials');
      if (!String(r.song || '').trim()) missing.push('song');
      if (!String(r.artist || '').trim()) missing.push('artist');
      out.push({ ...r, usd, proposed: reasons.length ? 'review' : 'convert', review_reasons: reasons, missing_info: missing });
    }
    const conv = out.filter((r) => r.proposed === 'convert');
    const review = out.filter((r) => r.proposed === 'review');
    res.json({
      success: true,
      data: {
        rows: out,
        // The counts and values the queue is judged on. Computed here, from the
        // same array the rows come from, so the banner cannot describe a
        // different set than the table under it.
        summary: {
          total: out.length,
          convert: conv.length,
          convert_value: round2(conv.reduce((t, r) => t + r.usd, 0)),
          review: review.length,
          review_value: round2(review.reduce((t, r) => t + r.usd, 0)),
          already_matched: out.filter((r) => r.already_matched).length,
        },
      },
    });
  } catch (e) { console.error('convertible error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

router.post('/convert', async (req, res) => {
  const client = await pool.connect();
  try {
    const ids = (req.body.ids || []).map(Number).filter(Boolean).slice(0, 500);
    if (!ids.length) return res.status(400).json({ success: false, error: 'No rows selected' });
    await client.query('BEGIN');
    const rows = (await client.query(
      `SELECT id, payee, entry_source FROM expenses WHERE id = ANY($1::int[]) AND label_id = $2 AND entry_source = ANY($3) FOR UPDATE`,
      [ids, req.labelId, SOURCE_PAGES]
    )).rows;
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'None of those rows can be moved in' }); }
    const targetIds = rows.map((r) => r.id);
    // The live matches that would change disposition. Read BEFORE the write in
    // both the dry run and the real one, from the same predicate as the UPDATE.
    const txns = (await client.query(
      `SELECT id, matched_expense_id, match_method FROM bank_transactions
        WHERE label_id = $1 AND matched_expense_id = ANY($2::int[]) AND dismissed = FALSE
          AND match_method IS DISTINCT FROM 'created'`,
      [req.labelId, targetIds]
    )).rows;
    if (req.body.dry_run) {
      await client.query('ROLLBACK');
      return res.json({
        success: true, dry_run: true,
        data: {
          would_convert: rows.length,
          would_relabel_matches: txns.length,
          rows: rows.map((r) => ({ id: r.id, payee: r.payee, from: r.entry_source })),
        },
      });
    }
    // Audit the OLD source per row BEFORE the write — unconvert restores the
    // exact original (9-of-131 came from a different page in the reference data).
    for (const r of rows) {
      await client.query(
        `INSERT INTO bk_audit_log (label_id, expense_id, action, detail, actor, field, old_value, new_value)
         VALUES ($1, $2, 'creator_convert', $3, $4, 'entry_source', $5, $6)`,
        [req.labelId, r.id, `Moved to Creator Payments from ${r.entry_source}`, req.user.name, r.entry_source, CREATOR_SOURCE]
      );
    }
    // And audit each MATCH's prior method the same way, one row per bank txn.
    // `match_method='creator'` is explained-never-invoice-backed, so this write
    // is not reversible by guessing: unconvert has to put back the exact method
    // the match carried, and 'manual' is invoice-backed. The txn id rides in
    // `detail` because bk_audit_log keys on expense_id.
    for (const t of txns) {
      await client.query(
        `INSERT INTO bk_audit_log (label_id, expense_id, action, detail, actor, field, old_value, new_value)
         VALUES ($1, $2, 'creator_convert', $3, $4, 'match_method', $5, 'creator')`,
        [req.labelId, t.matched_expense_id, `${MATCH_DETAIL_PREFIX}${t.id}`, req.user.name, t.match_method]
      );
    }
    const conv = await client.query(
      `UPDATE expenses SET entry_source = $3, payment_method = COALESCE(payment_method, 'PayPal')
        WHERE id = ANY($1::int[]) AND label_id = $2 RETURNING id`,
      [targetIds, req.labelId, CREATOR_SOURCE]
    );
    // Relabel existing bank matches so they stop counting as invoice-backed.
    const relabelled = await client.query(
      `UPDATE bank_transactions SET match_method = 'creator'
        WHERE label_id = $1 AND id = ANY($2::int[]) RETURNING id`,
      [req.labelId, txns.map((t) => t.id)]
    );
    await client.query('COMMIT');
    await logActivity(req, 'Converted rows to creator payments', `${conv.rows.length} rows, ${relabelled.rows.length} matches relabelled`);
    res.json({ success: true, data: { converted: conv.rows.length, relabelled_matches: relabelled.rows.length } });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('convert error:', e);
    res.status(500).json({ success: false, error: 'Convert failed' });
  } finally { client.release(); }
});

router.post('/unconvert', async (req, res) => {
  const client = await pool.connect();
  try {
    const ids = (req.body.ids || []).map(Number).filter(Boolean).slice(0, 500);
    if (!ids.length) return res.status(400).json({ success: false, error: 'No rows selected' });
    await client.query('BEGIN');
    let restored = 0;
    let matchesRestored = 0;
    let matchesLeftCreator = 0;
    for (const id of ids) {
      // The exact original source comes from the audit row — never guess it.
      const src = (await client.query(
        `SELECT id, old_value FROM bk_audit_log
          WHERE label_id = $1 AND expense_id = $2 AND action = 'creator_convert' AND field = 'entry_source'
          ORDER BY id DESC LIMIT 1`,
        [req.labelId, id]
      )).rows[0];
      if (!src?.old_value) continue;
      const r = await client.query(
        `UPDATE expenses e SET entry_source = $3 WHERE e.id = $2 AND e.label_id = $1 AND ${isCreatorRow('e')} RETURNING e.id`,
        [req.labelId, id, src.old_value]
      );
      if (!r.rows.length) continue;
      restored += 1;

      // Put each match back to the method it carried BEFORE that conversion.
      // Scoped to audit rows written by THIS conversion (id > the entry_source
      // row it opened with), so an older convert/unconvert cycle can't supply a
      // stale method. Only rows still sitting at 'creator' are touched — a
      // method changed since is somebody's later decision.
      const auditRows = (await client.query(
        `SELECT detail, old_value FROM bk_audit_log
          WHERE label_id = $1 AND expense_id = $2 AND action = 'creator_convert'
            AND field = 'match_method' AND id > $3
          ORDER BY id DESC`,
        [req.labelId, id, src.id]
      )).rows;
      const plan = restoreMatchPlan(auditRows);
      for (const p of plan) {
        const u = await client.query(
          `UPDATE bank_transactions SET match_method = $3
            WHERE label_id = $1 AND id = $2 AND matched_expense_id = $4 AND match_method = 'creator' RETURNING id`,
          [req.labelId, p.txn_id, p.match_method, id]
        );
        matchesRestored += u.rows.length;
      }
      // Anything still 'creator' was matched after the conversion and has no
      // audited prior method. It STAYS 'creator' — explained, not invoice-backed.
      const left = await client.query(
        `SELECT COUNT(*)::int AS n FROM bank_transactions
          WHERE label_id = $1 AND matched_expense_id = $2 AND match_method = 'creator' AND dismissed = FALSE`,
        [req.labelId, id]
      );
      matchesLeftCreator += left.rows[0].n;
    }
    await client.query('COMMIT');
    await logActivity(req, 'Moved rows back out of creator payments', `${restored} rows, ${matchesRestored} matches restored`);
    res.json({ success: true, data: { restored, of: ids.length, matches_restored: matchesRestored, matches_left_creator: matchesLeftCreator } });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('unconvert error:', e);
    res.status(500).json({ success: false, error: 'Failed' });
  } finally { client.release(); }
});

module.exports = router;
