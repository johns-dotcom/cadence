// Cross-statement integrity checks — the flags engine. Read-only: the
// endpoint mutates nothing; every flag carries an ACTION descriptor the
// client executes against existing endpoints.
//
// Every flag: { severity: 'error'|'warn', type, title, detail, fingerprint,
//   statement_id?, txn_id?, q?, action?, alt_action? }.
// Fingerprints are STABLE IDENTITIES: when the underlying set changes the
// fingerprint changes and the flag resurfaces despite an acknowledgement —
// that is the point. Money/dates in `detail` are written for a human
// ("off by $1,250.00", "37 days apart") — the card is the explanation.

const pool = require('../db');
const { usdOf, round2 } = require('./usd');
const { pairReversals } = require('./reversalPairs');
const { normalizeName, vendorsMatch } = require('./bankReconcile');
const { aggregateBankVendors, descriptorMentions, sameSquashedName } = require('./bankVendors');
const { noBankEvidenceSql, methodCompatibleSql } = require('./bankEvidence');
const { accountsFor } = require('./bankReconcile');

const fmt = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d) => String(d).slice(0, 10);
const dayGap = (a, b) => Math.round(Math.abs((new Date(day(a)) - new Date(day(b))) / 86400000));
const SELF_EVIDENCING = new Set(['auto-ref', 'auto-email', 'auto-learned', 'auto-alias', 'manual', 'booked', 'created', 'rule', 'created-income', 'rematch', 'creator']);

async function buildFlags(labelId) {
  const flags = [];
  const push = (f) => flags.push(f);

  const statements = (await pool.query(
    `SELECT * FROM bank_statements WHERE label_id = $1 AND status = 'ready' ORDER BY account, period_start ASC NULLS LAST, id`,
    [labelId]
  )).rows;
  const txns = (await pool.query(
    `SELECT t.*, s.account, s.period_start, s.period_end,
            e.payee AS exp_payee, e.invoice_date AS exp_invoice_date, e.payment_date AS exp_payment_date,
            e.status AS exp_status, e.deleted AS exp_deleted, e.voided AS exp_voided,
            e.invoice_r2_key AS exp_invoice_key, e.vendor_submitted AS exp_vendor_submitted,
            COALESCE(e.currency, 'USD') AS exp_currency, e.fx_rate_to_usd AS exp_fx,
            (e.amount + COALESCE((SELECT SUM(k.amount) FROM expenses k WHERE k.parent_id = e.id AND (k.deleted IS NULL OR k.deleted = FALSE)), 0)) AS exp_family_amount
       FROM bank_transactions t
       JOIN bank_statements s ON s.id = t.statement_id AND s.status = 'ready'
       LEFT JOIN expenses e ON e.id = t.matched_expense_id
      WHERE t.label_id = $1`,
    [labelId]
  )).rows;
  const labelRow = (await pool.query(`SELECT bank_accounts, name FROM labels WHERE id = $1`, [labelId])).rows[0] || {};
  const accounts = accountsFor(labelRow);

  const live = txns.filter((t) => !t.dismissed);
  const byStatement = new Map();
  for (const t of txns) {
    const arr = byStatement.get(t.statement_id) || [];
    arr.push(t);
    byStatement.set(t.statement_id, arr);
  }

  // ── Per-account statement sequence checks ─────────────────────────────────
  const byAccount = new Map();
  for (const s of statements) {
    if (!s.period_start || !s.period_end) continue;
    const arr = byAccount.get(s.account) || [];
    arr.push(s);
    byAccount.set(s.account, arr);
  }
  for (const [account, list] of byAccount) {
    const anyBalance = list.some((s) => s.ending_balance != null);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      // gap
      if (i > 0) {
        const prev = list[i - 1];
        const gap = (new Date(day(s.period_start)) - new Date(day(prev.period_end))) / 86400000;
        if (gap > 5) {
          push({
            severity: 'warn', type: 'gap', statement_id: s.id,
            title: `Missing ${account} coverage`,
            detail: `${Math.round(gap)} days between ${day(prev.period_end)} and ${day(s.period_start)} have no statement — a month may never have been uploaded.`,
            fingerprint: `gap:${prev.id}:${s.id}`,
          });
        }
      }
      // no-balance (only when siblings have one — otherwise nothing to tie against)
      if (anyBalance && s.ending_balance == null) {
        push({
          severity: 'warn', type: 'no-balance', statement_id: s.id,
          title: `No ending balance on ${s.filename || account}`,
          detail: `Other ${account} statements carry an ending balance — this one silently opts out of the balance-continuity check. Set it from the statement header.`,
          fingerprint: `nobal:${s.id}`,
        });
      }
      // balance-standalone / unverifiable — the tie-out uses EVERY row,
      // dismissed included (a dismissed transfer still moved the balance).
      const allRows = byStatement.get(s.id) || [];
      if (s.ending_balance != null && s.beginning_balance != null) {
        const foreign = allRows.filter((t) => (t.currency || 'USD') !== 'USD' && t.amount_usd == null);
        if (foreign.length) {
          push({
            severity: 'warn', type: 'balance-unverifiable', statement_id: s.id,
            title: `Balance unverifiable on ${s.filename || account}`,
            detail: `${foreign.length} foreign-currency row(s) carry no printed USD settlement, so the statement cannot be added up. A silently-skipped check looks like a passed one — this says it out loud.`,
            fingerprint: `balunver:${s.id}`,
          });
        } else {
          let sum = Number(s.beginning_balance);
          for (const t of allRows) {
            const v = t.amount_usd != null ? Number(t.amount_usd) : Number(t.amount);
            sum += t.direction === 'credit' ? v : -v;
          }
          const drift = round2(sum - Number(s.ending_balance));
          if (Math.abs(drift) > 0.05) {
            push({
              severity: 'error', type: 'balance-standalone', statement_id: s.id,
              title: `Statement doesn't add up: ${s.filename || account}`,
              detail: `Opening ${fmt(s.beginning_balance)} + credits − debits lands ${fmt(Math.abs(drift))} ${drift > 0 ? 'above' : 'below'} the printed closing ${fmt(s.ending_balance)}. The parse likely missed or misread rows — re-upload or re-parse.`,
              fingerprint: `balstd:${s.id}`,
            });
          }
        }
      } else if (i > 0 && s.ending_balance != null && list[i - 1].ending_balance != null) {
        // chained continuity (fallback when no opening balance)
        const prev = list[i - 1];
        const gap = (new Date(day(s.period_start)) - new Date(day(prev.period_end))) / 86400000;
        const allUsd = allRows.every((t) => (t.currency || 'USD') === 'USD' || t.amount_usd != null);
        if (gap <= 5 && allUsd) {
          let sum = Number(prev.ending_balance);
          for (const t of allRows) {
            const v = t.amount_usd != null ? Number(t.amount_usd) : Number(t.amount);
            sum += t.direction === 'credit' ? v : -v;
          }
          const drift = round2(sum - Number(s.ending_balance));
          if (Math.abs(drift) > 0.05) {
            push({
              severity: 'error', type: 'balance', statement_id: s.id,
              title: `Balance continuity broken into ${s.filename || account}`,
              detail: `Prior close ${fmt(prev.ending_balance)} + this statement's activity misses the printed close ${fmt(s.ending_balance)} by ${fmt(Math.abs(drift))} — the strongest catch-all for a bad parse.`,
              fingerprint: `balance:${s.id}`,
            });
          }
        }
      }
      // out-of-period
      const oop = allRows.filter((t) => day(t.txn_date) < day(new Date(new Date(day(s.period_start)).getTime() - 3 * 86400000).toISOString())
        || day(t.txn_date) > day(new Date(new Date(day(s.period_end)).getTime() + 3 * 86400000).toISOString()));
      if (oop.length) {
        push({
          severity: 'warn', type: 'out-of-period', statement_id: s.id,
          title: `${oop.length} row(s) dated outside the ${s.filename || account} period`,
          detail: `Transactions dated more than 3 days outside ${day(s.period_start)}–${day(s.period_end)} — usually misparsed dates. First: ${day(oop[0].txn_date)} "${(oop[0].payee_guess || oop[0].description || '').slice(0, 40)}".`,
          fingerprint: `oop:${s.id}:${oop.length}`,
        });
      }
    }
  }

  // ── Cross-statement duplicates ────────────────────────────────────────────
  const dupes = (await pool.query(
    `SELECT a.id AS a_id, b.id AS b_id, a.txn_date, a.amount, a.payee_guess, sa.account
       FROM bank_transactions a
       JOIN bank_transactions b ON b.label_id = a.label_id AND b.id > a.id
        AND b.txn_date = a.txn_date AND b.amount = a.amount AND b.direction = a.direction
        AND COALESCE(LOWER(b.payee_guess), '') = COALESCE(LOWER(a.payee_guess), '')
        AND b.statement_id <> a.statement_id
       JOIN bank_statements sa ON sa.id = a.statement_id AND sa.status = 'ready'
       JOIN bank_statements sb ON sb.id = b.statement_id AND sb.status = 'ready' AND sb.account = sa.account
      WHERE a.label_id = $1 AND a.dismissed = FALSE AND b.dismissed = FALSE
      LIMIT 20`,
    [labelId]
  )).rows;
  if (dupes.length) {
    const ids = dupes.flatMap((d) => [d.a_id, d.b_id]).sort((x, y) => x - y);
    push({
      severity: 'error', type: 'duplicates',
      title: `${dupes.length} transaction pair(s) duplicated across statements`,
      detail: `The same line appears in two live statements of one account (overlapping uploads). E.g. ${day(dupes[0].txn_date)} ${fmt(dupes[0].amount)} "${(dupes[0].payee_guess || '').slice(0, 40)}". Delete or re-upload the overlapping file.`,
      fingerprint: `dupes:${ids.slice(0, 8).join(',')}`,
    });
  }

  // ── Matched-pair checks ───────────────────────────────────────────────────
  for (const t of live) {
    if (t.direction !== 'debit' || !t.matched_expense_id) continue;
    const label = `${day(t.txn_date)} ${fmt(t.amount)} "${(t.payee_guess || t.description || '').slice(0, 40)}"`;
    // broken-link
    const gone = !t.exp_payee || t.exp_deleted || t.exp_voided || t.exp_status !== 'approved';
    if (gone) {
      push({
        severity: 'error', type: 'broken-link', statement_id: t.statement_id, txn_id: t.id,
        title: 'Match points at a dead ledger entry',
        detail: `${label} is matched to entry #${t.matched_expense_id}, which is deleted, voided or no longer approved. Unmatch it so the money is answered again.`,
        fingerprint: `broken:${t.id}`, action: { kind: 'unmatch', txn_id: t.id },
      });
      continue;
    }
    if (t.match_method === 'created' || t.booked) continue; // booked rows have no independent pair to check
    // currency / amount drift
    if ((t.currency || 'USD') !== t.exp_currency) {
      const txnUsd = usdOf(t.amount, t.currency, null);
      const expUsd = usdOf(t.exp_family_amount, t.exp_currency, t.exp_fx);
      const drift = Math.abs(txnUsd - expUsd);
      if (expUsd > 0 && drift > Math.max(35, expUsd * 0.03)) {
        push({
          severity: 'warn', type: 'currency-mismatch', statement_id: t.statement_id, txn_id: t.id,
          title: 'Cross-currency match doesn\'t convert',
          detail: `${label} (${t.currency}) vs invoice ${fmt(t.exp_family_amount)} ${t.exp_currency} — ${fmt(drift)} apart after conversion.`,
          fingerprint: `cur:${t.id}`, action: { kind: 'unmatch', txn_id: t.id },
        });
      }
    } else {
      const claimed = live.filter((x) => x.matched_expense_id === t.matched_expense_id && x.direction === 'debit')
        .reduce((s, x) => s + Number(x.amount), 0);
      const driftAmt = claimed - Number(t.exp_family_amount);
      if (driftAmt > Math.max(35, Number(t.exp_family_amount) * 0.01)) {
        push({
          severity: 'warn', type: 'amount-drift', statement_id: t.statement_id, txn_id: t.id,
          title: 'Bank total exceeds the invoice',
          detail: `Debits matched to "${t.exp_payee}" sum to ${fmt(claimed)} against a family total of ${fmt(t.exp_family_amount)} — off by ${fmt(driftAmt)}. Only a manual match can exceed the fee tolerance.`,
          fingerprint: `amtdrift:${t.id}`, action: { kind: 'unmatch', txn_id: t.id },
        });
      }
    }
    // bank-before-invoice
    if (t.exp_invoice_date && day(t.txn_date) < day(t.exp_invoice_date) && dayGap(t.txn_date, t.exp_invoice_date) > 5) {
      push({
        severity: 'error', type: 'bank-before-invoice', statement_id: t.statement_id, txn_id: t.id,
        title: 'Payment predates its invoice',
        detail: `${label} left the bank ${dayGap(t.txn_date, t.exp_invoice_date)} days BEFORE invoice #${t.matched_expense_id} ("${t.exp_payee}") was issued — impossible, not odd. Almost certainly a wrong match.`,
        fingerprint: `beforeinv:${t.id}`, action: { kind: 'unmatch', txn_id: t.id },
      });
    }
    // date-drift
    if (t.exp_payment_date && dayGap(t.txn_date, t.exp_payment_date) > 14) {
      push({
        severity: 'warn', type: 'date-drift', statement_id: t.statement_id, txn_id: t.id,
        title: 'Paid date far from the bank date',
        detail: `${label} vs a ledger paid date of ${day(t.exp_payment_date)} — ${dayGap(t.txn_date, t.exp_payment_date)} days apart.`,
        fingerprint: `datedrift:${t.id}`, action: { kind: 'unmatch', txn_id: t.id },
      });
    }
    // name-disagreement — only on non-self-evidencing matches.
    if (!SELF_EVIDENCING.has(t.match_method) && t.payee_guess && t.exp_payee) {
      const a = normalizeName(t.payee_guess), b = normalizeName(t.exp_payee);
      if (a && b && a !== b && !a.includes(b) && !b.includes(a)) {
        push({
          severity: 'error', type: 'name-disagreement', statement_id: t.statement_id, txn_id: t.id,
          title: 'Matched names share nothing',
          detail: `Bank says "${t.payee_guess}", the ledger says "${t.exp_payee}" (${t.match_method}, ${Math.round((t.match_score || 0) * 100)}%). Either unmatch it, or record the bank spelling as an alias so the pairing stops looking wrong.`,
          fingerprint: `namedis:${t.id}`,
          action: { kind: 'unmatch', txn_id: t.id },
          alt_action: { kind: 'alias', bank_payee: t.payee_guess, ledger_payee: t.exp_payee },
        });
      }
    }
    // no-document-match — matched to a hand-added entry with no invoice file.
    if (!t.exp_invoice_key && !t.exp_vendor_submitted) {
      push({
        severity: 'warn', type: 'no-document-match', statement_id: t.statement_id, txn_id: t.id,
        title: 'Matched to an entry with no invoice file',
        detail: `${label} is matched to "${t.exp_payee}", which carries no document. Explained is not documented — attach the invoice on the Ledger, or unmatch.`,
        fingerprint: `nodoc:${t.id}`, action: { kind: 'unmatch', txn_id: t.id },
      });
    }
  }

  // ── Reversal machinery ────────────────────────────────────────────────────
  const pairs = pairReversals(live);
  for (const p of pairs) {
    if (p.credit.matched_income_id) {
      push({
        severity: 'error', type: 'reversal-booked-income', statement_id: p.credit.statement_id, txn_id: p.credit.id,
        title: 'A reversal is booked as income',
        detail: `${fmt(p.credit.amount)} back from "${(p.credit.payee_guess || '').slice(0, 40)}" (${p.gap_days}d after the debit) is money RETURNED, not revenue — unbook the income and dismiss the pair.`,
        fingerprint: `revinc:${p.credit.id}`, action: { kind: 'unbook-income', txn_id: p.credit.id },
      });
    } else if (p.debit.matched_expense_id) {
      push({
        severity: 'error', type: 'reversal-still-matched', statement_id: p.debit.statement_id, txn_id: p.debit.id,
        title: 'Reversed payment still reads as paid',
        detail: `${fmt(p.debit.amount)} to "${(p.debit.payee_guess || '').slice(0, 40)}" came back ${p.gap_days} day(s) later, but the debit is still ${p.debit.match_method === 'created' ? 'booked' : 'matched'} — the ledger says paid while the money returned.`,
        fingerprint: `revm:${p.credit.id}:${p.debit.id}`,
        action: p.debit.match_method === 'created' ? undefined : { kind: 'unmatch', txn_id: p.debit.id },
      });
    } else {
      push({
        severity: 'warn', type: 'reversal-pair', statement_id: p.credit.statement_id,
        title: 'Money out and straight back',
        detail: `${fmt(p.credit.amount)} to/from "${(p.credit.payee_guess || p.debit.payee_guess || '').slice(0, 40)}" reversed within ${p.gap_days} day(s) — money that never really moved. Dismiss both sides.`,
        fingerprint: `rev:${p.credit.id}:${p.debit.id}`,
        action: { kind: 'dismiss-pair', txn_ids: [p.credit.id, p.debit.id] },
      });
    }
  }
  // round-trip: same-amount open credit+debit ≤3d, one account, ≥$100
  const paired = new Set(pairs.flatMap((p) => [p.credit.id, p.debit.id]));
  const openC = live.filter((t) => t.direction === 'credit' && !t.matched_income_id && !paired.has(t.id) && Number(t.amount) >= 100);
  const openD = live.filter((t) => t.direction === 'debit' && !t.matched_expense_id && !paired.has(t.id) && Number(t.amount) >= 100);
  const usedRt = new Set();
  for (const c of openC) {
    const d = openD.find((x) => !usedRt.has(x.id) && x.account === c.account
      && Math.abs(Number(x.amount) - Number(c.amount)) < 0.01 && dayGap(x.txn_date, c.txn_date) <= 3);
    if (!d) continue;
    usedRt.add(d.id);
    push({
      severity: 'warn', type: 'round-trip', statement_id: c.statement_id,
      title: 'Internal round-trip',
      detail: `${fmt(c.amount)} out and back within ${dayGap(d.txn_date, c.txn_date)} day(s) on ${c.account} — internal movement the noise list missed. Dismiss both sides.`,
      fingerprint: `rt:${c.id}:${d.id}`, action: { kind: 'dismiss-pair', txn_ids: [c.id, d.id] },
    });
  }

  // ── double-booked ────────────────────────────────────────────────────────
  const created = live.filter((t) => t.match_method === 'created' || t.booked);
  for (let i = 0; i < created.length; i++) {
    for (let j = i + 1; j < created.length; j++) {
      const a = created[i], b = created[j];
      if (a.statement_id === b.statement_id) continue;
      if (Math.abs(Number(a.amount) - Number(b.amount)) > 0.01) continue;
      if (normalizeName(a.payee_guess || '') !== normalizeName(b.payee_guess || '') || !normalizeName(a.payee_guess || '')) continue;
      if (dayGap(a.txn_date, b.txn_date) > 3) continue;
      push({
        severity: 'error', type: 'double-booked', statement_id: b.statement_id, txn_id: b.id,
        title: 'The ledger carries this charge twice',
        detail: `Two booked entries were invented from the same-looking line on different statements: ${fmt(a.amount)} "${(a.payee_guess || '').slice(0, 40)}", ${day(a.txn_date)} and ${day(b.txn_date)}. Unbooking the later one leaves one record of one payment.`,
        fingerprint: `dbl:${a.id}:${b.id}`,
        // The fix is a one-click unbook of the LATER copy — the earlier row
        // is the one whose statement was reconciled first.
        action: { kind: 'unbook', txn_id: b.id },
      });
    }
  }

  // ── booked-duplicate / stolen-match ──────────────────────────────────────
  //
  // A debit was BOOKED as a new ledger entry when the vendor's real invoice
  // was already in the ledger. The money now lives twice: the untouched
  // original reads "paid, no bank match" while the invented copy holds the
  // bank proof. The one-click fix is exactly the rematch endpoint — retire
  // the copy, tie the debit to the document.
  //
  // When the original is CLAIMED instead, by a payment whose bank name flatly
  // disagrees with the vendor, the duplicate is a symptom: an amount-
  // coincidence auto-match stole the invoice. Flag the thief, because
  // unmatching it is what makes the duplicate fixable at all.
  try {
    const claimedSums = new Map();
    for (const t of live) {
      if (t.direction !== 'debit' || !t.matched_expense_id) continue;
      claimedSums.set(t.matched_expense_id, (claimedSums.get(t.matched_expense_id) || 0) + Number(t.amount));
    }
    const bookedRows = live.filter((t) => (t.match_method === 'created' || t.booked) && t.matched_expense_id && t.exp_payee && !t.no_invoice);
    if (bookedRows.length) {
      const fams = (await pool.query(
        `SELECT e.id, e.payee, e.invoice_number, e.payment_status, e.payment_date, COALESCE(e.currency, 'USD') AS currency,
                (e.amount + COALESCE((SELECT SUM(k.amount) FROM expenses k WHERE k.parent_id = e.id AND (k.deleted IS NULL OR k.deleted = FALSE)), 0)) AS family_total
           FROM expenses e
          WHERE e.label_id = $1 AND e.parent_id IS NULL AND e.status = 'approved'
            AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
            AND e.entry_source IS DISTINCT FROM 'bank_statement'`,
        [labelId]
      )).rows;
      const byName = new Map();
      for (const f of fams) {
        const k = normalizeName(f.payee || '');
        if (!k) continue;
        if (!byName.has(k)) byName.set(k, []);
        byName.get(k).push(f);
      }
      let emitted = 0;
      for (const c of bookedRows) {
        if (emitted >= 60) break;
        const amt = Number(c.amount);
        const tol = Math.max(35, amt * 0.01);
        const key = normalizeName(c.exp_payee || '');
        let cands = byName.get(key) || [];
        if (!cands.length) {
          for (const [, list] of byName) {
            const vm = vendorsMatch(c.exp_payee, list[0]?.payee);
            if (vm.match && vm.score >= 0.8) cands = cands.concat(list);
          }
        }
        const sameCur = (f) => (f.currency || 'USD') === (c.currency || 'USD');
        const fits = cands.filter((f) => sameCur(f) && !claimedSums.get(f.id) && Math.abs(Number(f.family_total) - amt) <= tol);
        if (fits.length) {
          fits.sort((a, b) => Math.abs(Number(a.family_total) - amt) - Math.abs(Number(b.family_total) - amt));
          const orig = fits[0];
          emitted += 1;
          push({
            severity: 'error', type: 'booked-duplicate', statement_id: c.statement_id, txn_id: c.id, ledger_id: orig.id,
            title: `Booked a duplicate: ${c.exp_payee} ${fmt(amt)}`,
            detail: `The ${day(c.txn_date)} debit was booked as a NEW ledger entry, but ${orig.payee}'s ${fmt(orig.family_total)} invoice`
              + `${orig.invoice_number ? ` (inv ${orig.invoice_number})` : ''} already exists`
              + `${orig.payment_status === 'Paid' ? ' and is marked Paid with no bank line' : ''} — the expense counts twice. `
              + 'The fix retires the invented copy and ties this debit to the real invoice.',
            fingerprint: `bdup:${c.matched_expense_id}:${orig.id}`,
            action: { kind: 'unbook-rematch', txn_id: c.id, expense_id: orig.id, payee: orig.payee },
          });
          continue;
        }
        // Nothing free fits — is the original held by the WRONG payment?
        const held = cands.find((f) => sameCur(f) && claimedSums.get(f.id) > 0 && Math.abs(Number(f.family_total) - amt) <= tol);
        if (!held) continue;
        const thief = live.find((h) => {
          if (h.matched_expense_id !== held.id || h.id === c.id) return false;
          if (!/^auto/.test(h.match_method || '')) return false;   // a person's match is a person's call
          if (!(h.payee_guess || '').trim() || !(held.payee || '').trim()) return false;
          const vm = vendorsMatch(h.payee_guess, held.payee);
          return !vm.match && vm.score < 0.25;
        });
        if (!thief) continue;
        emitted += 1;
        push({
          severity: 'error', type: 'stolen-match', statement_id: c.statement_id, txn_id: thief.id, ledger_id: held.id,
          title: `Wrong payment holds this invoice: ${held.payee} ${fmt(held.family_total)}`,
          detail: `${held.payee}'s invoice is matched to the ${day(thief.txn_date)} payment from "${thief.payee_guess}" (${thief.match_method} — the names share nothing), `
            + `while the real ${c.exp_payee} payment sits booked as a duplicate copy. Unmatch the wrong payment; the next pass then offers the one-click duplicate fix.`,
          fingerprint: `steal:${thief.id}:${held.id}`,
          action: { kind: 'unmatch', txn_id: thief.id },
        });
      }
    }
  } catch (e) { console.warn('booked-duplicate flag check degraded:', e.message); }

  // ── suspect-currency ─────────────────────────────────────────────────────
  //
  // A PayPal payment whose EXACT amount also appears as a same-day "currency
  // conversion" row is almost certainly a FOREIGN face amount read as USD —
  // the conversion is what moved the face value. Left alone it inflates every
  // USD figure the row touches, silently.
  try {
    const ppKeys = accounts.filter((a) => /paypal/i.test(a.key)).map((a) => a.key);
    if (ppKeys.length) {
      const ppRows = live.filter((t) => ppKeys.includes(t.account));
      const conversions = ppRows.filter((t) => /conversion/i.test(`${t.description || ''} ${t.payee_guess || ''}`));
      for (const t of ppRows) {
        if ((t.currency || 'USD') !== 'USD') continue;
        if (Number(t.amount) < 500) continue;
        if (/conversion/i.test(`${t.description || ''} ${t.payee_guess || ''}`)) continue;
        const twin = conversions.find((c) => c.id !== t.id && c.statement_id === t.statement_id
          && Math.abs(Number(c.amount) - Number(t.amount)) < 0.005 && dayGap(c.txn_date, t.txn_date) <= 1);
        if (!twin) continue;
        push({
          severity: 'error', type: 'suspect-currency', statement_id: t.statement_id, txn_id: t.id,
          title: `Probably not USD: ${(t.payee_guess || t.description || '').slice(0, 40)} ${fmt(t.amount)}`,
          detail: `This payment's exact amount also appears as a same-day currency-conversion row — the signature of a foreign-currency payment parsed as USD. `
            + `Open the statement to read the real currency${t.matched_expense_id ? `, ${t.match_method === 'created' || t.booked ? 'unbook' : 'unmatch'} the line,` : ''} then correct it on Bank Matching.`,
          fingerprint: `suscur:${t.id}`,
          ...(t.matched_expense_id && t.match_method !== 'created' && !t.booked ? { action: { kind: 'unmatch', txn_id: t.id } } : {}),
        });
      }
    }
  } catch (e) { console.warn('suspect-currency flag check degraded:', e.message); }

  // ── lesson-disagreement / vendor-link ────────────────────────────────────
  //
  // Two complementary checks over the SHARED bank-vendor grouping:
  //   lesson-disagreement — a learned link names one vendor while every match
  //     under that descriptor names another. The next statement will follow
  //     the LINK, so a wrong one keeps re-creating the mistake.
  //   vendor-link — a group with no link at all whose own matches name exactly
  //     one vendor. The app already knows the answer and never wrote it down,
  //     so the directory lists one company as two.
  //
  // A person's OVERRIDE is exempt from both: disagreeing with the matches is
  // that person's decision, not a defect. And vendor-link requires NAME
  // EVIDENCE, never bare co-occurrence — offering a link on the strength of a
  // wrong match would cement that error into every future statement.
  try {
    const groups = await aggregateBankVendors(labelId);
    const agrees = (a, b) => {
      const x = String(a || '').toLowerCase().trim(), y = String(b || '').toLowerCase().trim();
      if (!x || !y) return false;
      return x === y || vendorsMatch(a, b).match || sameSquashedName(a, b);
    };
    const disagreeing = groups.filter((g) => g.linked_vendor && !g.overridden
      && g.ledger_vendors.length > 0 && !g.ledger_vendors.some((v) => agrees(v, g.linked_vendor)));
    // Collapse: 3+ groups whose lessons all disagree while pointing at ONE
    // ledger vendor are one card processor minting a group per charge. One
    // card, one bulk repoint — generic, because the next processor does the
    // same thing.
    const byLedger = new Map();
    for (const g of disagreeing) {
      const k = g.ledger_vendors.slice().sort().join(' + ');
      if (!byLedger.has(k)) byLedger.set(k, []);
      byLedger.get(k).push(g);
    }
    for (const [ledgerNames, gs] of byLedger) {
      const target = gs[0].ledger_vendors[0];
      const total = gs.reduce((n, g) => n + Number(g.total || 0), 0);
      if (gs.length >= 3) {
        push({
          severity: 'warn', type: 'lesson-disagreement',
          title: `${gs.length} bank vendors are all ${target}`,
          detail: `${gs.length} separate bank vendor groups (${gs.slice(0, 3).map((g) => g.name).join(', ')}…) each carry their own learned link, `
            + `but every one of their matches points at ${target} — ${fmt(total)} in total. The descriptor carries a per-charge code the grouping does not strip, `
            + `so each charge became its own vendor. Repointing all ${gs.length} at ${target} files them together.`,
          fingerprint: `lessongrp:${target}:${gs.length}`,
          q: gs[0].name || '',
          action: { kind: 'relink', bank_payees: gs.map((g) => g.name), ledger_payee: target },
        });
        continue;
      }
      for (const g of gs) {
        push({
          severity: 'warn', type: 'lesson-disagreement',
          title: `"${g.name}" is taught as ${g.linked_vendor}, but pays ${ledgerNames}`,
          detail: `Payments under "${g.name}" (${fmt(g.total)}, last seen ${g.last_seen || '?'}) are matched to ${ledgerNames}, `
            + `while the learned link sends future ones to ${g.linked_vendor}. Either the link is wrong — repoint it — or the matches are, `
            + 'in which case fix those first: the next statement will follow the link.',
          fingerprint: `lesson:${g.key}`,
          q: g.name || '',
          action: { kind: 'relink', bank_payees: [g.name], ledger_payee: target },
        });
      }
    }
    for (const g of groups) {
      if (g.linked_vendor || g.overridden) continue;
      if (g.ledger_vendors.length !== 1) continue;
      const target = g.ledger_vendors[0];
      if (agrees(target, g.name)) continue;               // the directory folds these on the name alone
      const vm = vendorsMatch(g.name, target);
      const evidence = vm.match || vm.score >= 0.25 || sameSquashedName(g.name, target) || descriptorMentions(g.name, target);
      if (!evidence) continue;                            // no evidence => this is a WRONG MATCH, not a link
      push({
        severity: 'warn', type: 'vendor-link',
        title: `"${g.name}" is ${target}`,
        detail: `Every payment under "${g.name}" (${fmt(g.total)}, last seen ${g.last_seen || '?'}) is matched to ${target}'s invoices, but nothing links the two names — `
          + 'so the directory lists them as separate vendors and the next statement will know neither. Linking files them together.',
        fingerprint: `vlink:${g.key}`,
        q: g.name || '',
        action: { kind: 'relink', bank_payees: [g.name], ledger_payee: target },
      });
    }
  } catch (e) { console.warn('lesson-disagreement flag check degraded:', e.message); }

  // ── stale-coverage ────────────────────────────────────────────────────────
  for (const s of statements) {
    if (!s.period_end) continue;
    const ageDays = (Date.now() - new Date(day(s.period_end)).getTime()) / 86400000;
    if (ageDays <= 7) continue;
    const rows = (byStatement.get(s.id) || []).filter((t) => t.direction === 'debit' && !t.dismissed);
    const open = rows.filter((t) => !t.matched_expense_id);
    const liveUsd = rows.reduce((x, t) => x + usdOf(t.amount, t.currency, null), 0);
    const matchedUsd = rows.filter((t) => t.matched_expense_id).reduce((x, t) => x + usdOf(t.amount, t.currency, null), 0);
    if (open.length >= 20 && liveUsd > 0 && matchedUsd / liveUsd < 0.6) {
      push({
        severity: 'warn', type: 'stale-coverage', statement_id: s.id,
        title: `${s.filename || s.account} is going stale`,
        detail: `The period ended ${Math.round(ageDays)} days ago with ${open.length} open debits and only ${Math.round((matchedUsd / liveUsd) * 100)}% of debit dollars matched.`,
        fingerprint: `stale:${s.id}:${open.length}`,
      });
    }
  }

  // ── paid-no-match (per-item, capped; true total in counts) ───────────────
  let pnmCount = 0;
  try {
    const pnm = (await pool.query(
      `SELECT e.id, e.payee, e.amount, e.currency, e.fx_rate_to_usd, e.payment_date, e.category
         FROM expenses e
        WHERE e.label_id = $1 AND e.parent_id IS NULL AND e.status = 'approved'
          AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
          AND e.entry_source IS DISTINCT FROM 'bank_statement'
          AND ${noBankEvidenceSql('e', accounts)}
        ORDER BY e.amount DESC
        LIMIT 500`,
      [labelId]
    )).rows;
    pnmCount = pnm.length;
    for (const e of pnm.slice(0, 150)) {
      push({
        severity: 'warn', type: 'paid-no-match',
        title: `Paid, no bank line: ${e.payee || '—'} ${fmt(usdOf(e.amount, e.currency, e.fx_rate_to_usd))}`,
        detail: `Marked Paid on ${day(e.payment_date)} and a compatible statement covers that date, yet no bank line settles it. Three explanations: the date is wrong, it was paid from an account with no statement uploaded, or it was never actually paid.`,
        fingerprint: `pnm:${e.id}`,
        action: { kind: 'mark-unpaid', entry_id: e.id },
        entry: { id: e.id, payee: e.payee, category: e.category, payment_date: day(e.payment_date) },
      });
    }
  } catch (e) { console.warn('paid-no-match check degraded:', e.message); }

  // ── paypal-uncovered ──────────────────────────────────────────────────────
  const paypalAccounts = accounts.filter((a) => /paypal/i.test(a.key)).map((a) => a.key);
  if (paypalAccounts.length) {
    const ppStatements = statements.filter((s) => paypalAccounts.includes(s.account) && s.period_start && s.period_end);
    const covered = (d) => ppStatements.some((s) => day(d) >= day(s.period_start) && day(d) <= day(s.period_end));
    const uncovered = live.filter((t) => t.direction === 'debit' && !paypalAccounts.includes(t.account)
      && /paypal/i.test(`${t.description || ''} ${t.payee_guess || ''}`) && !covered(t.txn_date));
    const byStmt = new Map();
    for (const t of uncovered) byStmt.set(t.statement_id, (byStmt.get(t.statement_id) || 0) + 1);
    for (const [sid, n] of byStmt) {
      push({
        severity: 'warn', type: 'paypal-uncovered', statement_id: sid,
        title: `${n} PayPal funding pull(s) with no PayPal statement`,
        detail: 'Bank pulls to PayPal in a period no PayPal statement covers. When that statement arrives the same spend will appear twice — pair the pulls on Bank Matching once it is uploaded.',
        fingerprint: `ppunc:${sid}:${n}`,
      });
    }
  }

  // ── reopened-month ────────────────────────────────────────────────────────
  try {
    const months = (await pool.query(`SELECT month_key FROM statement_months WHERE label_id = $1`, [labelId])).rows.map((r) => r.month_key);
    for (const mk of months) {
      const open = live.filter((t) => t.direction === 'debit' && !t.matched_expense_id && day(t.txn_date).slice(0, 7) === mk).length;
      if (open > 0) {
        push({
          severity: 'warn', type: 'reopened-month',
          title: `Reconciled month ${mk} has ${open} open debit(s) again`,
          detail: 'Something changed after the month was marked reconciled — a re-upload, an unmatch, or a new statement. Re-work it, then reconcile again.',
          fingerprint: `reopen:${mk}:${open}`,
        });
      }
    }
  } catch { /* table may not exist yet */ }

  // ── Split by acks ─────────────────────────────────────────────────────────
  let acks = new Map();
  try {
    acks = new Map((await pool.query(`SELECT fingerprint, created_by, created_at FROM statement_flag_acks WHERE label_id = $1`, [labelId]))
      .rows.map((r) => [r.fingerprint, r]));
  } catch { /* pre-migration */ }
  const sevRank = { error: 0, warn: 1 };
  flags.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
  const active = flags.filter((f) => !acks.has(f.fingerprint));
  const acked = flags.filter((f) => acks.has(f.fingerprint)).map((f) => ({ ...f, acked_by: acks.get(f.fingerprint).created_by }));
  return {
    flags: active,
    acked,
    counts: { total: flags.length, errors: flags.filter((f) => f.severity === 'error').length, paid_no_match: pnmCount },
  };
}

module.exports = { buildFlags };
