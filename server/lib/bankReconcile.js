// Bank-statement reconciliation engine. Parsing (CSV + Claude-parsed PDF),
// dedupe, auto-dismiss of internal movement, rule application, and the tiered
// learning matcher. A statement is a LENS over the master ledger — nothing
// here writes a second copy; matching links a bank txn to a ledger FAMILY ROOT
// and booking creates a normal approved+Paid expense.

const pool = require('../db');
const { normalizeBankPayee } = require('./normalizeBankPayee');
const { normalizeInvoiceNum } = require('./normalizeInvoiceNum');

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

// ── Email extraction (banks mash "Name / email@x" into one field) ───────────
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
function splitPayeeEmail(raw) {
  const s = String(raw || '');
  const m = s.match(EMAIL_RE);
  if (!m) return { payee: s.trim() || null, email: null };
  const payee = s.replace(EMAIL_RE, '').replace(/[\s/|,-]+$/g, '').replace(/^[\s/|,-]+/g, '').trim();
  return { payee: payee || null, email: m[0].toLowerCase() };
}

// Stable identity across re-uploads — keys statement_match_rejections.
const txnFingerprint = (txn) =>
  `${String(txn.txn_date).slice(0, 10)}|${(Number(txn.amount) || 0).toFixed(2)}|${normalizeBankPayee(txn.payee_guess || txn.description || '')}`;

// ── refEvidence — invoice/reference numbers in the wire text ─────────────────
// The strongest signal a bank row can carry. Checked FIRST; returns 1.0.
//   * payment_ref: the ledger's payment reference (≥4 chars) as a substring
//     of the wire text.
//   * invoice #: normalized with the SAME canonical normalizer the
//     duplicate-invoice detection uses (#003 ≡ INV-003 ≡ 003). Token scan
//     (only when normalized length ≥ 2) with the MMDD GUARD — card
//     descriptors embed the charge date ("PURCHASE 0227 FACEBK") and invoice
//     "227" must NOT match it — plus a prefixed regex for short numbers.
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function looksLikeMMDD(tok) {
  if (!/^\d{4}$/.test(tok)) return false;
  const mo = Number(tok.slice(0, 2)), da = Number(tok.slice(2));
  return mo >= 1 && mo <= 12 && da >= 1 && da <= 31;
}
function refEvidence(txn, cand) {
  const hay = `${txn.reference || ''} ${txn.description || ''} ${txn.payee_guess || ''}`;
  const ref = String(cand.payment_ref || '').trim();
  if (ref.length >= 4 && hay.toLowerCase().includes(ref.toLowerCase())) return { score: 1.0, reason: 'ref' };
  const inv = normalizeInvoiceNum(String(cand.invoice_number || ''));
  if (inv) {
    if (inv.length >= 2) {
      for (const rawTok of hay.split(/[\s,;:|]+/)) {
        if (looksLikeMMDD(rawTok)) continue; // MMDD guard
        if (normalizeInvoiceNum(rawTok) === inv) return { score: 1.0, reason: 'ref' };
      }
    }
    const prefixed = new RegExp(`(?:invoice|inv|no\\.?|#)[\\s\\-.:_/]*0*${escRe(inv)}\\b`, 'i');
    if (prefixed.test(hay)) return { score: 1.0, reason: 'ref' };
  }
  return null;
}

// ONE derivation of the match_method string from the evidence reason —
// every tier uses it, so the vocabulary can't fork.
function methodOf(reason) {
  return {
    ref: 'auto-ref', email: 'auto-email', learned: 'auto-learned',
    alias: 'auto-alias', 'alias-fuzzy': 'auto-fuzzy',
    exact: 'auto-exact', fuzzy: 'auto-fuzzy', date: 'auto-date', fee: 'auto-fee',
  }[reason] || 'auto-fuzzy';
}

// Evidence-date scoring (banks settle 1-3 business days after the ledger's
// paid date). evidenceDate = paid ? payment_date : scheduled_payment_date —
// yes, scheduled dates count for unpaid invoices. Neutral 0.5 when no date
// exists: never penalize undated candidates.
const dayOf = (d) => (d ? String(d).slice(0, 10) : null);
function evidenceDate(cand) {
  return dayOf(cand.payment_status === 'Paid' ? cand.payment_date : cand.scheduled_payment_date) || dayOf(cand.payment_date);
}
function daysApart(a, b) {
  if (!a || !b) return null;
  return Math.abs((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000);
}
function dateScore(txn, cand) {
  const d = daysApart(evidenceDate(cand), dayOf(txn.txn_date));
  return d == null ? 0.5 : Math.max(0, 1 - d / 7);
}

// Best evidence for (txn → candidate). Priority: reference/invoice# (1.0) →
// email (1.0) → learned map, raw or descriptor-normalized key (1.0) → alias
// exact (0.95) → fuzzy best-of the payee AND every alias in its group.
// `maps` from loadMaps.
function evidence(txn, cand, maps) {
  const r = refEvidence(txn, cand);
  if (r) return { score: r.score, method: methodOf(r.reason) };
  const candEmail = String(cand.vendor_email || '').toLowerCase().trim();
  if (txn.payee_email && candEmail && txn.payee_email === candEmail) return { score: 1.0, method: 'auto-email' };
  if (txn.payee_email && maps.emailByVendor?.get(String(cand.payee || '').toLowerCase().trim())?.has(txn.payee_email)) {
    return { score: 1.0, method: 'auto-email' };
  }
  const bankRaw = txn.payee_guess || '';
  if (!bankRaw) return { score: 0, method: 'auto-fuzzy' };
  const candLower = String(cand.payee || '').toLowerCase().trim();
  const group = maps.aliasGroups?.get(candLower) || new Set([candLower]);
  // Learned map: raw key first, then the descriptor-normalized key; a hit
  // also matches when the learned name is an ALIAS of the candidate's payee.
  const learned = maps.payeeMap?.[normalizeName(bankRaw)] || maps.payeeMap?.[`~${normalizeBankPayee(bankRaw)}`];
  if (learned && (learned === candLower || group.has(learned))) return { score: 1.0, method: 'auto-learned' };
  // Alias exact: the bank name IS a member of the candidate's alias group.
  const bankLower = bankRaw.toLowerCase().trim();
  if (group.has(bankLower) || group.has(normalizeName(bankRaw))) return { score: 0.95, method: 'auto-alias' };
  // Fuzzy — best score across the payee and every alias in its group.
  let best = { score: 0, method: 'auto-fuzzy' };
  for (const name of group) {
    const v = vendorsMatch(bankRaw, name);
    if (v.score > best.score) best = v;
  }
  return best;
}

// Back-compat string signature (older callers / fixtures).
function nameEvidence(bankPayee, ledgerPayee, payeeMap = {}, aliasMap = {}) {
  const aliasGroups = new Map();
  for (const [alias, canon] of Object.entries(aliasMap)) {
    const set = aliasGroups.get(canon) || new Set([canon]);
    set.add(alias);
    aliasGroups.set(canon, set);
    aliasGroups.set(alias, set);
  }
  return evidence({ payee_guess: bankPayee }, { payee: ledgerPayee }, { payeeMap, aliasGroups });
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
    // Two line shapes: legacy DATE|DIR|AMOUNT|PAYEE|REFERENCE|DESCRIPTION and
    // v2 DATE|DIR|AMOUNT|PAYEE|EMAIL|REFERENCE|DESCRIPTION. Field 5 is an
    // email when it looks like one (or the line is long enough to be v2).
    const [date, dir, amount, payee, ...rest] = parts;
    const d = normalizeDate(date);
    const amt = parseAmount(amount);
    if (!d || amt == null) continue;
    const direction = /credit|cr|deposit|\+/i.test(dir) ? 'credit' : 'debit';
    let email = null, reference, descRest;
    if (rest.length >= 3 || (rest.length >= 1 && EMAIL_RE.test(rest[0]))) {
      email = (rest[0] || '').match(EMAIL_RE)?.[0]?.toLowerCase() || null;
      reference = rest[1];
      descRest = rest.slice(2);
    } else {
      reference = rest[0];
      descRest = rest.slice(1);
    }
    // Emails also arrive mashed into the payee — split them out either way.
    const split = splitPayeeEmail(payee);
    out.push({
      txn_date: d, direction, amount: Math.abs(amt),
      payee_guess: split.payee, payee_email: email || split.email,
      reference: reference || null,
      description: (descRest.join(' | ') || payee || '').trim() || null,
    });
  }
  return out;
}

// Balance header lines from the PDF parse ("ENDING_BALANCE|1234.56" /
// "BEGINNING_BALANCE|1000.00" as the first output lines; empty after the pipe
// when the document doesn't print one). parsePipeLines already skips them
// (no parseable date), so this is a separate, backward-compatible peel-off.
function extractBalanceLines(text) {
  const out = { ending_balance: null, beginning_balance: null };
  for (const raw of String(text || '').split('\n').slice(0, 12)) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^ENDING_BALANCE\s*\|\s*(.*)$/i))) {
      const v = parseAmount(m[1]);
      if (v != null) out.ending_balance = v;
    } else if ((m = line.match(/^BEGINNING_BALANCE\s*\|\s*(.*)$/i))) {
      const v = parseAmount(m[1]);
      if (v != null) out.beginning_balance = v;
    }
  }
  return out;
}

// Best-effort balance capture from a CSV with a running-balance column:
// ending = the balance on the latest-dated row; beginning = the earliest
// row's balance rolled back by that row's own signed amount. NULL when no
// balance column exists — absence is honest, a guess is not.
function extractCsvBalances(text) {
  const none = { ending_balance: null, beginning_balance: null };
  try {
    const rows = splitCsv(text).filter(r => r.some(c => String(c).trim()));
    if (rows.length < 2) return none;
    const hi = findHeader(rows);
    const headers = rows[hi].map(h => String(h).toLowerCase().trim().replace(/\s+/g, ' '));
    const iBal = headers.findIndex(h => /^(running |ledger |current )?balance$/.test(h));
    if (iBal < 0) return none;
    const iDate = col(headers, 'date', 'transaction date', 'posting date');
    const iAmt = col(headers, 'amount', 'gross');
    const iDebit = col(headers, 'debit');
    const iCredit = col(headers, 'credit');
    const parsed = [];
    for (let r = hi + 1; r < rows.length; r++) {
      const cells = rows[r];
      const d = normalizeDate(iDate >= 0 ? cells[iDate] : '');
      const bal = parseAmount(cells[iBal]);
      if (!d || bal == null) continue;
      let signed = null;
      if (iDebit >= 0 || iCredit >= 0) {
        const deb = parseAmount(cells[iDebit]) || 0;
        const cre = parseAmount(cells[iCredit]) || 0;
        signed = cre ? Math.abs(cre) : -Math.abs(deb);
      } else if (iAmt >= 0) {
        signed = parseAmount(cells[iAmt]);
      }
      parsed.push({ d, bal, signed });
    }
    if (!parsed.length) return none;
    parsed.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    const first = parsed[0];
    const last = parsed[parsed.length - 1];
    return {
      ending_balance: last.bal,
      beginning_balance: first.signed != null ? Math.round((first.bal - first.signed) * 100) / 100 : null,
    };
  } catch {
    return none;
  }
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
// Load the learned payee map, vendor aliases (as SYMMETRIC groups), match
// rejections and vendor emails once per statement ingest / detail request.
async function loadMaps(db, labelId) {
  const c = db || pool;
  const pm = await c.query('SELECT bank_payee, ledger_payee FROM statement_payee_map WHERE label_id = $1', [labelId]);
  const payeeMap = {};
  for (const r of pm.rows) {
    const target = String(r.ledger_payee).toLowerCase();
    payeeMap[normalizeName(r.bank_payee)] = target;
    // Descriptor-normalized key (card descriptors vary per charge, so an
    // exact-string map re-learns every FACEBK code). '~' prefix keeps the two
    // key spaces from colliding. Only when the normalized form is meaningful.
    const norm = normalizeBankPayee(r.bank_payee);
    if (norm.length >= 3) payeeMap[`~${norm}`] = target;
  }

  // Aliases as symmetric groups: alias ↔ canonical share ONE Set, so lookups
  // from either name find the whole group.
  const al = await c.query('SELECT alias, canonical FROM vendor_aliases WHERE label_id = $1', [labelId]);
  const aliasGroups = new Map();
  const aliasMap = {}; // kept for back-compat consumers
  for (const r of al.rows) {
    const a = String(r.alias).toLowerCase().trim();
    const canon = String(r.canonical).toLowerCase().trim();
    aliasMap[a] = canon;
    const set = aliasGroups.get(canon) || aliasGroups.get(a) || new Set();
    set.add(a); set.add(canon);
    for (const name of set) aliasGroups.set(name, set);
  }

  // A human's "no" — never re-propose a rejected (txn fingerprint, root) pair.
  let rejections = new Set();
  try {
    const rj = await c.query('SELECT txn_fingerprint, expense_root_id FROM statement_match_rejections WHERE label_id = $1', [labelId]);
    rejections = new Set(rj.rows.map((r) => `${r.txn_fingerprint}::${r.expense_root_id}`));
  } catch { /* table may predate migration */ }

  // Vendor emails — an email match is the strongest evidence a bank carries.
  const emailByVendor = new Map();
  const addEmail = (vendor, email) => {
    const v = String(vendor || '').toLowerCase().trim();
    const e = String(email || '').toLowerCase().trim();
    if (!v || !e) return;
    const set = emailByVendor.get(v) || new Set();
    set.add(e);
    emailByVendor.set(v, set);
  };
  try {
    const ve = await c.query('SELECT vendor_name, email FROM vendor_emails WHERE label_id = $1', [labelId]);
    for (const r of ve.rows) addEmail(r.vendor_name, r.email);
  } catch { /* optional */ }
  try {
    const ee = await c.query(
      `SELECT DISTINCT payee, vendor_email FROM expenses
        WHERE label_id = $1 AND vendor_email IS NOT NULL AND TRIM(vendor_email) <> ''`,
      [labelId]
    );
    for (const r of ee.rows) addEmail(r.payee, r.vendor_email);
  } catch { /* optional */ }

  return { payeeMap, aliasMap, aliasGroups, rejections, emailByVendor };
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
         (e.payment_status = 'Paid' AND e.payment_date BETWEEN $3::date - 7 AND $3::date + 7)
         OR (e.payment_status IN ('Unpaid','Partial') AND (e.invoice_date IS NULL OR e.invoice_date <= $3::date + 5) AND $3::date >= e.invoice_date - 5)
       )${methodClause}`,
    params
  );
  return rows;
}

// Match ONE debit txn against the ledger. Returns {expense_id, method, score}
// or null. `maps` from loadMaps. `used` = Set of family-root ids already
// claimed (seeded from ALL existing claims + per-match adds during a run) —
// layer 1 of one-debit-per-invoice.
async function matchTxn(db, labelId, txn, methods, maps, used = new Set()) {
  if (txn.direction !== 'debit') return null;
  const fp = txnFingerprint(txn);
  const cands = (await candidates(db, labelId, txn, methods))
    .filter(c => !used.has(c.id))
    .filter(c => !maps.rejections || !maps.rejections.has(`${fp}::${c.id}`));
  if (!cands.length) return null;
  const amt = Number(txn.amount);

  // Tier 1 — exact amount.
  const exact = cands.filter(c => Math.abs(Number(c.family_amount) - amt) < 0.01);
  if (exact.length) {
    const scored = exact.map(c => ({ c, ev: evidence(txn, c, maps) }));
    if (exact.length === 1) {
      const best = scored[0];
      if (!txn.payee_guess && !txn.payee_email) {
        // A bare amount-only match is dangerous (the currency-conversion
        // lesson) — but an evidenceDate within 3 days is the missing evidence.
        const d = daysApart(evidenceDate(best.c), dayOf(txn.txn_date));
        if (d != null && d <= 3) return { expense_id: best.c.id, method: 'auto-date', score: 0.85 };
        return null;
      }
      return { expense_id: best.c.id, method: best.ev.method, score: Math.max(best.ev.score, 0.6) };
    }
    scored.sort((a, b) => b.ev.score - a.ev.score);
    if (scored[0].ev.score >= 0.6 && scored[0].ev.score - scored[1].ev.score >= 0.15) {
      return { expense_id: scored[0].c.id, method: scored[0].ev.method, score: scored[0].ev.score };
    }
    // Exact-tier date tiebreak: no name winner → the candidate whose
    // evidenceDate is within 3 days of the bank date, IF the runner-up is
    // 3+ days farther. Requires a non-empty bank payee.
    if (txn.payee_guess) {
      const dated = scored
        .map(x => ({ ...x, d: daysApart(evidenceDate(x.c), dayOf(txn.txn_date)) }))
        .filter(x => x.d != null)
        .sort((a, b) => a.d - b.d);
      if (dated.length && dated[0].d <= 3 && (dated.length < 2 || dated[1].d - dated[0].d >= 3)) {
        return { expense_id: dated[0].c.id, method: 'auto-date', score: 0.8 };
      }
    }
    return null;
  }

  // Tier 2 — fee-tolerant (wires land a fee above the invoice). Name REQUIRED.
  const tol = Math.max(35, amt * 0.01);
  const near = cands
    .map(c => ({ c, delta: amt - Number(c.family_amount), ev: evidence(txn, c, maps) }))
    .filter(x => x.delta >= -0.01 && x.delta <= tol && x.ev.score >= 0.6);
  if (near.length) {
    near.sort((a, b) => b.ev.score - a.ev.score);
    return { expense_id: near[0].c.id, method: 'auto-fee', score: near[0].ev.score };
  }
  return null;
}

// Top-3 suggestions for the "Match…" UI and the review deck.
// score = amount·0.55 + name·0.30 + date·0.15 (0..1; the UI shows ×100).
// Calibration to preserve (asserted by the evidence harness):
//   exact + perfect name stays ≥0.90 whether paid or unpaid, so ≥0.85
//   deck-primary and ≥0.90 auto-accept keep working; amount-only tops out at
//   0.70 — below every automation threshold.
async function suggestions(db, labelId, txn, methods, maps) {
  const cands = await candidates(db, labelId, txn, methods);
  const amt = Number(txn.amount);
  const fp = txnFingerprint(txn);
  const tol = Math.max(35, amt * 0.01);
  const scored = cands
    .filter(c => { const fa = Number(c.family_amount); return fa >= amt * 0.85 && fa <= amt * 1.15; })
    .filter(c => !maps.rejections || !maps.rejections.has(`${fp}::${c.id}`))
    .map(c => {
      const fa = Number(c.family_amount);
      const delta = Math.abs(fa - amt);
      const amountScore = delta < 0.01 ? 1.0 : delta <= tol ? 0.92 : Math.max(0, 1 - delta / amt / 0.15);
      const ev = evidence(txn, c, maps);
      const score = amountScore * 0.55 + ev.score * 0.30 + dateScore(txn, c) * 0.15;
      return {
        expense_id: c.id, payee: c.payee, amount: fa, currency: c.currency,
        invoice_number: c.invoice_number, score: Math.round(score * 1000) / 1000, method: ev.method,
      };
    })
    .sort((a, b) => b.score - a.score);
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
  normalizeName, nameEvidence, evidence, vendorsMatch, isInternal,
  splitPayeeEmail, txnFingerprint, refEvidence, methodOf,
  parsePipeLines, parseCsv, extractPayee,
  extractBalanceLines, extractCsvBalances,
  loadMaps, candidates, matchTxn, suggestions, learnPayee,
};
