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
const { settleTxnWithInvoices, detachTxn } = require('../lib/statementLinks');
const { proposeFundingPairs } = require('../lib/fundingPairs');
const bankEvidence = require('../lib/bankEvidence');
const { stampFxRateAsync } = require('../lib/fxStamp');
const { familyRoot } = require('../lib/paymentFamily');
const { loadEverInvoiced, buildRuleSuggestions, annotateCategoryRules } = require('../lib/uploadRules');
const { autoLinkRelease } = require('./ledger');

const router = express.Router();
router.use(authMiddleware, withTenant, requireAdmin);

function dispositionOf(t) {
  if (t.direction === 'credit') {
    if (t.matched_income_id) return 'booked-income';
    return t.dismissed ? 'dismissed' : 'open-credit';
  }
  if (t.dismissed) return 'dismissed';
  if (t.booked || t.match_method === 'created') return 'booked';
  if (t.matched_expense_id) return t.exp_payment_status === 'Paid' ? 'matched' : 'toconfirm';
  return 'open';
}

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
    const rows = [];
    let suggBudget = 200; // suggestion SQL per open row — cap the work per request
    for (const t of txns) {
      const disposition = dispositionOf(t);
      const row = {
        ...t, disposition,
        suggested_category: disposition === 'open' ? suggestCategory(t.payee_guess, t.description) : null,
        suggested_income_type: disposition === 'open-credit' ? suggestIncomeType(t.payee_guess, t.description) : null,
        suggestions: null,
      };
      if (disposition === 'open' && suggBudget > 0) {
        suggBudget -= 1;
        const methods = R.accountMethods(accounts, t.account);
        row.suggestions = await R.suggestions(pool, req.labelId, t, methods, maps).catch(() => []);
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
    const buckets = { matched: mk(), booked_expected: mk(), booked_not_expected: mk(), open: mk() };
    const needsInvoiceIds = [];
    const byStatement = {};
    const vendorClusters = new Map();
    const catStat = new Map();
    let total = 0;
    for (const t of txns) {
      const usd = usdOf(t.amount, t.currency, null);
      total += usd;
      const st = byStatement[t.statement_id] || (byStatement[t.statement_id] = { left: 0, left_value: 0, debits: 0 });
      st.debits += 1;
      const isBooked = t.booked || t.match_method === 'created' || t.match_method === 'rule';
      let bucket;
      if (isBooked) {
        bucket = (t.no_invoice || ruleHit(t)) ? 'booked_expected' : 'booked_not_expected';
        if (bucket === 'booked_not_expected') {
          needsInvoiceIds.push(t.id);
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
        bucket = t.match_method === 'creator' ? 'booked_expected' : 'matched';
      } else {
        bucket = 'open';
        st.left += 1; st.left_value += usd;
      }
      buckets[bucket].n += 1;
      buckets[bucket].value += usd;
    }
    for (const b of Object.values(buckets)) b.value = round2(b.value);
    const explained = buckets.matched.value + buckets.booked_expected.value + buckets.booked_not_expected.value;
    const scoped = stmtParam ? { statement_id: stmtParam, ...(byStatement[stmtParam] || { left: 0, left_value: 0, debits: 0 }) } : null;
    res.json({
      success: true,
      data: {
        ...Object.fromEntries(Object.entries(buckets)),
        total: round2(total),
        explained_pct: total > 0 ? Math.round((explained / total) * 100) : 100,
        invoice_backed_pct: total > 0 ? Math.round((buckets.matched.value / total) * 100) : 100,
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
              COALESCE(e.currency, 'USD') AS currency, e.fx_rate_to_usd, e.payment_date, e.payment_method
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
    const shape = (rows) => ({
      n: rows.rows.length,
      value: round2(rows.rows.reduce((s, r) => s + usdOf(r.amount, r.currency, r.fx_rate_to_usd), 0)),
      rows: rows.rows.map((r) => ({ ...r, usd: round2(usdOf(r.amount, r.currency, r.fx_rate_to_usd)) })),
    });
    const coverage = (await pool.query(
      `SELECT account, MAX(period_end) AS latest, COUNT(*)::int AS statements
         FROM bank_statements WHERE label_id = $1 AND status = 'ready' GROUP BY account`,
      [req.labelId]
    )).rows;
    res.json({
      success: true,
      data: { needs_match: shape(needs), awaiting_statement: shape(awaiting), missing_statement: shape(missing), coverage },
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
    const ok = await detachTxn(req.labelId, parseInt(req.params.id, 10));
    if (!ok) return res.status(400).json({ success: false, error: 'Booked rows unbook on the statement page, not here' });
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});
router.post('/unmatch/bulk', async (req, res) => {
  try {
    const ids = (req.body.txn_ids || []).map(Number).filter(Boolean).slice(0, 500);
    const done = [], skipped = [];
    for (const id of ids) {
      const t = (await pool.query(`SELECT * FROM bank_transactions WHERE id = $1 AND label_id = $2`, [id, req.labelId])).rows[0];
      if (!t || !t.matched_expense_id || t.match_method === 'created') { skipped.push(id); continue; }
      await pool.query(
        `INSERT INTO statement_match_rejections (label_id, txn_fingerprint, expense_root_id, source, created_by)
         VALUES ($1, $2, $3, 'unmatch', $4) ON CONFLICT DO NOTHING`,
        [req.labelId, R.txnFingerprint(t), t.matched_expense_id, req.user.name]
      ).catch(() => {});
      await detachTxn(req.labelId, id);
      done.push(id);
    }
    res.json({ success: true, data: { done, skipped } });
  } catch (e) { console.error('bulk unmatch error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

// ── Rematch: a booked row whose REAL invoice showed up ──────────────────────
router.get('/rematch-candidates', async (req, res) => {
  try {
    const maps = await R.loadMaps(pool, req.labelId);
    const booked = (await pool.query(
      `SELECT t.*, s.account, e.payee AS exp_payee, e.id AS exp_id
         FROM bank_transactions t
         JOIN bank_statements s ON s.id = t.statement_id AND s.status = 'ready'
         JOIN expenses e ON e.id = t.matched_expense_id AND e.entry_source = 'bank_statement'
        WHERE t.label_id = $1 AND t.dismissed = FALSE AND (t.booked = TRUE OR t.match_method IN ('created', 'rule', 'booked'))
          AND t.no_invoice = FALSE
        ORDER BY t.txn_date DESC LIMIT 300`,
      [req.labelId]
    )).rows;
    const invoices = (await pool.query(
      `SELECT e.id, e.payee, e.invoice_number, e.invoice_date, e.payment_date, e.payment_status,
              e.scheduled_payment_date, e.payment_ref, e.vendor_email, COALESCE(e.currency, 'USD') AS currency,
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
    const pairs = [];
    const usedInv = new Set();
    for (const t of booked) {
      const fp = R.txnFingerprint(t);
      let best = null;
      for (const inv of invoices) {
        if (usedInv.has(inv.id)) continue;
        if ((inv.currency || 'USD') !== (t.currency || 'USD')) continue;
        const delta = Number(t.amount) - Number(inv.family_amount);
        if (delta < -0.01 || delta > Math.max(35, Number(inv.family_amount) * 0.01)) continue;
        if (maps.rejections.has(`${fp}::${inv.id}`)) continue;
        const ev = R.evidence(t, inv, maps);
        if (ev.score < 0.6) continue;
        if (!best || ev.score > best.score) best = { inv, score: ev.score, method: ev.method };
      }
      if (best) {
        usedInv.add(best.inv.id);
        pairs.push({
          txn: { id: t.id, txn_date: t.txn_date, amount: Number(t.amount), currency: t.currency, payee_guess: t.payee_guess, account: t.account, booked_payee: t.exp_payee, statement_id: t.statement_id },
          invoice: { id: best.inv.id, payee: best.inv.payee, invoice_number: best.inv.invoice_number, amount: Number(best.inv.family_amount), currency: best.inv.currency },
          score: Math.round(best.score * 100) / 100, method: best.method,
        });
      }
    }
    res.json({ success: true, data: { pairs } });
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = (await client.query(`SELECT * FROM bank_transactions WHERE id = $1 AND label_id = $2 FOR UPDATE`, [parseInt(req.params.id, 10), req.labelId])).rows[0];
    if (!t || t.match_method !== 'rematch') { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: 'Not a rematched row' }); }
    const restored = (await client.query(
      `UPDATE expenses SET deleted = FALSE, deleted_by = NULL, deleted_at = NULL
        WHERE label_id = $1 AND deleted_by = $2 AND parent_id IS NULL RETURNING id`,
      [req.labelId, `rematch#${t.id}`]
    )).rows[0];
    await client.query(`UPDATE expenses SET deleted = FALSE, deleted_by = NULL, deleted_at = NULL WHERE label_id = $1 AND deleted_by = $2`, [req.labelId, `rematch#${t.id}`]);
    if (!restored) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: 'The original booking is gone' }); }
    await client.query(
      `UPDATE bank_transactions SET matched_expense_id = $1, match_method = 'created', match_score = 1.0, booked = TRUE, matched_by = $2, matched_at = NOW() WHERE id = $3`,
      [restored.id, req.user.name, t.id]
    );
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error('unrematch error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
  finally { client.release(); }
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
    const out = proposeFundingPairs(pp, bank, { windowDays });
    res.json({ success: true, data: out });
  } catch (e) { console.error('funding-pairs error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});
router.post('/tx/:ppId(\\d+)/funding-pair', async (req, res) => {
  try {
    const bankId = parseInt(req.body.bank_txn_id, 10);
    if (req.body.undo) {
      await pool.query(
        `UPDATE bank_transactions SET dismissed = FALSE, dismissed_reason = NULL WHERE id = $1 AND label_id = $2 AND dismissed_reason = 'funding'`,
        [bankId, req.labelId]
      );
      return res.json({ success: true });
    }
    const bank = (await pool.query(
      `SELECT t.*, s.account FROM bank_transactions t JOIN bank_statements s ON s.id = t.statement_id
        WHERE t.id = $1 AND t.label_id = $2`,
      [bankId, req.labelId]
    )).rows[0];
    if (!bank || bank.direction !== 'debit') return res.status(400).json({ success: false, error: 'Bank pull not found' });
    if (bank.matched_expense_id || bank.booked) return res.status(400).json({ success: false, error: 'That pull is already matched/booked — unlink it first' });
    // Dismiss the BANK PULL leg; the PayPal side stays canonical.
    await pool.query(
      `UPDATE bank_transactions SET dismissed = TRUE, dismissed_reason = 'funding' WHERE id = $1 AND label_id = $2`,
      [bankId, req.labelId]
    );
    await logActivity(req, 'Paired PayPal funding pull', `bank txn #${bankId} ↔ paypal txn #${req.params.ppId}`);
    res.json({ success: true });
  } catch (e) { console.error('funding-pair error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
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
    if (parts.length < 2 || parts.some((p) => !Number.isFinite(p.amount) || p.amount <= 0)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'At least two positive parts' });
    }
    const sum = parts.reduce((s, p) => s + p.amount, 0);
    if (Math.abs(sum - Number(t.amount)) > 0.01) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: `Parts sum to ${sum.toFixed(2)}, the line is ${Number(t.amount).toFixed(2)}` });
    }
    // Replace any existing booking with the family.
    if (t.booked && t.matched_expense_id) {
      await client.query(`UPDATE expenses SET deleted = TRUE, deleted_by = $3, deleted_at = NOW() WHERE (id = $1 OR parent_id = $1) AND label_id = $2`,
        [t.matched_expense_id, req.labelId, req.user.name]);
    }
    const payee = t.payee_guess || t.description || 'Bank debit';
    const mk = async (p, parentId) => (await client.query(
      `INSERT INTO expenses (label_id, invoice_date, payee, description, category, artist, amount, currency,
         status, payment_status, payment_date, payment_ref, entry_source, parent_id, created_by, created_at, paid_marked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'approved','Paid',$2,$9,'bank_statement',$10,$11,NOW(),NOW()) RETURNING id`,
      [req.labelId, t.txn_date, payee, t.description || null, p.category, p.artist, p.amount, t.currency || 'USD', t.reference || null, parentId, req.user.name]
    )).rows[0];
    const rootRow = await mk(parts[0], null);
    for (const p of parts.slice(1)) await mk(p, rootRow.id);
    await client.query(
      `UPDATE bank_transactions SET matched_expense_id = $1, match_method = 'created', match_score = 1.0, booked = TRUE,
              matched_by = $2, matched_at = NOW(), dismissed = FALSE, dismissed_reason = NULL WHERE id = $3`,
      [rootRow.id, req.user.name, t.id]
    );
    await client.query('COMMIT');
    stampFxRateAsync(rootRow.id);
    await logActivity(req, 'Split-booked a bank line', `txn #${t.id} → ${parts.length} slices`);
    res.json({ success: true, data: { expense_id: rootRow.id } });
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
              w.id AS twin_id, w.payment_date AS twin_paid
         FROM expenses o
         JOIN expenses w ON w.label_id = o.label_id AND w.id <> o.id AND w.parent_id IS NULL
          AND LOWER(TRIM(w.payee)) = LOWER(TRIM(o.payee)) AND w.amount = o.amount
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
      const gap = Math.abs(new Date(r.orphan_paid || 0) - new Date(r.twin_paid || 0));
      const cur = best.get(r.orphan_id);
      if (!cur || gap < cur.gap) best.set(r.orphan_id, { ...r, gap });
    }
    res.json({ success: true, data: { pairs: [...best.values()] } });
  } catch (e) { console.error('duplicate-pairs error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});
router.post('/duplicate-pairs/merge', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = '30s'`);
    const orphanId = parseInt(req.body.orphan_id, 10);
    const twinId = parseInt(req.body.twin_id, 10);
    const [orphan, twin] = await Promise.all([
      client.query(`SELECT * FROM expenses WHERE id = $1 AND label_id = $2 FOR UPDATE`, [orphanId, req.labelId]),
      client.query(`SELECT * FROM expenses WHERE id = $1 AND label_id = $2 FOR UPDATE`, [twinId, req.labelId]),
    ]);
    if (!orphan.rows.length || !twin.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Pair not found' }); }
    // Keep the ORPHAN (the hand-logged one usually carries the invoice +
    // artist); move the twin's bank rows onto it, then soft-delete the twin.
    await client.query(`UPDATE bank_transactions SET matched_expense_id = $1 WHERE label_id = $2 AND matched_expense_id = $3`, [orphanId, req.labelId, twinId]);
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
    await client.query(`UPDATE expenses SET deleted = TRUE, deleted_by = $3, deleted_at = NOW() WHERE (id = $1 OR parent_id = $1) AND label_id = $2`,
      [twinId, req.labelId, `${req.user.name} (duplicate merge)`]);
    await client.query('COMMIT');
    await logActivity(req, 'Merged duplicate payment rows', `kept #${orphanId}, archived #${twinId}`);
    res.json({ success: true });
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
router.post('/tx/:id(\\d+)/no-invoice', async (req, res) => {
  try {
    await pool.query(
      `UPDATE bank_transactions SET no_invoice = $3 WHERE id = $1 AND label_id = $2`,
      [parseInt(req.params.id, 10), req.labelId, req.body.undo ? false : true]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});
router.post('/no-invoice/bulk', async (req, res) => {
  try {
    const ids = (req.body.txn_ids || []).map(Number).filter(Boolean).slice(0, 500);
    const r = await pool.query(`UPDATE bank_transactions SET no_invoice = TRUE WHERE id = ANY($1::int[]) AND label_id = $2 RETURNING id`, [ids, req.labelId]);
    res.json({ success: true, data: { done: r.rows.length, skipped: ids.length - r.rows.length } });
  } catch { res.status(500).json({ success: false, error: 'Failed' }); }
});

module.exports = router;
