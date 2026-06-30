// Generate an artist clearance chart as a styled XLSX (via exceljs). Built from
// scratch (no bundled template) so it has no external file dependency.

const ExcelJS = require('exceljs');

// Per-track detail fields rendered as label/value rows under each track.
const TRACK_DETAILS = [
  ['ISRC', 'isrc'], ['Timing', 'timing'], ['Explicit', 'explicit'],
  ['Samples / AI', 'samples_ai'], ['Produced by', 'produced_by'],
  ['Writers', 'writers'], ['Publishing splits', 'publishing_splits'],
  ['Publishers', 'publishers'], ['Mixed by', 'mixed_by'], ['Mastered by', 'mastered_by'],
  ['Royalty rate', 'royalty_rate'], ['Agreement on file', 'agreement_on_file'],
];

const v = (x) => (x === null || x === undefined || x === '' ? 'TBD' : String(x));

async function buildClearanceXlsx(c, artistName) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cadence';
  const ws = wb.addWorksheet('Clearance Chart', { properties: { defaultColWidth: 22 } });
  ws.columns = [{ width: 22 }, { width: 40 }, { width: 22 }, { width: 40 }];

  const title = (text) => {
    const row = ws.addRow([text]);
    row.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    ws.mergeCells(`A${row.number}:D${row.number}`);
    row.height = 22;
  };
  const meta = (label, val) => {
    const row = ws.addRow([label, v(val)]);
    row.getCell(1).font = { bold: true };
  };

  title('ARTIST CLEARANCE CHART');
  meta('Artist', artistName || 'TBD');
  meta('Title', c.title);
  meta('Project #', c.project_number);
  meta('Product commitment', c.product_commitment);
  meta('Contractual members', c.contractual_members);
  meta('Effective date', c.effective_date ? String(c.effective_date).slice(0, 10) : '');
  meta('Artist royalty rate', c.royalty_rate);
  meta('Royalty account', c.royalty_account);
  ws.addRow([]);

  const tracks = Array.isArray(c.tracks) ? c.tracks : [];
  tracks.forEach((t, i) => {
    const hdr = ws.addRow([`Track ${i + 1}`, v(t.title)]);
    hdr.font = { bold: true, size: 12 };
    hdr.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
    hdr.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
    if (t.credit) ws.addRow(['Credit', v(t.credit)]);
    // Detail rows in two columns (label,value | label,value).
    for (let j = 0; j < TRACK_DETAILS.length; j += 2) {
      const [l1, k1] = TRACK_DETAILS[j];
      const pair = TRACK_DETAILS[j + 1];
      const cells = [l1, v(t[k1])];
      if (pair) cells.push(pair[0], v(t[pair[1]]));
      const row = ws.addRow(cells);
      row.getCell(1).font = { bold: true, color: { argb: 'FF6B7280' } };
      if (pair) row.getCell(3).font = { bold: true, color: { argb: 'FF6B7280' } };
    }
    ws.addRow([]);
  });
  if (!tracks.length) ws.addRow(['No tracks added.']);

  return wb.xlsx.writeBuffer(); // returns a Buffer
}

module.exports = { buildClearanceXlsx };
