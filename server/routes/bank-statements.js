// Bank statements / reconciliation — the premium finance surface. Admin only
// (balances are sensitive). A statement is a LENS over the master ledger:
// matching links a bank txn to a ledger family root, booking creates a normal
// approved+Paid expense. No staging copy.

const express = require('express');
const multer = require('multer');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { uploadFile, getSignedFileUrl, loadFileBuffer } = require('../lib/r2');
const claude = require('../lib/claude');
const { stampFxRateAsync } = require('../lib/fxStamp');
const { familyRoot, cascadePaymentFieldsToFamily } = require('../lib/paymentFamily');
const R = require('../lib/bankReconcile');

const router = express.Router();
router.use(authMiddleware, withTenant, requireAdmin);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

// ── Background PDF parse queue (max 2 concurrent — parallel 30k-token streams
// starve each other on org rate limits and nothing finishes) ────────────────
const MAX_CONCURRENT = 2;
let active = 0;
const queue = [];
function enqueue(job) { queue.push(job); pump(); }
function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    active++;
    job().catch(e => console.error('Statement parse job failed:', e.message)).finally(() => { active--; pump(); });
  }
}

const PIPE_INSTRUCTION =
  'You are extracting every transaction from this bank statement.\n' +
  'FIRST output exactly two header lines with the balances the document prints (leave empty after the pipe when not printed):\n' +
  'BEGINNING_BALANCE|<number>\n' +
  'ENDING_BALANCE|<number>\n' +
  'Then output ONE LINE PER TRANSACTION in the exact pipe-delimited format:\n' +
  'DATE|DIRECTION|AMOUNT|PAYEE|EMAIL|REFERENCE|DESCRIPTION\n' +
  'DATE is YYYY-MM-DD. DIRECTION is "debit" (money out) or "credit" (money in). AMOUNT is the positive number with no currency symbol or commas. ' +
  'PAYEE is the cleanest merchant/beneficiary name you can extract (empty if none). EMAIL is the counterparty email when the statement prints one (empty if none). ' +
  'REFERENCE is any confirmation/reference number (empty if none). ' +
  'DESCRIPTION is the raw line text. Apart from those two header lines, do NOT output JSON, headers, totals, commentary, or markdown — only transaction lines. Include EVERY transaction.';

async function parsePdfStatement(statementId, labelId, account, buffer, mimeType) {
  try {
    const block = claude.fileBlock(buffer, mimeType);
    if (!block) { await failStatement(statementId, 'Unsupported file type'); return; }
    const r = await claude.streamText({ content: [block, { type: 'text', text: PIPE_INSTRUCTION }], maxTokens: 32000 });
    if (!r.ok) { await failStatement(statementId, r.error || 'AI parse failed'); return; }
    if (r.stop_reason === 'max_tokens') { await failStatement(statementId, 'Statement too long to parse — please upload the CSV export instead.'); return; }
    const txns = R.parsePipeLines(r.text);
    if (!txns.length) { await failStatement(statementId, 'No transactions found — try the CSV export.'); return; }
    await ingest(statementId, labelId, account, txns, R.extractBalanceLines(r.text));
  } catch (e) {
    await failStatement(statementId, e.message);
  }
}
async function failStatement(id, error) {
  await pool.query(`UPDATE bank_statements SET status = 'error', error = $2 WHERE id = $1`, [id, String(error || '').slice(0, 500)]).catch(() => {});
}

// ── Ingest: dedupe → auto-dismiss internal → dismiss rules → auto-match →
// category rules (after matching) → write import_summary ─────────────────────
async function ingest(statementId, labelId, account, rawTxns, balances = {}) {
  const labelRow = (await pool.query('SELECT bank_accounts FROM labels WHERE id = $1', [labelId])).rows[0] || {};
  const accounts = R.accountsFor(labelRow);
  const methods = R.accountMethods(accounts, account);
  const maps = await R.loadMaps(pool, labelId);
  const dismissRules = (await pool.query('SELECT pattern FROM statement_dismiss_rules WHERE label_id = $1', [labelId])).rows.map(r => r.pattern);
  const catRules = (await pool.query('SELECT pattern, category FROM statement_category_rules WHERE label_id = $1', [labelId])).rows;
  const summary = { dup_skipped: 0, auto_matched: 0, rule_booked: 0, rule_dismissed: 0 };

  // One-debit-per-invoice, layer 1: seed the claimed set from ALL existing
  // live claims, and add per match inside this run — two rows in one upload
  // must not both claim the same invoice.
  const used = new Set(
    (await pool.query(
      `SELECT DISTINCT matched_expense_id AS id FROM bank_transactions
        WHERE label_id = $1 AND matched_expense_id IS NOT NULL AND dismissed = FALSE`,
      [labelId]
    )).rows.map(r => r.id)
  );

  const ruleHit = (rules, txn) => {
    const hay = `${txn.description || ''} ${txn.payee_guess || ''}`.toLowerCase();
    return rules.find(p => hay.includes(String(p).toLowerCase()));
  };

  for (const raw of rawTxns) {
    // Pull an email out of the payee wherever it arrived mashed together.
    const es = R.splitPayeeEmail(raw.payee_guess);
    const t = { ...raw, payee_guess: es.payee, payee_email: raw.payee_email || es.email };
    const currency = t.currency || 'USD';
    // (a) Dedupe against other statements of the same account (and earlier rows
    // of this one). Reference match when both have one, else same description.
    const dup = await pool.query(
      `SELECT 1 FROM bank_transactions bt JOIN bank_statements bs ON bs.id = bt.statement_id
        WHERE bs.label_id = $1 AND bs.account = $2 AND bt.txn_date = $3 AND bt.amount = $4 AND bt.direction = $5
          AND ( ($6 <> '' AND bt.reference = $6) OR ($6 = '' AND COALESCE(bt.description,'') = $7) ) LIMIT 1`,
      [labelId, account, t.txn_date, t.amount, t.direction, t.reference || '', t.description || '']
    );
    if (dup.rows.length) { summary.dup_skipped++; continue; }

    let dismissed = false, dismissedReason = null, matchedId = null, method = null, score = null, booked = false;

    // (b) Auto-dismiss internal movement (both parse paths).
    if (R.isInternal(t.description, t.payee_guess)) { dismissed = true; dismissedReason = 'internal'; }
    // (c) Dismiss rules.
    else if (ruleHit(dismissRules, t)) { dismissed = true; dismissedReason = 'auto'; summary.rule_dismissed++; }

    if (!dismissed && t.direction === 'debit') {
      // Auto-match against the ledger.
      const m = await R.matchTxn(pool, labelId, { ...t, currency }, methods, maps, used);
      if (m) {
        matchedId = m.expense_id; method = m.method; score = m.score;
        used.add(m.expense_id); summary.auto_matched++;
        // A creator payment reconciles but is never invoice-backed.
        const src = (await pool.query(`SELECT entry_source FROM expenses WHERE id = $1 /* no-tenant */`, [m.expense_id])).rows[0];
        if (src?.entry_source === 'creator_payment') method = 'creator';
      }
      else {
        // (post-match) Category rules → book straight to the ledger.
        const cr = catRules.find(r => { const hay = `${t.description || ''} ${t.payee_guess || ''}`.toLowerCase(); return hay.includes(String(r.pattern).toLowerCase()); });
        if (cr) {
          const entry = await bookEntry(pool, labelId, { ...t, currency }, { category: cr.category, method: methods && methods[0], actor: 'Auto (rule)' });
          matchedId = entry.id; method = 'rule'; booked = true; score = 1.0; summary.rule_booked++;
        }
      }
    }

    await pool.query(
      `INSERT INTO bank_transactions (statement_id, label_id, txn_date, description, payee_guess, payee_email, amount, direction,
         currency, reference, fee, amount_usd, matched_expense_id, match_method, match_score, matched_by, matched_at, booked, dismissed, dismissed_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,${matchedId ? 'NOW()' : 'NULL'},$17,$18,$19)`,
      [statementId, labelId, t.txn_date, t.description || null, t.payee_guess || null, t.payee_email || null, t.amount, t.direction,
       currency, t.reference || null, t.fee || null, t.amount_usd || null, matchedId, method, score, matchedId ? 'Auto' : null, booked, dismissed, dismissedReason]
    );
  }

  const per = await pool.query('SELECT MIN(txn_date) AS s, MAX(txn_date) AS e, COUNT(*)::int AS n FROM bank_transactions WHERE statement_id = $1 /* no-tenant */', [statementId]);
  await pool.query(
    `UPDATE bank_statements SET status = 'ready', period_start = $2, period_end = $3, txn_count = $4, import_summary = $5::jsonb, error = NULL,
        ending_balance = COALESCE($6, ending_balance), beginning_balance = COALESCE($7, beginning_balance)
      WHERE id = $1 /* no-tenant */`,
    [statementId, per.rows[0].s, per.rows[0].e, per.rows[0].n, JSON.stringify(summary),
     balances.ending_balance ?? null, balances.beginning_balance ?? null]
  );
}

// Book a debit as an approved+Paid ledger entry (entry_source='bank_statement').
async function bookEntry(db, labelId, txn, { category, payee, artist, method, actor }) {
  // Standing artist attribution — first rule whose pattern is in the
  // descriptor. An is_overhead rule is a REAL null answer (never guess past
  // it); an explicit artist param always wins.
  if (!artist) {
    try {
      const hay = `${txn.payee_guess || ''} ${txn.description || ''}`.toLowerCase();
      const rules = (await (db || pool).query(
        `SELECT pattern, artist, is_overhead FROM statement_artist_rules WHERE label_id = $1`, [labelId]
      )).rows;
      const hit = rules.find(r => hay.includes(String(r.pattern).toLowerCase()));
      if (hit && !hit.is_overhead) artist = hit.artist;
    } catch { /* table may predate migration */ }
  }
  const { rows } = await (db || pool).query(
    `INSERT INTO expenses (label_id, invoice_date, payee, description, category, artist, amount, currency,
       payment_method, status, payment_status, payment_date, payment_ref, entry_source, created_by, created_at, paid_marked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'approved','Paid',$2,$10,'bank_statement',$11,NOW(),NOW()) RETURNING *`,
    [labelId, txn.txn_date, payee || txn.payee_guess || txn.description || 'Bank debit', txn.description || null,
     category || null, artist || null, txn.amount, txn.currency || 'USD', method || null, txn.reference || null, actor || null]
  );
  stampFxRateAsync(rows[0].id);
  // Learn the descriptor → payee association.
  R.learnPayee(db, labelId, txn.payee_guess || txn.description, rows[0].payee, actor).catch(() => {});
  return rows[0];
}

// ── Accounts ────────────────────────────────────────────────────────────────
router.get('/accounts', async (req, res) => {
  try {
    const row = (await pool.query('SELECT bank_accounts FROM labels WHERE id = $1', [req.labelId])).rows[0] || {};
    res.json({ success: true, data: R.accountsFor(row) });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.put('/accounts', async (req, res) => {
  try {
    const list = Array.isArray(req.body.accounts) ? req.body.accounts
      .map(a => ({ key: String(a.key || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''), label: String(a.label || '').trim(), methods: Array.isArray(a.methods) ? a.methods : null }))
      .filter(a => a.key && a.label) : [];
    if (!list.length) return res.status(400).json({ success: false, error: 'Provide at least one account' });
    await pool.query('UPDATE labels SET bank_accounts = $1::jsonb WHERE id = $2', [JSON.stringify(list), req.labelId]);
    res.json({ success: true, data: list });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── Statements list (with stale-parse guard) ────────────────────────────────
router.get('/', async (req, res) => {
  try {
    // Flip interrupted parses (deploys kill in-flight streams) to error.
    await pool.query(`UPDATE bank_statements SET status = 'error', error = 'Interrupted — please re-upload' WHERE label_id = $1 AND status = 'parsing' AND created_at < NOW() - INTERVAL '25 minutes'`, [req.labelId]);

    // Idempotent retro sweep 1: split emails out of payees on rows that
    // predate payee_email (banks mash "Name / email@x" into one field).
    await pool.query(
      `UPDATE bank_transactions SET
         payee_email = LOWER(substring(payee_guess from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}')),
         payee_guess = btrim(regexp_replace(payee_guess, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', '', 'g'), ' /|,-')
       WHERE label_id = $1 AND payee_email IS NULL
         AND payee_guess ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'`,
      [req.labelId]
    ).catch(() => {});

    // Idempotent retro sweep 2: one invoice claimed by several live txns —
    // keep the strongest (created > manual > score > oldest), reopen the rest.
    // NEVER unlink 'created' rows: their ledger entry was created FROM the txn.
    await pool.query(
      `WITH ranked AS (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY matched_expense_id
           ORDER BY (match_method = 'created') DESC, (match_method = 'manual') DESC,
                    match_score DESC NULLS LAST, matched_at ASC NULLS LAST, id ASC
         ) AS rn
         FROM bank_transactions
         WHERE label_id = $1 AND matched_expense_id IS NOT NULL AND dismissed = FALSE
       )
       UPDATE bank_transactions t SET matched_expense_id = NULL, match_method = NULL, match_score = NULL,
              matched_by = NULL, matched_at = NULL
        FROM ranked r
       WHERE t.id = r.id AND r.rn > 1 AND t.label_id = $1
         AND t.match_method IS DISTINCT FROM 'created'`,
      [req.labelId]
    ).catch(() => {});
    const { rows } = await pool.query(
      `SELECT s.*,
         (SELECT COUNT(*)::int FROM bank_transactions t WHERE t.statement_id = s.id AND t.direction = 'debit' AND NOT t.dismissed AND t.matched_expense_id IS NULL) AS open_count
       FROM bank_statements s WHERE s.label_id = $1 ORDER BY s.created_at DESC`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (e) { console.error('Statements list error:', e); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── Upload ──────────────────────────────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    const account = String(req.body.account || '').trim().toLowerCase();
    if (!account) return res.status(400).json({ success: false, error: 'Choose an account' });
    const isPdf = req.file.mimetype === 'application/pdf';
    const isCsv = /csv|excel|text|sheet/.test(req.file.mimetype) || /\.csv$/i.test(req.file.originalname);
    if (!isPdf && !isCsv) return res.status(400).json({ success: false, error: 'Upload a CSV or PDF statement' });

    const key = `label-${req.labelId}/statements/${account}-${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await uploadFile(key, req.file.buffer, req.file.mimetype).catch(() => {});

    if (isPdf) {
      if (!claude.isEnabled()) return res.status(400).json({ success: false, error: 'PDF parsing needs AI configured — upload the CSV instead' });
      // Create the row, respond immediately, parse in the background. NEVER
      // parse a dense PDF inside the request (5–10 min → proxy 502).
      const { rows } = await pool.query(
        `INSERT INTO bank_statements (label_id, account, filename, r2_key, status, uploaded_by) VALUES ($1,$2,$3,$4,'parsing',$5) RETURNING *`,
        [req.labelId, account, req.file.originalname, key, req.user.name]
      );
      const st = rows[0];
      const buf = req.file.buffer, mt = req.file.mimetype;
      enqueue(() => parsePdfStatement(st.id, req.labelId, account, buf, mt));
      await logActivity(req, 'Uploaded bank statement (PDF)', `${account} · ${req.file.originalname}`);
      return res.status(202).json({ success: true, data: st });
    }

    // CSV — parse synchronously.
    const csvText = req.file.buffer.toString('utf8');
    const txns = R.parseCsv(csvText, account);
    if (!txns.length) return res.status(400).json({ success: false, error: 'No transactions found in that CSV (check the export format)' });
    const { rows } = await pool.query(
      `INSERT INTO bank_statements (label_id, account, filename, r2_key, status, uploaded_by) VALUES ($1,$2,$3,$4,'parsing',$5) RETURNING id`,
      [req.labelId, account, req.file.originalname, key, req.user.name]
    );
    await ingest(rows[0].id, req.labelId, account, txns, R.extractCsvBalances(csvText));
    await logActivity(req, 'Uploaded bank statement (CSV)', `${account} · ${txns.length} txns`);
    const st = (await pool.query('SELECT * FROM bank_statements WHERE id = $1', [rows[0].id])).rows[0];
    res.status(201).json({ success: true, data: st });
  } catch (e) {
    console.error('Statement upload error:', e);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

// ── Statement detail — the mini-ledger ──────────────────────────────────────
function dispositionOf(t) {
  if (t.direction === 'credit') {
    if (t.matched_income_id) return 'booked-income';
    return t.dismissed ? 'dismissed' : 'open-credit';
  }
  if (t.dismissed) return 'dismissed';
  if (t.booked) return 'booked';
  if (t.matched_expense_id) return t.exp_payment_status === 'Paid' ? 'matched' : 'toconfirm';
  return 'open';
}
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const st = (await pool.query('SELECT * FROM bank_statements WHERE id = $1 AND label_id = $2', [id, req.labelId])).rows[0];
    if (!st) return res.status(404).json({ success: false, error: 'Statement not found' });

    const { rows: txns } = await pool.query(
      `SELECT t.*, e.payee AS exp_payee, e.category AS exp_category, e.payment_status AS exp_payment_status,
              e.entry_source AS exp_source, e.artist AS exp_artist,
              (e.amount + COALESCE((SELECT SUM(k.amount) FROM expenses k WHERE k.parent_id = e.id AND (k.deleted=false OR k.deleted IS NULL)),0)) AS exp_family_amount,
              i.source AS income_type, i.amount AS income_amount
       FROM bank_transactions t
       LEFT JOIN expenses e ON e.id = t.matched_expense_id
       LEFT JOIN artist_income i ON i.id = t.matched_income_id AND i.label_id = t.label_id
       WHERE t.statement_id = $1 ORDER BY t.txn_date ASC, t.id ASC`,
      [id]
    );
    // View-time suggestions — never stored, so a pattern fix retroactively
    // applies to every statement.
    const { suggestCategory, suggestIncomeType } = require('../lib/statementSuggest');
    const rows = txns.map(t => {
      const disposition = dispositionOf(t);
      return {
        ...t, disposition,
        suggested_category: disposition === 'open' ? suggestCategory(t.payee_guess, t.description) : null,
        suggested_income_type: disposition === 'open-credit' ? suggestIncomeType(t.payee_guess, t.description) : null,
      };
    });

    // Category totals over debits (matched/booked category, else Unorganized).
    const catTotals = {};
    let liveDebits = 0, matchedDebits = 0;
    for (const t of rows) {
      if (t.direction !== 'debit' || t.dismissed) continue;
      const amt = Number(t.amount);
      liveDebits += amt;
      const cat = t.exp_category || 'Unorganized';
      catTotals[cat] = (catTotals[cat] || 0) + amt;
      if (t.matched_expense_id) matchedDebits += amt;
    }

    const rules = {
      dismiss: (await pool.query('SELECT id, pattern, created_by FROM statement_dismiss_rules WHERE label_id = $1 ORDER BY id', [req.labelId])).rows,
      category: (await pool.query('SELECT id, pattern, category, created_by FROM statement_category_rules WHERE label_id = $1 ORDER BY id', [req.labelId])).rows,
    };

    // "Paid on ledger, no bank evidence" — Paid entries in-period not matched by
    // any bank txn (surfaces payments the bank statement is missing).
    let paidNoEvidence = [];
    if (st.period_start && st.period_end) {
      paidNoEvidence = (await pool.query(
        `SELECT e.id, e.payee, e.category, e.amount, e.currency, e.payment_date, e.payment_method
           FROM expenses e
          WHERE e.label_id = $1 AND e.parent_id IS NULL AND e.payment_status = 'Paid'
            AND e.entry_source IS DISTINCT FROM 'bank_statement'
            AND e.payment_date BETWEEN $2 AND $3
            AND (e.deleted=false OR e.deleted IS NULL) AND (e.voided=false OR e.voided IS NULL)
            AND NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.matched_expense_id = e.id AND bt.label_id = e.label_id)
          ORDER BY e.payment_date`,
        [req.labelId, st.period_start, st.period_end]
      )).rows;
    }

    res.json({ success: true, data: { statement: st, transactions: rows, catTotals, coverage: { matched: matchedDebits, live: liveDebits }, rules, paidNoEvidence } });
  } catch (e) { console.error('Statement detail error:', e); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── Statement balances (backfill for statements uploaded before capture) ────
// Balance-only AI pass over the stored PDF — much cheaper than a full
// re-parse, and it never touches transactions.
router.post('/:id/reparse-balance', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const st = (await pool.query('SELECT * FROM bank_statements WHERE id = $1 AND label_id = $2', [id, req.labelId])).rows[0];
    if (!st) return res.status(404).json({ success: false, error: 'Statement not found' });
    if (!st.r2_key) return res.status(400).json({ success: false, error: 'No stored file for this statement — set the balance manually' });
    if (!claude.isEnabled()) return res.status(400).json({ success: false, error: 'AI is not configured — set the balance manually' });
    const buf = await loadFileBuffer(st.r2_key, null);
    if (!buf) return res.status(400).json({ success: false, error: 'Stored file could not be loaded — set the balance manually' });
    const isPdf = /\.pdf$/i.test(st.filename || '') || buf.slice(0, 4).toString() === '%PDF';
    const block = claude.fileBlock(buf, isPdf ? 'application/pdf' : 'text/csv');
    if (!block) return res.status(400).json({ success: false, error: 'Unsupported stored file type' });
    const r = await claude.callClaude({
      content: [block, {
        type: 'text',
        text: 'Return exactly two lines with the balances this bank statement prints (empty after the pipe when not printed):\nBEGINNING_BALANCE|<number>\nENDING_BALANCE|<number>\nNo other output.',
      }],
      maxTokens: 100,
    });
    if (!r.ok) return res.status(400).json({ success: false, error: r.error || 'Balance parse failed' });
    const bal = R.extractBalanceLines(r.text || (typeof r.data === 'string' ? r.data : ''));
    if (bal.ending_balance == null && bal.beginning_balance == null) {
      return res.status(400).json({ success: false, error: 'The document does not print a balance — set it manually if you know it' });
    }
    const upd = (await pool.query(
      `UPDATE bank_statements SET ending_balance = COALESCE($3, ending_balance), beginning_balance = COALESCE($4, beginning_balance)
        WHERE id = $1 AND label_id = $2 RETURNING *`,
      [id, req.labelId, bal.ending_balance, bal.beginning_balance]
    )).rows[0];
    await logActivity(req, 'Reparsed statement balance', `#${id} → ending ${bal.ending_balance ?? '—'}`);
    res.json({ success: true, data: upd });
  } catch (e) {
    console.error('reparse-balance error:', e);
    res.status(500).json({ success: false, error: 'Balance reparse failed' });
  }
});

// Manual fallback — CSV exports without a balance column, missing R2 objects.
router.patch('/:id/balance', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
    const ending = num(req.body.ending_balance);
    const beginning = num(req.body.beginning_balance);
    if ((ending !== null && !Number.isFinite(ending)) || (beginning !== null && !Number.isFinite(beginning))) {
      return res.status(400).json({ success: false, error: 'Balances must be numbers' });
    }
    const upd = (await pool.query(
      `UPDATE bank_statements SET ending_balance = $3, beginning_balance = $4
        WHERE id = $1 AND label_id = $2 RETURNING *`,
      [id, req.labelId, ending, beginning]
    )).rows[0];
    if (!upd) return res.status(404).json({ success: false, error: 'Statement not found' });
    await logActivity(req, 'Set statement balance', `#${id} → ending ${ending ?? '—'}, beginning ${beginning ?? '—'}`);
    res.json({ success: true, data: upd });
  } catch (e) {
    console.error('set balance error:', e);
    res.status(500).json({ success: false, error: 'Failed to set balance' });
  }
});

router.delete('/:id(\\d+)', async (req, res) => {
  try {
    // Deleting a statement drops its txns (CASCADE) but leaves any booked/
    // matched ledger entries intact — the ledger is the source of truth.
    const { rowCount } = await pool.query('DELETE FROM bank_statements WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Statement not found' });
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── Transaction helpers ──────────────────────────────────────────────────────
async function loadTxn(txnId, labelId) {
  const { rows } = await pool.query('SELECT * FROM bank_transactions WHERE id = $1 AND label_id = $2', [txnId, labelId]);
  return rows[0] || null;
}
async function accountMethodsForTxn(txn, labelId) {
  const st = (await pool.query('SELECT bs.account FROM bank_statements bs WHERE bs.id = $1', [txn.statement_id])).rows[0];
  const labelRow = (await pool.query('SELECT bank_accounts FROM labels WHERE id = $1', [labelId])).rows[0] || {};
  return R.accountMethods(R.accountsFor(labelRow), st ? st.account : null);
}

// GET suggestions (top-3 near misses) for the Match UI.
router.get('/txns/:id/suggestions', async (req, res) => {
  try {
    const t = await loadTxn(parseInt(req.params.id, 10), req.labelId);
    if (!t) return res.status(404).json({ success: false, error: 'Not found' });
    const maps = await R.loadMaps(pool, req.labelId);
    const methods = await accountMethodsForTxn(t, req.labelId);
    const sugg = await R.suggestions(pool, req.labelId, t, methods, maps);
    res.json({ success: true, data: sugg });
  } catch (e) { console.error('Suggestions error:', e); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// Ledger search for the Match dialog (approved, unmatched, family roots).
router.get('/ledger-search', async (req, res) => {
  try {
    const q = `%${String(req.query.q || '').trim()}%`;
    const { rows } = await pool.query(
      `SELECT e.id, e.payee, e.invoice_number, e.currency, e.payment_status, e.payment_date, e.invoice_date,
              (e.amount + COALESCE((SELECT SUM(k.amount) FROM expenses k WHERE k.parent_id = e.id AND (k.deleted=false OR k.deleted IS NULL)),0)) AS family_amount
         FROM expenses e
        WHERE e.label_id = $1 AND e.parent_id IS NULL AND e.status = 'approved'
          AND (e.deleted=false OR e.deleted IS NULL) AND (e.voided=false OR e.voided IS NULL)
          AND (e.payee ILIKE $2 OR e.invoice_number ILIKE $2)
          AND NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.matched_expense_id = e.id AND bt.label_id = e.label_id)
        ORDER BY e.invoice_date DESC NULLS LAST LIMIT 25`,
      [req.labelId, q]
    );
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// Match a txn to an existing ledger family root (plain link + learn payee).
router.post('/txns/:id/match', async (req, res) => {
  try {
    const t = await loadTxn(parseInt(req.params.id, 10), req.labelId);
    if (!t) return res.status(404).json({ success: false, error: 'Not found' });
    // A booked txn or a booked-income credit must be un-booked first — a
    // plain repoint would orphan the created row.
    if (t.match_method === 'created' || t.booked) {
      return res.status(400).json({ success: false, error: 'This line was booked — unbook it first, then match the invoice' });
    }
    if (t.matched_income_id) {
      return res.status(400).json({ success: false, error: 'This credit is booked as income — unbook the income first' });
    }
    const root = await familyRoot(pool, parseInt(req.body.expense_id, 10), req.labelId);
    if (!root) return res.status(400).json({ success: false, error: 'Ledger entry not found' });
    const exp = (await pool.query(
      `SELECT e.id, e.payee, e.invoice_date, e.entry_source, COALESCE(e.currency, 'USD') AS currency,
              (e.amount + COALESCE((SELECT SUM(k.amount) FROM expenses k WHERE k.parent_id = e.id AND (k.deleted=false OR k.deleted IS NULL)), 0)) AS family_amount
         FROM expenses e WHERE e.id = $1 AND e.label_id = $2`,
      [root, req.labelId]
    )).rows[0];
    if (!exp) return res.status(400).json({ success: false, error: 'Ledger entry not found' });
    // A bank-booked entry is not an invoice for another bank line.
    if (exp.entry_source === 'bank_statement') {
      return res.status(400).json({ success: false, error: 'That entry was itself created from a bank line — match a real invoice, or dismiss this line' });
    }
    // One-debit-per-invoice, layer 2 (capacity model — installments allowed
    // up to the family total, never beyond).
    const claimed = (await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS s FROM bank_transactions
        WHERE label_id = $1 AND matched_expense_id = $2 AND dismissed = FALSE AND id <> $3`,
      [req.labelId, root, t.id]
    )).rows[0];
    const claimedTotal = Number(claimed.s) || 0;
    const familyTotal = Number(exp.family_amount) || 0;
    const tol = claimedTotal > 0 ? 0.01 : Math.max(35, familyTotal * 0.01);
    if (claimedTotal + Number(t.amount) > familyTotal + tol) {
      const holder = (await pool.query(
        `SELECT amount, txn_date FROM bank_transactions WHERE label_id = $1 AND matched_expense_id = $2 AND dismissed = FALSE ORDER BY matched_at DESC NULLS LAST LIMIT 1`,
        [req.labelId, root]
      )).rows[0];
      return res.status(409).json({
        success: false,
        error: holder
          ? `That invoice is already covered by a ${Number(holder.amount).toFixed(2)} debit on ${String(holder.txn_date).slice(0, 10)} — unmatch that one first`
          : 'That would over-pay the invoice',
      });
    }
    // Bank-before-invoice is impossible, not odd — refuse unless the caller
    // explicitly allows a prepayment.
    if (exp.invoice_date && String(t.txn_date).slice(0, 10) < String(exp.invoice_date).slice(0, 10)) {
      const early = Math.round((new Date(String(exp.invoice_date).slice(0, 10)) - new Date(String(t.txn_date).slice(0, 10))) / 86400000);
      if (early > 5 && req.body.allow_prepayment !== true) {
        return res.status(400).json({
          success: false, prepayment_possible: true,
          error: `The bank debit predates the invoice by ${early} days — a payment before its invoice is usually a wrong match. Pass allow_prepayment to record it anyway.`,
        });
      }
    }
    // Creator payments record method 'creator' so they never count as
    // invoice-backed ("explained" and "documented" are different claims).
    await pool.query(
      `UPDATE bank_transactions SET matched_expense_id = $1,
         match_method = ${require('../lib/ledgerSource').movedMatchMethodSql('$1', 'manual')},
         match_score = 1.0,
         matched_by = $2, matched_at = NOW(), dismissed = FALSE, dismissed_reason = NULL, booked = FALSE WHERE id = $3 AND label_id = $4`,
      [root, req.user.name, t.id, req.labelId]
    );
    if (exp.payee) await R.learnPayee(pool, req.labelId, t.payee_guess || t.description, exp.payee, req.user.name);
    res.json({ success: true });
  } catch (e) { console.error('Match error:', e); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// Plain unlink (leaves any ledger entry untouched) — and RECORD the "no", so
// the auto-matcher and suggestions never re-propose this exact pair, even
// across a statement re-upload (fingerprint-keyed).
router.post('/txns/:id/unmatch', async (req, res) => {
  try {
    const t = await loadTxn(parseInt(req.params.id, 10), req.labelId);
    if (!t) return res.status(404).json({ success: false, error: 'Not found' });
    if (t.matched_expense_id && t.match_method !== 'created') {
      await pool.query(
        `INSERT INTO statement_match_rejections (label_id, txn_fingerprint, expense_root_id, source, created_by)
         VALUES ($1, $2, $3, 'unmatch', $4) ON CONFLICT DO NOTHING`,
        [req.labelId, R.txnFingerprint(t), t.matched_expense_id, req.user.name]
      ).catch(() => {});
    }
    await pool.query(
      `UPDATE bank_transactions SET matched_expense_id = NULL, match_method = NULL, match_score = NULL, matched_by = NULL, matched_at = NULL, booked = FALSE WHERE id = $1 AND label_id = $2`,
      [t.id, req.labelId]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// Unbook — soft-delete the entry this txn created AND reopen the txn, in one
// transaction (a plain unlink would orphan the created entry).
router.post('/txns/:id/unbook', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = (await client.query('SELECT * FROM bank_transactions WHERE id = $1 AND label_id = $2 FOR UPDATE', [parseInt(req.params.id, 10), req.labelId])).rows[0];
    if (!t || !t.booked || !t.matched_expense_id) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: 'Not a booked transaction' }); }
    await client.query(
      `UPDATE expenses SET deleted = true, deleted_by = $3, deleted_at = NOW() WHERE (id = $1 OR parent_id = $1) AND label_id = $2`,
      [t.matched_expense_id, req.labelId, req.user.name]
    );
    await client.query(`UPDATE bank_transactions SET matched_expense_id = NULL, match_method = NULL, match_score = NULL, matched_by = NULL, matched_at = NULL, booked = FALSE WHERE id = $1`, [t.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error('Unbook error:', e); res.status(500).json({ success: false, error: 'Internal server error' }); }
  finally { client.release(); }
});

// Book an OPEN debit as an approved+Paid entry (optionally with a category rule).
router.post('/txns/:id/book', async (req, res) => {
  try {
    const t = await loadTxn(parseInt(req.params.id, 10), req.labelId);
    if (!t) return res.status(404).json({ success: false, error: 'Not found' });
    if (t.direction !== 'debit') return res.status(400).json({ success: false, error: 'Only debits can be booked' });
    const methods = await accountMethodsForTxn(t, req.labelId);
    const entry = await bookEntry(pool, req.labelId, t, {
      category: req.body.category || null, payee: req.body.payee || null, artist: req.body.artist || null,
      method: (req.body.method || (methods && methods[0])) || null, actor: req.user.name,
    });
    await pool.query(
      `UPDATE bank_transactions SET matched_expense_id = $1, match_method = 'booked', match_score = 1.0, matched_by = $2, matched_at = NOW(), booked = TRUE, dismissed = FALSE, dismissed_reason = NULL WHERE id = $3 AND label_id = $4`,
      [entry.id, req.user.name, t.id, req.labelId]
    );
    // Optional "always book <payee> as <category>" rule.
    if (req.body.rule && req.body.category && (t.payee_guess || t.description)) {
      await pool.query('INSERT INTO statement_category_rules (label_id, pattern, category, created_by) VALUES ($1,$2,$3,$4)',
        [req.labelId, (t.payee_guess || t.description).slice(0, 120), req.body.category, req.user.name]);
    }
    await logActivity(req, 'Booked bank debit', `${entry.payee} — ${entry.amount}`);
    res.json({ success: true, data: entry });
  } catch (e) { console.error('Book error:', e); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// Mark a matched (To-confirm) txn's family Paid — writes bank date + reference
// through the family cascade.
async function markTxnPaid(txn, actor) {
  const root = txn.matched_expense_id;
  if (!root) return;
  await cascadePaymentFieldsToFamily(pool, root, txn.label_id, {
    payment_status: 'Paid', payment_date: txn.txn_date, paid_by: actor, payment_ref: txn.reference || null, paid_marked_at: new Date(),
  });
  const fam = await pool.query('SELECT id FROM expenses WHERE (id = $1 OR parent_id = $1) AND label_id = $2', [root, txn.label_id]);
  fam.rows.forEach(r => stampFxRateAsync(r.id));
}
router.post('/txns/:id/mark-paid', async (req, res) => {
  try {
    const t = await loadTxn(parseInt(req.params.id, 10), req.labelId);
    if (!t || !t.matched_expense_id) return res.status(400).json({ success: false, error: 'Nothing matched to pay' });
    await markTxnPaid(t, req.user.name);
    res.json({ success: true });
  } catch (e) { console.error('Mark paid error:', e); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// Dismiss / restore.
router.post('/txns/:id/dismiss', async (req, res) => {
  try {
    const t = await loadTxn(parseInt(req.params.id, 10), req.labelId);
    if (!t) return res.status(404).json({ success: false, error: 'Not found' });
    await pool.query(`UPDATE bank_transactions SET dismissed = TRUE, dismissed_reason = COALESCE($2,'manual'), matched_expense_id = NULL, match_method = NULL, booked = FALSE WHERE id = $1 AND label_id = $3`,
      [t.id, req.body.reason || null, req.labelId]);
    if (req.body.rule && (t.payee_guess || t.description)) {
      await pool.query('INSERT INTO statement_dismiss_rules (label_id, pattern, created_by) VALUES ($1,$2,$3)',
        [req.labelId, (t.payee_guess || t.description).slice(0, 120), req.user.name]);
    }
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.post('/txns/:id/restore', async (req, res) => {
  try {
    await pool.query(`UPDATE bank_transactions SET dismissed = FALSE, dismissed_reason = NULL WHERE id = $1 AND label_id = $2`, [parseInt(req.params.id, 10), req.labelId]);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── Bulk actions ──────────────────────────────────────────────────────────
// ── Credits are income (Money in) ────────────────────────────────────────────
// Debits reconcile to expenses; credits book to artist_income. The income
// type is validated against the live vocabulary and REJECTED, never coerced —
// a coerced typo looks like a successful booking onto the wrong P&L line.
router.post('/txns/:id/book-income', async (req, res) => {
  const client = await pool.connect();
  try {
    const t = await loadTxn(parseInt(req.params.id, 10), req.labelId);
    if (!t) return res.status(404).json({ success: false, error: 'Not found' });
    if (t.direction !== 'credit') return res.status(400).json({ success: false, error: 'Only credits book as income' });
    const incomeType = String(req.body.income_type || '').trim();
    const vocab = (await pool.query(
      `SELECT name FROM categories WHERE label_id = $1 AND kind = 'income' AND active = TRUE`,
      [req.labelId]
    )).rows.map(r => r.name);
    const known = vocab.length ? vocab : require('../lib/seedCategories').INCOME_SEED.map(s => s[0]);
    if (!known.some(n => n.toLowerCase() === incomeType.toLowerCase())) {
      return res.status(400).json({ success: false, error: `"${incomeType}" is not an income type — pick one from the list` });
    }
    let artistId = null;
    if (req.body.artist_id) {
      const a = await pool.query('SELECT id FROM artists WHERE id = $1 AND label_id = $2', [parseInt(req.body.artist_id, 10), req.labelId]);
      if (a.rows.length) artistId = a.rows[0].id;
    }
    await client.query('BEGIN');
    const income = (await client.query(
      `INSERT INTO artist_income (label_id, artist_id, source, description, amount, currency, income_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [req.labelId, artistId, incomeType, req.body.description || t.payee_guess || t.description || null,
       t.amount, t.currency || 'USD', t.txn_date, req.user.id]
    )).rows[0];
    // Atomic claim — a lost race deletes the income row it just made.
    const claim = await client.query(
      `UPDATE bank_transactions SET matched_income_id = $1, match_method = 'created-income',
              matched_by = $2, matched_at = NOW(), dismissed = FALSE, dismissed_reason = NULL
        WHERE id = $3 AND label_id = $4 AND matched_income_id IS NULL AND matched_expense_id IS NULL AND dismissed = FALSE
        RETURNING id`,
      [income.id, req.user.name, t.id, req.labelId]
    );
    if (!claim.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'That credit was just answered by someone else' });
    }
    await client.query('COMMIT');
    await logActivity(req, 'Booked bank credit as income', `#${t.id} → ${incomeType}`);
    res.json({ success: true, data: { income_id: income.id } });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('book-income error:', e);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally { client.release(); }
});

// Unbook income — hard-delete the created income row, reopen the credit.
router.post('/txns/:id/unbook-income', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = (await client.query('SELECT * FROM bank_transactions WHERE id = $1 AND label_id = $2 FOR UPDATE', [parseInt(req.params.id, 10), req.labelId])).rows[0];
    if (!t || !t.matched_income_id) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: 'Not booked as income' }); }
    await client.query('DELETE FROM artist_income WHERE id = $1 AND label_id = $2', [t.matched_income_id, req.labelId]);
    await client.query(`UPDATE bank_transactions SET matched_income_id = NULL, match_method = NULL, matched_by = NULL, matched_at = NULL WHERE id = $1`, [t.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error('unbook-income error:', e); res.status(500).json({ success: false, error: 'Internal server error' }); }
  finally { client.release(); }
});

router.post('/txns/bulk', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
    const action = req.body.action;
    if (!ids.length) return res.status(400).json({ success: false, error: 'No transactions selected' });
    const { rows } = await pool.query('SELECT * FROM bank_transactions WHERE id = ANY($1::int[]) AND label_id = $2', [ids, req.labelId]);
    let n = 0;
    if (action === 'dismiss') {
      await pool.query(`UPDATE bank_transactions SET dismissed = TRUE, dismissed_reason = 'manual', matched_expense_id = NULL, booked = FALSE WHERE id = ANY($1::int[]) AND label_id = $2`, [ids, req.labelId]);
      n = rows.length;
    } else if (action === 'book') {
      for (const t of rows) {
        if (t.direction !== 'debit' || t.dismissed || t.matched_expense_id) continue;
        const methods = await accountMethodsForTxn(t, req.labelId);
        const entry = await bookEntry(pool, req.labelId, t, { category: req.body.category || null, method: methods && methods[0], actor: req.user.name });
        await pool.query(`UPDATE bank_transactions SET matched_expense_id = $1, match_method = 'booked', match_score = 1.0, matched_by = $2, matched_at = NOW(), booked = TRUE WHERE id = $3`, [entry.id, req.user.name, t.id]);
        n++;
      }
    } else if (action === 'mark-paid') {
      for (const t of rows) { if (t.matched_expense_id) { await markTxnPaid(t, req.user.name); n++; } }
    } else if (action === 'accept-suggestions') {
      // Accept the single best ≥0.9 suggestion for each open txn.
      const maps = await R.loadMaps(pool, req.labelId);
      for (const t of rows) {
        if (t.direction !== 'debit' || t.dismissed || t.matched_expense_id) continue;
        const methods = await accountMethodsForTxn(t, req.labelId);
        const sugg = await R.suggestions(pool, req.labelId, t, methods, maps);
        const best = sugg[0];
        if (best && best.score >= 0.9) {
          const root = await familyRoot(pool, best.expense_id, req.labelId);
          await pool.query(`UPDATE bank_transactions SET matched_expense_id = $1, match_method = ${require('../lib/ledgerSource').movedMatchMethodSql('$1', 'manual')}, match_score = $2, matched_by = $3, matched_at = NOW() WHERE id = $4`, [root, best.score, req.user.name, t.id]);
          const exp = (await pool.query('SELECT payee FROM expenses WHERE id = $1', [root])).rows[0];
          if (exp) await R.learnPayee(pool, req.labelId, t.payee_guess || t.description, exp.payee, req.user.name);
          n++;
        }
      }
    } else return res.status(400).json({ success: false, error: 'Unknown bulk action' });
    res.json({ success: true, data: { affected: n } });
  } catch (e) { console.error('Bulk error:', e); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── Flags — cross-statement integrity checks ────────────────────────────────
router.get('/flags', async (req, res) => {
  try {
    const data = await require('../lib/statementFlags').buildFlags(req.labelId);
    res.json({ success: true, data });
  } catch (e) { console.error('flags error:', e); res.status(500).json({ success: false, error: 'Flags failed' }); }
});
router.post('/flags/ack', async (req, res) => {
  try {
    const fp = String(req.body.fingerprint || '');
    if (!fp) return res.status(400).json({ success: false, error: 'fingerprint required' });
    await pool.query(
      `INSERT INTO statement_flag_acks (label_id, fingerprint, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [req.labelId, fp, req.user.name]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});
router.delete('/flags/ack', async (req, res) => {
  try {
    await pool.query(`DELETE FROM statement_flag_acks WHERE label_id = $1 AND fingerprint = $2`, [req.labelId, String(req.body.fingerprint || req.query.fingerprint || '')]);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});
// Flag actions with no prior endpoint:
router.post('/txns/dismiss-pair', async (req, res) => {
  try {
    const ids = (req.body.txn_ids || []).map(Number).filter(Boolean).slice(0, 2);
    if (ids.length !== 2) return res.status(400).json({ success: false, error: 'two txn_ids required' });
    await pool.query(
      `UPDATE bank_transactions SET dismissed = TRUE, dismissed_reason = 'manual',
              matched_expense_id = CASE WHEN match_method = 'created' THEN matched_expense_id ELSE NULL END,
              booked = booked
        WHERE id = ANY($1::int[]) AND label_id = $2 AND match_method IS DISTINCT FROM 'created' AND matched_income_id IS NULL`,
      [ids, req.labelId]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});
router.post('/flags/mark-unpaid', async (req, res) => {
  try {
    const id = parseInt(req.body.entry_id, 10);
    const root = await familyRoot(pool, id, req.labelId);
    if (!root) return res.status(404).json({ success: false, error: 'No such entry' });
    await cascadePaymentFieldsToFamily(pool, root, req.labelId, {
      payment_status: 'Unpaid', payment_date: null, paid_by: null, payment_ref: null, fx_rate_to_usd: null, paid_marked_at: null,
    });
    await logActivity(req, 'Marked unpaid from statement flags', `entry #${id}`);
    res.json({ success: true });
  } catch (e) { console.error('mark-unpaid error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});
router.post('/rules/alias', async (req, res) => {
  try {
    const alias = String(req.body.bank_payee || '').trim();
    const canonical = String(req.body.ledger_payee || '').trim();
    if (!alias || !canonical) return res.status(400).json({ success: false, error: 'bank_payee and ledger_payee required' });
    await pool.query(
      `INSERT INTO vendor_aliases (label_id, alias, canonical, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [req.labelId, alias, canonical, req.user.name]
    ).catch(async () => {
      await pool.query(`INSERT INTO vendor_aliases (label_id, alias, canonical) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [req.labelId, alias, canonical]);
    });
    await R.learnPayee(pool, req.labelId, alias, canonical, req.user.name);
    res.json({ success: true });
  } catch (e) { console.error('alias error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

// ── Monthly soft close ───────────────────────────────────────────────────────
router.get('/months', async (req, res) => {
  try {
    const txns = (await pool.query(
      `SELECT t.txn_date, t.direction, t.amount, t.currency, t.dismissed, t.matched_expense_id, t.matched_income_id, s.account
         FROM bank_transactions t JOIN bank_statements s ON s.id = t.statement_id AND s.status = 'ready'
        WHERE t.label_id = $1`,
      [req.labelId]
    )).rows;
    const closed = new Map(
      (await pool.query(`SELECT month_key, reconciled_by, reconciled_at FROM statement_months WHERE label_id = $1`, [req.labelId]))
        .rows.map(r => [r.month_key, r])
    );
    const months = {};
    for (const t of txns) {
      const mk = String(t.txn_date).slice(0, 7);
      const m = months[mk] || (months[mk] = { month_key: mk, accounts: new Set(), debits: 0, matched: 0, dismissed: 0, open_debits: 0, open_credits: 0 });
      m.accounts.add(t.account);
      if (t.direction === 'debit') {
        if (t.dismissed) m.dismissed += 1;
        else {
          m.debits += 1;
          if (t.matched_expense_id) m.matched += 1; else m.open_debits += 1;
        }
      } else if (!t.dismissed && !t.matched_income_id) m.open_credits += 1;
    }
    const out = Object.values(months)
      .map(m => ({
        ...m, accounts: [...m.accounts],
        coverage: m.debits + m.dismissed > 0 ? Math.round(((m.matched + m.dismissed) / (m.debits + m.dismissed)) * 100) : 100,
        reconciled_by: closed.get(m.month_key)?.reconciled_by || null,
        reconciled_at: closed.get(m.month_key)?.reconciled_at || null,
      }))
      .sort((a, b) => (a.month_key < b.month_key ? 1 : -1));
    res.json({ success: true, data: out });
  } catch (e) { console.error('months error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});
router.post('/months/:key([0-9]{4}-[0-9]{2})/reconcile', async (req, res) => {
  try {
    const key = req.params.key;
    if (req.body.undo) {
      await pool.query(`DELETE FROM statement_months WHERE label_id = $1 AND month_key = $2`, [req.labelId, key]);
      await logActivity(req, 'Reopened bank month', key);
      activityBot.postEvent(req.labelId, { text: `🏦 Bank month *${key}* reopened by ${req.user.name}`, icon: 'landmark', link: '/bank-matching' });
    } else {
      await pool.query(
        `INSERT INTO statement_months (label_id, month_key, reconciled_by) VALUES ($1, $2, $3)
         ON CONFLICT (label_id, month_key) DO UPDATE SET reconciled_by = EXCLUDED.reconciled_by, reconciled_at = NOW()`,
        [req.labelId, key, req.user.name]
      );
      await logActivity(req, 'Reconciled bank month', key);
      activityBot.postEvent(req.labelId, { text: `🏦 Bank month *${key}* marked reconciled by ${req.user.name}`, icon: 'landmark', link: '/bank-matching' });
    }
    res.json({ success: true });
  } catch (e) { console.error('reconcile error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

// ── Global transaction search — every txn on every statement ────────────────
router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ success: true, data: [] });
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    const params = [req.labelId, like];
    let amountClause = '';
    const num = q.replace(/[$,]/g, '');
    if (/^\d+(\.\d{1,2})?$/.test(num)) { params.push(Number(num)); amountClause = ` OR t.amount = $${params.length}`; }
    const { rows } = await pool.query(
      `SELECT t.id, t.txn_date, t.payee_guess, t.description, t.payee_email, t.reference, t.amount, t.currency,
              t.direction, t.dismissed, t.booked, t.matched_expense_id, t.matched_income_id, t.match_method,
              t.statement_id, s.filename, s.account, e.payee AS exp_payee
         FROM bank_transactions t
         JOIN bank_statements s ON s.id = t.statement_id
         LEFT JOIN expenses e ON e.id = t.matched_expense_id
        WHERE t.label_id = $1 AND (
          t.payee_guess ILIKE $2 OR t.description ILIKE $2 OR t.payee_email ILIKE $2
          OR t.reference ILIKE $2 OR e.payee ILIKE $2${amountClause})
        ORDER BY t.txn_date DESC, t.id DESC
        LIMIT 50`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (e) { console.error('statement search error:', e); res.status(500).json({ success: false, error: 'Search failed' }); }
});

// ── Rules management ────────────────────────────────────────────────────────
router.delete('/rules/dismiss/:id', async (req, res) => {
  try { await pool.query('DELETE FROM statement_dismiss_rules WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]); res.json({ success: true }); }
  catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.delete('/rules/category/:id', async (req, res) => {
  try { await pool.query('DELETE FROM statement_category_rules WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]); res.json({ success: true }); }
  catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

module.exports = router;
