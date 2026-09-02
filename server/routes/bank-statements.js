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
const activityBot = require('../lib/activityBot');
const { parseStatementText } = require('../lib/statementPdfText');
const audit = require('../lib/statementAudit');
const { sendFileSafely } = require('../lib/safeFiles');
const { usdOf } = require('../lib/usd');
const { pairReversals } = require('../lib/reversalPairs');
const { restoreDisplacedBooking } = require('../lib/statementLinks');
const lens = require('../lib/statementLens');
const { dispositionOf } = lens;

const router = express.Router();
router.use(authMiddleware, withTenant, requireAdmin);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

// Background audit line (parse outcomes have no req). user_id NULL, method
// 'SYSTEM' — same table the request-path logActivity writes.
async function logBg(labelId, action, detail) {
  await pool.query(
    `INSERT INTO activity_log (label_id, user_id, action, detail, method, endpoint, created_at)
     VALUES ($1, NULL, $2, $3, 'SYSTEM', '/api/bank-statements', NOW())`,
    [labelId, action, String(detail || '').slice(0, 2000)]
  ).catch(() => {});
}

// ── Housekeeping throttles (per label, never concurrent per process) ─────────
// Boom's 2026-08-04 outage lesson: idempotent maintenance running on EVERY
// list load stacks full-table scans until the pool starves. 10 min/label.
const sweepsLast = new Map();          // labelId -> ts
let sweepsInFlight = false;
const rematchLast = new Map();         // statement id -> last freshness re-run ts
const rematchLabelBusy = new Set();    // labels with a matcher pass running
let portfolioAuditInFlight = false;    // one whole-portfolio extras audit at a time
let balBackfillInFlight = false;
const balBackfillSkip = new Set();     // statement ids whose file shows no balance

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
  'FIRST output exactly two header lines with the balances the document prints (leave empty after the pipe when not printed; take them from the statement\'s own summary — never compute them):\n' +
  'BEGINNING_BALANCE|<number>\n' +
  'ENDING_BALANCE|<number>\n' +
  'Then output ONE LINE PER TRANSACTION in the exact pipe-delimited format:\n' +
  'DATE|DIRECTION|AMOUNT|CURRENCY|AMOUNT_USD|PAYEE|EMAIL|REFERENCE|DESCRIPTION\n' +
  'DATE is YYYY-MM-DD. DIRECTION is "debit" (money out) or "credit" (money in). AMOUNT is the positive number with no currency symbol or commas, in the transaction\'s OWN currency. ' +
  'CURRENCY is the 3-letter ISO code of the amount (USD, EUR, JPY, GBP…) — PayPal statements list foreign-currency transactions; never write USD for a JPY amount. ' +
  'AMOUNT_USD: ONLY when CURRENCY is not USD — the US-dollar settlement the statement prints for that transaction. Leave EMPTY when CURRENCY is USD, and leave it blank rather than estimating. ' +
  'PAYEE is the counterparty NAME ONLY (for wires the BNF/beneficiary; for card charges the merchant; for PayPal the recipient). Never an email address. ' +
  'ACH lines look like "MERCHANT DES:<descriptor> ID:<id> INDN:<person> CO ID:<id> WEB" — the PAYEE is the MERCHANT at the START, before "DES:". The INDN field is the individual on OUR OWN account, never the counterparty; taking INDN puts real people\'s names into the vendor ledger where they read as 1099 vendors. ' +
  'Internal-transfer lines look like "TRANSFER <our account>:<counterparty> Confirmation# <digits>" (REVERSAL the same) — the PAYEE is the counterparty AFTER the colon; the name before it is OUR OWN account. Never return the raw statement line as the payee; if you cannot isolate a name, leave PAYEE blank. ' +
  'EMAIL is the counterparty email when printed (empty if none). REFERENCE is any confirmation/reference number (empty if none). ' +
  'DESCRIPTION is the raw line text (replace any | in it with /). Apart from those two header lines, do NOT output JSON, headers, totals, commentary, or markdown — only transaction lines. Include EVERY transaction.';

// Deterministic-first: rules over extracted text win ONLY when the parse
// reconciles against the statement's own printed balances and section totals
// (the gate is the whole safety argument — a layout change or a bad text
// extraction can cost the fast path, never correctness). Anything else falls
// through to the AI. Returns {rows, balances, method} or null.
function tryDeterministicPdf(buffer) {
  let out = null;
  try { out = parseStatementText(buffer); } catch { return null; }
  if (!out) return null;
  if (!out.ok) {
    console.warn(`[statement-parse] deterministic parse did not reconcile (${out.verdict?.reason || 'unknown'}) — falling back to AI`);
    return null;
  }
  return {
    // Same payee extraction the CSV path applies to descriptors, so matching
    // and vendor grouping behave identically whichever path ran.
    rows: out.rows.map((r) => ({ ...r, payee_guess: r.payee_guess || R.extractPayee(r.description) })),
    balances: { beginning_balance: out.beginningBalance, ending_balance: out.endingBalance },
    method: 'rules',
  };
}

async function parsePdfStatement(statementId, labelId, account, buffer, mimeType) {
  try {
    const det = tryDeterministicPdf(buffer);
    if (det) {
      await ingest(statementId, labelId, account, det.rows, det.balances, { parseMethod: 'rules' });
      await logBg(labelId, 'Parsed bank statement (PDF)', `#${statementId} ${account}: rule-parsed, balance-verified — ${det.rows.length} transactions`);
      return;
    }
    if (!claude.isEnabled()) {
      await failStatement(statementId, 'The PDF did not parse deterministically and AI is not configured — upload the CSV export instead.');
      return;
    }
    const block = claude.fileBlock(buffer, mimeType);
    if (!block) { await failStatement(statementId, 'Unsupported file type'); return; }
    const r = await claude.streamText({ content: [block, { type: 'text', text: PIPE_INSTRUCTION }], maxTokens: 32000 });
    if (!r.ok) { await failStatement(statementId, r.error || 'AI parse failed'); return; }
    if (r.stop_reason === 'max_tokens') { await failStatement(statementId, 'Statement too long to parse — please upload the CSV export instead.'); return; }
    const txns = R.parsePipeLines(r.text);
    if (!txns.length) { await failStatement(statementId, 'No transactions found — try the CSV export.'); return; }
    await ingest(statementId, labelId, account, txns, R.extractBalanceLines(r.text), { parseMethod: 'ai' });
    await logBg(labelId, 'Parsed bank statement (PDF)', `#${statementId} ${account}: AI-parsed — ${txns.length} transactions`);
  } catch (e) {
    await failStatement(statementId, e.message);
  }
}
async function failStatement(id, error) {
  await pool.query(`UPDATE bank_statements SET status = 'error', error = $2 WHERE id = $1`, [id, String(error || '').slice(0, 500)]).catch(() => {});
}

// ── Ingest: dedupe → auto-dismiss internal → dismiss rules → auto-match →
// category rules (after matching) → write import_summary ─────────────────────
// Split into a context + a per-row step so the strictly-additive /reparse can
// run EXACTLY the same pipeline over just the rows a re-parse found missing.
async function buildIngestCtx(labelId, account) {
  const labelRow = (await pool.query('SELECT bank_accounts FROM labels WHERE id = $1', [labelId])).rows[0] || {};
  const accounts = R.accountsFor(labelRow);
  const methods = R.accountMethods(accounts, account);
  const maps = await R.loadMaps(pool, labelId);
  const dismissRules = (await pool.query('SELECT pattern FROM statement_dismiss_rules WHERE label_id = $1', [labelId])).rows.map(r => r.pattern);
  const catRules = (await pool.query('SELECT pattern, category FROM statement_category_rules WHERE label_id = $1', [labelId])).rows;
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
  const summary = { dup_skipped: 0, auto_matched: 0, rule_booked: 0, rule_dismissed: 0, reasons: {} };
  return { labelId, account, methods, maps, dismissRules, catRules, used, summary };
}

const ruleHit = (rules, txn) => {
  const hay = `${txn.description || ''} ${txn.payee_guess || ''}`.toLowerCase();
  return rules.find(p => hay.includes(String(p).toLowerCase()));
};

// Process ONE raw parsed row: dedupe → internal → dismiss rules → auto-match →
// category rules → insert. Returns 'dup' | 'inserted'.
async function ingestOne(ctx, statementId, raw) {
  const { labelId, account, methods, maps, dismissRules, catRules, used, summary } = ctx;
  // Pull an email out of the payee wherever it arrived mashed together.
  const es = R.splitPayeeEmail(raw.payee_guess);
  const t = { ...raw, payee_guess: es.payee, payee_email: raw.payee_email || es.email };
  const currency = t.currency || 'USD';
  // Backfill the reference from the descriptor (TRN: / Confirmation#) so the
  // dedupe below has the one field that identifies a payment.
  const ref = String(t.reference || '').trim() || audit.refFromDescription(t.description) || '';

  // (a) Dedupe. Across OTHER statements of the same account: reference match
  // when both have one, else same description — an overlapping or re-uploaded
  // month must not double-book the period. Within THIS statement: only a REAL
  // reference may collapse two rows — N identical same-day charges are
  // ordinary (boom's motivating extras case was 30 legitimate $1.00 fees in
  // one day), so description equality must never fold them.
  const dup = await pool.query(
    `SELECT 1 FROM bank_transactions bt JOIN bank_statements bs ON bs.id = bt.statement_id
      WHERE bs.label_id = $1 AND bs.account = $2 AND bt.txn_date = $3 AND bt.amount = $4 AND bt.direction = $5
        AND (
          (bt.statement_id <> $8 AND (
            ($6 <> '' AND bt.reference = $6)
            OR ($6 = '' AND COALESCE(bt.description,'') = $7)))
          OR (bt.statement_id = $8 AND $6 <> ''
            AND (bt.reference = $6 OR bt.description LIKE '%' || $6 || '%'))
        ) LIMIT 1`,
    [labelId, account, t.txn_date, t.amount, t.direction, ref, t.description || '', statementId]
  );
  if (dup.rows.length) { summary.dup_skipped++; return 'dup'; }

  let dismissed = false, dismissedReason = null, matchedId = null, method = null, score = null, booked = false;

  // (b) Auto-dismiss internal movement (both parse paths).
  if (R.isInternal(t.description, t.payee_guess)) { dismissed = true; dismissedReason = 'internal'; }
  // (c) Dismiss rules — the reason names the pattern (an anonymous 'auto'
  // makes "why is this dismissed" unanswerable a month later).
  else {
    const hit = ruleHit(dismissRules, t);
    if (hit) { dismissed = true; dismissedReason = `rule: ${hit}`.slice(0, 120); summary.rule_dismissed++; }
  }

  if (!dismissed && t.direction === 'debit') {
    // Auto-match against the ledger — and when it declines, keep the WHY.
    // The first thing anyone wants after an upload is not "40 matched" but
    // "what about the other 396", and the answer used to be unrecoverable.
    const why = {};
    const m = await R.matchTxn(pool, labelId, { ...t, currency }, methods, maps, used, why);
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
      } else {
        const reason = why.reason || 'no-candidate';
        summary.reasons[reason] = (summary.reasons[reason] || 0) + 1;
      }
    }
  }

  await pool.query(
    `INSERT INTO bank_transactions (statement_id, label_id, txn_date, description, payee_guess, payee_email, amount, direction,
       currency, reference, fee, amount_usd, matched_expense_id, match_method, match_score, matched_by, matched_at, booked, dismissed, dismissed_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,${matchedId ? 'NOW()' : 'NULL'},$17,$18,$19)`,
    [statementId, labelId, t.txn_date, t.description || null, t.payee_guess || null, t.payee_email || null, t.amount, t.direction,
     currency, ref || null, t.fee || null, t.amount_usd || null, matchedId, method, score, matchedId ? 'Auto' : null, booked, dismissed, dismissedReason]
  );
  return 'inserted';
}

async function ingest(statementId, labelId, account, rawTxns, balances = {}, opts = {}) {
  const ctx = await buildIngestCtx(labelId, account);
  for (const raw of rawTxns) await ingestOne(ctx, statementId, raw);
  const summary = ctx.summary;
  if (opts.parseMethod) summary.parse_method = opts.parseMethod;

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
// PUT /accounts — replace this label's account list.
//
// `key` is the join between a statement and its account: bank_statements.account
// stores the key string, and lib/bankEvidence.js builds per-account payment-
// method compatibility from these rows. So a key that disappears while
// statements still reference it doesn't fail loudly — those statements quietly
// fall through to "any method is compatible", weakening every match decision
// made against them. Removing an in-use key is therefore refused, and renaming
// a LABEL (display text) is always fine because nothing joins on it.
router.put('/accounts', async (req, res) => {
  try {
    const raw = Array.isArray(req.body.accounts) ? req.body.accounts : [];
    if (raw.length > 25) return res.status(400).json({ success: false, error: 'Too many accounts' });

    const seen = new Set();
    const list = [];
    for (const a of raw) {
      const key = String(a?.key || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
      const label = String(a?.label || '').trim().slice(0, 80);
      if (!key || !label) continue;
      // Two rows with one key make the CASE in bankEvidence unreachable past
      // the first — a silent, order-dependent rule.
      if (seen.has(key)) return res.status(400).json({ success: false, error: `Duplicate account key "${key}"` });
      seen.add(key);
      const methods = Array.isArray(a.methods)
        ? [...new Set(a.methods.map(m => String(m || '').trim()).filter(Boolean).slice(0, 20))]
        : null;
      // An empty array and null mean different things downstream (accountMethods
      // returns the array as-is), and an empty one would match NOTHING. Normalize
      // "no restriction" to null.
      list.push({ key, label, methods: methods && methods.length ? methods : null });
    }
    if (!list.length) return res.status(400).json({ success: false, error: 'Provide at least one account' });

    const before = R.accountsFor((await pool.query('SELECT bank_accounts FROM labels WHERE id = $1', [req.labelId])).rows[0] || {});
    const removed = before.map(a => a.key).filter(k => !seen.has(k));
    if (removed.length) {
      const { rows } = await pool.query(
        `SELECT account, COUNT(*)::int AS n FROM bank_statements
          WHERE label_id = $1 AND account = ANY($2::text[]) GROUP BY account`,
        [req.labelId, removed]
      );
      if (rows.length) {
        return res.status(409).json({
          success: false,
          error: `Can't remove ${rows.map(r => `"${r.account}" (${r.n} statement${r.n === 1 ? '' : 's'})`).join(', ')} — statements are filed under it. Rename its label instead.`,
        });
      }
    }

    await pool.query('UPDATE labels SET bank_accounts = $1::jsonb WHERE id = $2', [JSON.stringify(list), req.labelId]);
    await logActivity(req, 'Updated bank accounts', list.map(a => a.key).join(', '));
    res.json({ success: true, data: list });
  } catch (error) {
    console.error('Update bank accounts error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Housekeeping sweeps (idempotent maintenance, NOT request logic) ─────────
// Throttled to once per 10 minutes per label and never concurrent per
// process — running these on every list load stacked full-table scans until
// the pool starved (boom's 2026-08-04 outage; same shape here).
async function runListSweeps(labelId) {
  // Flip interrupted parses (deploys kill in-flight streams) to error.
  await pool.query(`UPDATE bank_statements SET status = 'error', error = 'Interrupted — please re-upload' WHERE label_id = $1 AND status = 'parsing' AND created_at < NOW() - INTERVAL '25 minutes'`, [labelId]);

  // 1: split emails out of payees on rows that predate payee_email.
  await pool.query(
    `UPDATE bank_transactions SET
       payee_email = LOWER(substring(payee_guess from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}')),
       payee_guess = btrim(regexp_replace(payee_guess, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', '', 'g'), ' /|,-')
     WHERE label_id = $1 AND payee_email IS NULL
       AND payee_guess ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'`,
    [labelId]
  ).catch(() => {});

  // 2: retro internal-noise cleanup — first UNLINK any AUTO-matched internal
  // row (a currency conversion that amount-matched an invoice is a false
  // positive; manual matches are left alone), then dismiss unmatched ones.
  await pool.query(
    `UPDATE bank_transactions SET matched_expense_id = NULL, match_method = NULL,
       match_score = NULL, matched_by = NULL, matched_at = NULL
      WHERE label_id = $1 AND match_method LIKE 'auto%' AND booked = FALSE
        AND (description ~* $2 OR payee_guess ~* $2)`,
    [labelId, R.INTERNAL_RE.source]
  ).catch(() => {});
  await pool.query(
    `UPDATE bank_transactions SET dismissed = TRUE, dismissed_reason = 'internal'
      WHERE label_id = $1 AND dismissed = FALSE AND matched_expense_id IS NULL AND matched_income_id IS NULL
        AND (description ~* $2 OR payee_guess ~* $2)`,
    [labelId, R.INTERNAL_RE.source]
  ).catch(() => {});

  // 3: orphaned statement bookings — an entry CREATED from a bank debit whose
  // link is gone (deleted statement, historical race) keeps counting in the
  // ledger with no bank evidence, the exact "recorded twice" failure once the
  // debit is re-booked. Soft-delete; restorable from the archive.
  // entry_source guarded on BOTH halves so a hand-entered child of a
  // bank-born parent can never be swept.
  try {
    const { rows: orphans } = await pool.query(
      `SELECT id FROM expenses r
        WHERE r.label_id = $1 AND r.entry_source = 'bank_statement' AND r.parent_id IS NULL
          AND (r.deleted = false OR r.deleted IS NULL)
          AND NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.matched_expense_id = r.id AND bt.label_id = r.label_id)`,
      [labelId]);
    if (orphans.length) {
      const ids = orphans.map((r) => r.id);
      await pool.query(
        `UPDATE expenses SET deleted = true, deleted_by = 'orphan-sweep', deleted_at = NOW()
          WHERE label_id = $2 AND (id = ANY($1) OR parent_id = ANY($1)) AND entry_source = 'bank_statement'
            AND (deleted = false OR deleted IS NULL)`, [ids, labelId]);
      await logBg(labelId, 'Statement orphan sweep', `${ids.length} statement-created ledger entr${ids.length === 1 ? 'y' : 'ies'} had no bank link — soft-deleted to prevent double counting`);
    }
  } catch { /* advisory */ }

  // 4: currency repair — rows ingested before currency capture carry the real
  // currency at the end of the description ("General Payment - JPY").
  // ¥237,858 read as $237,858 is the failure this repairs.
  await pool.query(String.raw`
    UPDATE bank_transactions
       SET currency = UPPER(substring(description from '[-–] ?(JPY|EUR|GBP|CAD|AUD|CHF|MXN|BRL|SEK|NOK|DKK|NZD|HKD|SGD|PLN|CZK|HUF|ILS|THB|PHP|TWD) *$'))
     WHERE label_id = $1 AND (currency IS NULL OR currency = 'USD')
       AND description ~ '[-–] ?(JPY|EUR|GBP|CAD|AUD|CHF|MXN|BRL|SEK|NOK|DKK|NZD|HKD|SGD|PLN|CZK|HUF|ILS|THB|PHP|TWD) *$'`,
    [labelId]).catch(() => {});

  // 5: over-capacity — a family may hold several matched debits
  // (installments) but only up to its total. The old sweep here reopened
  // EVERY claim beyond rank 1, which contradicted the match endpoint's
  // capacity model and unlinked legitimate second installments on the next
  // page load. Sum claims against family capacity instead, keeping fits;
  // 'created'/'booked' rows are never unlinked (their entry was created FROM
  // the txn). Cross-currency groups are skipped — raw sums are meaningless.
  try {
    const { rows: multi } = await pool.query(
      `SELECT t.id, t.amount, t.currency, t.match_method, t.booked, t.match_score, t.matched_at,
              t.matched_expense_id AS root
         FROM bank_transactions t
        WHERE t.label_id = $1 AND t.dismissed = FALSE AND t.matched_expense_id IN (
          SELECT matched_expense_id FROM bank_transactions
           WHERE label_id = $1 AND matched_expense_id IS NOT NULL AND dismissed = FALSE
           GROUP BY matched_expense_id HAVING COUNT(*) > 1)`,
      [labelId]);
    if (multi.length) {
      const rootIds = [...new Set(multi.map((r) => r.root))];
      const { rows: fams } = await pool.query(
        `SELECT e.id, COALESCE(e.currency,'USD') AS currency,
                (e.amount + COALESCE((SELECT SUM(k.amount) FROM expenses k WHERE k.parent_id = e.id AND (k.deleted=false OR k.deleted IS NULL)),0)) AS family_total
           FROM expenses e WHERE e.label_id = $1 AND e.id = ANY($2)`,
        [labelId, rootIds]);
      const totalOf = new Map(fams.map((f) => [f.id, Number(f.family_total)]));
      const curOf = new Map(fams.map((f) => [f.id, String(f.currency).toUpperCase()]));
      const strength = (r) =>
        ((r.match_method === 'created' || r.booked) ? 3e12 : r.match_method === 'manual' ? 2e12 : 0)
        + (Number(r.match_score) || 0) * 1e9
        - (r.matched_at ? new Date(r.matched_at).getTime() / 1e6 : 0);
      const unlink = [];
      for (const rootId of rootIds) {
        const total = totalOf.get(rootId);
        if (total === undefined) continue;
        const group = multi.filter((r) => r.root === rootId).sort((a, b) => strength(b) - strength(a));
        const fCur = curOf.get(rootId) || 'USD';
        if (group.some((r) => String(r.currency || 'USD').toUpperCase() !== fCur)) continue;
        let sum = 0;
        for (const r of group) {
          if (r.match_method === 'created' || r.booked) { sum += Number(r.amount); continue; }
          // First-claim-only overshoot, same as the match endpoint —
          // otherwise a second $30 fee squats on a paid $30 entry via the
          // $35 floor.
          const tol = sum > 0 ? 0.01 : Math.max(35, total * 0.01);
          if (sum + Number(r.amount) <= total + tol) sum += Number(r.amount);
          else unlink.push(r.id);
        }
      }
      if (unlink.length) {
        await pool.query(
          `UPDATE bank_transactions SET matched_expense_id = NULL, match_method = NULL,
                  match_score = NULL, matched_by = NULL, matched_at = NULL
            WHERE label_id = $2 AND id = ANY($1)`, [unlink, labelId]);
      }
    }
  } catch { /* advisory — never block the list */ }
}

// Ending-balance backfill: statements missing balances but holding a stored
// file get a deterministic read first (free), then a focused AI pass when
// configured. 2 per cycle, FIRE-AND-FORGET — must never block the request.
function runBalanceBackfill(labelId) {
  if (balBackfillInFlight) return;
  balBackfillInFlight = true;
  (async () => {
    const { rows: needBal } = await pool.query(
      `SELECT id, filename, r2_key FROM bank_statements
        WHERE label_id = $1 AND status = 'ready' AND ending_balance IS NULL AND r2_key IS NOT NULL
        ORDER BY period_end DESC NULLS LAST`, [labelId]);
    const todo = needBal.filter((s) => !balBackfillSkip.has(s.id)).slice(0, 2);
    for (const st of todo) {
      const bal = await readBalancesFromStored(st).catch(() => null);
      if (bal && (bal.ending_balance != null || bal.beginning_balance != null)) {
        await pool.query(
          `UPDATE bank_statements SET ending_balance = COALESCE(ending_balance, $2), beginning_balance = COALESCE(beginning_balance, $3)
            WHERE id = $1 AND label_id = $4`,
          [st.id, bal.ending_balance, bal.beginning_balance, labelId]);
        await logBg(labelId, 'Statement balance backfilled', `#${st.id} "${st.filename}" → ending ${bal.ending_balance ?? '—'} (${bal.method})`);
      } else {
        balBackfillSkip.add(st.id); // no balance found / AI off — don't retry this process
      }
    }
  })().catch((e) => console.warn('[balance-backfill]', e.message))
    .finally(() => { balBackfillInFlight = false; });
}

// Read balances off a statement's STORED file: CSV running-balance column or
// a reconciling deterministic PDF parse; AI single-field extraction last.
async function readBalancesFromStored(st) {
  if (!st.r2_key) return null;
  const buf = await loadFileBuffer(st.r2_key, null);
  if (!buf) return null;
  const isPdf = buf.slice(0, 5).toString() === '%PDF-';
  if (!isPdf) {
    const b = R.extractCsvBalances(buf.toString('utf8'));
    if (b.ending_balance != null || b.beginning_balance != null) return { ...b, method: 'csv' };
    return null;
  }
  const det = tryDeterministicPdf(buf);
  if (det && (det.balances.ending_balance != null || det.balances.beginning_balance != null)) {
    return { ...det.balances, method: 'rules' };
  }
  if (!claude.isEnabled()) return null;
  const block = claude.fileBlock(buf, 'application/pdf');
  if (!block) return null;
  const r = await claude.callClaude({
    content: [block, {
      type: 'text',
      text: 'Return exactly two lines with the balances this bank statement prints (empty after the pipe when not printed):\nBEGINNING_BALANCE|<number>\nENDING_BALANCE|<number>\nNo other output.',
    }],
    maxTokens: 100,
  });
  if (!r.ok) return null;
  const b = R.extractBalanceLines(r.text || (typeof r.data === 'string' ? r.data : ''));
  if (b.ending_balance == null && b.beginning_balance == null) return null;
  return { ...b, method: 'ai' };
}

// ── Statements list ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const now = Date.now();
    if (!sweepsInFlight && now - (sweepsLast.get(req.labelId) || 0) > 10 * 60 * 1000) {
      sweepsInFlight = true;
      sweepsLast.set(req.labelId, now);
      runBalanceBackfill(req.labelId); // fire-and-forget
      try { await runListSweeps(req.labelId); }
      finally { sweepsInFlight = false; }
    }
    // Per-statement work counts, computed here because a cross-statement
    // breakdown is impossible client-side exactly when it is most useful.
    // Explicit FILTERs, never "debits - matched - dismissed" — those overlap.
    const { rows } = await pool.query(
      `SELECT s.*,
         COUNT(t.id) FILTER (WHERE t.direction = 'debit')::int AS debits,
         COUNT(t.id) FILTER (WHERE t.direction = 'debit' AND t.matched_expense_id IS NOT NULL)::int AS matched,
         COUNT(t.id) FILTER (WHERE t.direction = 'debit' AND t.dismissed)::int AS dismissed,
         COUNT(t.id) FILTER (WHERE t.direction = 'debit' AND t.matched_expense_id IS NULL AND t.dismissed = FALSE)::int AS open_debits,
         COUNT(t.id) FILTER (WHERE t.direction = 'debit' AND t.matched_expense_id IS NULL AND t.dismissed = FALSE)::int AS open_count,
         COUNT(t.id) FILTER (WHERE t.direction = 'credit' AND t.matched_income_id IS NULL AND t.dismissed = FALSE)::int AS open_credits,
         COALESCE(SUM(ABS(COALESCE(t.amount_usd, t.amount))) FILTER (
           WHERE t.direction = 'debit' AND t.matched_expense_id IS NULL AND t.dismissed = FALSE
         ), 0)::float AS open_value
       FROM bank_statements s
       LEFT JOIN bank_transactions t ON t.statement_id = s.id
       WHERE s.label_id = $1
       GROUP BY s.id ORDER BY s.created_at DESC`,
      [req.labelId]
    );
    // Flag period overlaps within the same account — an overlapping upload is
    // the main way a month gets double-counted.
    for (const s of rows) {
      if (!s.period_start || !s.period_end) continue;
      const other = rows.find((o) => o.id !== s.id && o.account === s.account
        && o.period_start && o.period_end
        && !(new Date(o.period_end) < new Date(s.period_start) || new Date(o.period_start) > new Date(s.period_end)));
      if (other) s.overlaps_with = other.filename;
    }
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
      // Deterministic rules parse first (sub-second, balance-verified), AI
      // fallback — so a recognised layout works even with AI unconfigured.
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
    await ingest(rows[0].id, req.labelId, account, txns, R.extractCsvBalances(csvText), { parseMethod: 'csv' });
    await logActivity(req, 'Uploaded bank statement (CSV)', `${account} · ${txns.length} txns`);
    const st = (await pool.query('SELECT * FROM bank_statements WHERE id = $1', [rows[0].id])).rows[0];
    res.status(201).json({ success: true, data: st });
  } catch (e) {
    console.error('Statement upload error:', e);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

// ── Auto-match pass over ONE statement's open debits ────────────────────────
// Additive by construction: only unmatched, undismissed debits are even
// considered. Shared by the detail freshness re-run, /rematch-all,
// /reset-matching and the nightly sweep — one implementation, one behavior.
async function runAutoMatchStatement(st, labelId, actor) {
  const { rows: txns } = await pool.query(
    `SELECT * FROM bank_transactions
      WHERE statement_id = $1 AND label_id = $2 AND direction = 'debit'
        AND dismissed = FALSE AND matched_expense_id IS NULL
      ORDER BY txn_date, id`, [st.id, labelId]);
  if (!txns.length) return { scanned: 0, matched: 0, reasons: {} };
  const labelRow = (await pool.query('SELECT bank_accounts FROM labels WHERE id = $1', [labelId])).rows[0] || {};
  const methods = R.accountMethods(R.accountsFor(labelRow), st.account);
  const maps = await R.loadMaps(pool, labelId);
  const used = new Set(
    (await pool.query(
      `SELECT DISTINCT matched_expense_id AS id FROM bank_transactions
        WHERE label_id = $1 AND matched_expense_id IS NOT NULL AND dismissed = FALSE`,
      [labelId]
    )).rows.map(r => r.id)
  );
  let matched = 0;
  const reasons = {};
  for (const t of txns) {
    const why = {};
    const m = await R.matchTxn(pool, labelId, t, methods, maps, used, why);
    if (m) {
      let method = m.method;
      const src = (await pool.query(`SELECT entry_source FROM expenses WHERE id = $1 /* no-tenant */`, [m.expense_id])).rows[0];
      if (src?.entry_source === 'creator_payment') method = 'creator';
      await pool.query(
        `UPDATE bank_transactions SET matched_expense_id = $1, match_method = $2, match_score = $3,
                matched_by = $4, matched_at = NOW()
          WHERE id = $5 AND label_id = $6 AND matched_expense_id IS NULL AND dismissed = FALSE`,
        [m.expense_id, method, m.score, actor || 'Auto', t.id, labelId]);
      used.add(m.expense_id);
      matched++;
    } else {
      const reason = why.reason || 'no-candidate';
      reasons[reason] = (reasons[reason] || 0) + 1;
    }
  }
  return { scanned: txns.length, matched, reasons };
}

// The same pass, label-wide, and it can tell you what it did. Shares the
// per-label busy set with the freshness re-run and the nightly sweep so
// pressing the button can never stack matcher passes on the pool.
async function runMatcherPass(labelId, { userName, statementId = null } = {}) {
  if (rematchLabelBusy.has(labelId)) return { ran: false, statements: 0, scanned: 0, matched: 0, per_statement: [] };
  rematchLabelBusy.add(labelId);
  try {
    const { rows: sts } = statementId
      ? await pool.query(`SELECT * FROM bank_statements WHERE id = $1 AND label_id = $2 AND status = 'ready'`, [statementId, labelId])
      : await pool.query(`SELECT * FROM bank_statements WHERE label_id = $1 AND status = 'ready' ORDER BY period_start`, [labelId]);
    const per = [];
    let scanned = 0;
    let matched = 0;
    for (const st of sts) {
      // One statement failing must not abandon the rest — and the failure is
      // REPORTED per statement, because a silently short count reads as
      // "nothing to find".
      const out = await runAutoMatchStatement(st, labelId, userName)
        .then((r) => ({ ...r, error: null }))
        .catch((e) => ({ matched: 0, scanned: 0, error: e.message }));
      rematchLast.set(st.id, Date.now());
      scanned += out.scanned || 0;
      matched += out.matched || 0;
      per.push({ id: st.id, account: st.account, period_start: st.period_start, scanned: out.scanned || 0, matched: out.matched || 0, ...(out.error ? { error: out.error } : {}) });
    }
    return { ran: true, statements: sts.length, scanned, matched, per_statement: per };
  } finally { rematchLabelBusy.delete(labelId); }
}
// Exposed for the nightly freshness sweep in index.js.
router.runMatcherPass = runMatcherPass;

/**
 * Book one OPEN debit and claim it, atomically enough that two callers cannot
 * both create an entry. Exported so Bank Matching's "no invoice coming" can
 * BOOK the row rather than flag an unanswered one — one booking path means
 * the artist rules, the fx stamp and the learned payee happen either way.
 * Returns the created expense row; throws when the row is no longer open.
 */
router.bookOpenTxn = async function bookOpenTxn(labelId, txn, { category, payee, artist, actor }) {
  const methods = await accountMethodsForTxn(txn, labelId);
  const entry = await bookEntry(pool, labelId, txn, { category, payee, artist, method: methods && methods[0], actor });
  const claim = await pool.query(
    `UPDATE bank_transactions SET matched_expense_id = $1, match_method = 'booked', match_score = 1.0,
            matched_by = $2, matched_at = NOW(), booked = TRUE, dismissed = FALSE, dismissed_reason = NULL
      WHERE id = $3 AND label_id = $4 AND matched_expense_id IS NULL AND booked = FALSE
      RETURNING id`,
    [entry.id, actor || null, txn.id, labelId]
  );
  if (!claim.rows.length) {
    // A lost race would otherwise leave the invented entry in the ledger with
    // no bank line pointing at it — money counted twice.
    await pool.query(`UPDATE expenses SET deleted = TRUE, deleted_by = $2, deleted_at = NOW() WHERE id = $1`, [entry.id, 'race rollback']).catch(() => {});
    throw Object.assign(new Error('That line was just answered by someone else'), { status: 409 });
  }
  return entry;
};

// ── Statement detail — the mini-ledger ──────────────────────────────────────
// `dispositionOf` used to live here AND in routes/bank-matching.js, and the two
// had drifted: this copy missed `match_method = 'created'`, so a created-from-
// rule row read as `matched` here and `booked` there — an undocumented row
// counted as invoice-backed on one page and not the other. One definition now,
// in lib/statementLens.js, fixture-held.
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const st = (await pool.query('SELECT * FROM bank_statements WHERE id = $1 AND label_id = $2', [id, req.labelId])).rows[0];
    if (!st) return res.status(404).json({ success: false, error: 'Statement not found' });

    // Freshness: invoices approved/paid AFTER upload never touched this
    // statement's open debits — matching used to run exactly once at ingest.
    // Re-run quietly on open: idempotent (only unmatched rows considered),
    // throttled per statement (10 min), never concurrent per label.
    if (st.status === 'ready' && !rematchLabelBusy.has(req.labelId)
        && Date.now() - (rematchLast.get(st.id) || 0) > 10 * 60 * 1000) {
      rematchLast.set(st.id, Date.now());
      rematchLabelBusy.add(req.labelId);
      try { await runAutoMatchStatement(st, req.labelId, req.user.name).catch(() => {}); }
      finally { rematchLabelBusy.delete(req.labelId); }
    }

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
    // Reversal pairing — a FAILED/RETURNED payment and its refund cancel out;
    // the chips steer review away from matching either side to an invoice.
    const revPairs = pairReversals(txns.map(t => ({ ...t, account: st.account })));
    const reversedBy = new Map(revPairs.map(p => [p.debit.id, p.credit.id]));
    const reversalOf = new Map(revPairs.map(p => [p.credit.id, p.debit.id]));
    const rows = txns.map(t => {
      const disposition = dispositionOf(t);
      return {
        ...t, disposition,
        // Per-row USD estimate — clients must never sum yen as dollars. The
        // parser's printed settlement (amount_usd) wins; else cached rates.
        usd: t.amount_usd != null ? Number(t.amount_usd) : usdOf(Number(t.amount), t.currency || 'USD', null),
        reversed_by: reversedBy.get(t.id) || null,
        reversal_of: reversalOf.get(t.id) || null,
        suggested_category: disposition === 'open' ? suggestCategory(t.payee_guess, t.description) : null,
        suggested_income_type: disposition === 'open-credit' ? suggestIncomeType(t.payee_guess, t.description) : null,
      };
    });

    // Category totals over debits — summed in USD (raw amounts across
    // currencies are meaningless the moment one foreign row exists).
    const catTotals = {};
    let liveDebits = 0, matchedDebits = 0;
    for (const t of rows) {
      if (t.direction !== 'debit' || t.dismissed) continue;
      const amt = Number(t.usd) || 0;
      liveDebits += amt;
      const cat = t.exp_category || 'Unorganized';
      catTotals[cat] = (catTotals[cat] || 0) + amt;
      if (t.matched_expense_id) matchedDebits += amt;
    }

    const rules = {
      dismiss: (await pool.query('SELECT id, pattern, created_by FROM statement_dismiss_rules WHERE label_id = $1 ORDER BY id', [req.labelId])).rows,
      category: (await pool.query('SELECT id, pattern, category, created_by FROM statement_category_rules WHERE label_id = $1 ORDER BY id', [req.labelId])).rows,
    };

    // Category usage (12-mo, label-scoped, voided excluded) — orders the deck
    // and the pickers by what this label actually books.
    const categoryUsage = (await pool.query(
      `SELECT e.category, COUNT(*)::int AS n FROM expenses e
        WHERE e.label_id = $1 AND e.category IS NOT NULL AND TRIM(e.category) <> ''
          AND (e.deleted=false OR e.deleted IS NULL) AND (e.voided=false OR e.voided IS NULL)
          AND e.created_at > NOW() - INTERVAL '12 months'
        GROUP BY e.category ORDER BY n DESC LIMIT 40`,
      [req.labelId]
    )).rows;

    // "Paid on ledger, no bank evidence" — Paid entries in-period not matched
    // by any bank txn. ±3-day pad (banks settle after the ledger's paid date,
    // and a payment on the period's edge is not "missing"); FAMILY totals (a
    // split parent's own slice understates what the bank saw); method-compat
    // filter (a PayPal-paid row must not accuse a BofA statement); and
    // bank_candidates — this statement's open debits that could explain each
    // entry, the one-click path from "no bank proof" to matched.
    let paidNoEvidence = [];
    if (st.period_start && st.period_end) {
      const labelRow = (await pool.query('SELECT bank_accounts FROM labels WHERE id = $1', [req.labelId])).rows[0] || {};
      const acctMethods = R.accountMethods(R.accountsFor(labelRow), st.account);
      const params = [req.labelId, st.period_start, st.period_end];
      let methodClause = '';
      if (Array.isArray(acctMethods) && acctMethods.length) {
        params.push(acctMethods);
        methodClause = ` AND (e.payment_method = ANY($${params.length}) OR e.payment_method IS NULL)`;
      }
      paidNoEvidence = (await pool.query(
        `SELECT e.id, e.payee, e.category, e.currency, e.payment_date, e.payment_method,
                (e.amount + COALESCE((SELECT SUM(k.amount) FROM expenses k WHERE k.parent_id = e.id AND (k.deleted=false OR k.deleted IS NULL)),0)) AS amount
           FROM expenses e
          WHERE e.label_id = $1 AND e.parent_id IS NULL AND e.payment_status = 'Paid'
            AND e.entry_source IS DISTINCT FROM 'bank_statement'
            AND e.payment_date BETWEEN $2::date - 3 AND $3::date + 3
            AND (e.deleted=false OR e.deleted IS NULL) AND (e.voided=false OR e.voided IS NULL)
            AND NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.matched_expense_id = e.id AND bt.label_id = e.label_id)${methodClause}
          ORDER BY e.payment_date LIMIT 60`,
        params
      )).rows;
      // Reverse candidates: open debits on THIS statement whose amount sits
      // within the fee tolerance of the entry's family total, scored by date.
      const openDebits = rows.filter(t => t.disposition === 'open');
      for (const e of paidNoEvidence) {
        const fam = Number(e.amount) || 0;
        const tol = Math.max(35, fam * 0.01);
        e.bank_candidates = openDebits
          .filter(t => (t.currency || 'USD') === (e.currency || 'USD'))
          .map(t => ({ t, delta: Number(t.amount) - fam, dd: Math.abs((new Date(String(t.txn_date).slice(0, 10)) - new Date(String(e.payment_date).slice(0, 10))) / 86400000) }))
          .filter(x => x.delta >= -0.01 && x.delta <= tol && x.dd <= 7)
          .sort((a, b) => a.dd - b.dd || a.delta - b.delta)
          .slice(0, 3)
          .map(x => ({ txn_id: x.t.id, txn_date: x.t.txn_date, amount: x.t.amount, payee_guess: x.t.payee_guess, description: x.t.description }));
      }
    }

    res.json({ success: true, data: { statement: st, transactions: rows, catTotals, coverage: { matched: matchedDebits, live: liveDebits }, rules, paidNoEvidence, categoryUsage } });
  } catch (e) { console.error('Statement detail error:', e); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── The statement lens — one month, and whether it adds up ──────────────────
//
// Deliberately NOT `GET /:id`. That endpoint re-runs auto-matching on open,
// computes paid-no-evidence with per-row bank candidates, view-time category
// suggestions and 12-month category usage — everything the review deck needs
// and none of what a tie-out needs. The Bank Ledger asks a read-only question
// about a month it is already showing, and asking it should not have a side
// effect or cost a 700KB payload.
//
// Returns the summary AND a slim per-line list carrying the server's own
// `disposition`, so the page's extra-lines list is a set difference over
// decided facts rather than a client-side copy of the disposition rule.
router.get('/:id(\\d+)/lens', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const st = (await pool.query('SELECT * FROM bank_statements WHERE id = $1 AND label_id = $2', [id, req.labelId])).rows[0];
    if (!st) return res.status(404).json({ success: false, error: 'Statement not found' });

    // `exp_payment_status` is what separates `matched` from `toconfirm`, and
    // `match_method` is what separates a creator payment from an invoice — both
    // have to be on the row before dispositionOf sees it.
    const { rows: txns } = await pool.query(
      `SELECT t.id, t.txn_date, t.description, t.payee_guess, t.reference, t.direction,
              t.amount, t.amount_usd, t.currency, t.dismissed, t.dismissed_reason,
              t.matched_expense_id, t.matched_income_id, t.match_method, t.booked, t.no_invoice,
              e.payment_status AS exp_payment_status, e.payee AS exp_payee,
              i.source AS income_type, ia.name AS income_artist
         FROM bank_transactions t
         LEFT JOIN expenses e ON e.id = t.matched_expense_id AND e.label_id = t.label_id
         LEFT JOIN artist_income i ON i.id = t.matched_income_id AND i.label_id = t.label_id
         LEFT JOIN artists ia ON ia.id = i.artist_id AND ia.label_id = i.label_id
        WHERE t.statement_id = $1 AND t.label_id = $2
        ORDER BY t.txn_date ASC, t.id ASC`,
      [id, req.labelId]
    );

    // Per-row USD before the summary sums anything — clients must never sum yen
    // as dollars, and lib/usd.js converts at the row.
    const rows = txns.map((t) => ({
      ...t,
      usd: t.amount_usd != null ? Number(t.amount_usd) : usdOf(Number(t.amount), t.currency || 'USD', null),
      disposition: lens.dispositionOf(t),
    }));

    res.json({ success: true, data: { statement: st, transactions: rows, lens: lens.summariseStatement(st, rows) } });
  } catch (e) { console.error('Statement lens error:', e); res.status(500).json({ success: false, error: 'Internal server error' }); }
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
    // Deterministic first (CSV balance column / balance-verified rules parse);
    // a focused AI pass only when the rules can't read it.
    const bal = await readBalancesFromStored(st).catch(() => null);
    if (!bal) {
      return res.status(400).json({
        success: false,
        error: claude.isEnabled()
          ? 'The document does not print a readable balance — set it manually if you know it'
          : 'The balance could not be read deterministically and AI is not configured — set it manually',
      });
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
    const id = parseInt(req.params.id, 10);
    // Refuse to pull a statement out from under its own parser. The parse runs
    // after the upload responds and writes transactions against this row, so a
    // delete mid-parse leaves a half-import (and the client offers a Delete on
    // the detail page, which is reachable by URL while parsing).
    //
    // Time-bounded on purpose: a parse that crashed leaves `status` at
    // 'parsing' forever, and an unconditional guard would make that row
    // permanently undeletable. After the window it is plainly wedged, not
    // working, so it becomes deletable again.
    const PARSE_GRACE_MIN = 15;
    const { rows: [live] } = await pool.query(
      `SELECT status, created_at > NOW() - INTERVAL '${PARSE_GRACE_MIN} minutes' AS fresh
         FROM bank_statements WHERE id = $1 AND label_id = $2`, [id, req.labelId]);
    if (live && live.status === 'parsing' && live.fresh) {
      return res.status(409).json({
        success: false,
        error: 'This statement is still importing. Wait for it to finish (or fail) before deleting it.',
      });
    }
    // The txns cascade away with the statement — soft-delete the ledger
    // entries that were CREATED from them first, or re-uploading the
    // statement and re-booking would record every one of them twice.
    // MATCHED (non-booked) entries are real invoices and stay untouched.
    const { rows: createdRows } = await pool.query(
      `SELECT DISTINCT matched_expense_id AS id FROM bank_transactions
        WHERE statement_id = $1 AND label_id = $2 AND booked = TRUE AND matched_expense_id IS NOT NULL`,
      [id, req.labelId]);
    const createdIds = createdRows.map((r) => r.id);
    const { rows: [st] } = await pool.query('DELETE FROM bank_statements WHERE id = $1 AND label_id = $2 RETURNING *', [id, req.labelId]);
    if (!st) return res.status(404).json({ success: false, error: 'Statement not found' });
    let entriesRemoved = 0;
    if (createdIds.length) {
      // entry_source guarded so a real invoice can never be swept, even if a
      // booked flag ever points at one.
      const { rowCount } = await pool.query(
        `UPDATE expenses SET deleted = true, deleted_by = $1, deleted_at = NOW()
          WHERE label_id = $3 AND (id = ANY($2) OR parent_id = ANY($2)) AND entry_source = 'bank_statement'
            AND (deleted = false OR deleted IS NULL)`,
        [req.user.name, createdIds, req.labelId]);
      entriesRemoved = rowCount;
    }
    await logActivity(req, 'Deleted bank statement',
      `${st.account} "${st.filename}"${entriesRemoved ? ` (+${entriesRemoved} booked entr${entriesRemoved === 1 ? 'y' : 'ies'} it created — soft-deleted, restorable from the archive)` : ''}`);
    res.json({ success: true, data: { entries_removed: entriesRemoved } });
  } catch (e) { console.error('Statement delete error:', e); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── Original file — the extras/misfiled workflows and ordinary verification
// depend on being able to open the uploaded statement. Buffer through the
// server (label-gated) and let safeFiles decide inline vs attachment.
router.get('/:id(\\d+)/file', async (req, res) => {
  try {
    const st = (await pool.query('SELECT filename, r2_key FROM bank_statements WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId])).rows[0];
    if (!st) return res.status(404).json({ success: false, error: 'Statement not found' });
    if (!st.r2_key) return res.status(404).json({ success: false, error: 'No file stored — this statement was uploaded before file retention worked' });
    const buf = await loadFileBuffer(st.r2_key, null).catch(() => null);
    if (!buf) return res.status(404).json({ success: false, error: 'The stored file could not be read (file storage may not be configured)' });
    const isPdf = buf.slice(0, 5).toString() === '%PDF-';
    sendFileSafely(res, { mime: isPdf ? 'application/pdf' : 'text/csv', filename: st.filename || 'statement', buffer: buf });
  } catch (e) { console.error('Statement file error:', e); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── Re-parse: run the parser over the ORIGINAL file again, add what the
// first pass missed. STRICTLY ADDITIVE — never deletes, never updates, never
// re-inserts a row it already has. Rows in the database but absent from the
// re-parse are reported, never removed (a parser disagreement is a question
// for a human, not a mandate to delete reconciled history).
async function applyReparse(st, labelId, parsedRows) {
  const { rows: existing } = await pool.query(
    // Every KEY_COLUMNS member MUST be selected — omitting `currency` once
    // made every non-USD row read as USD and a re-parse would have inserted a
    // duplicate for each (lib/statementAudit.js).
    'SELECT txn_date, amount, direction, currency, reference, description FROM bank_transactions WHERE statement_id = $1 AND label_id = $2',
    [st.id, labelId]);
  const { missing, onlyInDb } = audit.diffReparseRows(existing, parsedRows);

  const ctx = await buildIngestCtx(labelId, st.account);
  let inserted = 0;
  for (const raw of missing) {
    if ((await ingestOne(ctx, st.id, raw)) === 'inserted') inserted++;
  }
  // MATCH the rows just created — upload does this; a re-parse that skipped
  // it is how a backlog of matchable rows gets booked by hand instead.
  let autoMatched = 0;
  if (inserted > 0) {
    autoMatched = (await runAutoMatchStatement(st, labelId, 'reparse').catch(() => ({ matched: 0 }))).matched || 0;
  }
  const { rows: [{ n }] } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM bank_transactions WHERE statement_id = $1 AND label_id = $2', [st.id, labelId]);
  await pool.query('UPDATE bank_statements SET txn_count = $1 WHERE id = $2 AND label_id = $3', [n, st.id, labelId]);

  return {
    parsed: parsedRows.length,
    added: inserted,
    already_present: parsedRows.length - missing.length,
    duplicate_of_other_statement: ctx.summary.dup_skipped,
    only_in_database: onlyInDb.length,
    txn_count: n,
    auto_matched: autoMatched + ctx.summary.auto_matched,
    rule_booked: ctx.summary.rule_booked,
  };
}

// Background PDF re-parse. Writes its outcome into import_summary.reparse and
// ALWAYS returns the statement to 'ready' — a failed re-parse must not leave
// a reconciled month stuck in 'parsing' or flipped to 'error'.
async function reparseInBackground(st, labelId, buffer) {
  let summary;
  try {
    let parsed = null;
    const det = tryDeterministicPdf(buffer);
    if (det) parsed = { rows: det.rows, method: 'rules', balances: det.balances };
    else if (claude.isEnabled()) {
      const block = claude.fileBlock(buffer, 'application/pdf');
      const r = block && await claude.streamText({ content: [block, { type: 'text', text: PIPE_INSTRUCTION }], maxTokens: 32000 });
      if (!r || !r.ok) throw new Error((r && r.error) || 'AI parse failed');
      if (r.stop_reason === 'max_tokens') throw new Error('Statement too long to parse in one pass — upload the CSV export instead.');
      parsed = { rows: R.parsePipeLines(r.text), method: 'ai', balances: R.extractBalanceLines(r.text) };
    } else {
      throw new Error('The PDF did not parse deterministically and AI is not configured.');
    }
    if (!parsed.rows.length) throw new Error('The re-parse produced no transactions.');
    summary = { ...(await applyReparse(st, labelId, parsed.rows)), method: parsed.method, at: new Date().toISOString() };
    // Persist the balances a RECONCILING rules parse read — already verified
    // against the statement's own printed figures. An AI-path re-parse must
    // never overwrite a known-good balance with a guess.
    if (parsed.method === 'rules'
        && Number.isFinite(Number(parsed.balances.beginning_balance))
        && Number.isFinite(Number(parsed.balances.ending_balance))) {
      await pool.query(
        `UPDATE bank_statements SET beginning_balance = $1, ending_balance = $2 WHERE id = $3 AND label_id = $4`,
        [parsed.balances.beginning_balance, parsed.balances.ending_balance, st.id, labelId]);
      summary.balances_written = true;
    }
    await logBg(labelId, 'Reparsed bank statement', `#${st.id} "${st.filename}" (${parsed.method === 'rules' ? 'rule-parsed, balance-verified' : 'AI-parsed'}): ${summary.added} added, ${summary.already_present} already present, ${summary.only_in_database} only in the app`);
  } catch (err) {
    summary = { error: err.message, at: new Date().toISOString() };
  }
  await pool.query(
    `UPDATE bank_statements
        SET status = 'ready',
            import_summary = COALESCE(import_summary, '{}'::jsonb) || jsonb_build_object('reparse', $1::jsonb)
      WHERE id = $2 AND label_id = $3`,
    [JSON.stringify(summary), st.id, labelId]).catch(() => {});
}

router.post('/:id(\\d+)/reparse', async (req, res) => {
  try {
    const st = (await pool.query('SELECT * FROM bank_statements WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId])).rows[0];
    if (!st) return res.status(404).json({ success: false, error: 'Statement not found' });
    if (st.status === 'parsing') return res.status(400).json({ success: false, error: 'Statement is still parsing' });
    if (!st.r2_key) return res.status(400).json({ success: false, error: 'The original file was never stored for this statement — re-upload it instead.' });
    const buffer = await loadFileBuffer(st.r2_key, null).catch(() => null);
    if (!buffer || !buffer.length) return res.status(400).json({ success: false, error: 'The stored file could not be read — re-upload it instead.' });

    const isPdf = buffer.slice(0, 5).toString() === '%PDF-';
    if (isPdf) {
      // A PDF re-parse can be an AI call over a whole statement — minutes,
      // not seconds. Return immediately and finish in the background; the
      // client polls the list and reads import_summary.reparse.
      await pool.query(`UPDATE bank_statements SET status = 'parsing' WHERE id = $1 AND label_id = $2`, [st.id, req.labelId]);
      reparseInBackground(st, req.labelId, buffer).catch(() => {});
      return res.json({ success: true, data: { started: true, mode: 'background' } });
    }
    // CSV — deterministic local parse, synchronous.
    const parsedRows = R.parseCsv(buffer.toString('utf8'), st.account);
    if (!parsedRows.length) return res.status(400).json({ success: false, error: 'The re-parse produced no transactions.' });
    const out = await applyReparse(st, req.labelId, parsedRows);
    await logActivity(req, 'Reparsed bank statement', `#${st.id} "${st.filename}" (CSV): ${out.added} added, ${out.already_present} already present`);
    res.json({ success: true, data: { ...out, method: 'csv', mode: 'sync' } });
  } catch (e) { console.error('Reparse error:', e); res.status(500).json({ success: false, error: 'Re-parse failed' }); }
});

// ── Extras audit — rows the app holds that the statement itself does not
// support. Only possible because a RECONCILED deterministic parse is ground
// truth (opening + net = closing, section totals tie). No ground truth, no
// opinion: an unreconciled parse reports nothing rather than guessing.
async function auditStatementExtrasRaw(st, labelId) {
  const base = {
    id: st.id, account: st.account, filename: st.filename,
    period_start: st.period_start, period_end: st.period_end,
    held: null, expected: null, extraCount: 0, extraValue: 0, missingCount: 0,
    reconciles: false, reason: null, groups: [], misfiled: { repairs: [], unclear: [] },
  };
  const { rows: dbRows } = await pool.query(
    // currency is part of keyOf; match_method is load-bearing for the
    // misfiled repair (it is how that path knows a booking was INVENTED and
    // therefore safe to remove).
    `SELECT id, txn_date, amount, direction, currency, description, payee_guess, created_at,
            matched_expense_id, matched_income_id, match_method, booked, dismissed
       FROM bank_transactions WHERE statement_id = $1 AND label_id = $2`, [st.id, labelId]);
  base.held = dbRows.length;

  if (!st.r2_key) { base.reason = 'The original file was never stored, so there is nothing to check against.'; return base; }
  let buffer;
  try {
    buffer = await loadFileBuffer(st.r2_key, null);
  } catch (err) { base.reason = `Could not read the stored file: ${err.message}`; return base; }
  if (!buffer) { base.reason = 'The stored file could not be read (file storage may not be configured).'; return base; }
  if (buffer.slice(0, 5).toString() !== '%PDF-') {
    base.reason = 'CSV statement — the balance proof only applies to the PDF layout.'; return base;
  }
  let out;
  try { out = parseStatementText(buffer); } catch (err) { base.reason = `Parse failed: ${err.message}`; return base; }
  if (!out) { base.reason = 'The stored PDF did not parse as a recognised statement layout.'; return base; }
  if (!out.ok) { base.reason = `The parse did not reconcile (${out.verdict.reason}), so it cannot be used as ground truth.`; return base; }

  // The parser leaves payee_guess empty — fill it the SAME way ingest does.
  // The misfiled repair compares payees; against a blank every repair would
  // look like a change of vendor.
  const stmtRows = out.rows.map((r) => ({ ...r, payee_guess: r.payee_guess || R.extractPayee(r.description) }));

  const found = audit.findExtras(stmtRows, dbRows);
  const misfiled = audit.findMisfiled(dbRows, stmtRows);

  // Surplus and shortfall appearing TOGETHER means the rows were RELABELLED,
  // not duplicated — the same transaction filed under a different key on each
  // side (the AI flattening currencies to USD produced exactly this). Only
  // the excess beyond the overlap is surplus; acting on the overlap would
  // delete real transactions.
  const mismatched = Math.min(found.extraCount, found.missingCount);
  return {
    ...base,
    expected: stmtRows.length,
    reconciles: true,
    extraCount: found.extraCount,
    extraValue: found.extraValue,
    missingCount: found.missingCount,
    mismatched,
    surplus: found.extraCount - mismatched,
    groups: found.groups,
    misfiled,
  };
}

// API shape: ids and labels only.
async function auditStatementExtras(st, labelId) {
  const raw = await auditStatementExtrasRaw(st, labelId);
  return {
    ...raw,
    groups: (raw.groups || []).map((g) => ({
      txn_date: g.txn_date, amount: g.amount, direction: g.direction,
      expected: g.expected, held: g.held, extra: g.extra,
      description: (g.remove[0]?.description || '').slice(0, 120),
      payee_guess: g.remove[0]?.payee_guess || '',
      remove_ids: g.remove.map((r) => r.id),
      matched_expense_ids: g.remove.map((r) => r.matched_expense_id).filter(Boolean),
      booked_income_ids: g.remove.map((r) => r.matched_income_id).filter(Boolean),
    })),
    misfiled_count: (raw.misfiled?.repairs || []).length,
    misfiled_value: Math.round((raw.misfiled?.repairs || []).reduce((t, r) => t + Number(r.row.amount || 0), 0) * 100) / 100,
    misfiled_unclear: (raw.misfiled?.unclear || []).length,
  };
}

// Only ONE whole-portfolio audit at a time, process-wide: each one downloads
// and re-parses every stored PDF — CPU-bound work inside a request handler.
// Rejected rather than queued, because a queued audit just moves the pile-up.
const withPortfolioAudit = async (res, run) => {
  if (portfolioAuditInFlight) {
    return res.status(429).json({ success: false, error: 'An audit of every statement is already running. It re-parses all stored PDFs, so only one runs at a time — try again when it finishes.' });
  }
  portfolioAuditInFlight = true;
  try { return await run(); } finally { portfolioAuditInFlight = false; }
};

// GET /extras — audit every ready statement. Read-only.
router.get('/extras', async (req, res) => {
  try {
    return await withPortfolioAudit(res, async () => {
      const { rows: stmts } = await pool.query(
        `SELECT * FROM bank_statements WHERE label_id = $1 AND status = 'ready' ORDER BY period_start DESC NULLS LAST, id DESC`,
        [req.labelId]);
      const results = [];
      for (const st of stmts) results.push(await auditStatementExtras(st, req.labelId)); // sequential: keeps the pool free
      res.json({ success: true, data: {
        statements: results,
        total_extra: results.reduce((s, r) => s + r.extraCount, 0),
        total_value: Math.round(results.reduce((s, r) => s + r.extraValue, 0) * 100) / 100,
        checked: results.filter((r) => r.reconciles).length,
        unverifiable: results.filter((r) => !r.reconciles).length,
        total_misfiled: results.reduce((s, r) => s + (r.misfiled_count || 0), 0),
        misfiled_value: Math.round(results.reduce((s, r) => s + (r.misfiled_value || 0), 0) * 100) / 100,
      } });
    });
  } catch (e) { console.error('Extras audit error:', e); res.status(500).json({ success: false, error: 'Extras audit failed' }); }
});

// GET /:id/extras — one statement, with group detail. Read-only.
router.get('/:id(\\d+)/extras', async (req, res) => {
  try {
    const st = (await pool.query('SELECT * FROM bank_statements WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId])).rows[0];
    if (!st) return res.status(404).json({ success: false, error: 'Statement not found' });
    res.json({ success: true, data: await auditStatementExtras(st, req.labelId) });
  } catch (e) { console.error('Extras error:', e); res.status(500).json({ success: false, error: 'Extras audit failed' }); }
});

// POST /:id/extras/remove — delete the surplus copies. Server-authoritative:
// the stored PDF is re-parsed at the moment of the call; the client's opinion
// is never consulted.
router.post('/:id(\\d+)/extras/remove', async (req, res) => {
  try {
    const st = (await pool.query('SELECT * FROM bank_statements WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId])).rows[0];
    if (!st) return res.status(404).json({ success: false, error: 'Statement not found' });

    const audit0 = await auditStatementExtras(st, req.labelId);
    if (!audit0.reconciles) {
      return res.status(400).json({ success: false, error: `Refusing to remove anything: ${audit0.reason}` });
    }
    // A shortfall alongside the surplus means the two sides disagree about how
    // rows are LABELLED, not how many exist — deleting on that reading once
    // nearly destroyed 206 real transactions. Re-parse to correct the labels.
    if (audit0.missingCount > 0) {
      return res.status(400).json({ success: false,
        error: `Refusing to remove anything: this statement is also MISSING ${audit0.missingCount} row${audit0.missingCount === 1 ? '' : 's'} `
          + `that the statement charges, so the ${audit0.extraCount} apparent extras are rows recorded under different details `
          + `(commonly the wrong currency), not duplicates. Re-parse to correct them instead of deleting.` });
    }
    if (!audit0.extraCount) return res.json({ success: true, data: { removed: 0, ...audit0 } });

    // Booked income is a real record elsewhere (an artist_income row) —
    // deleting its bank row would strand that. Handed back to unbook first.
    const blockedIds = audit0.groups.filter((g) => g.booked_income_ids.length).flatMap((g) => g.remove_ids);
    const removableIds = audit0.groups.flatMap((g) => g.remove_ids).filter((id) => !blockedIds.includes(id));
    const affectedExpenses = [...new Set(audit0.groups.flatMap((g) => g.matched_expense_ids))];

    let removed = 0;
    if (removableIds.length) {
      const del = await pool.query(
        'DELETE FROM bank_transactions WHERE statement_id = $1 AND label_id = $2 AND id = ANY($3::int[])',
        [st.id, req.labelId, removableIds]);
      removed = del.rowCount;
    }
    const { rows: [{ n }] } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM bank_transactions WHERE statement_id = $1 AND label_id = $2', [st.id, req.labelId]);
    await pool.query('UPDATE bank_statements SET txn_count = $1 WHERE id = $2 AND label_id = $3', [n, st.id, req.labelId]);

    await logActivity(req, 'Removed statement extras',
      `${st.account} "${st.filename}": removed ${removed} extra transaction${removed === 1 ? '' : 's'} worth ${audit0.extraValue} `
      + `the statement's own balances do not support (proves ${audit0.expected}; app held ${audit0.held}). `
      + `${blockedIds.length} left in place (booked income). `
      + `${affectedExpenses.length} ledger entr${affectedExpenses.length === 1 ? 'y' : 'ies'} lost a bank match: ${affectedExpenses.slice(0, 40).join(', ')}${affectedExpenses.length > 40 ? ' …' : ''}`);

    res.json({ success: true, data: {
      removed, value: audit0.extraValue, expected: audit0.expected, held_before: audit0.held,
      txn_count: n, blocked_booked_income: blockedIds.length, affected_expense_ids: affectedExpenses,
    } });
  } catch (e) { console.error('Extras remove error:', e); res.status(500).json({ success: false, error: 'Extras removal failed' }); }
});

// ── Misfiled rows — a row holding the WRONG PAYMENT'S details. Invisible to
// the count-based extras audit by construction: the surplus and the shortfall
// cancel exactly, the month reconciles to the cent, and the money is filed
// against a company that was never paid it.
const misfiledPayee = (r) => String(r.payee_guess || '').trim() || String(r.description || '').slice(0, 40);
const payeeKey = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

router.get('/:id(\\d+)/misfiled', async (req, res) => {
  try {
    const st = (await pool.query('SELECT * FROM bank_statements WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId])).rows[0];
    if (!st) return res.status(404).json({ success: false, error: 'Statement not found' });
    const a = await auditStatementExtrasRaw(st, req.labelId);
    res.json({ success: true, data: {
      id: st.id, account: st.account, filename: st.filename,
      reconciles: a.reconciles, reason: a.reason,
      repairs: (a.misfiled?.repairs || []).map((r) => ({
        txn_id: r.row.id, txn_date: r.row.txn_date, amount: r.row.amount, direction: r.row.direction,
        duplicate_of_reference: r.duplicate_of_reference,
        currently_reads: String(r.row.description || '').slice(0, 140),
        currently_payee: misfiledPayee(r.row),
        should_read: String(r.should_be.description || '').slice(0, 140),
        should_payee: r.should_be.payee_guess || '',
        matched_expense_id: r.row.matched_expense_id,
        matched_income_id: r.row.matched_income_id,
        match_method: r.row.match_method,
        // A repair that changes WHO was paid invalidates whatever was matched
        // against the old name; one that only corrects a confirmation number
        // does not.
        payee_changes: payeeKey(misfiledPayee(r.row)) !== payeeKey(r.should_be.payee_guess),
      })),
      unclear: (a.misfiled?.unclear || []).map((u) => ({
        txn_id: u.row.id, txn_date: u.row.txn_date, amount: u.row.amount,
        reference: u.reference, reason: u.reason,
        reads: String(u.row.description || '').slice(0, 140),
      })),
    } });
  } catch (e) { console.error('Misfiled error:', e); res.status(500).json({ success: false, error: 'Misfiled audit failed' }); }
});

// POST /:id/misfiled/repair — rewrite each provably-misfiled row to the
// payment the statement actually charges. The row is correct in date, amount
// and direction — only its identity is wrong — so this is an UPDATE, never
// delete-and-insert: the row keeps its id. Where the payee changes the match
// is DROPPED (silently re-pointing a real invoice at a different company's
// payment is the exact false-record shape this surface exists to prevent);
// a BOOKED row's invented entry is soft-deleted, guarded on entry_source.
router.post('/:id(\\d+)/misfiled/repair', async (req, res) => {
  const client = await pool.connect();
  try {
    const st = (await pool.query('SELECT * FROM bank_statements WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId])).rows[0];
    if (!st) { return res.status(404).json({ success: false, error: 'Statement not found' }); }
    const a = await auditStatementExtrasRaw(st, req.labelId);
    if (!a.reconciles) { return res.status(400).json({ success: false, error: `Refusing to change anything: ${a.reason}` }); }
    const repairs = a.misfiled?.repairs || [];
    if (!repairs.length) { return res.json({ success: true, data: { repaired: 0, unmatched: 0, unbooked: 0, rows: [], unclear: (a.misfiled?.unclear || []).length } }); }

    // Honour a caller's narrowing, never a caller's list: ids SELECT from what
    // the statement already proved — a client can repair one row without being
    // able to nominate a row the statement does not support.
    const only = Array.isArray(req.body?.txn_ids) ? req.body.txn_ids.map(Number).filter(Boolean) : null;
    const todo = only ? repairs.filter((r) => only.includes(r.row.id)) : repairs;

    const done = [];
    let unmatched = 0;
    let unbooked = 0;
    await client.query('BEGIN');
    for (const r of todo) {
      const oldPayee = misfiledPayee(r.row);
      const newPayee = String(r.should_be.payee_guess || '').trim();
      const payeeChanges = payeeKey(oldPayee) !== payeeKey(newPayee);

      if (payeeChanges && (r.row.matched_expense_id || r.row.matched_income_id)) {
        if (r.row.booked && r.row.matched_expense_id) {
          const del = await client.query(
            `UPDATE expenses SET deleted = true, deleted_by = $2, deleted_at = NOW()
              WHERE label_id = $3 AND (id = $1 OR parent_id = $1) AND entry_source = 'bank_statement'
                AND (deleted = false OR deleted IS NULL)`,
            [r.row.matched_expense_id, req.user.name, req.labelId]);
          unbooked += del.rowCount ? 1 : 0;
        }
        await client.query(`DELETE FROM bank_txn_invoice_links WHERE txn_id = $1 AND label_id = $2`, [r.row.id, req.labelId]).catch(() => {});
        await client.query(
          `UPDATE bank_transactions SET matched_expense_id = NULL, matched_income_id = NULL,
                  match_method = NULL, match_score = NULL, matched_by = NULL, matched_at = NULL, booked = FALSE
            WHERE id = $1 AND label_id = $2`, [r.row.id, req.labelId]);
        unmatched++;
      }
      await client.query(
        `UPDATE bank_transactions SET description = $1, payee_guess = $2, reference = $3
          WHERE id = $4 AND label_id = $5`,
        [r.should_be.description, newPayee.slice(0, 200) || null,
          audit.refFromDescription(r.should_be.description), r.row.id, req.labelId]);
      done.push({ txn_id: r.row.id, from: oldPayee, to: newPayee, payee_changed: payeeChanges, amount: r.row.amount, txn_date: r.row.txn_date });
    }
    await client.query('COMMIT');

    await logActivity(req, 'Repaired misfiled statement rows',
      `${st.account} "${st.filename}": repaired ${done.length} row${done.length === 1 ? '' : 's'} holding another payment's details — `
      + done.map((d) => `#${d.txn_id} ${d.from} → ${d.to}`).join('; ')
      + `. ${unmatched} lost a match (payee changed); ${unbooked} invented booking${unbooked === 1 ? '' : 's'} removed.`);
    res.json({ success: true, data: { repaired: done.length, unmatched, unbooked, rows: done, unclear: (a.misfiled?.unclear || []).length } });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Misfiled repair error:', e);
    res.status(500).json({ success: false, error: 'Misfiled repair failed' });
  } finally { client.release(); }
});

// ── Re-match lifecycle ───────────────────────────────────────────────────────
// POST /rematch-all — run the matcher again over what is still unmatched,
// WITHOUT clearing anything. Additive by construction: only open debits are
// even considered. ?statement_id= scopes it.
router.post('/rematch-all', async (req, res) => {
  try {
    const raw = req.query.statement_id ?? req.body?.statement_id;
    const statementId = raw === undefined || raw === null || raw === '' || raw === 'all' ? null : parseInt(raw, 10);
    if (statementId !== null && !Number.isFinite(statementId)) {
      return res.status(400).json({ success: false, error: 'statement_id must be a number, or omitted for every statement' });
    }
    const out = await runMatcherPass(req.labelId, { userName: req.user.name, statementId });
    if (!out.ran) {
      // 409, never a zero — "0 matched" must not be the answer both when
      // there was nothing to find and when the run never happened.
      return res.status(409).json({ success: false, error: 'A matcher pass is already running — nothing was changed; try again in a moment.' });
    }
    if (statementId !== null && !out.statements) {
      return res.status(404).json({ success: false, error: 'Statement not found, or not ready' });
    }
    await logActivity(req, 'Statement matcher re-run',
      `${out.matched} of ${out.scanned} unmatched debits matched across ${out.statements} statement(s)${statementId ? ` (statement #${statementId})` : ''}. Additive — no existing match cleared.`);
    res.json({ success: true, data: out });
  } catch (e) { console.error('rematch-all error:', e); res.status(500).json({ success: false, error: 'Rematch failed' }); }
});

// POST /reset-matching — clear every AUTO and MANUAL match, then re-run with
// the current evidence (aliases, learned payees, rejections). Never cleared,
// because clearing them destroys or strands real records: booked rows
// ('created'/'booked'/'rule' — the entry was CREATED from the txn), anything
// carrying matched_income_id, and dismissals. Some manual matches exist
// precisely because the matcher can't derive them; the response reports how
// many stayed open rather than letting the loss pass silently.
router.post('/reset-matching', async (req, res) => {
  try {
    const { rows: target } = await pool.query(
      `SELECT id, match_method FROM bank_transactions
        WHERE label_id = $1 AND (match_method LIKE 'auto%' OR match_method = 'manual')
          AND booked = FALSE AND matched_income_id IS NULL AND matched_expense_id IS NOT NULL`,
      [req.labelId]);
    const ids = target.map((r) => r.id);
    const manualIds = target.filter((r) => r.match_method === 'manual').map((r) => r.id);

    let cleared = 0;
    if (ids.length) {
      const { rowCount } = await pool.query(
        `UPDATE bank_transactions
            SET matched_expense_id = NULL, match_method = NULL, match_score = NULL,
                matched_by = NULL, matched_at = NULL
          WHERE label_id = $2 AND id = ANY($1::int[])`, [ids, req.labelId]);
      cleared = rowCount;
    }
    const out = await runMatcherPass(req.labelId, { userName: req.user.name });
    const stillOpen = async (list) => {
      if (!list.length) return 0;
      const { rows: [c] } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM bank_transactions WHERE label_id = $2 AND id = ANY($1::int[]) AND matched_expense_id IS NULL',
        [list, req.labelId]);
      return c.n;
    };
    const unresolved = await stillOpen(ids);
    const manualUnresolved = await stillOpen(manualIds);
    await logActivity(req, 'Statement matching reset',
      `${cleared} matches cleared (${manualIds.length} manual), ${out.matched} re-matched with current evidence; `
      + `${unresolved} left open, ${manualUnresolved} of which were previously matched by hand. Booked entries, booked income and dismissals untouched.`);
    res.json({ success: true, data: {
      cleared, manual_cleared: manualIds.length, rematched: out.matched,
      still_open: unresolved, manual_not_recovered: manualUnresolved,
    } });
  } catch (e) { console.error('reset-matching error:', e); res.status(500).json({ success: false, error: 'Reset failed' }); }
});

// ── Reminders — monthly-cadence nudges ("upload the statement and match it"),
// delivered through the notification bell when due. Per user, label-scoped.
const REMINDER_CADENCES = ['monthly', 'weekly', 'once'];
function reminderNextDue(cadence, dayOfMonth, from) {
  const base = from ? new Date(from) : new Date();
  if (cadence === 'weekly') {
    const d = new Date(base); d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }
  const day = Math.min(Math.max(parseInt(dayOfMonth, 10) || 1, 1), 31);
  let y = base.getFullYear(); let m = base.getMonth() + 1;
  if (m > 11) { m = 0; y++; }
  const clamped = Math.min(day, new Date(y, m + 1, 0).getDate());
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
}
function reminderFirstDue(cadence, dayOfMonth) {
  const now = new Date();
  if (cadence === 'weekly') return now.toISOString().slice(0, 10);
  const day = Math.min(Math.max(parseInt(dayOfMonth, 10) || 1, 1), 31);
  const y = now.getFullYear(); const m = now.getMonth();
  const clamped = Math.min(day, new Date(y, m + 1, 0).getDate());
  if (clamped >= now.getDate()) return `${y}-${String(m + 1).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
  return reminderNextDue(cadence, day, new Date(y, m, clamped));
}
router.get('/reminders', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM statement_reminders WHERE label_id = $1 AND user_id = $2 ORDER BY next_due, id`,
      [req.labelId, req.user.id]);
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.post('/reminders', async (req, res) => {
  try {
    const title = String(req.body.title || '').trim().slice(0, 200);
    if (!title) return res.status(400).json({ success: false, error: 'title required' });
    const cadence = REMINDER_CADENCES.includes(req.body.cadence) ? req.body.cadence : 'monthly';
    const dayOfMonth = Math.min(Math.max(parseInt(req.body.day_of_month, 10) || 1, 1), 31);
    const due = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.next_due || ''))
      ? req.body.next_due
      : (cadence === 'once' ? new Date().toISOString().slice(0, 10) : reminderFirstDue(cadence, dayOfMonth));
    const { rows: [r] } = await pool.query(
      `INSERT INTO statement_reminders (label_id, user_id, title, link, cadence, day_of_month, next_due)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.labelId, req.user.id, title, String(req.body.link || '/bank-statements').slice(0, 200), cadence, dayOfMonth, due]);
    res.json({ success: true, data: r });
  } catch (e) { console.error('reminder create error:', e); res.status(500).json({ success: false, error: 'Internal server error' }); }
});
// Done — advance to the next occurrence from TODAY (not a stale next_due), so
// an overdue monthly reminder lands next month, not tomorrow. 'once' deactivates.
router.post('/reminders/:rid(\\d+)/done', async (req, res) => {
  try {
    const { rows: [r] } = await pool.query(
      `SELECT * FROM statement_reminders WHERE id = $1 AND label_id = $2 AND user_id = $3`,
      [parseInt(req.params.rid, 10), req.labelId, req.user.id]);
    if (!r) return res.status(404).json({ success: false, error: 'Not found' });
    if (r.cadence === 'once') {
      await pool.query(`UPDATE statement_reminders SET active = false WHERE id = $1 AND label_id = $2`, [r.id, req.labelId]);
    } else {
      await pool.query(`UPDATE statement_reminders SET next_due = $1 WHERE id = $2 AND label_id = $3`,
        [reminderNextDue(r.cadence, r.day_of_month, new Date()), r.id, req.labelId]);
    }
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.put('/reminders/:rid(\\d+)', async (req, res) => {
  try {
    const { rows: [r] } = await pool.query(
      `UPDATE statement_reminders SET active = COALESCE($4, active)
        WHERE id = $1 AND label_id = $2 AND user_id = $3 RETURNING *`,
      [parseInt(req.params.rid, 10), req.labelId, req.user.id,
        typeof req.body.active === 'boolean' ? req.body.active : null]);
    if (!r) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: r });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.delete('/reminders/:rid(\\d+)', async (req, res) => {
  try {
    await pool.query(`DELETE FROM statement_reminders WHERE id = $1 AND label_id = $2 AND user_id = $3`,
      [parseInt(req.params.rid, 10), req.labelId, req.user.id]);
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

// Ledger search for the Match dialog (approved family roots).
//
// PARTIALLY-SETTLED invoices are INCLUDED, with what is left on them. Hiding
// every family that any bank line already touches makes an installment
// invoice unfindable — even though the capacity model explicitly allows
// further debits up to the family total. The searcher needs to see "$400 of
// $1,200 left", not an empty result.
router.get('/ledger-search', async (req, res) => {
  try {
    const q = `%${String(req.query.q || '').trim()}%`;
    const { rows } = await pool.query(
      `SELECT e.id, e.payee, e.invoice_number, e.currency, e.payment_status, e.payment_date, e.invoice_date,
              e.entry_source,
              (e.amount + COALESCE((SELECT SUM(k.amount) FROM expenses k WHERE k.parent_id = e.id AND (k.deleted=false OR k.deleted IS NULL)),0)) AS family_amount,
              COALESCE((SELECT SUM(bt.amount) FROM bank_transactions bt
                         WHERE bt.matched_expense_id = e.id AND bt.label_id = e.label_id
                           AND bt.dismissed = FALSE AND bt.direction = 'debit'), 0) AS claimed
         FROM expenses e
        WHERE e.label_id = $1 AND e.parent_id IS NULL AND e.status = 'approved'
          AND (e.deleted=false OR e.deleted IS NULL) AND (e.voided=false OR e.voided IS NULL)
          AND e.entry_source IS DISTINCT FROM 'bank_statement'
          AND (e.payee ILIKE $2 OR e.invoice_number ILIKE $2)
        ORDER BY e.invoice_date DESC NULLS LAST LIMIT 40`,
      [req.labelId, q]
    );
    // Fully-claimed families are dropped (matching them can only 409); the
    // rest carry `remaining` so the chip can say how much room is left.
    const out = [];
    for (const r of rows) {
      const total = Number(r.family_amount) || 0;
      const claimed = Number(r.claimed) || 0;
      const remaining = Math.round((total - claimed) * 100) / 100;
      if (claimed > 0 && remaining <= 0.01) continue;
      out.push({ ...r, claimed: Math.round(claimed * 100) / 100, remaining, partially_settled: claimed > 0 });
    }
    res.json({ success: true, data: out.slice(0, 25) });
  } catch (e) { console.error('ledger-search error:', e); res.status(500).json({ success: false, error: 'Internal server error' }); }
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
          ? `That invoice is already covered by a ${Number(holder.amount).toFixed(2)} debit on ${(holder.txn_date instanceof Date ? holder.txn_date.toISOString() : String(holder.txn_date)).slice(0, 10)} — unmatch that one first`
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
    // If this match DISPLACED a booking (a rematch), put it back — otherwise
    // the row lands open with its only answer soft-deleted, which is a state
    // nothing in the UI can get out of.
    const restored = t.match_method === 'rematch'
      ? await restoreDisplacedBooking(req.labelId, t.id, req.user.name).catch(() => null)
      : null;
    res.json({ success: true, data: { restored_expense_id: restored } });
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
    // Optional "always book <payee> as <category>" rule — GUARDED, because a
    // rule can be a wrong turn. If this vendor has ever sent a real invoice,
    // its lines want MATCHING: a booking rule would quietly convert matchable
    // payments into rematch work while its invoices sit unclaimed. The booking
    // itself still goes through; only the rule is refused, and the refusal is
    // named in the response so the click isn't a silent no-op.
    let ruleSkipped = null;
    if (req.body.rule && req.body.category && (t.payee_guess || t.description)) {
      const pattern = (t.payee_guess || t.description).slice(0, 120).trim();
      if (pattern.length < 3) {
        // A 1-2 char payee_guess mints a substring rule that auto-books broad
        // swathes of every future upload.
        ruleSkipped = 'pattern too short for a standing rule — booked without one';
      } else {
        const vendorName = String(req.body.payee || t.payee_guess || '').trim();
        const { rows: inv } = await pool.query(
          `SELECT COUNT(*)::int AS n FROM expenses
            WHERE label_id = $1 AND (deleted = false OR deleted IS NULL)
              AND COALESCE(entry_source, '') <> 'bank_statement'
              AND COALESCE(TRIM(invoice_number), '') <> ''
              AND LOWER(TRIM(payee)) = LOWER(TRIM($2))`,
          [req.labelId, vendorName || pattern]);
        if (inv[0].n > 0) {
          ruleSkipped = `"${vendorName || pattern}" has sent ${inv[0].n} real invoice${inv[0].n === 1 ? '' : 's'} — its lines want matching, so no standing rule was written`;
        } else {
          await pool.query('INSERT INTO statement_category_rules (label_id, pattern, category, created_by) VALUES ($1,$2,$3,$4)',
            [req.labelId, pattern, req.body.category, req.user.name]);
          await logActivity(req, 'Added statement book rule', `always book "${pattern}" as ${req.body.category}`);
          // Pair it in the same call when the client says no invoice is ever
          // coming — an unpaired BOOK rule feeds the needs-invoice queue.
          const niPattern = String(req.body.no_invoice_pattern || '').trim().slice(0, 120);
          if (niPattern.length >= 2) {
            await pool.query(
              `INSERT INTO statement_no_invoice_rules (label_id, scope, pattern, created_by)
               VALUES ($1, 'vendor', $2, $3)
               ON CONFLICT (label_id, scope, LOWER(TRIM(pattern))) DO UPDATE SET created_at = NOW()`,
              [req.labelId, niPattern, req.user.name]).catch(() => {});
          }
        }
      }
    }
    await logActivity(req, 'Booked bank debit', `${entry.payee} — ${entry.amount}`);
    res.json({ success: true, data: entry, rule_skipped: ruleSkipped });
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
    // Zombie guard: a dismissed-but-matched row hides the bank proof while the
    // ledger still counts the entry — and dismissing a BOOKED row would orphan
    // the entry it created. Force the unlink/unbook first.
    if (t.matched_expense_id || t.matched_income_id || t.booked) {
      return res.status(400).json({ success: false, error: 'This transaction is matched or booked — unmatch/unbook it before dismissing.' });
    }
    await pool.query(`UPDATE bank_transactions SET dismissed = TRUE, dismissed_reason = COALESCE($2,'manual') WHERE id = $1 AND label_id = $3`,
      [t.id, req.body.reason || null, req.labelId]);
    // Dismissing a card that carried a suggestion is a "no" to that pairing —
    // record it so the matcher and deck never re-propose the exact pair.
    const rejectedRoot = parseInt(req.body.rejected_expense_id, 10);
    if (rejectedRoot) {
      await pool.query(
        `INSERT INTO statement_match_rejections (label_id, txn_fingerprint, expense_root_id, source, created_by)
         VALUES ($1, $2, $3, 'dismiss', $4) ON CONFLICT DO NOTHING`,
        [req.labelId, R.txnFingerprint(t), rejectedRoot, req.user.name]
      ).catch(() => {});
    }
    // ≥3 chars — a 1-2 char payee_guess would mint a substring rule that
    // silently auto-dismisses broad swathes of every future upload.
    let ruleSkipped = null;
    let ruleSwept = 0;
    if (req.body.rule && (t.payee_guess || t.description)) {
      const pattern = (t.payee_guess || t.description).slice(0, 120).trim();
      if (pattern.length < 3) {
        ruleSkipped = 'pattern too short for a standing rule — dismissed without one';
      } else {
        await pool.query('INSERT INTO statement_dismiss_rules (label_id, pattern, created_by) VALUES ($1,$2,$3)',
          [req.labelId, pattern, req.user.name]);
        // Sweep it across every existing open debit right away — a rule that
        // only touches FUTURE ingests leaves this month's recurrences open.
        const swept = await pool.query(
          `UPDATE bank_transactions SET dismissed = TRUE, dismissed_reason = $1
            WHERE label_id = $2 AND direction = 'debit' AND dismissed = FALSE
              AND matched_expense_id IS NULL AND matched_income_id IS NULL AND booked = FALSE
              AND (payee_guess ILIKE $3 OR description ILIKE $3)`,
          [`rule: ${pattern}`.slice(0, 120), req.labelId, `%${pattern.replace(/[\\%_]/g, (m) => '\\' + m)}%`]);
        ruleSwept = swept.rowCount || 0;
        await logActivity(req, 'Added statement dismiss rule', `always set aside "${pattern}" (${ruleSwept} existing open row${ruleSwept === 1 ? '' : 's'} swept)`);
      }
    }
    res.json({ success: true, rule_skipped: ruleSkipped, rule_swept: ruleSwept });
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
      // Same zombie guard as the single-row endpoint: matched/booked rows are
      // skipped in the WHERE (the client gates to open rows; the server must
      // not trust that) and the real count is returned.
      const { rowCount } = await pool.query(
        `UPDATE bank_transactions SET dismissed = TRUE, dismissed_reason = 'manual'
          WHERE id = ANY($1::int[]) AND label_id = $2
            AND matched_expense_id IS NULL AND matched_income_id IS NULL AND booked = FALSE`,
        [ids, req.labelId]);
      n = rowCount;
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

// Repoint one or more learned links at a ledger vendor — the fix behind the
// lesson-disagreement and vendor-link flags. A learned link is what the NEXT
// statement follows, so a wrong one keeps re-creating the same mistake; this
// rewrites the lesson without touching a single existing match.
router.post('/rules/relink', async (req, res) => {
  try {
    const target = String(req.body.ledger_payee || '').trim();
    const names = (Array.isArray(req.body.bank_payees) ? req.body.bank_payees : [req.body.bank_payee])
      .map((n) => String(n || '').trim()).filter(Boolean).slice(0, 100);
    if (!target || !names.length) return res.status(400).json({ success: false, error: 'bank_payees and ledger_payee required' });
    for (const n of names) await R.learnPayee(pool, req.labelId, n, target, req.user.name);
    await logActivity(req, 'Repointed learned bank links',
      names.length === 1 ? `"${names[0]}" → ${target}` : `${names.length} descriptors → ${target}`);
    res.json({ success: true, data: { relinked: names.length, ledger_payee: target } });
  } catch (e) { console.error('relink error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

// ── Monthly soft close ───────────────────────────────────────────────────────
router.get('/months', async (req, res) => {
  try {
    // month key computed in SQL — pg returns DATE as a JS Date, and
    // String(date).slice(0, 7) yields "Wed Aug", collapsing every month.
    const txns = (await pool.query(
      `SELECT to_char(t.txn_date, 'YYYY-MM') AS month_key, t.direction, t.amount, t.currency, t.dismissed, t.matched_expense_id, t.matched_income_id, s.account
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
      const mk = t.month_key;
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
    // Which configured accounts have NO statement covering the month — the
    // reconcile gate needs it ("No {account} statement covers this month"):
    // a month can read 100% coverage while a whole account is simply absent.
    const labelRow = (await pool.query('SELECT bank_accounts FROM labels WHERE id = $1', [req.labelId])).rows[0] || {};
    const configured = R.accountsFor(labelRow).map(a => a.key);
    const out = Object.values(months)
      .map(m => ({
        ...m, accounts: [...m.accounts],
        missing_accounts: configured.filter(k => !m.accounts.has(k)),
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
