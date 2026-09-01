// Deterministic statement parsing — the fast path (ported from boom-dashboard's
// lib/statement-pdf.js, whose layout rules and reconciliation gates are kept
// verbatim; only the TEXT EXTRACTION differs, see below).
//
// The AI path has to WRITE every transaction as output tokens, which is why a
// dense statement takes minutes. Text extraction plus rules does the same job
// in well under a second, because nothing has to be generated.
//
// This is only safe because a statement can be made to prove itself. Every
// parse is checked against the statement's OWN printed figures before it is
// used:
//
//   1. beginning + Σ(signed amounts) = ending          — the whole statement
//   2. Σ(signed amounts in section) = printed section total  — per section
//   3. no orphan records (a date-opened record with no amount)
//
// If any check fails the caller discards this result and falls back to the AI
// parse, so a layout change (or a bad extraction) can only ever cost time,
// never correctness — the worst case is silently losing the fast path.
//
// ── Text extraction: dependency-free, gate-protected ────────────────────────
// boom extracts text with pdfjs-dist; cadence has no PDF dependency and this
// campaign may not add one. So extraction here is a minimal reader built on
// Node's zlib: it inflates FlateDecode content streams, walks the page tree,
// decodes simple/CID fonts via their ToUnicode CMaps, and reconstructs lines
// and columns from Td/Tm positioning with the SAME thresholds boom derived its
// rules against (|Δy| < 4.6 = same line; horizontal gap > 7 = a TAB).
//
// HONEST LIMITATION: this reads digitally-generated, unencrypted PDFs whose
// fonts carry ToUnicode maps (typical bank-generated statements). Scanned
// documents, encrypted files, and fonts with no ToUnicode yield garbage or
// nothing — in which case the reconciliation gate fails and the caller uses
// the AI path (or asks for the CSV). The gate is the whole safety argument.

const zlib = require('zlib');

// Same constants boom's layout rules were derived against.
const LINE_THRESHOLD = 4.6;
const CELL_THRESHOLD = 7;

// ── PDF plumbing ─────────────────────────────────────────────────────────────

function inflate(buf) {
  if (!buf || !buf.length) return null;
  // Trailing EOL before `endstream` is common; zlib tolerates trailing bytes.
  try { return zlib.inflateSync(buf); } catch { /* try raw */ }
  try { return zlib.inflateRawSync(buf); } catch { /* not deflate */ }
  return null;
}

// Scan every `N 0 obj … endobj` in the file. Works without an xref table —
// bank PDFs are linear and regular, and a mis-scan just fails the gate.
function scanObjects(buffer) {
  const s = buffer.toString('latin1');
  const objs = new Map(); // num -> { dict: string, stream: Buffer|null }
  const re = /(?:^|[^\d])(\d+)\s+\d+\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const num = Number(m[1]);
    const start = re.lastIndex;
    const end = s.indexOf('endobj', start);
    if (end < 0) break;
    const body = s.slice(start, end);
    let dict = body;
    let stream = null;
    const si = body.search(/stream\r?\n/);
    if (si >= 0) {
      dict = body.slice(0, si);
      let dataStart = start + si + 'stream'.length;
      if (s[dataStart] === '\r') dataStart++;
      if (s[dataStart] === '\n') dataStart++;
      let dataEnd = s.indexOf('endstream', dataStart);
      if (dataEnd > dataStart) {
        // trim the EOL the writer put before `endstream`
        let e = dataEnd;
        if (s[e - 1] === '\n') e--;
        if (s[e - 1] === '\r') e--;
        stream = buffer.slice(dataStart, e);
      }
    }
    objs.set(num, { dict, stream });
    re.lastIndex = end + 'endobj'.length;
  }
  return { objs, raw: s };
}

// Objects stored inside /ObjStm compressed object streams (modern writers).
function expandObjectStreams(objs) {
  for (const o of [...objs.values()]) {
    if (!/\/Type\s*\/ObjStm\b/.test(o.dict) || !o.stream) continue;
    const data = inflate(o.stream);
    if (!data) continue;
    const text = data.toString('latin1');
    const n = Number((o.dict.match(/\/N\s+(\d+)/) || [])[1] || 0);
    const first = Number((o.dict.match(/\/First\s+(\d+)/) || [])[1] || 0);
    if (!n || !first) continue;
    const header = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const objNum = header[i * 2];
      const off = header[i * 2 + 1];
      if (!Number.isFinite(objNum) || !Number.isFinite(off)) continue;
      const nextOff = i + 1 < n ? header[(i + 1) * 2 + 1] : text.length - first;
      const body = text.slice(first + off, first + nextOff);
      if (!objs.has(objNum)) objs.set(objNum, { dict: body, stream: null });
    }
  }
}

// Read the value that follows /Key in a dict string: an indirect ref, a name,
// a number, a balanced [array] or <<dict>>. Returns the raw token string.
function dictValue(dict, key) {
  const i = dict.search(new RegExp(`/${key}(?![A-Za-z0-9])`));
  if (i < 0) return null;
  let j = i + key.length + 1;
  while (j < dict.length && /\s/.test(dict[j])) j++;
  const ch = dict[j];
  if (ch === '[' || ch === '<') {
    const open = ch === '[' ? '[' : '<';
    const close = ch === '[' ? ']' : '>';
    let depth = 0;
    let k = j;
    for (; k < dict.length; k++) {
      if (dict[k] === open) depth++;
      else if (dict[k] === close) { depth--; if (depth === 0) { k++; break; } }
    }
    return dict.slice(j, k);
  }
  const m = dict.slice(j).match(/^(\d+\s+\d+\s+R|\/?[^\s/<>[\]()]+)/);
  return m ? m[0] : null;
}

const refNum = (tok) => {
  const m = String(tok || '').match(/^(\d+)\s+\d+\s+R$/);
  return m ? Number(m[1]) : null;
};

// Resolve a token to a dict string (following one level of indirection).
function resolveDict(objs, tok) {
  if (tok == null) return null;
  const n = refNum(tok);
  if (n != null) return objs.get(n) ? objs.get(n).dict : null;
  return String(tok);
}

// ── ToUnicode CMaps ──────────────────────────────────────────────────────────

const hexToStr = (hex) => {
  let out = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  if (hex.length % 4 === 2) out += String.fromCharCode(parseInt(hex.slice(-2), 16));
  return out;
};

function parseCMap(text) {
  const map = new Map();
  let codeBytes = 1;
  const cs = text.match(/begincodespacerange\s*<([0-9A-Fa-f]+)>/);
  if (cs) codeBytes = Math.max(1, Math.round(cs[1].length / 2));
  for (const m of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(p[1], 16), hexToStr(p[2]));
    }
  }
  for (const m of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const r of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[((?:\s*<[0-9A-Fa-f]+>)+)\s*\])/g)) {
      const lo = parseInt(r[1], 16);
      const hi = parseInt(r[2], 16);
      if (hi - lo > 65535) continue;
      if (r[4]) {
        const targets = [...r[4].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => hexToStr(x[1]));
        for (let c = lo; c <= hi && c - lo < targets.length; c++) map.set(c, targets[c - lo]);
      } else if (r[3]) {
        const base = parseInt(r[3], 16);
        for (let c = lo; c <= hi; c++) map.set(c, String.fromCharCode(base + (c - lo)));
      }
    }
  }
  return map.size ? { map, codeBytes } : null;
}

// Build /F-name → decoder for one page's /Resources.
function pageFonts(objs, resourcesTok) {
  const fonts = {};
  const resDict = resolveDict(objs, resourcesTok);
  if (!resDict) return fonts;
  const fontDict = resolveDict(objs, dictValue(resDict, 'Font'));
  if (!fontDict) return fonts;
  for (const m of fontDict.matchAll(/\/([A-Za-z0-9.+-]+)\s+(\d+)\s+\d+\s+R/g)) {
    const name = m[1];
    const fobj = objs.get(Number(m[2]));
    if (!fobj) continue;
    const twoByte = /\/Subtype\s*\/Type0\b/.test(fobj.dict);
    let cmap = null;
    const tuNum = refNum(dictValue(fobj.dict, 'ToUnicode'));
    if (tuNum != null && objs.get(tuNum) && objs.get(tuNum).stream) {
      const data = inflate(objs.get(tuNum).stream) || objs.get(tuNum).stream;
      cmap = parseCMap(data.toString('latin1'));
    }
    fonts[name] = { twoByte, cmap };
  }
  return fonts;
}

// ── Page tree ────────────────────────────────────────────────────────────────

function pageOrder(objs) {
  // Walk Catalog → Pages → Kids for true reading order; fall back to
  // object-number order of every /Type /Page dict.
  let rootPages = null;
  for (const o of objs.values()) {
    if (/\/Type\s*\/Catalog\b/.test(o.dict)) { rootPages = refNum(dictValue(o.dict, 'Pages')); break; }
  }
  const ordered = [];
  const walk = (num, depth) => {
    if (depth > 50) return;
    const o = objs.get(num);
    if (!o) return;
    if (/\/Type\s*\/Page\b(?!s)/.test(o.dict)) { ordered.push(num); return; }
    const kids = dictValue(o.dict, 'Kids');
    if (!kids) return;
    for (const k of String(kids).matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(k[1]), depth + 1);
  };
  if (rootPages != null) walk(rootPages, 0);
  if (ordered.length) return ordered;
  return [...objs.entries()].filter(([, o]) => /\/Type\s*\/Page\b(?!s)/.test(o.dict)).map(([n]) => n).sort((a, b) => a - b);
}

function pageContent(objs, pageDict) {
  const tok = dictValue(pageDict, 'Contents');
  if (!tok) return null;
  const nums = [...String(tok).matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
  const parts = [];
  for (const n of nums) {
    const o = objs.get(n);
    if (!o || !o.stream) continue;
    const data = inflate(o.stream) || (!/\/Filter/.test(o.dict) ? o.stream : null);
    if (data) parts.push(data.toString('latin1'));
  }
  return parts.length ? parts.join('\n') : null;
}

// ── Content-stream interpretation ────────────────────────────────────────────

function decodeLiteral(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out += c; continue; }
    const n = s[++i];
    if (n === 'n') out += '\n';
    else if (n === 'r') out += '\r';
    else if (n === 't') out += '\t';
    else if (n === 'b' || n === 'f') out += '';
    else if (n === '\n') { /* line continuation */ }
    else if (n === '\r') { if (s[i + 1] === '\n') i++; }
    else if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(s[i + 1])) oct += s[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else out += n;
  }
  return out;
}

function decodeWithFont(raw, font, isHex) {
  // raw: latin1 byte string (literal already unescaped) or hex digits.
  const bytes = [];
  if (isHex) {
    const h = raw.replace(/[^0-9A-Fa-f]/g, '');
    for (let i = 0; i + 2 <= h.length; i += 2) bytes.push(parseInt(h.slice(i, i + 2), 16));
    if (h.length % 2) bytes.push(parseInt(h.slice(-1) + '0', 16));
  } else {
    for (let i = 0; i < raw.length; i++) bytes.push(raw.charCodeAt(i) & 0xff);
  }
  const width = font && (font.twoByte || (font.cmap && font.cmap.codeBytes === 2)) ? 2 : 1;
  let out = '';
  for (let i = 0; i < bytes.length; i += width) {
    const code = width === 2 ? (bytes[i] << 8) | (bytes[i + 1] || 0) : bytes[i];
    if (font && font.cmap && font.cmap.map.has(code)) out += font.cmap.map.get(code);
    else if (width === 1) out += String.fromCharCode(code); // WinAnsi ≈ latin1 for the ASCII range we need
    // else: unmapped CID — drop (better a hole that fails the gate than noise)
  }
  return out;
}

// Interpret one page's content: emit positioned text items.
function runContent(content, fonts, items) {
  let i = 0;
  const len = content.length;
  const stack = [];
  let font = null;
  let size = 0;
  let leading = 0;
  let tm = [1, 0, 0, 1, 0, 0]; // current text matrix (a b c d e f)
  let lm = [1, 0, 0, 1, 0, 0]; // line matrix

  const setBoth = (m) => { tm = m.slice(); lm = m.slice(); };
  const td = (tx, ty) => {
    lm = [lm[0], lm[1], lm[2], lm[3], lm[0] * tx + lm[2] * ty + lm[4], lm[1] * tx + lm[3] * ty + lm[5]];
    tm = lm.slice();
  };
  const show = (str) => {
    if (!str) return;
    items.push({ str, x: tm[4], y: tm[5], size: Math.abs(size * (tm[3] || 1)) || 10 });
    const w = str.length * (size || 10) * 0.5;
    tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + w * (tm[0] || 1), tm[5]];
  };

  const flushOp = (op) => {
    try {
      if (op === 'BT') { setBoth([1, 0, 0, 1, 0, 0]); }
      else if (op === 'Tf') { size = Number(stack[stack.length - 1]) || 0; const name = String(stack[stack.length - 2] || '').replace(/^\//, ''); font = fonts[name] || null; }
      else if (op === 'TL') { leading = Number(stack[stack.length - 1]) || 0; }
      else if (op === 'Td') { td(Number(stack[stack.length - 2]) || 0, Number(stack[stack.length - 1]) || 0); }
      else if (op === 'TD') { leading = -(Number(stack[stack.length - 1]) || 0); td(Number(stack[stack.length - 2]) || 0, Number(stack[stack.length - 1]) || 0); }
      else if (op === 'Tm') { setBoth(stack.slice(-6).map(Number)); }
      else if (op === 'T*') { td(0, -leading); }
      else if (op === 'Tj') { show(stack.pop()); }
      else if (op === "'") { td(0, -leading); show(stack.pop()); }
      else if (op === '"') { const s = stack.pop(); td(0, -leading); show(s); }
      else if (op === 'TJ') {
        const arr = stack.pop();
        if (Array.isArray(arr)) {
          for (const el of arr) {
            if (typeof el === 'string') show(el);
            else if (typeof el === 'number' && el < -180) {
              // large negative displacement = intra-cell gap; a space keeps
              // "05/12/26" and its descriptor from fusing into one token
              items.push({ str: ' ', x: tm[4], y: tm[5], size: size || 10 });
              tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + (size || 10) * 0.5, tm[5]];
            }
          }
        }
      }
    } catch { /* one bad operator must not kill the page */ }
    stack.length = 0;
  };

  let arr = null; // open TJ array accumulator
  while (i < len) {
    const c = content[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '%') { while (i < len && content[i] !== '\n') i++; continue; }
    if (c === '(') {
      // literal string with nesting + escapes
      let depth = 0;
      let j = i;
      let out = '';
      for (; j < len; j++) {
        const ch = content[j];
        if (ch === '\\') { out += ch + (content[j + 1] || ''); j++; continue; }
        if (ch === '(') { depth++; if (depth === 1) continue; }
        if (ch === ')') { depth--; if (depth === 0) { j++; break; } }
        out += ch;
      }
      i = j;
      const decoded = decodeWithFont(decodeLiteral(out), font, false);
      if (arr) arr.push(decoded); else stack.push(decoded);
      continue;
    }
    if (c === '<' && content[i + 1] === '<') { // inline dict — skip balanced
      let depth = 0;
      let j = i;
      for (; j < len - 1; j++) {
        if (content[j] === '<' && content[j + 1] === '<') { depth++; j++; }
        else if (content[j] === '>' && content[j + 1] === '>') { depth--; j++; if (!depth) { j++; break; } }
      }
      i = j;
      continue;
    }
    if (c === '<') {
      const j = content.indexOf('>', i);
      const decoded = decodeWithFont(content.slice(i + 1, j < 0 ? len : j), font, true);
      if (arr) arr.push(decoded); else stack.push(decoded);
      i = (j < 0 ? len : j + 1);
      continue;
    }
    if (c === '[') { arr = []; i++; continue; }
    if (c === ']') { stack.push(arr || []); arr = null; i++; continue; }
    if (c === '/') {
      const m = content.slice(i).match(/^\/[^\s/<>[\]()%]*/);
      const tok = m ? m[0] : '/';
      if (arr) arr.push(tok); else stack.push(tok);
      i += tok.length;
      continue;
    }
    const m = content.slice(i, i + 64).match(/^[^\s/<>[\]()%]+/);
    if (!m) { i++; continue; }
    const tok = m[0];
    i += tok.length;
    if (/^[+-]?\.?\d/.test(tok)) {
      const num = Number(tok);
      if (arr) arr.push(num); else stack.push(num);
      continue;
    }
    if (arr) continue; // operators never appear inside a TJ array
    flushOp(tok);
  }
}

// Line/column reconstruction — reproduces boom's assemblePageText (itself a
// port of pdf-parse's defaults, which the layout rules were derived against).
function assemblePageText(items) {
  const buf = [];
  let lastX;
  let lastY;
  let lineHeight = 0;
  for (const item of items) {
    if (lastY !== undefined && Math.abs(lastY - item.y) > LINE_THRESHOLD) {
      const prev = buf.length ? buf[buf.length - 1] : undefined;
      if (prev !== undefined && !prev.endsWith('\n')) {
        if (Math.abs(lastY - item.y) - 1 > lineHeight) { buf.push('\n'); lineHeight = 0; }
      }
    }
    let str = item.str;
    if (lastY !== undefined && Math.abs(lastY - item.y) < LINE_THRESHOLD
        && lastX !== undefined && Math.abs(lastX - item.x) > CELL_THRESHOLD && item.x > lastX) {
      str = `\t${str}`;
    }
    buf.push(str);
    lastX = item.x + item.str.length * item.size * 0.5;
    lastY = item.y;
    lineHeight = Math.max(lineHeight, item.size || 0);
    if (item.str.endsWith('\n')) lineHeight = 0;
  }
  return buf.join('');
}

/**
 * Extract plain text from a PDF buffer. Returns '' when the file is
 * encrypted, scanned, or otherwise unreadable — the caller's gate treats
 * that as "no fast path", never as data.
 */
function extractPdfText(buffer) {
  try {
    if (!buffer || buffer.slice(0, 5).toString() !== '%PDF-') return '';
    const { objs, raw } = scanObjects(buffer);
    // Encrypted documents: string/stream bytes are ciphertext — bail.
    if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(raw)) return '';
    expandObjectStreams(objs);
    const pages = pageOrder(objs);
    const out = [];
    for (const num of pages) {
      const page = objs.get(num);
      if (!page) continue;
      const content = pageContent(objs, page.dict);
      if (!content) continue;
      const fonts = pageFonts(objs, dictValue(page.dict, 'Resources'));
      const items = [];
      runContent(content, fonts, items);
      if (items.length) out.push(assemblePageText(items));
    }
    return out.join('\n');
  } catch {
    return '';
  }
}

// ── From here down: boom's layout parsers + reconciliation gates, verbatim ───

const money = (s) => {
  const str = String(s).replace(/[$,\s ]/g, '');
  if (!/^-?\d*\.?\d+$/.test(str)) return null;
  const n = parseFloat(str);
  return Number.isFinite(n) ? n : null;
};

const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

// BofA prints MM/DD/YY. The century is unambiguous for statement dates.
const toIso = (mdy) => {
  const m = String(mdy).trim().match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (!m) return null;
  const [, mm, dd, yy] = m;
  const year = yy.length === 4 ? yy : `20${yy}`;
  return `${year}-${mm}-${dd}`;
};

const MONEY_FIELD = /^-?\$?[\d,]+\.\d{2}$/;
const DATE_FIELD = /^\d{2}\/\d{2}\/\d{2,4}$/;

// Which table a line belongs to. Rows are only collected inside the four
// transaction sections; the "Daily ledger balances" table, whose rows look
// just like transactions, is skipped. Section headers are bare — the same
// words followed by a tab and a figure are the account-summary block.
function sectionOf(line) {
  const l = line.trim().toLowerCase().replace(/\s*-\s*continued$/, '');
  if (/^deposits and other credits$/.test(l)) return 'deposits';
  if (/^withdrawals and other debits$/.test(l)) return 'withdrawals';
  if (/^checks$/.test(l)) return 'checks';
  if (/^service fees$/.test(l)) return 'fees';
  if (/^daily ledger balances/.test(l)) return 'ledger-balances';
  if (/^total (deposits|withdrawals|checks|service)/.test(l)) return 'end-of-section';
  return null;
}

// Page furniture that lands mid-record when a transaction straddles a page
// break. The reconciliation gate is what actually protects the amounts.
const NOISE = [
  /^page \d+ of \d+$/i,
  /^date\b.*description.*amount$/i,
  /^your checking account/i,
  /^account ?#? ?[\d\s-]{6,}$/i,
  /^continued on the next page/i,
  /^subtotal for card account/i,
  /\baccount ?#\s*[\d\s-]{6,}.*\b[a-z]+ \d{1,2}, \d{4}\s+to\s+[a-z]+ \d{1,2}, \d{4}/i,
];
const isNoise = (l) => NOISE.some((re) => re.test(l));

/**
 * A transaction is NOT one line — long descriptors wrap, and the amount
 * frequently sits alone on the last line. Records are accumulated: a line
 * whose first field is a date opens one, and everything up to the next date
 * line belongs to it. The amount is the LAST whole-field money token.
 */
function parseBofaText(text) {
  const lines = String(text)
    .split('\n')
    .map((l) => l.replace(/ /g, ' '))
    .filter((l) => l.trim());

  let beginningBalance = null;
  let endingBalance = null;
  const printed = { deposits: null, withdrawals: null, checks: null, fees: null };

  for (const raw of lines) {
    const l = raw.trim();
    if (!l.includes('\t')) continue;
    const last = l.split('\t').pop().trim();
    if (!MONEY_FIELD.test(last)) continue;
    if (beginningBalance == null && /^beginning balance/i.test(l)) beginningBalance = money(last);
    else if (/^ending balance/i.test(l)) endingBalance = money(last) ?? endingBalance;
    else if (printed.deposits == null && /^(total )?deposits and other credits/i.test(l)) printed.deposits = money(last);
    else if (printed.withdrawals == null && /^(total )?withdrawals and other debits/i.test(l)) printed.withdrawals = money(last);
    else if (printed.checks == null && /^(total )?checks/i.test(l)) printed.checks = money(last);
    else if (printed.fees == null && /^(total )?service fees/i.test(l)) printed.fees = money(last);
  }

  if (beginningBalance == null || endingBalance == null) return null;

  const rows = [];
  let orphans = 0;
  let section = null;
  let open = null;

  const flush = () => {
    if (!open) return;
    const rec = open;
    open = null;
    const moneyIdx = rec.fields
      .map((f, i) => (MONEY_FIELD.test(f) ? i : -1))
      .filter((i) => i >= 0)
      .pop();
    const signed = moneyIdx == null ? null : money(rec.fields[moneyIdx]);
    if (signed == null) { orphans++; return; }
    if (signed === 0) return;
    const description = rec.fields
      .filter((_, i) => i !== moneyIdx)
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    rows.push({
      txn_date: rec.date,
      description: description.slice(0, 500),
      payee_guess: '', // filled by the caller's descriptor cleaner
      payee_email: null,
      amount: Math.abs(signed),
      signed,
      section: rec.section,
      direction: signed < 0 ? 'debit' : 'credit',
      currency: 'USD',
      amount_usd: null,
      reference: '',
      fee: null,
    });
  };

  for (const raw of lines) {
    const l = raw.trim();
    const sec = sectionOf(l);
    if (sec) {
      if (sec === 'end-of-section') { flush(); continue; }
      if (sec !== section) { flush(); section = sec; }
      continue;
    }
    if (!section || section === 'ledger-balances') continue;
    if (isNoise(l)) continue;

    const parts = l.split('\t').map((p) => p.trim()).filter(Boolean);
    if (!parts.length) continue;

    if (DATE_FIELD.test(parts[0])) {
      flush();
      const iso = toIso(parts[0]);
      if (!iso) continue;
      open = { date: iso, fields: parts.slice(1), section };
    } else if (open) {
      open.fields.push(...parts);
    }
  }
  flush();

  if (!rows.length) return null;
  return { rows, beginningBalance, endingBalance, printed, orphans };
}

// ── PayPal Monthly Statement Report ─────────────────────────────────────────
// Proves itself per currency: Activity Summary brackets (Beginning/Ending
// Available Balance) against the summed rows of each Transaction History
// table. Component rows are SUMMED, never enumerated by name.

const CUR_HEADER = /^([A-Z]{3}(?:\s+[A-Z]{3})*)$/;
const PP_NUM = '-?\\(?\\$?[\\d,]+(?:\\.\\d{2})?\\)?';
const PP_LABEL_ROW = new RegExp(`^([A-Za-z][A-Za-z ,&/\\\\-]*?)\\s+((?:${PP_NUM})(?:\\s+${PP_NUM})*)\\s*$`);
const PP_TRIPLE = new RegExp(`(${PP_NUM})\\s+(${PP_NUM})\\s+(${PP_NUM})\\s*$`);
const PP_HISTORY = /^Transaction History\s*[-–]\s*([A-Z]{3})\b/i;
const PP_DATE = /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(.*)$/;
const PP_FURNITURE = /^(Merchant Account ID|Page \d+$|Date\s+Descript|Total\b|Statement for |Balance Summary|Activity Summary)/i;

const ppNum = (s) => {
  const neg = /^\(.*\)$/.test(String(s).trim());
  const n = Number(String(s).replace(/[()$,\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
};

const ppIso = (mdy) => {
  const m = String(mdy).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const yy = m[3].length === 4 ? m[3] : `20${m[3]}`;
  return `${yy}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
};

function paypalActivitySummary(lines) {
  const per = {};
  let cols = null;
  let inSummary = false;
  for (const raw of lines) {
    const l = raw.trim();
    if (/^Activity Summary/i.test(l)) { inSummary = true; cols = null; continue; }
    if (!inSummary) continue;

    const c = l.match(CUR_HEADER);
    if (c) { cols = c[1].split(/\s+/); continue; }
    if (!cols) continue;

    const m = l.match(PP_LABEL_ROW);
    if (!m) continue;
    const label = m[1].trim().toLowerCase();
    const vals = m[2].trim().split(/\s+/).map(ppNum);
    if (vals.length !== cols.length) continue;

    cols.forEach((cur, i) => {
      const v = vals[i];
      if (v == null) return;
      const slot = (per[cur] ||= { beginning: null, ending: null, components: 0, rows: 0 });
      if (/^beginning available balance/.test(label)) slot.beginning = v;
      else if (/^ending available balance/.test(label)) slot.ending = v;
      else { slot.components += v; slot.rows++; }
    });
  }
  for (const [cur, v] of Object.entries(per)) {
    if (v.beginning == null || v.ending == null) delete per[cur];
  }
  return per;
}

function parsePaypalText(text) {
  const lines = String(text)
    .split('\n')
    .map((l) => l.replace(/ /g, ' ').replace(/\t/g, ' ').trim())
    .filter(Boolean);

  const summary = paypalActivitySummary(lines);
  if (!Object.keys(summary).length) return null;

  const rows = [];
  let currency = null;
  let open = null;
  let orphans = 0;

  const flush = () => {
    if (!open) return;
    const rec = open;
    open = null;
    let hit = null;
    for (let i = rec.parts.length - 1; i >= 0 && !hit; i--) {
      const m = rec.parts[i].match(PP_TRIPLE);
      if (m) hit = { i, m };
    }
    if (!hit) { orphans++; return; }
    const gross = ppNum(hit.m[1]);
    const fee = ppNum(hit.m[2]);
    const net = ppNum(hit.m[3]);
    if (gross == null || net == null) { orphans++; return; }

    const text0 = rec.parts
      .map((p, i) => (i === hit.i ? p.slice(0, p.length - hit.m[0].length) : p))
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const email = (text0.match(/[\w.+-]+@[\w.-]+\.\w+/) || [null])[0];
    const ref = (text0.match(/\bID:\s*([A-Z0-9]+)/i) || [null, null])[1];

    // AMOUNT IS GROSS (what the counterparty was paid); the GATE uses net,
    // because net is what moves the balance. Kept apart deliberately.
    rows.push({
      txn_date: ppIso(rec.date),
      description: text0.slice(0, 500),
      payee_guess: '',
      payee_email: email,
      amount: Math.abs(gross),
      net,
      currency: rec.currency,
      direction: net < 0 ? 'debit' : 'credit',
      amount_usd: null,
      reference: ref ? ref.slice(0, 120) : null,
      fee: fee == null ? null : Math.abs(fee),
    });
  };

  for (const l of lines) {
    const th = l.match(PP_HISTORY);
    if (th) { flush(); currency = th[1].toUpperCase(); continue; }
    if (PP_FURNITURE.test(l)) { if (/^Total\b/i.test(l)) flush(); continue; }
    if (!currency) continue;

    const dm = l.match(PP_DATE);
    if (dm) { flush(); open = { date: dm[1], currency, parts: dm[2] ? [dm[2]] : [] }; continue; }
    if (open) open.parts.push(l);
  }
  flush();

  if (!rows.filter((r) => r.txn_date).length) return null;
  return { rows: rows.filter((r) => r.txn_date), summary, orphans };
}

/**
 * PayPal gate: for every currency, the parsed rows must move the balance
 * exactly as the statement says it moved.
 */
function verifyPaypal(parsed, tolerance = 0.02) {
  const { rows, summary, orphans } = parsed;
  const checks = [];
  const byCurrency = {};

  for (const [cur, s] of Object.entries(summary)) {
    const mine = rows.filter((r) => r.currency === cur);
    const netSum = mine.reduce((t, r) => t + r.net, 0);
    const tol = mine.some((r) => !Number.isInteger(r.net)) ? tolerance : Math.max(tolerance, 1);
    const rowDelta = s.ending - (s.beginning + netSum);
    const sumDelta = s.ending - (s.beginning + s.components);
    byCurrency[cur] = { rows: mine.length, row_delta: round2(rowDelta), summary_delta: round2(sumDelta) };
    if (!mine.length && Math.abs(s.components) <= tol) continue;
    checks.push({ name: `${cur}-rows`, ok: Math.abs(rowDelta) <= tol, delta: round2(rowDelta) });
    checks.push({ name: `${cur}-summary`, ok: Math.abs(sumDelta) <= tol, delta: round2(sumDelta) });
  }

  checks.push({ name: 'orphans', ok: !orphans, count: orphans });
  if (!checks.some((c) => c.name.endsWith('-rows'))) {
    checks.push({ name: 'no-verifiable-currency', ok: false });
  }

  const failed = checks.filter((c) => !c.ok);
  return {
    ok: failed.length === 0,
    checks,
    byCurrency,
    rowCount: rows.length,
    reason: failed.length ? `failed: ${failed.map((f) => f.name).join(', ')}` : null,
  };
}

/**
 * Verify a BofA-shaped parse against the statement's own printed figures.
 * Returns { ok, checks, reason } — ok:false means DISCARD and use the AI path.
 */
function verifyAgainstPrinted(parsed, tolerance = 0.02) {
  const { rows, beginningBalance, endingBalance, printed, orphans } = parsed;
  const net = rows.reduce((s, r) => s + r.signed, 0);
  const checks = [];

  const delta = endingBalance - (beginningBalance + net);
  checks.push({ name: 'balance', ok: Math.abs(delta) <= tolerance, delta: round2(delta) });

  for (const [key, section] of [['deposits', 'deposits'], ['withdrawals', 'withdrawals'], ['checks', 'checks'], ['fees', 'fees']]) {
    if (printed[key] == null) continue;
    const got = rows.filter((r) => r.section === section).reduce((s, r) => s + r.signed, 0);
    const d = got - printed[key];
    checks.push({ name: key, ok: Math.abs(d) <= tolerance, delta: round2(d) });
  }

  checks.push({ name: 'orphans', ok: !orphans, count: orphans });

  const failed = checks.filter((c) => !c.ok);
  return {
    ok: failed.length === 0,
    checks,
    rowCount: rows.length,
    reason: failed.length ? `failed: ${failed.map((f) => f.name).join(', ')}` : null,
  };
}

/**
 * Fast-path entry point. Account-agnostic (cadence accounts are per-label):
 * both layouts are tried; whichever parses AND reconciles wins.
 * @returns {null}                    unreadable / no recognised layout
 * @returns {{ok:false, verdict}}     parsed but didn't reconcile (use the AI)
 * @returns {{ok:true, verdict, rows, beginningBalance, endingBalance, layout}}
 */
function parseStatementText(buffer) {
  const text = extractPdfText(buffer);
  if (!text || text.trim().length < 40) return null;

  const pp = parsePaypalText(text);
  if (pp) {
    const verdict = verifyPaypal(pp);
    if (!verdict.ok) return { ok: false, verdict };
    const rows = pp.rows.map(({ net, ...row }) => row);
    // A PayPal balance is normally swept to the bank, so 0.00 brackets are
    // real. Report the USD bracket when there is one.
    const usd = pp.summary.USD || {};
    return { ok: true, verdict, rows, beginningBalance: usd.beginning ?? null, endingBalance: usd.ending ?? null, layout: 'paypal' };
  }

  const bofa = parseBofaText(text);
  if (!bofa) return null;
  const verdict = verifyAgainstPrinted(bofa);
  if (!verdict.ok) return { ok: false, verdict };
  const rows = bofa.rows.map(({ signed, section, ...row }) => row);
  return { ok: true, verdict, rows, beginningBalance: bofa.beginningBalance, endingBalance: bofa.endingBalance, layout: 'bofa' };
}

module.exports = {
  parseStatementText, extractPdfText,
  parseBofaText, verifyAgainstPrinted,
  parsePaypalText, verifyPaypal, paypalActivitySummary,
};
