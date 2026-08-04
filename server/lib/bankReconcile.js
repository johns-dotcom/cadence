// Bank-statement reconciliation engine. Parsing (CSV + Claude-parsed PDF),
// dedupe, auto-dismiss of internal movement, rule application, and the tiered
// learning matcher. A statement is a LENS over the master ledger — nothing
// here writes a second copy; matching links a bank txn to a ledger FAMILY ROOT
// and booking creates a normal approved+Paid expense.

const pool = require('../db');

// ── Bank accounts ─────────────────────────────────────────────────────────
// Per-label configurable; these ship as defaults. `methods` = payment methods
// a match on this account is compatible with (null = any).
const DEFAULT_ACCOUNTS = [
  { key: 'bofa', label: 'Bank of America', methods: ['ACH', 'Wire', 'Check'] },
  { key: 'paypal', label: 'PayPal', methods: ['PayPal'] },
];
function accountsFor(labelRow) {
  const a = labelRow && labelRow.bank_accounts;
  return Array.isArray(a) && a.length ? a : DEFAULT_ACCOUNTS;
}
function accountMethods(accounts, key) {
  const a = accounts.find(x => x.key === key);
  return a && Array.isArray(a.methods) ? a.methods : null;
}

// ── Name normalization + evidence ───────────────────────────────────────────
const SUFFIXES = /\b(llc|l\.l\.c|inc|incorporated|ltd|limited|co|corp|corporation|company|the|group|holdings|gmbh|pty|plc)\b/g;
function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')       // drop parentheticals
    .replace(/[^a-z0-9 ]+/g, ' ')     // punctuation → space
    .replace(SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokens(s) { return new Set(normalizeName(s).split(' ').filter(w => w.length > 1)); }
function jaccard(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// Fuzzy vendor-name similarity (0..1) with a method label. Independent of any
// learning — used as a fallback when the payee map doesn't have a hit.
function vendorsMatch(bankPayee, ledgerPayee) {
  const a = normalizeName(bankPayee), b = normalizeName(ledgerPayee);
  if (!a || !b) return { score: 0, method: 'auto-fuzzy' };
  if (a === b) return { score: 0.95, method: 'auto-exact' };
  if (a.includes(b) || b.includes(a)) return { score: 0.85, method: 'auto-fuzzy' };
  const j = jaccard(a, b);
  if (j >= 0.5) return { score: 0.6 + Math.min(0.2, (j - 0.5) * 0.8), method: 'auto-fuzzy' };
  return { score: j, method: 'auto-fuzzy' };
}

// Best name evidence for (bankPayee → ledgerPayee), folding the learned payee
// map (exact bank-descriptor hit = 1.0) and vendor aliases into the fuzzy
// fallback. `payeeMap` = { normalizedBankPayee: ledgerPayeeLower }.
// `aliasMap` = { aliasLower: canonicalLower }.
function nameEvidence(bankPayee, ledgerPayee, payeeMap = {}, aliasMap = {}) {
  if (!bankPayee) return { score: 0, method: 'auto-fuzzy' };
  const bn = normalizeName(bankPayee);
  const learned = payeeMap[bn];
  if (learned && learned === String(ledgerPayee || '').toLowerCase()) return { score: 1.0, method: 'auto-learned' };
  // Fold aliases: if the bank payee is a known alias of the ledger payee.
  const canon = aliasMap[String(bankPayee).toLowerCase().trim()] || aliasMap[bn];
  if (canon && canon === String(ledgerPayee || '').toLowerCase()) return { score: 0.95, method: 'auto-exact' };
  return vendorsMatch(bankPayee, ledgerPayee);
}

// ── Internal-movement detection ─────────────────────────────────────────────
const INTERNAL_RE = /(currency conversion|withdrawal to (your )?bank|account hold|general (hold|card) hold|reversal of|transfer (to|from) (your )?(bank|account|savings|checking)|internal transfer|online banking transfer|book transfer|zelle.*(to|from) (your )?own|to your linked)/i;
function isInternal(description, payee) {
  const s = `${description || ''} ${payee || ''}`;
  return INTERNAL_RE.test(s);
}

// ── Parsers ─────────────────────────────────────────────────────────────────
// Claude PDF output: pipe-delimited lines DATE|DIRECTION|AMOUNT|PAYEE|REFERENCE|DESCRIPTION
function parsePipeLines(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || /^date\s*\|/i.test(line)) continue;
    const parts = line.split('|').map(p => p.trim());
    if (parts.length < 3) continue;
    const [date, dir, amount, payee, reference, ...descRest] = parts;
    const d = normalizeDate(date);
    const amt = parseAmount(amount);
    if (!d || amt == null) continue;
    const direction = /credit|cr|deposit|\+/i.test(dir) ? 'credit' : 'debit';
    out.push({
      txn_date: d, direction, amount: Math.abs(amt),
      payee_guess: payee || null, reference: reference || null,
      description: (descRest.join(' | ') || payee || '').trim() || null,
    });
  }
  return out;
}

function normalizeDate(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  let m;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/))) {
    let [, mo, da, yr] = m;
    if (yr.length === 2) yr = '20' + yr;
    return `${yr}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
  }
  const d = new Date(t);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}
function parseAmount(s) {
  const t = String(s || '').replace(/[$,\s]/g, '').replace(/[()]/g, m => (m === '(' ? '-' : ''));
  if (t === '' || isNaN(Number(t))) return null;
  return Number(t);
}

// CSV parsing with header-row detection (banks put summary blocks first) and
// forgiving, per-bank column + payee extraction.
function splitCsv(text) {
  const rows = []; let row = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = ''; } if (c === '\r' && text[i + 1] === '\n') i++; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const HEADER_HINTS = ['date', 'amount', 'description', 'payee', 'name', 'debit', 'credit', 'gross', 'reference'];
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cells = rows[i].map(c => String(c).toLowerCase().trim());
    const hits = cells.filter(c => HEADER_HINTS.some(h => c.includes(h))).length;
    if (hits >= 2) return i;
  }
  return 0;
}
function col(headers, ...names) {
  for (const n of names) { const i = headers.findIndex(h => h === n || h.includes(n)); if (i >= 0) return i; }
  return -1;
}
// Extract a clean payee from a bank descriptor (wire BNF:, ACH DES:, checkcard
// merchant, Zelle recipient).
function extractPayee(desc) {
  const d = String(desc || '');
  let m;
  if ((m = d.match(/BNF[:=]\s*([A-Za-z0-9 .,&'-]+)/i))) return m[1].trim();
  if ((m = d.match(/DES[:=]\s*([A-Za-z0-9 .,&'-]+)/i))) return m[1].trim();
  if ((m = d.match(/(?:CHECKCARD|PURCHASE|POS)\s+\d*\s*([A-Za-z0-9 .,&'*-]{3,})/i))) return m[1].replace(/\*+/g, ' ').trim();
  if ((m = d.match(/ZELLE[^A-Za-z]*(?:to|from|payment to)?\s*([A-Za-z0-9 .'-]+)/i))) return m[1].trim();
  return d.split(/\s{2,}|;|\|/)[0].trim().slice(0, 80) || null;
}
function parseCsv(text, account) {
  const rows = splitCsv(text).filter(r => r.some(c => String(c).trim()));
  if (rows.length < 2) return [];
  const hi = findHeader(rows);
  const headers = rows[hi].map(h => String(h).toLowerCase().trim().replace(/\s+/g, ' '));
  const iDate = col(headers, 'date', 'transaction date', 'posting date');
  const iAmt = col(headers, 'amount', 'gross');
  const iNet = col(headers, 'net');
  const iFee = col(headers, 'fee');
  const iDesc = col(headers, 'description', 'details', 'memo');
  const iName = col(headers, 'name', 'payee', 'merchant');
  const iRef = col(headers, 'reference', 'transaction id', 'confirmation');
  const iDebit = col(headers, 'debit');
  const iCredit = col(headers, 'credit');
  const out = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const cells = rows[r];
    const dateStr = iDate >= 0 ? cells[iDate] : '';
    const d = normalizeDate(dateStr);
    if (!d) continue;
    let amt = null, direction = 'debit';
    if (iDebit >= 0 || iCredit >= 0) {
      const deb = parseAmount(cells[iDebit]) || 0;
      const cre = parseAmount(cells[iCredit]) || 0;
      if (deb) { amt = Math.abs(deb); direction = 'debit'; }
      else if (cre) { amt = Math.abs(cre); direction = 'credit'; }
    } else {
      // Match on gross when present, fall back to net (PayPal).
      const gross = iAmt >= 0 ? parseAmount(cells[iAmt]) : null;
      const net = iNet >= 0 ? parseAmount(cells[iNet]) : null;
      const raw = gross != null ? gross : net;
      if (raw == null) continue;
      amt = Math.abs(raw);
      direction = raw < 0 ? 'debit' : 'credit';
    }
    if (amt == null) continue;
    const desc = iDesc >= 0 ? cells[iDesc] : '';
    const name = iName >= 0 ? cells[iName] : '';
    out.push({
      txn_date: d, direction, amount: amt,
      fee: iFee >= 0 ? Math.abs(parseAmount(cells[iFee]) || 0) || null : null,
      reference: iRef >= 0 ? (cells[iRef] || '').trim() || null : null,
      description: (desc || name || '').trim() || null,
      payee_guess: (name && name.trim()) ? name.trim() : extractPayee(desc),
    });
  }
  return out;
}

// ── The tiered learning matcher ──────────────────────────────────────────────
// Load the learned payee map + vendor aliases once per statement ingest.
async function loadMaps(db, labelId) {
  const pm = await (db || pool).query('SELECT bank_payee, ledger_payee FROM statement_payee_map WHERE label_id = $1', [labelId]);
  const payeeMap = {};
  for (const r of pm.rows) payeeMap[normalizeName(r.bank_payee)] = String(r.ledger_payee).toLowerCase();
  const al = await (db || pool).query('SELECT alias, canonical FROM vendor_aliases WHERE label_id = $1', [labelId]);
  const aliasMap = {};
  for (const r of al.rows) aliasMap[String(r.alias).toLowerCase().trim()] = String(r.canonical).toLowerCase();
  return { payeeMap, aliasMap };
}

// Candidate ledger FAMILIES (roots) for one debit txn: approved/live,
// method-compatible, same currency, date-plausible. Returns rows with
// family_amount (root slice + children).
async function candidates(db, labelId, txn, methods) {
  const c = db || pool;
  const params = [labelId, txn.currency || 'USD', txn.txn_date];
  let methodClause = '';
  if (Array.isArray(methods) && methods.length) {
    params.push(methods);
    methodClause = ` AND (e.payment_method = ANY($${params.length}) OR e.payment_method IS NULL)`;
  }
  const { rows } = await c.query(
    `SELECT e.*,
       (e.amount + COALESCE((SELECT SUM(k.amount) FROM expenses k WHERE k.parent_id = e.id AND (k.deleted=false OR k.deleted IS NULL)),0)) AS family_amount
     FROM expenses e
     WHERE e.label_id = $1 AND e.parent_id IS NULL AND e.status = 'approved'
       AND (e.deleted=false OR e.deleted IS NULL) AND (e.voided=false OR e.voided IS NULL)
       AND COALESCE(e.currency,'USD') = $2
       AND e.entry_source IS DISTINCT FROM 'bank_statement'
       AND NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.matched_expense_id = e.id AND bt.label_id = e.label_id)
       AND (
         (e.payment_status = 'Paid' AND e.payment_date BETWEEN $3::date - 5 AND $3::date + 5)
         OR (e.payment_status IN ('Unpaid','Partial') AND (e.invoice_date IS NULL OR e.invoice_date <= $3::date + 5) AND $3::date >= e.invoice_date - 5)
       )${methodClause}`,
    params
  );
  return rows;
}

// Match ONE debit txn against the ledger. Returns {expense_id, method, score}
// or null. `maps` from loadMaps.
async function matchTxn(db, labelId, txn, methods, maps) {
  if (txn.direction !== 'debit') return null;
  const cands = await candidates(db, labelId, txn, methods);
  if (!cands.length) return null;
  const amt = Number(txn.amount);

  // Tier 1 — exact amount.
  const exact = cands.filter(c => Math.abs(Number(c.family_amount) - amt) < 0.01);
  if (exact.length) {
    const scored = exact.map(c => ({ c, ev: nameEvidence(txn.payee_guess, c.payee, maps.payeeMap, maps.aliasMap) }));
    if (exact.length === 1) {
      // A bare amount-only match is dangerous — require a non-empty bank payee.
      if (!txn.payee_guess) return null;
      const best = scored[0];
      return { expense_id: best.c.id, method: best.ev.method, score: Math.max(best.ev.score, 0.6) };
    }
    scored.sort((a, b) => b.ev.score - a.ev.score);
    if (scored[0].ev.score >= 0.6 && (scored.length < 2 || scored[0].ev.score - scored[1].ev.score >= 0.15)) {
      return { expense_id: scored[0].c.id, method: scored[0].ev.method, score: scored[0].ev.score };
    }
    return null;
  }

  // Tier 2 — fee-tolerant (wires land a fee above the invoice).
  const tol = Math.max(35, amt * 0.01);
  const near = cands
    .map(c => ({ c, delta: amt - Number(c.family_amount), ev: nameEvidence(txn.payee_guess, c.payee, maps.payeeMap, maps.aliasMap) }))
    .filter(x => x.delta >= -0.01 && x.delta <= tol && x.ev.score >= 0.6);
  if (near.length) {
    near.sort((a, b) => b.ev.score - a.ev.score);
    return { expense_id: near[0].c.id, method: 'auto-fee', score: near[0].ev.score };
  }
  return null;
}

// Top-3 near-miss suggestions for the "Match…" UI (amount-prefiltered ±15%,
// then name-scored). Returns [{ expense_id, payee, amount, score }].
async function suggestions(db, labelId, txn, methods, maps) {
  const cands = await candidates(db, labelId, txn, methods);
  const amt = Number(txn.amount);
  const scored = cands
    .filter(c => { const fa = Number(c.family_amount); return fa >= amt * 0.85 && fa <= amt * 1.15; })
    .map(c => ({ expense_id: c.id, payee: c.payee, amount: Number(c.family_amount), currency: c.currency, invoice_number: c.invoice_number, score: nameEvidence(txn.payee_guess, c.payee, maps.payeeMap, maps.aliasMap).score }))
    .sort((a, b) => (Math.abs(a.amount - amt) === Math.abs(b.amount - amt) ? b.score - a.score : Math.abs(a.amount - amt) - Math.abs(b.amount - amt)));
  return scored.slice(0, 3);
}

// Learn a bank-descriptor → ledger-payee association (idempotent upsert).
async function learnPayee(db, labelId, bankPayee, ledgerPayee, actor) {
  if (!bankPayee || !ledgerPayee) return;
  await (db || pool).query(
    `INSERT INTO statement_payee_map (label_id, bank_payee, ledger_payee, created_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (label_id, LOWER(bank_payee)) DO UPDATE SET ledger_payee = EXCLUDED.ledger_payee`,
    [labelId, bankPayee.trim(), ledgerPayee.trim(), actor || null]
  );
}

module.exports = {
  DEFAULT_ACCOUNTS, accountsFor, accountMethods,
  normalizeName, nameEvidence, vendorsMatch, isInternal,
  parsePipeLines, parseCsv, extractPayee,
  loadMaps, candidates, matchTxn, suggestions, learnPayee,
};
