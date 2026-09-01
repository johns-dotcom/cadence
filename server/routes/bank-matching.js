// Bank Matching — the reconciliation WORK SURFACE. The statements page is the
// FILES; this is where open money gets answered. Admin-only, label-scoped.
//
// Two directions:
//   statement → ledger  (the queue: every open bank line)
//   ledger → statement  (paid ledger rows the bank never shows, partitioned
//                        needs_match / awaiting_statement / missing_statement)
//
// Completion model — three states, never two: a MATCHED row is tied to an
// invoice a vendor actually sent; a BOOKED row is an entry the app invented
// from the bank line (no document behind it); OPEN is unanswered. "Explained"
// and "invoice-backed" are different claims and both are reported.

const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const R = require('../lib/bankReconcile');
const { usdOf, round2 } = require('../lib/usd');
const { normalizeBankPayee } = require('../lib/normalizeBankPayee');
const { settleTxnWithInvoices, detachTxn, restoreDisplacedBooking, feeTolerance } = require('../lib/statementLinks');
const { proposeFundingPairs } = require('../lib/fundingPairs');
const { proposeGroups } = require('../lib/groupProposal');
const { aggregateBankVendors, vendorHintFor } = require('../lib/bankVendors');
const bankEvidence = require('../lib/bankEvidence');
const { stampFxRateAsync } = require('../lib/fxStamp');
const { familyRoot } = require('../lib/paymentFamily');
const { loadEverInvoiced, buildRuleSuggestions, annotateCategoryRules } = require('../lib/uploadRules');
const { autoLinkRelease } = require('./ledger');

const router = express.Router();
router.use(authMiddleware, withTenant, requireAdmin);

// One definition, shared with routes/bank-statements.js — see lib/statementLens.js
// for why it stopped being two.
const { dispositionOf } = require('../lib/statementLens');

async function loadLabelAccounts(labelId) {
  const row = (await pool.query(`SELECT bank_accounts FROM labels WHERE id = $1`, [labelId])).rows[0] || {};
  return R.accountsFor(row);
}

// ── The queue ────────────────────────────────────────────────────────────────
router.get('/queue', async (req, res) => {
  try {
    const stmtParam = req.query.statement && req.query.statement !== 'all' ? parseInt(req.query.statement, 10) : null;
    const params = [req.labelId];
    let stmtClause = '';
    if (stmtParam) { params.push(stmtParam); stmtClause = ` AND t.statement_id = $${params.length}`; }
    const { rows: txns } = await pool.query(
      `SELECT t.*, s.account, s.filename, s.period_start, s.period_end,
              e.payee AS exp_payee, e.category AS exp_category, e.payment_status AS exp_payment_status,
              e.artist AS exp_artist, e.invoice_number AS exp_invoice_number,
              e.invoice_r2_key AS exp_invoice_key, e.entry_source AS exp_source,
              i.source AS income_type
         FROM bank_transactions t
         JOIN bank_statements s ON s.id = t.statement_id AND s.status = 'ready'
         LEFT JOIN expenses e ON e.id = t.matched_expense_id
         LEFT JOIN artist_income i ON i.id = t.matched_income_id AND i.label_id = t.label_id
        WHERE t.label_id = $1${stmtClause}
        ORDER BY t.txn_date DESC, t.id DESC`,
      params
    );
    const { suggestCategory, suggestIncomeType } = require('../lib/statementSuggest');
    const maps = await R.loadMaps(pool, req.labelId);
    const accounts = await loadLabelAccounts(req.labelId);
    // What descriptors have historically resolved to, for the `history` tier
    // of the vendor hint. Built from THIS payload so it costs nothing extra.
    const matchedNames = new Map();
    for (const t of txns) {
      if (!t.exp_payee || t.exp_source === 'bank_statement') continue;
      const k = normalizeBankPayee(t.payee_guess || t.description || '');
      if (!k) continue;
      const set = matchedNames.get(k) || new Set();
      set.add(t.exp_payee);
      matchedNames.set(k, set);
    }
    // Reversal pairing, per ACCOUNT — a failed payment and its refund cancel
    // out, and the chips steer review away from matching either side to an
    // invoice (or, worse, booking the credit as revenue).
    const { pairReversals } = require('../lib/reversalPairs');
    const reversedBy = new Map(), reversalOf = new Map();
    const byAccount = new Map();
    for (const t of txns) {
      const arr = byAccount.get(t.account) || [];
      arr.push(t);
      byAccount.set(t.account, arr);
    }
    for (const [, list] of byAccount) {
      for (const p of pairReversals(list)) { reversedBy.set(p.debit.id, p.credit.id); reversalOf.set(p.credit.id, p.debit.id); }
    }

    const rows = [];
    let suggBudget = 200; // suggestion SQL per open row — cap the work per request
    let groupBudget = 40; // group proposals are a subset search — a tighter cap
    for (const t of txns) {
      const disposition = dispositionOf(t);
      const row = {
        ...t, disposition,
        // The parser's printed settlement wins; else cached rates. Summing
        // yen as dollars is the failure this exists to prevent.
        usd: round2(t.amount_usd != null ? Number(t.amount_usd) : usdOf(t.amount, t.currency, null)),
        reversed_by: reversedBy.get(t.id) || null,
        reversal_of: reversalOf.get(t.id) || null,
        vendor_hint: vendorHintFor(t, maps, matchedNames),
        suggested_category: disposition === 'open' ? suggestCategory(t.payee_guess, t.description) : null,
        suggested_income_type: disposition === 'open-credit' ? suggestIncomeType(t.payee_guess, t.description) : null,
        suggestions: null,
        group_proposal: null,
      };
      if (disposition === 'open' && suggBudget > 0) {
        suggBudget -= 1;
        const methods = R.accountMethods(accounts, t.account);
        row.suggestions = await R.suggestions(pool, req.labelId, t, methods, maps).catch(() => []);
        // A group proposal is only offered when NO single invoice explains the
        // line — otherwise the page would offer two contradictory answers to
        // the same row and let the click decide which is true.
        const top = row.suggestions?.[0];
        if ((!top || top.score < 0.85) && groupBudget > 0) {
          groupBudget -= 1;
          const cands = await R.candidates(pool, req.labelId, t, methods).catch(() => []);
          const g = proposeGroups(t, cands, { aliasGroups: maps.aliasGroups });
          if (g.sets.length) row.group_proposal = { ...g, sets: g.ambiguous ? g.sets.slice(0, 2) : g.sets };
        }
      }
      rows.push(row);
    }
    // "Likely" — open rows whose TOP suggestion scores ≥0.90, deduped so two
    // rows sharing one top suggestion count once (the other would 409).
    const seenTargets = new Set();
    for (const r of rows) {
      const top = r.suggestions?.[0];
      r.likely = false;
      if (r.disposition === 'open' && top && top.score >= 0.9 && !seenTargets.has(top.expense_id)) {
        seenTargets.add(top.expense_id);
        r.likely = true;
      }
    }
    const statements = (await pool.query(
      `SELECT id, filename, account, period_start, period_end FROM bank_statements
        WHERE label_id = $1 AND status = 'ready' ORDER BY period_start DESC NULLS LAST, id DESC`,
      [req.labelId]
    )).rows;
    res.json({ success: true, data: { rows, statements, accounts, suggestions_capped: suggBudget <= 0 } });
  } catch (e) { console.error('queue error:', e); res.status(500).json({ success: false, error: 'Queue failed' }); }
});

// ── Completion — the ONE definition ─────────────────────────────────────────
router.get('/completion', async (req, res) => {
  try {
    const stmtParam = req.query.statement_id ? parseInt(req.query.statement_id, 10) : null;
    // Always fetch UNSCOPED and narrow in JS — "what else is left" must
    // survive narrowing to one statement.
    const { rows: txns } = await pool.query(
      `SELECT t.id, t.statement_id, t.txn_date, t.amount, t.currency, t.direction, t.dismissed,
              t.matched_expense_id, t.match_method, t.booked, t.no_invoice, t.payee_guess, t.description,
              s.account, e.payee AS exp_payee, e.category AS exp_category
         FROM bank_transactions t
         JOIN bank_statements s ON s.id = t.statement_id AND s.status = 'ready'
         LEFT JOIN expenses e ON e.id = t.matched_expense_id
        WHERE t.label_id = $1 AND t.direction = 'debit' AND t.dismissed = FALSE`,
      [req.labelId]
    );
    const rules = (await pool.query(`SELECT id, scope, pattern FROM statement_no_invoice_rules WHERE label_id = $1 ORDER BY id`, [req.labelId])).rows;
    // Whole-category candidates need the invoice census — a category is only
    // offered when NOT ONE of its vendors has ever sent an invoice.
    const everInvoiced = await loadEverInvoiced(pool, req.labelId);
    const ruleHit = (t) => {
      // BOTH names, not a fallback chain: a vendor rule written for the bank
      // descriptor must still clear rows whose ledger payee differs, and vice
      // versa — otherwise the queue count disagrees with what a rule accept
      // actually delivers.
      const ledger = String(t.exp_payee || '').trim().toLowerCase();
      const guess = String(t.payee_guess || '').trim().toLowerCase();
      const cat = String(t.exp_category || '').trim().toLowerCase();
      // EQUALITY, never substring — "TONE" is inside "Tone Pay, Inc".
      return rules.some((r) => {
        const p = r.pattern.trim().toLowerCase();
        if (r.scope === 'vendor') return (!!ledger && p === ledger) || (!!guess && p === guess);
        return !!cat && p === cat;
      });
    };
    const mk = () => ({ n: 0, value: 0 });
    // FIVE dispositions, and the bucket names mean what they say:
    //   needs_invoice      — booked, still expects a document (the worklist)
    //   no_invoice_expected — booked and ANSWERED (a rule or the row says so)
    //   creator            — a creator payment: explained, never invoice-backed
    // `booked_expected` / `booked_not_expected` are kept as aliases with the
    // reference app's meanings (expected = still waiting) so an older consumer
    // reads the same truth rather than the opposite one.
    const buckets = { matched: mk(), creator: mk(), needs_invoice: mk(), no_invoice_expected: mk(), open: mk() };
    // The same five, narrowed to ?statement_id. Narrowing must change the
    // percentages on the card, or the card is answering about a different set
    // of money than the queue underneath it.
    const scopedBuckets = { matched: mk(), creator: mk(), needs_invoice: mk(), no_invoice_expected: mk(), open: mk() };
    const needsInvoiceIds = [];
    const byStatement = {};
    const vendorClusters = new Map();
    const catStat = new Map();
    let total = 0;
    let scopedTotal = 0;
    let leftAll = 0, leftAllValue = 0;
    for (const t of txns) {
      const usd = usdOf(t.amount, t.currency, null);
      total += usd;
      const inScope = !stmtParam || t.statement_id === stmtParam;
      if (inScope) scopedTotal += usd;
      const st = byStatement[t.statement_id] || (byStatement[t.statement_id] = { left: 0, left_value: 0, open: 0, needs_invoice: 0, debits: 0 });
      st.debits += 1;
      const isBooked = t.booked || t.match_method === 'created' || t.match_method === 'rule';
      let bucket;
      if (isBooked) {
        bucket = (t.no_invoice || ruleHit(t)) ? 'no_invoice_expected' : 'needs_invoice';
        if (bucket === 'needs_invoice') {
          needsInvoiceIds.push(t.id);
          // "Left" is open PLUS created-and-not-answered. Counting only fully
          // open rows lets a statement read "0 left" in the selector while the
          // needs-invoice chip beside it shows a three-figure pile — the exact
          // drift the reference app's comments memorialise fixing.
          st.left += 1; st.left_value += usd; st.needs_invoice += 1;
          leftAll += 1; leftAllValue += usd;
          const key = normalizeBankPayee(t.exp_payee || t.payee_guess || t.description || '') || '(no payee)';
          const c = vendorClusters.get(key) || { key, n: 0, value: 0, sample: t.exp_payee || t.payee_guess };
          c.n += 1; c.value += usd;
          vendorClusters.set(key, c);
          // Category evidence for the "whole categories that never invoice"
          // candidates below — tracked with money and the vendor census, so a
          // candidate carries its evidence instead of a bare count.
          if (t.exp_category) {
            const cs = catStat.get(t.exp_category) || { category: t.exp_category, n: 0, value: 0, vendors: new Set(), invoiced_vendors: 0 };
            cs.n += 1; cs.value += usd;
            const vp = String(t.exp_payee || t.payee_guess || '').trim().toLowerCase();
            if (vp && !cs.vendors.has(vp)) {
              cs.vendors.add(vp);
              if (everInvoiced.has(vp)) cs.invoiced_vendors += 1;
            }
            catStat.set(t.exp_category, cs);
          }
        }
      } else if (t.matched_expense_id) {
        // 'creator' matches are explained but NEVER invoice-backed.
        bucket = t.match_method === 'creator' ? 'creator' : 'matched';
      } else {
        bucket = 'open';
        st.left += 1; st.left_value += usd; st.open += 1;
        leftAll += 1; leftAllValue += usd;
      }
      buckets[bucket].n += 1;
      buckets[bucket].value += usd;
      if (inScope) { scopedBuckets[bucket].n += 1; scopedBuckets[bucket].value += usd; }
    }
    for (const b of Object.values(buckets)) b.value = round2(b.value);
    for (const b of Object.values(scopedBuckets)) b.value = round2(b.value);
    // The card reports the NARROWED set when a statement is selected; the
    // headline and by_statement stay global, because "what else is left"
    // must survive narrowing to one file.
    const shown = stmtParam ? scopedBuckets : buckets;
    const shownTotal = stmtParam ? scopedTotal : total;
    const explained = shown.matched.value + shown.creator.value + shown.needs_invoice.value + shown.no_invoice_expected.value;
    const pct = (v) => (shownTotal > 0 ? Math.round((v / shownTotal) * 1000) / 10 : 100);
    const scoped = stmtParam ? { statement_id: stmtParam, ...(byStatement[stmtParam] || { left: 0, left_value: 0, open: 0, needs_invoice: 0, debits: 0 }) } : null;
    res.json({
      success: true,
      data: {
        ...Object.fromEntries(Object.entries(shown)),
        // Reference-app-compatible aliases: expected = still expects a
        // document; not_expected = answered. Naming them the other way round
        // is internally consistent and a trap for every other consumer.
        booked_expected: shown.needs_invoice,
        booked_not_expected: shown.no_invoice_expected,
        total: round2(shownTotal),
        scoped_to_statement: stmtParam || null,
        workspace_total: round2(total),
        explained_pct: pct(explained),
        invoice_backed_pct: pct(shown.matched.value),
        // The headline: everything still owed an answer anywhere, so narrowing
        // the queue never hides the size of the job.
        left_all: leftAll,
        left_all_value: round2(leftAllValue),
        needs_invoice_txn_ids: needsInvoiceIds,
        by_statement: byStatement,
        scoped,
        vendors: [...vendorClusters.values()].map((c) => ({ ...c, value: round2(c.value) })).sort((a, b) => b.value - a.value).slice(0, 40),
        // Categories where NOT ONE vendor has ever sent an invoice — offered
        // as suggested answers WITH their evidence (n · $ · vendor count),
        // never applied automatically. A category with even one invoicing
        // vendor is not offered: those rows want matching.
        category_candidates: [...catStat.values()]
          .filter((c) => c.invoiced_vendors === 0 && c.n > 0)
          .map((c) => ({ category: c.category, n: c.n, value: round2(c.value), vendors: c.vendors.size }))
          .sort((a, b) => b.value - a.value),
        rules,
      },
    });
  } catch (e) { console.error('completion error:', e); res.status(500).json({ success: false, error: 'Completion failed' }); }
});

// ── Direction 2 — paid ledger rows the bank never shows ─────────────────────
router.get('/unmatched-ledger', async (req, res) => {
  try {
    const accounts = await loadLabelAccounts(req.labelId);
    const base = (predicate) => pool.query(
      `SELECT e.id, e.payee, e.artist, e.song, e.category, e.invoice_number, e.amount,
              COALESCE(e.currency, 'USD') AS currency, e.fx_rate_to_usd, e.payment_date, e.payment_method,
              (e.invoice_r2_key IS NOT NULL OR e.vendor_submitted = TRUE) AS has_invoice
         FROM expenses e
        WHERE e.label_id = $1 AND e.status = 'approved'
          AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
          AND e.entry_source IS DISTINCT FROM 'bank_statement'
          AND NOT EXISTS (SELECT 1 FROM expenses c WHERE c.parent_id = e.id AND (c.deleted IS NULL OR c.deleted = FALSE))
          AND ${predicate}
        ORDER BY e.payment_date DESC NULLS LAST
        LIMIT 400`,
      [req.labelId]
    );
    const [needs, awaiting, missing] = await Promise.all([
      base(bankEvidence.noBankEvidenceSql('e', accounts)),
      base(bankEvidence.awaitingStatementSql('e', accounts)),
      base(bankEvidence.missingStatementSql('e', accounts)),
    ]);
    // LIMIT 400 per band: a silent truncation makes "n" a lie, so the cap is
    // reported and the client says so.
    const shape = (rows) => ({
      n: rows.rows.length,
      truncated: rows.rows.length >= 400,
      value: round2(rows.rows.reduce((s, r) => s + usdOf(r.amount, r.currency, r.fx_rate_to_usd), 0)),
      rows: rows.rows.map((r) => ({ ...r, usd: round2(usdOf(r.amount, r.currency, r.fx_rate_to_usd)) })),
    });
    const coverage = (await pool.query(
      `SELECT account, MAX(period_end) AS latest, COUNT(*)::int AS statements
         FROM bank_statements WHERE label_id = $1 AND status = 'ready' GROUP BY account`,
      [req.labelId]
    )).rows;

    // The way OUT of the needs-match band. A row here says "the bank should
    // show this and doesn't" — usually because an open debit on some statement
    // IS the payment under a different name. Offering those debits turns a
    // dead-end list into a one-click match; without it the only exit is to go
    // hunting on the other side of the page.
    const needsShaped = shape(needs);
    if (needsShaped.rows.length) {
      const openDebits = (await pool.query(
        `SELECT t.id, t.txn_date, t.amount, t.currency, t.payee_guess, t.description, t.statement_id, s.account
           FROM bank_transactions t
           JOIN bank_statements s ON s.id = t.statement_id AND s.status = 'ready'
          WHERE t.label_id = $1 AND t.direction = 'debit' AND t.dismissed = FALSE
            AND t.matched_expense_id IS NULL AND t.booked = FALSE`,
        [req.labelId]
      )).rows;
      for (const e of needsShaped.rows) {
        const fam = Number(e.amount) || 0;
        const tol = Math.max(35, fam * 0.01);
        e.bank_candidates = openDebits
          .filter((t) => {
            if ((t.currency || 'USD') !== (e.currency || 'USD')) return false;
            // Account/method compatibility, same rule the matcher uses: a
            // PayPal-paid row must not be offered a BofA debit.
            const methods = R.accountMethods(accounts, t.account);
            if (!methods || !e.payment_method) return true;
            return methods.includes(e.payment_method);
          })
          .map((t) => ({
            t, delta: Number(t.amount) - fam,
            dd: Math.abs((new Date(String(t.txn_date).slice(0, 10)) - new Date(String(e.payment_date).slice(0, 10))) / 86400000),
          }))
          .filter((x) => x.delta >= -0.01 && x.delta <= tol && x.dd <= 7)
          .sort((a, b) => a.dd - b.dd || a.delta - b.delta)
          .slice(0, 3)
          .map((x) => ({
            id: x.t.id, txn_date: x.t.txn_date, amount: Number(x.t.amount), currency: x.t.currency,
            payee_guess: x.t.payee_guess || x.t.description, account: x.t.account, statement_id: x.t.statement_id,
            days_apart: Math.round(x.dd),
          }));
      }
    }
    res.json({
      success: true,
      data: { needs_match: needsShaped, awaiting_statement: shape(awaiting), missing_statement: shape(missing), coverage },
    });
  } catch (e) { console.error('unmatched-ledger error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

// ── Multi-invoice attach ─────────────────────────────────────────────────────
router.post('/tx/:id(\\d+)/attach', async (req, res) => {
  try {
    const out = await settleTxnWithInvoices(req.labelId, parseInt(req.params.id, 10), req.body.expense_ids || [], {
      userName: req.user.name, allowPrepayment: req.body.allow_prepayment === true,
    });
    await logActivity(req, 'Attached invoices to bank txn', `txn #${req.params.id} → [${out.linked.join(', ')}]`);
    res.json({ success: true, data: out });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ success: false, error: e.message, prepayment_possible: e.prepayment_possible });
    console.error('attach error:', e);
    res.status(500).json({ success: false, error: 'Attach failed' });
  }
});
router.post('/tx/:id(\\d+)/unattach', async (req, res) => {
  try {
    const out = await detachTxn(req.labelId, parseInt(req.params.id, 10), { actor: req.user.name });
    if (!out.ok) return res.status(400).json({ success: false, error: 'Booked rows unbook on the statement page, not here' });
    res.json({ success: true, data: out });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});
router.post('/unmatch/bulk', async (req, res) => {
  try {
    const ids = (req.body.txn_ids || []).map(Number).filter(Boolean).slice(0, 500);
    const done = [], skipped = [], restored = [];
    for (const id of ids) {
      const t = (await pool.query(`SELECT * FROM bank_transactions WHERE id = $1 AND label_id = $2`, [id, req.labelId])).rows[0];
      if (!t || !t.matched_expense_id || t.match_method === 'created') { skipped.push(id); continue; }
      await pool.query(
        `INSERT INTO statement_match_rejections (label_id, txn_fingerprint, expense_root_id, source, created_by)
         VALUES ($1, $2, $3, 'unmatch', $4) ON CONFLICT DO NOTHING`,
        [req.labelId, R.txnFingerprint(t), t.matched_expense_id, req.user.name]
      ).catch(() => {});
      const out = await detachTxn(req.labelId, id, { actor: req.user.name });
      done.push(id);
      // A rematch this unmatch just undid puts its original booking back —
      // reported, because the row does NOT land open and the count would
      // otherwise describe work that did not happen.
      if (out.restored) restored.push(id);
    }
    await logActivity(req, 'Bulk unmatched bank rows', `${done.length} unmatched, ${skipped.length} skipped, ${restored.length} bookings restored`);
    res.json({ success: true, data: { done, skipped, restored } });
  } catch (e) { console.error('bulk unmatch error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

// ── Rematch: a booked row whose REAL invoice showed up ──────────────────────
router.get('/rematch-candidates', async (req, res) => {
  try {
    const maps = await R.loadMaps(pool, req.labelId);
    const stmtParam = req.query.statement && req.query.statement !== 'all' ? parseInt(req.query.statement, 10) : null;
    const bParams = [req.labelId];
    let bClause = '';
    if (stmtParam) { bParams.push(stmtParam); bClause = ` AND t.statement_id = $${bParams.length}`; }
    const booked = (await pool.query(
      `SELECT t.*, s.account, e.payee AS exp_payee, e.id AS exp_id
         FROM bank_transactions t
         JOIN bank_statements s ON s.id = t.statement_id AND s.status = 'ready'
         JOIN expenses e ON e.id = t.matched_expense_id AND e.entry_source = 'bank_statement'
        WHERE t.label_id = $1 AND t.dismissed = FALSE AND (t.booked = TRUE OR t.match_method IN ('created', 'rule', 'booked'))
          AND t.no_invoice = FALSE${bClause}
        ORDER BY t.txn_date DESC LIMIT 300`,
      bParams
    )).rows;
    const invoices = (await pool.query(
      `SELECT e.id, e.payee, e.invoice_number, e.invoice_date, e.payment_date, e.payment_status,
              e.scheduled_payment_date, e.payment_ref, e.vendor_email, COALESCE(e.currency, 'USD') AS currency,
              e.fx_rate_to_usd, (e.invoice_r2_key IS NOT NULL OR e.vendor_submitted = TRUE) AS has_invoice,
              (e.amount + COALESCE((SELECT SUM(k.amount) FROM expenses k WHERE k.parent_id = e.id AND (k.deleted IS NULL OR k.deleted = FALSE)), 0)) AS family_amount
         FROM expenses e
        WHERE e.label_id = $1 AND e.parent_id IS NULL AND e.status = 'approved'
          AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
          AND e.entry_source IS DISTINCT FROM 'bank_statement'
          AND NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.label_id = e.label_id AND bt.matched_expense_id = e.id AND bt.dismissed = FALSE)
          AND NOT EXISTS (SELECT 1 FROM bank_txn_invoice_links bl JOIN bank_transactions bt2 ON bt2.id = bl.txn_id AND bt2.matched_expense_id IS NOT NULL
                           WHERE bl.label_id = e.label_id AND bl.expense_id = e.id)`,
      [req.labelId]
    )).rows;

    // Amount test in TWO tiers, exact cents first. A cross-currency invoice is
    // reachable — the reference app's fx band, with the arithmetic returned so
    // the card can show its working rather than assert a verdict.
    const amountFit = (t, inv) => {
      const sameCur = (inv.currency || 'USD') === (t.currency || 'USD');
      if (sameCur) {
        const delta = Number(t.amount) - Number(inv.family_amount);
        if (Math.abs(delta) < 0.005) return { tier: 'exact', delta: 0, fx: null };
        if (delta < -0.01 || delta > feeTolerance(Number(inv.family_amount))) return null;
        return { tier: 'fee', delta: round2(delta), fx: null };
      }
      const invUsd = usdOf(inv.family_amount, inv.currency, inv.fx_rate_to_usd);
      const txnUsd = usdOf(t.amount, t.currency, null);
      if (!invUsd) return null;
      const ratio = txnUsd / invUsd;
      if (ratio < 0.94 || ratio > 1.08) return null;
      return {
        tier: 'fx', delta: round2(txnUsd - invUsd),
        fx: { txn_usd: round2(txnUsd), invoice_usd: round2(invUsd), invoice_currency: inv.currency, ratio: Math.round(ratio * 1000) / 1000 },
      };
    };

    // Greedy 1:1 assignment, best score first — and the pairs that LOSE the
    // assignment are returned, not dropped. "3 contested" is a fact about the
    // data; silently discarding them makes the panel look complete.
    const scored = [];
    for (const t of booked) {
      const fp = R.txnFingerprint(t);
      for (const inv of invoices) {
        if (maps.rejections.has(`${fp}::${inv.id}`)) continue;
        const fit = amountFit(t, inv);
        if (!fit) continue;
        const ev = R.evidence(t, inv, maps);
        if (ev.score < 0.6) continue;
        scored.push({ t, inv, fit, score: ev.score, method: ev.method });
      }
    }
    scored.sort((a, b) => b.score - a.score || (a.fit.tier === 'exact' ? -1 : 1));
    const usedInv = new Set(), usedTxn = new Set();
    const pairs = [], contested = [];
    const shape = (c) => ({
      txn: {
        id: c.t.id, txn_date: c.t.txn_date, amount: Number(c.t.amount), currency: c.t.currency,
        payee_guess: c.t.payee_guess, account: c.t.account, booked_payee: c.t.exp_payee, statement_id: c.t.statement_id,
      },
      invoice: {
        id: c.inv.id, payee: c.inv.payee, invoice_number: c.inv.invoice_number,
        amount: Number(c.inv.family_amount), currency: c.inv.currency, has_invoice: c.inv.has_invoice,
      },
      score: Math.round(c.score * 100) / 100, method: c.method, tier: c.fit.tier, delta: c.fit.delta, fx: c.fit.fx,
      gap_days: c.inv.payment_date || c.inv.invoice_date
        ? Math.round(Math.abs(new Date(String(c.t.txn_date).slice(0, 10)) - new Date(String(c.inv.payment_date || c.inv.invoice_date).slice(0, 10))) / 86400000)
        : null,
    });
    for (const c of scored) {
      if (usedTxn.has(c.t.id) || usedInv.has(c.inv.id)) { if (contested.length < 25) contested.push(shape(c)); continue; }
      usedTxn.add(c.t.id); usedInv.add(c.inv.id);
      pairs.push(shape(c));
    }
    res.json({
      success: true,
      data: {
        pairs, contested,
        booked_considered: booked.length,
        invoices_available: invoices.length,
        statement_id: stmtParam || null,
      },
    });
  } catch (e) { console.error('rematch-candidates error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});
router.post('/tx/:id(\\d+)/rematch', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = (await client.query(`SELECT * FROM bank_transactions WHERE id = $1 AND label_id = $2 FOR UPDATE`, [parseInt(req.params.id, 10), req.labelId])).rows[0];
    if (!t || !t.matched_expense_id) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: 'Not a booked row' }); }
    const bookedEntry = (await client.query(`SELECT id, entry_source FROM expenses WHERE id = $1 AND label_id = $2`, [t.matched_expense_id, req.labelId])).rows[0];
    if (!bookedEntry || bookedEntry.entry_source !== 'bank_statement') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'That row is matched to a real invoice, not booked' });
    }
    const root = await familyRoot(client, parseInt(req.body.expense_id, 10), req.labelId);
    if (!root) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: 'Invoice not found' }); }
    // Soft-delete the invented entry with a breadcrumb so unrematch can restore it.
    await client.query(
      `UPDATE expenses SET deleted = TRUE, deleted_by = $3, deleted_at = NOW() WHERE (id = $1 OR parent_id = $1) AND label_id = $2`,
      [bookedEntry.id, req.labelId, `rematch#${t.id}`]
    );
    await client.query(
      `UPDATE bank_transactions SET matched_expense_id = $1, match_method = 'rematch', match_score = 1.0,
              matched_by = $2, matched_at = NOW(), booked = FALSE WHERE id = $3`,
      [root, req.user.name, t.id]
    );
    await client.query('COMMIT');
    await logActivity(req, 'Rematched booked row to a real invoice', `txn #${t.id} → entry #${root}`);
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error('rematch error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
  finally { client.release(); }
});
router.post('/tx/:id(\\d+)/unrematch', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const t = (await pool.query(`SELECT id, match_method FROM bank_transactions WHERE id = $1 AND label_id = $2`, [id, req.labelId])).rows[0];
    if (!t || t.match_method !== 'rematch') return res.status(400).json({ success: false, error: 'Not a rematched row' });
    // One restore path, shared with unmatch — two implementations of "put the
    // displaced booking back" is two chances to leave a row in the dead-end
    // state (open row, soft-deleted entry).
    const restored = await restoreDisplacedBooking(req.labelId, id, req.user.name);
    if (!restored) return res.status(400).json({ success: false, error: 'The original booking is gone — it was hard-deleted or already restored' });
    await logActivity(req, 'Undid a rematch', `txn #${id} → booking #${restored} restored`);
    res.json({ success: true, data: { restored_expense_id: restored } });
  } catch (e) { console.error('unrematch error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

// ── Auto-decisions audit — what the matcher did unasked ─────────────────────
router.get('/auto-decisions', async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const { rows } = await pool.query(
      `SELECT t.id, t.txn_date, t.amount, t.currency, t.payee_guess, t.match_method, t.match_score, t.matched_at,
              e.payee AS exp_payee, e.invoice_number, s.account
         FROM bank_transactions t
         JOIN bank_statements s ON s.id = t.statement_id
         LEFT JOIN expenses e ON e.id = t.matched_expense_id
        WHERE t.label_id = $1 AND t.match_method LIKE 'auto-%' AND t.dismissed = FALSE
          AND t.matched_at > NOW() - ($2 || ' days')::interval
        ORDER BY t.matched_at DESC`,
      [req.labelId, days]
    );
    // The cap must never wear the costume of a total.
    res.json({ success: true, data: { days, total: rows.length, shown: Math.min(rows.length, 200), rows: rows.slice(0, 200) } });
  } catch (e) { console.error('auto-decisions error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

// ── PayPal funding pairs (propose-only; a person confirms each) ─────────────
router.get('/funding-pairs/cross-currency', async (req, res) => {
  try {
    const windowDays = Math.min(10, Math.max(1, parseInt(req.query.days, 10) || 4));
    const accounts = await loadLabelAccounts(req.labelId);
    const ppKeys = accounts.filter((a) => /paypal/i.test(a.key)).map((a) => a.key);
    if (!ppKeys.length) return res.json({ success: true, data: { pairs: [], ambiguous: [] } });
    const { rows: txns } = await pool.query(
      `SELECT t.*, s.account FROM bank_transactions t
         JOIN bank_statements s ON s.id = t.statement_id AND s.status = 'ready'
        WHERE t.label_id = $1 AND t.direction = 'debit' AND t.dismissed = FALSE`,
      [req.labelId]
    );
    const pp = txns.filter((t) => ppKeys.includes(t.account));
    const bank = txns.filter((t) => !ppKeys.includes(t.account) && !t.matched_expense_id && !t.booked);
    // The recipient's OTHER known names — alias group, learned link, vendor
    // override. Without these, a pull naming the legal entity never proves a
    // payment to the trading name.
    const maps = await R.loadMaps(pool, req.labelId);
    const namesFor = (t) => {
      const out = [];
      if (t.vendor_override) out.push(t.vendor_override);
      const raw = String(t.payee_guess || '').toLowerCase().trim();
      const learned = maps.payeeMap[R.normalizeName(raw)];
      if (learned) out.push(learned);
      const group = maps.aliasGroups && maps.aliasGroups.get(raw);
      if (group) out.push(...group);
      return out;
    };
    const out = proposeFundingPairs(pp, bank, { windowDays, namesFor });
    // Already-paired legs, so the panel can offer the undo that closes the loop.
    const paired = (await pool.query(
      `SELECT t.id, t.txn_date, t.amount, t.currency, t.payee_guess, t.description, s.account
         FROM bank_transactions t JOIN bank_statements s ON s.id = t.statement_id AND s.status = 'ready'
        WHERE t.label_id = $1 AND t.dismissed = TRUE AND t.dismissed_reason = 'funding'
        ORDER BY t.txn_date DESC LIMIT 100`,
      [req.labelId]
    )).rows;
    res.json({ success: true, data: { ...out, paired } });
  } catch (e) { console.error('funding-pairs error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});
router.post('/tx/:ppId(\\d+)/funding-pair', async (req, res) => {
  try {
    const bankId = parseInt(req.body.bank_txn_id, 10);
    if (req.body.undo) {
      const r = await pool.query(
        `UPDATE bank_transactions SET dismissed = FALSE, dismissed_reason = NULL WHERE id = $1 AND label_id = $2 AND dismissed_reason = 'funding' RETURNING id`,
        [bankId, req.labelId]
      );
      if (!r.rows.length) return res.status(400).json({ success: false, error: 'That bank line was not set aside as a funding pull' });
      await logActivity(req, 'Unpaired a PayPal funding pull', `bank txn #${bankId} is open again`);
      return res.json({ success: true });
    }
    const bank = (await pool.query(
      `SELECT t.*, s.account FROM bank_transactions t JOIN bank_statements s ON s.id = t.statement_id
        WHERE t.id = $1 AND t.label_id = $2`,
      [bankId, req.labelId]
    )).rows[0];
    if (!bank || bank.direction !== 'debit') return res.status(400).json({ success: false, error: 'Bank pull not found' });
    if (bank.matched_expense_id || bank.booked) return res.status(400).json({ success: false, error: 'That pull is already matched/booked — unlink it first' });
    // An UNPROVEN pairing (amount fits, nothing names the recipient) needs an
    // explicit yes. Dismissing the wrong pull hides a real payment.
    if (req.body.unproven && req.body.confirm_unnamed !== true) {
      return res.status(400).json({
        success: false, unproven: true,
        error: 'Nothing in the pull names this recipient — the amount band alone is not proof. Confirm to set it aside anyway.',
      });
    }
    // Dismiss the BANK PULL leg; the PayPal side stays canonical.
    await pool.query(
      `UPDATE bank_transactions SET dismissed = TRUE, dismissed_reason = 'funding' WHERE id = $1 AND label_id = $2`,
      [bankId, req.labelId]
    );
    await logActivity(req, 'Paired PayPal funding pull', `bank txn #${bankId} ↔ paypal txn #${req.params.ppId}`);
    res.json({ success: true });
  } catch (e) { console.error('funding-pair error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});
// Close every PROVABLE pair in one pass. Unproven pairs are excluded by
// construction; each failure is reported rather than collapsing the batch.
router.post('/funding-pairs/close-all', async (req, res) => {
  try {
    const legs = (Array.isArray(req.body.pairs) ? req.body.pairs : [])
      .map((p) => ({ pp: parseInt(p.pp_id, 10), bank: parseInt(p.bank_txn_id, 10) }))
      .filter((p) => Number.isFinite(p.pp) && Number.isFinite(p.bank))
      .slice(0, 200);
    const done = [], failed = [];
    for (const leg of legs) {
      const r = await pool.query(
        `UPDATE bank_transactions SET dismissed = TRUE, dismissed_reason = 'funding'
          WHERE id = $1 AND label_id = $2 AND direction = 'debit' AND dismissed = FALSE
            AND matched_expense_id IS NULL AND booked = FALSE
          RETURNING id`,
        [leg.bank, req.labelId]
      );
      if (r.rows.length) done.push(leg.bank);
      else failed.push({ bank_txn_id: leg.bank, reason: 'already answered or already set aside' });
    }
    await logActivity(req, 'Closed PayPal funding pairs', `${done.length} pulls set aside, ${failed.length} refused`);
    res.json({ success: true, data: { done, failed } });
  } catch (e) { console.error('funding close-all error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

// ── Split-book: one bank line → several booked slices ───────────────────────
router.post('/tx/:id(\\d+)/split-book', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = (await client.query(
      `SELECT t.*, s.account FROM bank_transactions t JOIN bank_statements s ON s.id = t.statement_id
        WHERE t.id = $1 AND t.label_id = $2 FOR UPDATE OF t`,
      [parseInt(req.params.id, 10), req.labelId]
    )).rows[0];
    if (!t || t.direction !== 'debit') { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: 'Debit not found' }); }
    if (t.matched_expense_id && !t.booked && t.match_method !== 'created') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Matched to a real invoice — unmatch first' });
    }
    const parts = (req.body.parts || []).map((p) => ({
      amount: Number(p.amount), category: String(p.category || '').trim() || null, artist: String(p.artist || '').trim() || null,
    }));
    // 2-6 parts. Beyond six the form is being used as a ledger, and every
    // extra slice is another uncategorised row somebody has to find later.
    if (parts.length < 2 || parts.length > 6 || parts.some((p) => !Number.isFinite(p.amount) || p.amount <= 0)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Between two and six positive parts' });
    }
    // A category per part is REQUIRED, not optional: the whole point of a
    // split is that the slices land on different P&L lines, and a null
    // category books money into an uncategorised row nothing surfaces.
    const uncat = parts.findIndex((p) => !p.category);
    if (uncat >= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: `Part ${uncat + 1} has no category — every slice needs one, or the split books money nowhere` });
    }
    const sum = parts.reduce((s, p) => s + p.amount, 0);
    if (Math.abs(sum - Number(t.amount)) > 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: `Parts sum to ${sum.toFixed(2)}, the line is ${Number(t.amount).toFixed(2)}` });
    }
    // The payee is resolved, never defaulted: 'Bank debit' is not a vendor,
    // and a family filed under it is invisible to every vendor surface.
    // Order = the caller's explicit choice, a person's override, the learned
    // link, the descriptor, the email local-part.
    const maps = await R.loadMaps(pool, req.labelId);
    const hint = vendorHintFor(t, maps, new Map());
    const payee = String(req.body.payee || '').trim()
      || (hint && hint.name)
      || String(t.payee_guess || '').trim()
      || String(t.payee_email || '').split('@')[0].trim();
    if (!payee) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Nothing names the payee on this line — give one, or the slices file under no vendor at all' });
    }
    // Replace any existing booking with the family.
    if (t.booked && t.matched_expense_id) {
      await client.query(`UPDATE expenses SET deleted = TRUE, deleted_by = $3, deleted_at = NOW() WHERE (id = $1 OR parent_id = $1) AND label_id = $2`,
        [t.matched_expense_id, req.labelId, `${req.user.name} (split-book)`]);
    }
    const accounts = await loadLabelAccounts(req.labelId);
    const method = (R.accountMethods(accounts, t.account) || [])[0] || null;
    const mk = async (p, parentId) => (await client.query(
      `INSERT INTO expenses (label_id, invoice_date, payee, description, category, artist, amount, currency,
         status, payment_status, payment_date, payment_ref, payment_method, entry_source, parent_id, created_by, created_at, paid_marked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'approved','Paid',$2,$9,$10,'bank_statement',$11,$12,NOW(),NOW()) RETURNING id`,
      [req.labelId, t.txn_date, payee, t.description || null, p.category, p.artist, p.amount, t.currency || 'USD', t.reference || null, method, parentId, req.user.name]
    )).rows[0];
    const rootRow = await mk(parts[0], null);
    const kids = [];
    for (const p of parts.slice(1)) kids.push(await mk(p, rootRow.id));
    await client.query(
      `UPDATE bank_transactions SET matched_expense_id = $1, match_method = 'created', match_score = 1.0, booked = TRUE,
              matched_by = $2, matched_at = NOW(), dismissed = FALSE, dismissed_reason = NULL WHERE id = $3`,
      [rootRow.id, req.user.name, t.id]
    );
    await client.query('COMMIT');
    stampFxRateAsync(rootRow.id);
    for (const k of kids) stampFxRateAsync(k.id);
    // Same lesson a single booking teaches — a split is still this descriptor
    // meaning this vendor.
    if (payee !== String(t.payee_guess || '').trim()) {
      await R.learnPayee(pool, req.labelId, t.payee_guess || t.description, payee, req.user.name).catch(() => {});
    }
    await logActivity(req, 'Split-booked a bank line', `txn #${t.id} → ${parts.length} slices for ${payee}`);
    res.json({ success: true, data: { expense_id: rootRow.id, payee, parts: parts.length } });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error('split-book error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
  finally { client.release(); }
});

// ── Duplicate pairs: one payment, two ledger rows ────────────────────────────
router.get('/duplicate-pairs', async (req, res) => {
  try {
    // Orphan = Paid family with NO bank line; twin = same payee+amount family
    // that HAS one. The orphan is probably a hand-logged copy of the twin.
    const { rows } = await pool.query(
      `SELECT o.id AS orphan_id, o.payee, o.amount, o.currency, o.payment_date AS orphan_paid,
              o.artist AS orphan_artist, o.invoice_number AS orphan_invoice_number,
              (o.invoice_r2_key IS NOT NULL OR o.vendor_submitted = TRUE) AS orphan_has_invoice,
              (o.w9_r2_key IS NOT NULL) AS orphan_has_w9,
              w.id AS twin_id, w.payment_date AS twin_paid, w.amount AS twin_amount,
              w.artist AS twin_artist, w.invoice_number AS twin_invoice_number, w.entry_source AS twin_source,
              (w.invoice_r2_key IS NOT NULL OR w.vendor_submitted = TRUE) AS twin_has_invoice,
              (w.w9_r2_key IS NOT NULL) AS twin_has_w9
         FROM expenses o
         JOIN expenses w ON w.label_id = o.label_id AND w.id <> o.id AND w.parent_id IS NULL
          -- ±0.01: two records of ONE payment routinely differ by a rounded
          -- cent (one typed by hand, one parsed). Exact equality misses those,
          -- which is the duplicate that survives longest.
          AND LOWER(TRIM(w.payee)) = LOWER(TRIM(o.payee)) AND ABS(w.amount - o.amount) <= 0.01
          AND COALESCE(w.currency, 'USD') = COALESCE(o.currency, 'USD')
          AND w.status = 'approved' AND (w.deleted IS NULL OR w.deleted = FALSE)
          AND EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.label_id = w.label_id AND bt.matched_expense_id = w.id AND bt.dismissed = FALSE)
        WHERE o.label_id = $1 AND o.parent_id IS NULL AND o.status = 'approved' AND o.payment_status = 'Paid'
          AND (o.deleted IS NULL OR o.deleted = FALSE) AND (o.voided IS NULL OR o.voided = FALSE)
          AND o.entry_source IS DISTINCT FROM 'bank_statement'
          AND NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.label_id = o.label_id AND bt.matched_expense_id = o.id AND bt.dismissed = FALSE)
          AND NOT EXISTS (SELECT 1 FROM statement_match_rejections r WHERE r.label_id = o.label_id AND r.source = 'dup-pair' AND r.expense_root_id = o.id)
        LIMIT 100`,
      [req.labelId]
    );
    // One proposal per orphan — closest paid date wins.
    const best = new Map();
    for (const r of rows) {
      const gapMs = Math.abs(new Date(r.orphan_paid || 0) - new Date(r.twin_paid || 0));
      const cur = best.get(r.orphan_id);
      if (!cur || gapMs < cur.gapMs) best.set(r.orphan_id, { ...r, gapMs, gap_days: Math.round(gapMs / 86400000) });
    }
    res.json({ success: true, data: { pairs: [...best.values()].map(({ gapMs, ...p }) => p) } });
  } catch (e) { console.error('duplicate-pairs error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});
router.post('/duplicate-pairs/merge', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = '30s'`);
    // A lock_timeout as well as a statement_timeout: without it, two people
    // merging overlapping pairs block on each other for the full 30s and both
    // surface as "Merge failed" with nothing said about why.
    await client.query(`SET LOCAL lock_timeout = '10s'`);
    const orphanId = parseInt(req.body.orphan_id, 10);
    const twinId = parseInt(req.body.twin_id, 10);
    const [orphan, twin] = await Promise.all([
      client.query(`SELECT * FROM expenses WHERE id = $1 AND label_id = $2 FOR UPDATE`, [orphanId, req.labelId]),
      client.query(`SELECT * FROM expenses WHERE id = $1 AND label_id = $2 FOR UPDATE`, [twinId, req.labelId]),
    ]);
    if (!orphan.rows.length || !twin.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Pair not found' }); }
    // Keep the ORPHAN (the hand-logged one usually carries the invoice +
    // artist); move the twin's bank rows onto it, then soft-delete the twin.
    const moved = await client.query(`UPDATE bank_transactions SET matched_expense_id = $1 WHERE label_id = $2 AND matched_expense_id = $3 RETURNING id`, [orphanId, req.labelId, twinId]);
    // The merge's whole purpose is to move the bank proof. If nothing moved,
    // the twin no longer holds it (someone unmatched it first) and archiving
    // the twin would destroy a record while proving nothing — refuse instead.
    if (!moved.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        error: `Entry #${twinId} no longer holds a bank line, so there is nothing to move onto #${orphanId}. Re-run the check — the pair may already be resolved.`,
      });
    }
    await client.query(`UPDATE bank_txn_invoice_links SET expense_id = $1 WHERE label_id = $2 AND expense_id = $3`, [orphanId, req.labelId, twinId]).catch(() => {});
    // Carry documents the orphan lacks — server-side, never through Node.
    const carry = ['invoice_r2_key', 'invoice_filename', 'w9_r2_key', 'w9_filename', 'proof_r2_key', 'proof_filename', 'artist', 'song', 'invoice_number'];
    for (const col of carry) {
      await client.query(
        `UPDATE expenses o SET ${col} = w.${col} FROM expenses w
          WHERE o.id = $1 AND w.id = $2 AND o.label_id = $3 AND w.label_id = $3
            AND (o.${col} IS NULL OR o.${col}::text = '') AND w.${col} IS NOT NULL`,
        [orphanId, twinId, req.labelId]
      );
    }
    // Carry the twin's RECOUPMENT state. `ufr` is a mark a person made about
    // money — "this went out on an artist's statement" — and its date is what
    // stamps the statement month. Archiving the row that carries it silently
    // un-recoups the spend and the artist statement quietly changes.
    //
    // `recoupable` is deliberately NOT carried: it defaults TRUE, so forcing
    // it would overwrite a deliberate "no" with a default, which is the
    // opposite of preserving a decision.
    const carriedState = [];
    const ufrCarry = await client.query(
      `UPDATE expenses o SET ufr = TRUE, ufr_marked_at = COALESCE(o.ufr_marked_at, w.ufr_marked_at)
         FROM expenses w
        WHERE o.id = $1 AND w.id = $2 AND o.label_id = $3 AND w.label_id = $3
          AND w.ufr = TRUE AND COALESCE(o.ufr, FALSE) = FALSE RETURNING o.id`,
      [orphanId, twinId, req.labelId]
    ).catch(() => ({ rows: [] }));
    if (ufrCarry.rows.length) carriedState.push('UFR mark');
    const labelCarry = await client.query(
      `UPDATE expenses o SET recoupment_label = w.recoupment_label FROM expenses w
        WHERE o.id = $1 AND w.id = $2 AND o.label_id = $3 AND w.label_id = $3
          AND o.recoupment_label IS NULL AND w.recoupment_label IS NOT NULL RETURNING o.id`,
      [orphanId, twinId, req.labelId]
    ).catch(() => ({ rows: [] }));
    if (labelCarry.rows.length) carriedState.push('recoupment label');
    await client.query(`UPDATE expenses SET deleted = TRUE, deleted_by = $3, deleted_at = NOW() WHERE (id = $1 OR parent_id = $1) AND label_id = $2`,
      [twinId, req.labelId, `${req.user.name} (duplicate merge)`]);
    await client.query('COMMIT');
    await logActivity(req, 'Merged duplicate payment rows',
      `kept #${orphanId}, archived #${twinId} — ${moved.rows.length} bank line(s) moved`
      + (carriedState.length ? `, carried ${carriedState.join(' + ')}` : ''));
    res.json({ success: true, data: { moved: moved.rows.length, carried: carriedState } });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error('dup merge error:', e); res.status(500).json({ success: false, error: 'Merge failed' }); }
  finally { client.release(); }
});
router.post('/duplicate-pairs/reject', async (req, res) => {
  try {
    const orphanId = parseInt(req.body.orphan_id, 10);
    await pool.query(
      `INSERT INTO statement_match_rejections (label_id, txn_fingerprint, expense_root_id, source, created_by)
       VALUES ($1, $2, $3, 'dup-pair', $4) ON CONFLICT DO NOTHING`,
      [req.labelId, `dup-pair:${orphanId}`, orphanId, req.user.name]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});

// ── Rules: suggestions, all four kinds of CRUD, and the leak report ──────────
//
// The organizing question: will this line ever have an invoice behind it? The
// suggestions endpoint mines repeated decisions and answers it per vendor; the
// annotate report shows what each BOOK rule is DOING to the needs-invoice
// queue. Every rule mutation is written to the activity log — a rule books or
// hides money on every future upload, so its history must be reconstructable.

// GET /rule-suggestions — repeated-decision mining + invoice-census
// classification (match / category+pairing / no-invoice / dismiss / artist).
router.get('/rule-suggestions', async (req, res) => {
  try {
    const data = await buildRuleSuggestions(pool, req.labelId, req.query.min);
    res.json({ success: true, data });
  } catch (e) { console.error('rule-suggestions error:', e); res.status(500).json({ success: false, error: 'Suggestions failed' }); }
});

// Category (BOOK) rules — standalone CRUD. A rule learned from history has no
// row to act on, so it cannot be born only as a booking side effect.
router.get('/category-rules', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM statement_category_rules WHERE label_id = $1 ORDER BY created_at DESC, id DESC`, [req.labelId]);
    // annotate=1 also reports what each rule is DOING — how many rows it is
    // putting in the needs-invoice queue, and which ledger vendors they
    // resolve to. Opt-in because it costs a scan of every booked debit.
    if (!rows.length || req.query.annotate !== '1') return res.json({ success: true, data: rows });
    res.json({ success: true, data: await annotateCategoryRules(pool, req.labelId, rows) });
  } catch (e) { console.error('category-rules error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});
router.post('/category-rules', async (req, res) => {
  try {
    const pattern = String(req.body.pattern || '').trim().slice(0, 120);
    const category = String(req.body.category || '').trim().slice(0, 80);
    if (pattern.length < 3) return res.status(400).json({ success: false, error: 'pattern must be at least 3 characters' });
    if (!category) return res.status(400).json({ success: false, error: 'category required' });
    const { rows: [rule] } = await pool.query(
      `INSERT INTO statement_category_rules (label_id, pattern, category, created_by) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.labelId, pattern, category, req.user.name]);

    // BOTH HALVES OR NEITHER. A category rule on its own MANUFACTURES queue
    // work: every rule-booked row lands with no document behind it, which
    // /completion counts as "still needs an invoice". So the caller can say
    // "and no invoice is ever coming for this vendor" in the same call; if
    // that half fails, the booking rule is rolled back rather than left
    // feeding the queue — a leaking rule looks identical to a working one.
    //
    // The no-invoice pattern is the LEDGER payee, matched by EQUALITY —
    // substring would swallow the neighbour ("TONE" inside "Tone Pay, Inc").
    const niPattern = String(req.body.no_invoice_pattern || '').trim().slice(0, 120);
    let noInvoiceRule = null;
    if (niPattern) {
      try {
        const { rows: [ni] } = await pool.query(
          `INSERT INTO statement_no_invoice_rules (label_id, scope, pattern, created_by)
           VALUES ($1, 'vendor', $2, $3)
           ON CONFLICT (label_id, scope, LOWER(TRIM(pattern))) DO UPDATE SET created_at = NOW()
           RETURNING *`,
          [req.labelId, niPattern, req.user.name]);
        noInvoiceRule = ni;
      } catch (err) {
        await pool.query(`DELETE FROM statement_category_rules WHERE id = $1 AND label_id = $2`, [rule.id, req.labelId]).catch(() => {});
        return res.status(500).json({
          success: false,
          error: `Could not record "${niPattern}" as never invoicing, so the booking rule was rolled back `
            + `rather than left feeding the needs-invoice queue: ${err.message}`,
        });
      }
    }
    await logActivity(req, 'Added statement book rule', `always book "${pattern}" as ${category}`
      + (niPattern ? ` — and "${niPattern}" never sends an invoice` : ''));
    res.json({ success: true, data: { ...rule, no_invoice_rule: noInvoiceRule } });
  } catch (e) { console.error('category-rule error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});
router.delete('/category-rules/:id(\\d+)', async (req, res) => {
  try {
    const { rows } = await pool.query(`DELETE FROM statement_category_rules WHERE id = $1 AND label_id = $2 RETURNING pattern, category`, [parseInt(req.params.id, 10), req.labelId]);
    if (rows.length) await logActivity(req, 'Removed statement book rule', `"${rows[0].pattern}" → ${rows[0].category}`);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});

// Dismiss (SET ASIDE) rules — standalone CRUD, same reasoning as above.
router.get('/dismiss-rules', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM statement_dismiss_rules WHERE label_id = $1 ORDER BY created_at DESC, id DESC`, [req.labelId]);
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});
router.post('/dismiss-rules', async (req, res) => {
  try {
    const pattern = String(req.body.pattern || '').trim().slice(0, 120);
    if (pattern.length < 3) return res.status(400).json({ success: false, error: 'pattern must be at least 3 characters' });
    const { rows: [rule] } = await pool.query(
      `INSERT INTO statement_dismiss_rules (label_id, pattern, created_by) VALUES ($1, $2, $3) RETURNING *`,
      [req.labelId, pattern, req.user.name]);
    await logActivity(req, 'Added statement dismiss rule', `always set aside "${pattern}"`);
    res.json({ success: true, data: rule });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});
router.delete('/dismiss-rules/:id(\\d+)', async (req, res) => {
  try {
    const { rows } = await pool.query(`DELETE FROM statement_dismiss_rules WHERE id = $1 AND label_id = $2 RETURNING pattern`, [parseInt(req.params.id, 10), req.labelId]);
    if (rows.length) await logActivity(req, 'Removed statement dismiss rule', `"${rows[0].pattern}"`);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});

// Artist attribution rules.
router.get('/artist-rules', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM statement_artist_rules WHERE label_id = $1 ORDER BY id`, [req.labelId]);
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});
router.post('/artist-rules', async (req, res) => {
  try {
    const pattern = String(req.body.pattern || '').trim();
    if (pattern.length < 3) return res.status(400).json({ success: false, error: 'Pattern too short' });
    const artist = String(req.body.artist || '').trim() || null;
    const isOverhead = req.body.is_overhead === true;
    if (!artist && !isOverhead) return res.status(400).json({ success: false, error: 'Name an artist, or mark it overhead — NULL artist is only an answer with is_overhead' });
    await pool.query(
      `INSERT INTO statement_artist_rules (label_id, pattern, artist, is_overhead, created_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (label_id, LOWER(pattern)) DO UPDATE SET artist = EXCLUDED.artist, is_overhead = EXCLUDED.is_overhead`,
      [req.labelId, pattern, artist, isOverhead, req.user.name]
    );
    // The historical write is scoped by EXPENSE ID, never by the pattern.
    //
    // A pattern is a substring test, and vendor names collide exactly where it
    // hurts: "TONE" is a substring of "Tone Pay, Inc". Sweeping history by
    // LIKE '%pattern%' silently attributes a different company's spend to an
    // artist, and nothing downstream contradicts it. So the caller sends the
    // ids it actually reviewed, re-checked server-side (still booked, still
    // artist-less, still alive — the client's list can be stale), and the
    // pattern is kept only for FUTURE statements, where the stakes are one new
    // row at a time. No ids means rule-only — a deliberate no-op on history.
    let updated = 0;
    const touched = [];
    const ids = Array.isArray(req.body.entry_ids)
      ? req.body.entry_ids.map(Number).filter(Number.isFinite).slice(0, 5000)
      : [];
    if (!isOverhead && artist && ids.length) {
      const { rows: targets } = await pool.query(
        `SELECT e.id FROM bank_transactions t
           JOIN expenses e ON e.id = t.matched_expense_id
          WHERE t.label_id = $1 AND e.label_id = $1 AND t.direction = 'debit' AND t.dismissed = FALSE
            AND (t.booked = TRUE OR t.match_method IN ('created', 'rule'))
            AND (e.deleted = false OR e.deleted IS NULL)
            AND COALESCE(TRIM(e.artist), '') = ''
            AND e.id = ANY($2::int[])`,
        [req.labelId, ids]);
      for (const t of targets) {
        await pool.query(`UPDATE expenses SET artist = $1 WHERE id = $2 AND label_id = $3`, [artist, t.id, req.labelId]);
        // Same release auto-link the ledger's own edit path runs, so a rule
        // write is indistinguishable from a hand edit. Best-effort.
        await autoLinkRelease(req.labelId, t.id).catch(() => {});
        updated += 1;
        touched.push(t.id);
      }
    }
    await logActivity(req, 'Added statement artist rule',
      `"${pattern}" → ${isOverhead ? 'overhead' : artist}${updated ? ` — ${updated} past entr${updated === 1 ? 'y' : 'ies'} attributed` : ''}`);
    res.json({
      success: true,
      data: {
        updated,
        entry_ids: touched,
        // Requested vs written: a gap means rows changed under the caller
        // (already attributed, unbooked, deleted) and the UI should say so
        // rather than report a count it didn't achieve.
        requested: ids.length,
        skipped: Math.max(0, ids.length - updated),
      },
    });
  } catch (e) { console.error('artist-rule error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});
router.delete('/artist-rules/:id(\\d+)', async (req, res) => {
  try {
    const { rows } = await pool.query(`DELETE FROM statement_artist_rules WHERE id = $1 AND label_id = $2 RETURNING pattern, artist, is_overhead`, [parseInt(req.params.id, 10), req.labelId]);
    if (rows.length) await logActivity(req, 'Removed statement artist rule', `"${rows[0].pattern}" → ${rows[0].is_overhead ? 'overhead' : rows[0].artist}`);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});

// No-invoice rules. Accepts `pattern` or `patterns` — one call either way.
// `patterns` exists because pairing an existing category rule needs a vendor
// rule per ledger payee its rows resolve to, and a half-paired rule drops
// fewer rows than it just promised, which is indistinguishable from the rule
// not working. All or nothing.
router.get('/no-invoice-rules', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM statement_no_invoice_rules WHERE label_id = $1 ORDER BY id`, [req.labelId]);
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});
router.post('/no-invoice-rules', async (req, res) => {
  try {
    const scope = String(req.body.scope || '').trim();
    // Scope is validated, never coerced — a typo silently becoming 'vendor'
    // writes a rule that matches nothing the caller intended.
    if (!['category', 'vendor'].includes(scope)) return res.status(400).json({ success: false, error: "scope must be 'category' or 'vendor'" });
    const list = (Array.isArray(req.body.patterns) ? req.body.patterns : [req.body.pattern])
      .map((p) => String(p || '').trim().slice(0, 120)).filter((p) => p.length >= 2);
    if (!list.length) return res.status(400).json({ success: false, error: 'pattern too short' });
    const written = [];
    try {
      for (const pattern of list) {
        const { rows: [rule] } = await pool.query(
          `INSERT INTO statement_no_invoice_rules (label_id, scope, pattern, created_by) VALUES ($1, $2, $3, $4)
           ON CONFLICT (label_id, scope, LOWER(TRIM(pattern))) DO UPDATE SET created_at = NOW()
           RETURNING *`,
          [req.labelId, scope, pattern, req.user.name]);
        written.push(rule);
      }
    } catch (err) {
      // A partial accept quietly under-delivers on the row count it just
      // promised, which is indistinguishable from the rule not working.
      const ids = written.map((r) => r.id);
      if (ids.length) await pool.query(`DELETE FROM statement_no_invoice_rules WHERE id = ANY($1) AND label_id = $2`, [ids, req.labelId]).catch(() => {});
      return res.status(500).json({ success: false, error: `Nothing was saved (${err.message})` });
    }
    await logActivity(req, 'Added no-invoice rule',
      list.length === 1 ? `${scope} "${list[0]}" never has an invoice` : `${list.length} ${scope}s never have an invoice (${list.join(', ')})`);
    res.json({ success: true, data: written.length === 1 ? written[0] : written });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});
router.delete('/no-invoice-rules/:id(\\d+)', async (req, res) => {
  try {
    const { rows } = await pool.query(`DELETE FROM statement_no_invoice_rules WHERE id = $1 AND label_id = $2 RETURNING scope, pattern`, [parseInt(req.params.id, 10), req.labelId]);
    if (rows.length) await logActivity(req, 'Removed no-invoice rule', `${rows[0].scope} "${rows[0].pattern}"`);
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});
// "No invoice is coming for this line."
//
// This is an ANSWER, not a flag. On an OPEN row it has to book the money as
// well as record the note — a bare flag leaves the row unanswered by
// /completion's own rules, so the click appears to do nothing. On a row
// matched to a REAL invoice it is a contradiction (the document is right
// there) and is refused.
router.post('/tx/:id(\\d+)/no-invoice', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const t = (await pool.query(
      `SELECT t.*, s.account, e.entry_source AS exp_source, e.payee AS exp_payee, e.invoice_number AS exp_invoice_number
         FROM bank_transactions t
         JOIN bank_statements s ON s.id = t.statement_id
         LEFT JOIN expenses e ON e.id = t.matched_expense_id
        WHERE t.id = $1 AND t.label_id = $2`,
      [id, req.labelId]
    )).rows[0];
    if (!t) return res.status(404).json({ success: false, error: 'Not found' });
    if (req.body.undo) {
      await pool.query(`UPDATE bank_transactions SET no_invoice = FALSE WHERE id = $1 AND label_id = $2`, [id, req.labelId]);
      await logActivity(req, 'Reopened a no-invoice answer', `txn #${id} expects a document again`);
      return res.json({ success: true, data: { booked: false } });
    }
    if (t.matched_expense_id && t.exp_source !== 'bank_statement') {
      return res.status(400).json({
        success: false,
        error: `This line is matched to ${t.exp_payee}'s real invoice${t.exp_invoice_number ? ` #${t.exp_invoice_number}` : ''} — "no invoice coming" would contradict the document it is already tied to.`,
      });
    }
    if (t.direction !== 'debit') return res.status(400).json({ success: false, error: 'Only debits carry this answer' });

    let booked = null;
    if (!t.matched_expense_id && !t.booked) {
      // Speed bump: an OPEN line that looks exactly like an already-paid
      // invoice is far more likely a missed match than a document-free
      // charge. Booking it invents a second record of one payment.
      if (req.body.confirm_new !== true) {
        const dupe = (await pool.query(
          `SELECT e.id, e.payee, e.invoice_number, e.payment_date,
                  (e.amount + COALESCE((SELECT SUM(k.amount) FROM expenses k WHERE k.parent_id = e.id AND (k.deleted IS NULL OR k.deleted = FALSE)), 0)) AS family_amount
             FROM expenses e
            WHERE e.label_id = $1 AND e.parent_id IS NULL AND e.status = 'approved'
              AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
              AND e.entry_source IS DISTINCT FROM 'bank_statement'
              AND ABS(e.amount - $2) <= 0.01
              AND e.payment_date BETWEEN $3::date - 10 AND $3::date + 10
            LIMIT 3`,
          [req.labelId, Number(t.amount), t.txn_date]
        )).rows;
        if (dupe.length) {
          return res.status(409).json({
            success: false, paid_candidates: dupe,
            error: `${dupe.length === 1 ? 'An invoice' : `${dupe.length} invoices`} for this exact amount already sit${dupe.length === 1 ? 's' : ''} in the ledger around this date `
              + `(${dupe.map((d) => `${d.payee}${d.invoice_number ? ` #${d.invoice_number}` : ''}`).join(', ')}). `
              + 'Booking a new entry would record the same payment twice — match it instead, or confirm to book anyway.',
          });
        }
      }
      const category = String(req.body.category || '').trim() || null;
      if (!category) return res.status(400).json({ success: false, error: 'Give the line a category — booking it without one files the money nowhere' });
      const r = await require('./bank-statements').bookOpenTxn(req.labelId, t, {
        category, payee: req.body.payee || null, artist: req.body.artist || null, actor: req.user.name,
      });
      booked = r.id;
    }
    await pool.query(`UPDATE bank_transactions SET no_invoice = TRUE WHERE id = $1 AND label_id = $2`, [id, req.labelId]);
    await logActivity(req, 'Recorded that no invoice is coming',
      `txn #${id}${booked ? ` — booked as entry #${booked}` : ''}`);
    res.json({ success: true, data: { booked } });
  } catch (e) { console.error('no-invoice error:', e); res.status(500).json({ success: false, error: e.message || 'Failed' }); }
});
// Bulk: booked-but-unanswered rows only. A row matched to a REAL invoice is
// refused per-row above and must be refused here too — the WHERE is the gate,
// never the client's selection, and the skipped count is returned so the toast
// can say "n of m" instead of claiming the whole selection.
router.post('/no-invoice/bulk', async (req, res) => {
  try {
    const ids = (req.body.txn_ids || []).map(Number).filter(Boolean).slice(0, 500);
    if (!ids.length) return res.status(400).json({ success: false, error: 'Nothing selected' });
    const r = await pool.query(
      `UPDATE bank_transactions t SET no_invoice = TRUE
        WHERE t.id = ANY($1::int[]) AND t.label_id = $2 AND t.direction = 'debit'
          AND t.dismissed = FALSE AND COALESCE(t.no_invoice, FALSE) = FALSE
          AND (t.matched_expense_id IS NULL
               OR EXISTS (SELECT 1 FROM expenses e WHERE e.id = t.matched_expense_id AND e.label_id = $2 AND e.entry_source = 'bank_statement'))
          AND (t.booked = TRUE OR t.match_method IN ('created', 'rule', 'booked'))
        RETURNING t.id`,
      [ids, req.labelId]
    );
    const done = r.rows.length;
    await logActivity(req, 'Bulk "no invoice coming"', `${done} of ${ids.length} rows`);
    res.json({
      success: true,
      data: {
        done, skipped: ids.length - done,
        // Named, because "12 of 20" with no reason reads as a failure.
        skipped_reason: ids.length - done > 0 ? 'open rows need booking first; rows matched to a real invoice cannot carry this answer' : null,
      },
    });
  } catch (e) { console.error('bulk no-invoice error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

// ── Row markers: flag-for-review, currency correction, vendor override ──────

// A flag is "come back to this" and nothing else — it never changes an
// amount, a match or a disposition.
router.post('/tx/:id(\\d+)/flag', async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE bank_transactions SET flagged = $3 WHERE id = $1 AND label_id = $2 RETURNING id, flagged`,
      [parseInt(req.params.id, 10), req.labelId, req.body.flagged !== false]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});

// Currency correction — a mis-parsed foreign row read as USD. REFUSED while
// matched or booked: the currency is what the capacity model and every USD
// conversion downstream were computed from, so changing it under a live match
// silently moves money in the P&L.
router.post('/tx/:id(\\d+)/currency', async (req, res) => {
  try {
    const code = String(req.body.currency || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return res.status(400).json({ success: false, error: 'Give a 3-letter currency code' });
    const t = (await pool.query(`SELECT * FROM bank_transactions WHERE id = $1 AND label_id = $2`, [parseInt(req.params.id, 10), req.labelId])).rows[0];
    if (!t) return res.status(404).json({ success: false, error: 'Not found' });
    if (t.matched_expense_id || t.matched_income_id || t.booked) {
      return res.status(400).json({ success: false, error: 'Unmatch or unbook this line first — its currency is what the match was measured against.' });
    }
    // amount_usd was derived from the OLD currency; a stale conversion is
    // worse than none, so it is cleared rather than left to be believed.
    await pool.query(`UPDATE bank_transactions SET currency = $3, amount_usd = NULL WHERE id = $1 AND label_id = $2`, [t.id, req.labelId, code]);
    await logActivity(req, 'Corrected a bank line currency', `txn #${t.id}: ${t.currency || 'USD'} → ${code}`);
    res.json({ success: true });
  } catch (e) { console.error('currency error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

// Vendor override — a PERSON says this descriptor is this ledger vendor.
// Separate from the learned map on purpose (see lib/bankVendors.js). Unknown
// vendors are gated behind confirm_new so a typo cannot mint a directory row.
async function applyVendorOverride(labelId, ids, vendor, actor, { learn = true } = {}) {
  const r = await pool.query(
    `UPDATE bank_transactions SET vendor_override = $3 WHERE id = ANY($1::int[]) AND label_id = $2 RETURNING id, payee_guess, description`,
    [ids, labelId, vendor]
  );
  if (learn) {
    const seen = new Set();
    for (const row of r.rows) {
      const desc = row.payee_guess || row.description;
      if (!desc || seen.has(desc)) continue;
      seen.add(desc);
      await R.learnPayee(pool, labelId, desc, vendor, actor).catch(() => {});
    }
  }
  return r.rows.length;
}
router.post('/tx/:id(\\d+)/vendor', async (req, res) => {
  try {
    const vendor = String(req.body.vendor || '').trim().slice(0, 200);
    if (!vendor) return res.status(400).json({ success: false, error: 'Name the vendor' });
    const known = (await pool.query(
      `SELECT 1 FROM expenses WHERE label_id = $1 AND LOWER(TRIM(payee)) = LOWER($2) AND (deleted IS NULL OR deleted = FALSE) LIMIT 1`,
      [req.labelId, vendor]
    )).rows.length > 0;
    if (!known && req.body.confirm_new !== true) {
      return res.status(409).json({
        success: false, unknown_vendor: true,
        error: `No ledger entry is filed under "${vendor}". Confirm to use it anyway — a misspelling here becomes a second vendor in the directory.`,
      });
    }
    const n = await applyVendorOverride(req.labelId, [parseInt(req.params.id, 10)], vendor, req.user.name);
    if (!n) return res.status(404).json({ success: false, error: 'Not found' });
    await logActivity(req, 'Set a bank line vendor', `txn #${req.params.id} → ${vendor}`);
    res.json({ success: true, data: { updated: n, new_vendor: !known } });
  } catch (e) { console.error('vendor override error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});
router.post('/vendor/bulk', async (req, res) => {
  try {
    const vendor = String(req.body.vendor || '').trim().slice(0, 200);
    const ids = (req.body.txn_ids || []).map(Number).filter(Boolean).slice(0, 500);
    if (!vendor || !ids.length) return res.status(400).json({ success: false, error: 'Name the vendor and select some rows' });
    const n = await applyVendorOverride(req.labelId, ids, vendor, req.user.name);
    await logActivity(req, 'Bulk-set bank line vendor', `${n} rows → ${vendor}`);
    res.json({ success: true, data: { updated: n, skipped: ids.length - n } });
  } catch (e) { console.error('vendor bulk error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

// ── Attribution: the artist roster + a booked row's artist ──────────────────
//
// The roster is the union of the artist table and the artist names the ledger
// actually carries — a booked entry filed under a name nobody registered is
// still that artist's spend, and a picker that cannot offer the name forces a
// second spelling.
router.get('/artist-names', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT name FROM (
         SELECT name FROM artists WHERE label_id = $1
         UNION
         SELECT DISTINCT TRIM(artist) AS name FROM expenses
          WHERE label_id = $1 AND COALESCE(TRIM(artist), '') <> '' AND (deleted IS NULL OR deleted = FALSE)
       ) u WHERE name IS NOT NULL ORDER BY LOWER(name)`,
      [req.labelId]
    );
    res.json({ success: true, data: rows.map((r) => r.name) });
  } catch (e) { console.error('artist-names error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});
// Set (or clear) the artist on the entry a bank line created. Only ever
// touches BANK-BORN entries: a real invoice's attribution belongs to the
// ledger, not to a reconciliation screen.
router.post('/tx/:id(\\d+)/artist', async (req, res) => {
  try {
    const artist = String(req.body.artist || '').trim() || null;
    const t = (await pool.query(
      `SELECT t.id, t.matched_expense_id, e.entry_source
         FROM bank_transactions t JOIN expenses e ON e.id = t.matched_expense_id AND e.label_id = t.label_id
        WHERE t.id = $1 AND t.label_id = $2`,
      [parseInt(req.params.id, 10), req.labelId]
    )).rows[0];
    if (!t) return res.status(400).json({ success: false, error: 'That line has no entry to attribute' });
    if (t.entry_source !== 'bank_statement') {
      return res.status(400).json({ success: false, error: 'That entry came from a real invoice — change its artist on the Ledger.' });
    }
    await pool.query(`UPDATE expenses SET artist = $1 WHERE (id = $2 OR parent_id = $2) AND label_id = $3`, [artist, t.matched_expense_id, req.labelId]);
    if (artist) await autoLinkRelease(req.labelId, t.matched_expense_id).catch(() => {});
    await logActivity(req, 'Attributed a booked bank line', `entry #${t.matched_expense_id} → ${artist || '(no artist)'}`);
    res.json({ success: true });
  } catch (e) { console.error('txn artist error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

// ── Bank vendor groups — the batch (vendor-clustered) view's data ───────────
router.get('/bank-vendors', async (req, res) => {
  try {
    res.json({ success: true, data: await aggregateBankVendors(req.labelId) });
  } catch (e) { console.error('bank-vendors error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

module.exports = router;
