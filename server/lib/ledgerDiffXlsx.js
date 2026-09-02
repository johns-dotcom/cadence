// The ExcelJS half of Bookkeeper Reconcile: reading the outside workbook, and
// writing the report that goes back.
//
// Kept apart from lib/ledgerDiff.js so the matching rules stay pure and
// fixture-held. Everything here is I/O shape — cell variants, header guessing,
// column widths — none of it decides what disagrees with what.
//
// exceljs is the app's only spreadsheet library on purpose: the `xlsx` package
// was removed in the security pass (prototype pollution / ReDoS on crafted
// workbooks) and must not come back. This file reads a file an outside party
// produced, which is exactly the threat model that removal was about.

const ExcelJS = require('exceljs');
const { DIFF_CATEGORIES, rowDollarDelta, topVendors, ymd } = require('./ledgerDiff');
const { TIERS } = require('./vendorMatch');

// A crafted workbook must not be able to make the server chew through millions
// of rows. Matches the ledger's own bulk-import ceiling.
const MAX_SHEET_ROWS = 20000;

// ── Reading ──────────────────────────────────────────────────────────────────

// ExcelJS hands back four different shapes for a cell depending on whether it
// holds a formula, rich text, a hyperlink or a date. Flatten them all.
const cellText = (cell) => {
  let v = cell?.value;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (v && typeof v === 'object') {
    if ('result' in v) v = v.result;
    else if ('text' in v) v = v.text;
    else if ('richText' in v) v = (v.richText || []).map((r) => r.text).join('');
    else if ('hyperlink' in v) v = v.text || v.hyperlink;
  }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  return String(v ?? '').trim();
};

// Accounting formats: "$1,234.00", "(500.00)" for a negative, stray symbols.
const cellAmount = (cell) => {
  const t = cellText(cell);
  if (!t) return null;
  const cleaned = t.replace(/[,$£€¥]/g, '').replace(/[()]/g, '-').replace(/[^0-9.-]/g, '').trim();
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
};

// The real header is rarely row 1 — these workbooks open with a title block and
// a week-ending line. Score the first 20 rows on how many finance-ish words
// they contain and take the best, requiring at least two so a stray sentence
// cannot win.
// NOTE — `ws.rowCount`, never `ws.actualRowCount`. ExcelJS's actualRowCount is
// a COUNT of non-empty rows; rowCount is the highest row NUMBER. These
// workbooks open with a title block that includes at least one blank row, so
// using the count as an upper bound silently walks off the end — it costs you
// exactly as many trailing data rows as there are blank rows above them, with
// no error anywhere. Found live: the last row of a real sheet vanished.
function detectHeaderRow(ws) {
  const max = Math.min(20, ws.rowCount || 0);
  let best = { row: 0, score: 0 };
  for (let r = 1; r <= max; r++) {
    const row = ws.getRow(r);
    const values = [];
    row.eachCell({ includeEmpty: false }, (c) => values.push(cellText(c)));
    if (values.length < 2) continue;
    if (new Set(values).size === 1) continue;      // a merged banner
    if (values.some((v) => v.length > 80)) continue; // a paragraph, not a header
    let score = 0;
    for (const v of values) {
      if (/\b(vendor|payee|invoice|inv|amount|date|artist|description|notes?|paid|approval|priority)\b/i.test(v)) score++;
    }
    if (score > best.score) best = { row: r, score };
  }
  return best.score >= 2 ? best.row : 0;
}

function findColumns(headerRow) {
  const map = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const t = cellText(cell).toLowerCase();
    if (!t) return;
    if (!map.payee_name && /\bpayee\s*name\b/.test(t)) map.payee_name = col;
    else if (!map.vendor && /\b(vendor|supplier|company|payee)\b/.test(t)) map.vendor = col;
    if (!map.invoice && (/\binvoice\s*#/.test(t) || /\binvoice\s*(num|number|no)\b/.test(t) || /^inv\b/.test(t))) map.invoice = col;
    if (!map.amount && /\bamount\b/.test(t) && !/paid/.test(t)) map.amount = col;
    if (!map.artist && /\bartist\b/.test(t)) map.artist = col;
    if (!map.description && /\b(description|memo|notes?)\b/.test(t)) map.description = col;
    if (!map.invoice_date && /\b(invoice\s*date|date\s*rec'?d|date\s*received)\b/.test(t)) map.invoice_date = col;
  });
  // A two-column PAID block ("DATE" + "AMOUNT") often sits UNDER a merged
  // "PAID" parent header, so its labels are one row down.
  const sub = headerRow.worksheet.getRow(headerRow.number + 1);
  sub.eachCell({ includeEmpty: false }, (cell, col) => {
    const t = cellText(cell).toLowerCase();
    if (!map.paid_date && t === 'date') map.paid_date = col;
    if (!map.paid_amount && t === 'amount') map.paid_amount = col;
  });
  return map;
}

// "WEEK ENDING <date>" in the title block. It caps the reverse direction: an
// invoice filed after the bookkeeper took their snapshot is not missing from
// their sheet, it is newer than their sheet.
function findWeekEnding(wb) {
  for (const ws of wb.worksheets) {
    const max = Math.min(20, ws.rowCount || 0);
    for (let r = 1; r <= max; r++) {
      const row = ws.getRow(r);
      let found = null;
      row.eachCell({ includeEmpty: false }, (cell, col) => {
        if (found) return;
        const t = cellText(cell);
        if (!t || !/week\s*ending/i.test(t)) return;
        // The date may be inline ("WEEK ENDING 2026-06-30") or in the next cell.
        const inline = t.match(/(\d{4}-\d{2}-\d{2})/);
        if (inline) { found = inline[1]; return; }
        for (let c = col + 1; c <= row.cellCount; c++) {
          const tt = cellText(row.getCell(c));
          if (/^\d{4}-\d{2}-\d{2}/.test(tt)) { found = tt.slice(0, 10); return; }
        }
      });
      if (found) return found;
    }
  }
  return null;
}

/** @returns { rows, sheets_skipped, sheets_processed, sheet_years, week_ending, truncated } */
function parseBookkeeperWorkbook(wb) {
  const rows = [];
  const skipped = [];
  const years = new Set();
  let truncated = false;

  for (const ws of wb.worksheets) {
    const name = ws.name || '';
    const y = name.match(/\b(20\d\d)\b/);
    if (y) years.add(Number(y[1]));
    if (/^(sum|summary|totals?|grand\s*total)$/i.test(name.trim())) {
      skipped.push({ sheet: name, reason: 'A summary / totals tab — it carries no invoice rows.' });
      continue;
    }
    const headerIdx = detectHeaderRow(ws);
    if (!headerIdx) { skipped.push({ sheet: name, reason: 'No header row found in the first 20 rows.' }); continue; }
    const cols = findColumns(ws.getRow(headerIdx));
    if (!cols.vendor || !cols.invoice) {
      skipped.push({ sheet: name, reason: 'Could not find both a vendor/payee column and an invoice-number column.' });
      continue;
    }
    // Step past the PAID sub-header row when there is one.
    const subVals = [];
    ws.getRow(headerIdx + 1).eachCell({ includeEmpty: false }, (c) => subVals.push(cellText(c).toLowerCase()));
    const isSub = subVals.some((v) => v === 'date' || v === 'amount' || v === 'via');
    const first = headerIdx + (isSub ? 2 : 1);
    const end = ws.rowCount || 0;
    const last = Math.min(end, first + MAX_SHEET_ROWS);
    if (end > last) truncated = true;

    for (let r = first; r <= last; r++) {
      const row = ws.getRow(r);
      const vendor = cellText(row.getCell(cols.vendor));
      const invoice = cellText(row.getCell(cols.invoice));
      if (!vendor && !invoice) continue;
      rows.push({
        sheet: name, rowNum: r, vendor, invoice,
        payee_name: cols.payee_name ? cellText(row.getCell(cols.payee_name)) : null,
        amount: cols.amount ? cellAmount(row.getCell(cols.amount)) : null,
        paid_date: cols.paid_date ? cellText(row.getCell(cols.paid_date)) : null,
        paid_amount: cols.paid_amount ? cellAmount(row.getCell(cols.paid_amount)) : null,
        invoice_date: cols.invoice_date ? cellText(row.getCell(cols.invoice_date)) : null,
        artist: cols.artist ? cellText(row.getCell(cols.artist)) : null,
        description: cols.description ? cellText(row.getCell(cols.description)) : null,
      });
    }
  }

  return {
    rows,
    sheets_skipped: skipped,
    sheets_processed: wb.worksheets.length - skipped.length,
    sheet_years: [...years].sort(),
    week_ending: findWeekEnding(wb),
    truncated,
  };
}

// ── Writing ──────────────────────────────────────────────────────────────────

const MONEY = '"$"#,##0.00;[Red]("$"#,##0.00)';
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
const DISPUTE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
const PRIORITY_COLOR = { HIGH: 'FFB91C1C', MEDIUM: 'FFB45309', LOW: 'FF4B5563', INFO: 'FF6B7280' };

const COLUMNS = [
  { header: 'Sheet', width: 16, get: (d) => d.sheet || '' },
  { header: 'Row', width: 7, get: (d) => d.row_num || '' },
  { header: 'BK vendor', width: 30, get: (d) => d.bookkeeper?.vendor || '' },
  { header: 'BK invoice #', width: 15, get: (d) => d.bookkeeper?.invoice || '' },
  { header: 'BK amount', width: 14, money: true, get: (d) => d.bookkeeper?.amount ?? null },
  { header: 'BK artist', width: 18, get: (d) => d.bookkeeper?.artist || '' },
  { header: 'BK paid date', width: 13, get: (d) => ymd(d.bookkeeper?.paid_date) || d.bookkeeper?.paid_date || '' },
  { header: 'BK paid amt', width: 13, money: true, get: (d) => d.bookkeeper?.paid_amount ?? null },
  { header: 'Ledger payee', width: 30, get: (d) => d.ledger?.payee || '' },
  { header: 'Entry #', width: 9, get: (d) => d.ledger?.id || '' },
  { header: 'Ledger invoice #', width: 15, get: (d) => d.ledger?.invoice_number || '' },
  { header: 'Ledger amount', width: 15, money: true, get: (d) => (d.ledger ? (d.ledger.family_amount ?? d.ledger.amount) : null) },
  { header: 'Cur', width: 6, get: (d) => d.ledger?.currency || '' },
  { header: 'Ledger artist', width: 18, get: (d) => d.ledger?.artist || '' },
  { header: 'Ledger status', width: 12, get: (d) => d.ledger?.payment_status || '' },
  { header: 'Ledger paid date', width: 14, get: (d) => ymd(d.ledger?.payment_date) },
  { header: 'Match', width: 34, get: (d) => d.vendor_match_label || '' },
  { header: 'What disagrees', width: 80, get: (d) => (d.issues || []).join(' ') },
];
// 1-based column indexes whose value is in dispute, per category — highlighted
// so a long row does not have to be read left to right to find the problem.
const DISPUTED = {
  amount_mismatch: [5, 12],
  paid_status_mismatch: [7, 15],
  paid_date_mismatch: [7, 16],
  vendor_name_variation: [3, 9],
  missing_from_ledger: [3, 4],
  missing_from_bookkeeper: [9, 11],
  no_invoice_num: [4],
};

function writeCategorySheet(wb, cat, rows, ctx) {
  const ws = wb.addWorksheet(cat.label.slice(0, 31).replace(/[\\/?*[\]:]/g, '-'), {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  COLUMNS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  const title = ws.addRow([`${cat.label} — ${rows.length} row${rows.length === 1 ? '' : 's'} · ${cat.priority}`]);
  title.font = { bold: true, size: 14, color: { argb: PRIORITY_COLOR[cat.priority] || 'FF111827' } };
  const action = ws.addRow([cat.action]);
  action.font = { italic: true, color: { argb: 'FF6B7280' }, size: 10 };
  const banner = ws.addRow(['BOOKKEEPER', '', '', '', '', '', '', '', 'CADENCE LEDGER']);
  banner.font = { bold: true, size: 9, color: { argb: 'FF6B7280' } };

  const head = ws.addRow(COLUMNS.map((c) => c.header));
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => { c.fill = HEAD_FILL; });

  const disputed = DISPUTED[cat.key] || [];
  let subtotal = 0;
  for (const d of rows) {
    const r = ws.addRow(COLUMNS.map((c) => c.get(d)));
    COLUMNS.forEach((c, i) => { if (c.money) r.getCell(i + 1).numFmt = MONEY; });
    for (const idx of disputed) r.getCell(idx).fill = DISPUTE_FILL;
    r.getCell(COLUMNS.length).alignment = { wrapText: true, vertical: 'top' };
    subtotal += rowDollarDelta(d);
  }
  if (rows.length) {
    ws.autoFilter = { from: { row: head.number, column: 1 }, to: { row: head.number + rows.length, column: COLUMNS.length } };
    const tot = ws.addRow([]);
    tot.getCell(11).value = 'At stake';
    tot.getCell(12).value = Math.round(subtotal * 100) / 100;
    tot.getCell(12).numFmt = MONEY;
    tot.font = { bold: true };
  }
  if (ctx?.note) {
    const n = ws.addRow([ctx.note]);
    n.font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
  }
  return ws;
}

const AT_STAKE_NOTE = 'At stake is USD-equivalent wherever the ledger supplies one (locked FX honoured). Rows only the bookkeeper has carry no currency, so their sheet figure is taken at face value.';

/**
 * The full report: a cover tab plus one tab per non-empty category.
 * `diff` is the payload the page renders — never re-derived, so the workbook
 * and the screen cannot disagree.
 */
function buildDiffWorkbook(diff, { labelName = 'Cadence', categories = null } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = labelName;
  const diffs = diff?.diffs || [];
  const summary = diff?.summary || {};
  const wanted = categories ? DIFF_CATEGORIES.filter((c) => categories.includes(c.key)) : DIFF_CATEGORIES;

  const cover = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  [46, 12, 16, 60].forEach((w, i) => { cover.getColumn(i + 1).width = w; });
  cover.addRow([`Bookkeeper reconciliation — ${labelName}`]).font = { bold: true, size: 16 };
  cover.addRow([`Generated ${new Date().toISOString().slice(0, 10)}`]).font = { italic: true, color: { argb: 'FF6B7280' } };
  cover.addRow([]);

  const scope = cover.addRow(['Scope']);
  scope.font = { bold: true };
  cover.addRow(['Rows read from the workbook', summary.bookkeeper_rows ?? 0]);
  cover.addRow(['Ledger invoices considered', summary.ledger_rows ?? 0]);
  cover.addRow(['Sheets processed', summary.sheets_processed ?? 0]);
  cover.addRow(['Years inferred from tab names', (summary.sheet_years || []).join(', ') || 'none — the year filter fell open']);
  cover.addRow(['Week ending on the workbook', summary.week_ending || 'not stated — no snapshot cap applied']);
  for (const s of summary.sheets_skipped || []) cover.addRow([`Skipped: ${s.sheet}`, '', '', s.reason]);
  if (summary.suppressed) {
    cover.addRow(['Ledger rows held back (outside the workbook years)', summary.suppressed.outside_sheet_years || 0]);
    cover.addRow(['Ledger rows held back (filed after the week ending)', summary.suppressed.after_week_ending || 0]);
  }
  cover.addRow([]);

  const ch = cover.addRow(['Category', 'Rows', 'At stake', 'What to do']);
  ch.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ch.eachCell((c) => { c.fill = HEAD_FILL; });
  for (const cat of DIFF_CATEGORIES) {
    const rows = diffs.filter((d) => d.kind === cat.key);
    const at = Math.round(rows.reduce((t, d) => t + rowDollarDelta(d), 0) * 100) / 100;
    const r = cover.addRow([`${cat.label} (${cat.priority})`, rows.length, at, cat.action]);
    r.getCell(3).numFmt = MONEY;
    r.getCell(4).alignment = { wrapText: true, vertical: 'top' };
    if (rows.length) r.getCell(1).font = { bold: true, color: { argb: PRIORITY_COLOR[cat.priority] || 'FF111827' } };
  }
  cover.addRow([AT_STAKE_NOTE]).font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
  cover.addRow([]);

  const tv = topVendors(diffs);
  if (tv.length) {
    const th = cover.addRow(['Vendor', 'Rows', 'At stake']);
    th.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    th.eachCell((c) => { c.fill = HEAD_FILL; });
    for (const v of tv) {
      const r = cover.addRow([v.vendor, v.rows, v.at_stake]);
      r.getCell(3).numFmt = MONEY;
    }
    cover.addRow([]);
  }

  const lh = cover.addRow(['How two spellings were judged the same vendor']);
  lh.font = { bold: true };
  for (const [tier, label] of Object.entries(TIERS)) cover.addRow([label, '', '', tier]);
  cover.addRow([]);
  cover.addRow(['Amounts are compared native to native and never converted — both sides are recording what one document says.'])
    .font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };

  for (const cat of wanted) {
    const rows = diffs.filter((d) => d.kind === cat.key);
    if (!rows.length) continue;
    writeCategorySheet(wb, cat, rows, { note: AT_STAKE_NOTE });
  }
  return wb;
}

module.exports = {
  parseBookkeeperWorkbook, buildDiffWorkbook, writeCategorySheet,
  cellText, cellAmount, detectHeaderRow, findColumns, findWeekEnding,
  MAX_SHEET_ROWS, AT_STAKE_NOTE,
};
