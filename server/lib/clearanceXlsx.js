// Render an artist clearance chart as XLSX (exceljs).
//
// The layout is the canonical clearance-chart structure the reference app
// rendered into a bundled template workbook: prefixed header strings in rows
// 1-12 (column A), the effective date as a REAL date cell, a primary-column
// header row, then one 17-row block per track — a primary row across 13
// columns followed by 16 label/value detail rows (label in column C, value in
// column D, blank → 'TBD').
//
// It is built in code rather than cloned from a bundled .xlsx so there is no
// binary asset to keep in sync, and so the styling stays workspace-neutral
// (greys, not a hardcoded accent). Every row/column index below matches the
// canonical chart, so a bookkeeper opening this file sees the same shape.

const ExcelJS = require('exceljs');

const TRACK_BLOCK_ROWS = 17;   // primary row + 16 detail rows
const FIRST_TRACK_ROW = 15;
const HEADER_ROW = 14;         // primary-column headings
const SUB_LABEL_COL = 3;       // detail labels live in column C
const SUB_VALUE_COL = 4;       // detail values in column D

// The 16 per-track detail rows, in chart order. Labels carry their trailing
// punctuation because that is what the chart reads like on paper.
const SUB_FIELDS = [
  { key: 'isrc', label: 'ISRC:' },
  { key: 'timing', label: 'Timing:' },
  { key: 'explicit', label: 'Clean or Explicit:' },
  { key: 'samples_ai', label: 'Samples/AI [yes/no]:' },
  { key: 'produced_by', label: 'Produced by:' },
  { key: 'musician_credits', label: 'Musician Credits:' },
  { key: 'recorded_by', label: 'Recorded by:' },
  { key: 'mixed_by', label: 'Mixed by:' },
  { key: 'mastered_by', label: 'Mastered by:' },
  { key: 'writers', label: 'Writers (full names):' },
  { key: 'publishing_splits', label: 'Publishing splits:' },
  { key: 'publishers', label: 'Publishers:' },
  { key: 'lyrics', label: 'Lyrics' },
  { key: 'stems_masters', label: 'Stems/Masters?' },
  { key: 'artwork', label: 'Artwork?' },
  { key: 'credits_approved', label: 'Credits Approved?' },
];

// Primary-row columns. The gaps (8, 10, 12, …) are deliberate: the canonical
// chart leaves a spacer column between the wider free-text fields.
const PRIMARY_COLS = [
  { col: 1, key: 'track_number', label: '#' },
  { col: 2, key: 'title', label: 'Track' },
  { col: 3, key: 'role', label: 'Role' },
  { col: 4, key: 'credit', label: 'Credit' },
  { col: 5, key: 'docs_needed', label: 'Docs needed' },
  { col: 6, key: 'sample_review', label: 'Sample review' },
  { col: 7, key: 'release_date', label: 'Release date' },
  { col: 9, key: 'royalty_comments', label: 'Royalty comments' },
  { col: 11, key: 'royalty_rate', label: 'Royalty rate' },
  { col: 13, key: 'royalty_account', label: 'Royalty account' },
  { col: 15, key: 'advance', label: 'Advance' },
  { col: 17, key: 'recoupable_portion', label: 'Recoupable portion' },
  { col: 19, key: 'agreement_on_file', label: 'Agreement on file' },
];

const GREY_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
const RULE = { style: 'thin', color: { argb: 'FFD1D5DB' } };
const BOX = { top: RULE, left: RULE, bottom: RULE, right: RULE };

// Blank detail values render as TBD — the chart is filled in as information
// arrives, and an empty cell reads as "nobody looked" rather than "not yet
// known". Header fields are NOT defaulted this way: a blank stays blank.
const tbd = (x) => (x === null || x === undefined || String(x).trim() === '' ? 'TBD' : String(x));

async function buildClearanceXlsx(c, artistName) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cadence';
  const ws = wb.addWorksheet('Clearance Chart');

  ws.columns = [
    { width: 5 }, { width: 34 }, { width: 22 }, { width: 30 }, { width: 18 },
    { width: 18 }, { width: 14 }, { width: 3 }, { width: 26 }, { width: 3 },
    { width: 14 }, { width: 3 }, { width: 22 }, { width: 3 }, { width: 14 },
    { width: 3 }, { width: 18 }, { width: 3 }, { width: 18 },
  ];

  // ── Header metadata (rows 1-12, column A) ──────────────────────────────
  // Prefix labels are baked into the string exactly as the canonical chart
  // renders them, including "Product Committment" — that spelling is what the
  // bookkeeper's chart has said for years and matching it keeps a diff of an
  // old chart against a new one readable.
  const head = (row, text, opts = {}) => {
    const cell = ws.getCell(row, 1);
    cell.value = text;
    cell.font = { bold: !!opts.bold, size: opts.size || 11 };
    return cell;
  };
  head(1, `Artist Name: ${artistName || ''}`, { bold: true, size: 14 });
  head(2, 'Document List', { bold: true });
  // A real Date cell, not a string — so the chart sorts and formats natively.
  // pg hands DATE columns back as a Date, but a freshly-inserted row echoed
  // from RETURNING can also be the 'YYYY-MM-DD' string the client sent; both
  // reach this function, so normalise before parsing.
  if (c.effective_date) {
    const iso = (c.effective_date instanceof Date)
      ? c.effective_date.toISOString().slice(0, 10)
      : String(c.effective_date).slice(0, 10);
    const d = new Date(`${iso}T00:00:00Z`);
    const cell = ws.getCell(3, 1);
    if (!isNaN(d)) { cell.value = d; cell.numFmt = 'mm/dd/yyyy'; }
  }
  head(5, `Contractual Members: ${c.contractual_members || ''}`);
  head(7, `Project #: ${c.project_number || ''}`);
  head(8, `Title: ${c.title || ''}`);
  head(9, `Product Committment: ${c.product_commitment || ''}`);
  head(11, `Main Artist Royalty Account: ${c.royalty_account || ''}`);
  head(12, `Artist Royalty Rate: ${c.royalty_rate || ''}`);

  // ── Primary-column header row ─────────────────────────────────────────
  for (const col of PRIMARY_COLS) {
    const cell = ws.getCell(HEADER_ROW, col.col);
    cell.value = col.label;
    cell.font = { bold: true, size: 10 };
    cell.fill = GREY_FILL;
    cell.border = BOX;
    cell.alignment = { vertical: 'middle', wrapText: true };
  }
  ws.getRow(HEADER_ROW).height = 26;

  // ── One 17-row block per track ────────────────────────────────────────
  const tracks = Array.isArray(c.tracks) ? c.tracks : [];
  const writeBlock = (index, track) => {
    const startRow = FIRST_TRACK_ROW + index * TRACK_BLOCK_ROWS;
    // Primary row.
    for (const col of PRIMARY_COLS) {
      const cell = ws.getCell(startRow, col.col);
      if (track) {
        const raw = col.key === 'track_number' ? (index + 1) : (track[col.key] || '');
        cell.value = raw === '' ? null : raw;
      }
      cell.font = { bold: col.key === 'track_number' || col.key === 'title', size: 11 };
      cell.fill = GREY_FILL;
      cell.border = BOX;
      cell.alignment = { vertical: 'top', wrapText: true };
    }
    // 16 detail rows — label in column C, value in column D. The labels are
    // written even for the empty scaffold so a freshly-created chart opens
    // with the form intact.
    SUB_FIELDS.forEach((sub, i) => {
      const row = startRow + 1 + i;
      const labelCell = ws.getCell(row, SUB_LABEL_COL);
      labelCell.value = sub.label;
      labelCell.font = { bold: true, size: 10, color: { argb: 'FF6B7280' } };
      labelCell.alignment = { vertical: 'top' };
      const valueCell = ws.getCell(row, SUB_VALUE_COL);
      if (track) valueCell.value = tbd(track[sub.key]);
      valueCell.alignment = { vertical: 'top', wrapText: true };
    });
  };

  if (tracks.length) tracks.forEach((t, i) => writeBlock(i, t || {}));
  // No tracks yet — emit the scaffold (headers + detail labels, no values) so
  // the chart is still usable as a blank form.
  else writeBlock(0, null);

  return wb.xlsx.writeBuffer();
}

module.exports = { buildClearanceXlsx, SUB_FIELDS, PRIMARY_COLS, TRACK_BLOCK_ROWS, FIRST_TRACK_ROW };
