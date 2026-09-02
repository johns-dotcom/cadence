// Bookkeeper Reconcile — /api/ledger-matching
//
// Diff the ledger against an outside bookkeeper's spreadsheet and produce the
// deliverables that go back to them.
//
// This is NOT bank matching. /bank-matching reconciles bank statement lines
// against the ledger and is calibrated for bank descriptors; nothing here
// touches bank_transactions or lib/bankReconcile.js. The dataset here is a file
// a human uploads. Nothing is persisted — a saved diff of a file we do not
// control is stale the moment either side edits a row, and a stale
// reconciliation is worse than none.
//
// Admin-gated on the server (requireAdmin) and behind AdminRoute on the client.

const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { usdOf } = require('../lib/usd');
const { excludeBankRows } = require('../lib/ledgerSource');
const { DIFF_CATEGORIES, CATEGORY_KEYS, diffLedger, rowDollarDelta } = require('../lib/ledgerDiff');
const { parseBookkeeperWorkbook, buildDiffWorkbook, AT_STAKE_NOTE } = require('../lib/ledgerDiffXlsx');
const { loadFileBuffer, isConfigured: r2Configured } = require('../lib/r2');
const { buildZip } = require('../lib/zip');

const router = express.Router();
router.use(authMiddleware, withTenant, requireAdmin);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// The diff round-trips through the browser (the client filters, then asks for a
// workbook of what it is showing). It is one upload's worth of rows, not a
// database, but it still needs a ceiling well above any real workbook.
const jsonBig = express.json({ limit: '25mb' });

const safeName = (s) => String(s || '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unnamed';
const extOf = (key) => (/\.pdf$/i.test(key) ? 'pdf' : /\.png$/i.test(key) ? 'png' : /\.jpe?g$/i.test(key) ? 'jpg' : /\.docx?$/i.test(key) ? 'docx' : 'bin');
const today = () => new Date().toISOString().slice(0, 10);

// ── The ledger side of the diff ──────────────────────────────────────────────
// Family ROOTS only, with live children summed onto the root, so a split
// invoice compares against what was actually billed rather than against one
// slice. Bank-born rows are excluded: they carry no invoice number and the
// bookkeeper was never given them, so they would be pure noise in the reverse
// direction. Rejected and deleted rows are out; voided rows are out.
async function ledgerSide(labelId) {
  const { rows } = await pool.query(
    `SELECT e.id, e.payee, e.invoice_number, e.amount, e.currency, e.fx_rate_to_usd,
            to_char(e.invoice_date, 'YYYY-MM-DD') AS invoice_date,
            to_char(e.payment_date, 'YYYY-MM-DD') AS payment_date,
            e.payment_status, e.artist, e.song, e.description, e.status,
            e.invoice_filename, e.invoice_r2_key, e.w9_filename, e.w9_r2_key,
            e.proof_filename, e.proof_r2_key, e.receipt_filename, e.receipt_r2_key,
            COALESCE(e.amount + COALESCE((
              SELECT SUM(c.amount) FROM expenses c
               WHERE c.parent_id = e.id AND c.label_id = e.label_id
                 AND (c.deleted IS NULL OR c.deleted = FALSE)
                 AND (c.voided IS NULL OR c.voided = FALSE)), 0), e.amount) AS family_amount
       FROM expenses e
      WHERE e.label_id = $1
        AND e.parent_id IS NULL
        AND e.status <> 'rejected'
        AND (e.deleted IS NULL OR e.deleted = FALSE)
        AND (e.voided IS NULL OR e.voided = FALSE)
        AND ${excludeBankRows('e')}
        AND e.invoice_number IS NOT NULL AND TRIM(e.invoice_number) <> ''`,
    [labelId]
  );
  for (const r of rows) {
    r.family_amount = Number(r.family_amount);
    r.amount = Number(r.amount);
    // Locked rate always wins; an unknown currency passes through visibly
    // rather than being silently 1:1'd. Display only — the amount comparison
    // itself is native to native (see lib/ledgerDiff.js).
    r.usd = Math.round(usdOf(r.family_amount, r.currency, r.fx_rate_to_usd) * 100) / 100;
  }
  return rows;
}

// POST /api/ledger-matching/diff — upload the workbook, get the report.
router.post('/diff', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'Please choose a spreadsheet to upload.' });
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(req.file.buffer); }
    catch { return res.status(400).json({ success: false, error: 'Could not read that spreadsheet. It must be a .xlsx workbook.' }); }

    const parsed = parseBookkeeperWorkbook(wb);
    const ledgerRows = await ledgerSide(req.labelId);
    const { counts, diffs, suppressed } = diffLedger(parsed.rows, ledgerRows, {
      sheetYears: parsed.sheet_years, weekEnding: parsed.week_ending,
    });

    // The file's own name is the only handle the bookkeeper has on which
    // version of their workbook this report came from.
    await logActivity(req, 'Bookkeeper reconcile', `${req.file.originalname} — ${parsed.rows.length} rows, ${diffs.length - (counts.matched || 0)} disagreements`);

    res.json({
      success: true,
      data: {
        summary: {
          source_file: req.file.originalname,
          bookkeeper_rows: parsed.rows.length,
          ledger_rows: ledgerRows.length,
          sheets_processed: parsed.sheets_processed,
          sheets_skipped: parsed.sheets_skipped,
          sheet_years: parsed.sheet_years,
          week_ending: parsed.week_ending,
          truncated: parsed.truncated,
          suppressed,
          counts,
        },
        diffs,
        categories: DIFF_CATEGORIES,
        at_stake_note: AT_STAKE_NOTE,
      },
    });
  } catch (error) {
    console.error('Ledger matching diff error:', error);
    res.status(500).json({ success: false, error: 'Could not reconcile that workbook.' });
  }
});

const sendWorkbook = async (res, wb, filename) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
};

// Reject a payload that is not the shape the page produced, rather than letting
// an odd body reach the workbook writer and 500.
function readDiffBody(body) {
  const diffs = Array.isArray(body?.diff?.diffs) ? body.diff.diffs : null;
  if (!diffs) return null;
  return { diffs, summary: body.diff.summary || {} };
}

// POST /api/ledger-matching/report — the full multi-sheet workbook.
router.post('/report', jsonBig, async (req, res) => {
  try {
    const diff = readDiffBody(req.body);
    if (!diff) return res.status(400).json({ success: false, error: 'Run the reconciliation first — there is nothing to export.' });
    const { rows } = await pool.query('SELECT name FROM labels WHERE id = $1', [req.labelId]);
    const wb = buildDiffWorkbook(diff, { labelName: rows[0]?.name || 'Cadence' });
    await sendWorkbook(res, wb, `bookkeeper-reconciliation-${today()}.xlsx`);
  } catch (error) {
    console.error('Ledger matching report error:', error);
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Could not build the report.' });
  }
});

// POST /api/ledger-matching/export — ONE category, from the rows the page is
// currently showing (so a filtered view exports what it shows).
router.post('/export', jsonBig, async (req, res) => {
  try {
    const category = String(req.body?.category || '');
    if (!CATEGORY_KEYS.includes(category)) return res.status(400).json({ success: false, error: 'Unknown category.' });
    const diff = readDiffBody(req.body);
    if (!diff) return res.status(400).json({ success: false, error: 'Nothing to export.' });
    const { rows } = await pool.query('SELECT name FROM labels WHERE id = $1', [req.labelId]);
    const wb = buildDiffWorkbook(
      { diffs: diff.diffs.filter((d) => d.kind === category), summary: diff.summary },
      { labelName: rows[0]?.name || 'Cadence', categories: [category] }
    );
    await sendWorkbook(res, wb, `reconciliation-${category.replace(/_/g, '-')}-${today()}.xlsx`);
  } catch (error) {
    console.error('Ledger matching export error:', error);
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Could not build the export.' });
  }
});

// Total bytes the handoff will pull out of R2 before it stops adding files.
// The ZIP is built in memory (lib/zip.js is a STORE writer, no streaming), so
// this is a real ceiling, not a preference.
const HANDOFF_BYTE_CAP = 60 * 1024 * 1024;

// POST /api/ledger-matching/handoff — the bundle that actually goes to the
// bookkeeper: the report, a plain-English README, and every document behind the
// ledger rows in the diff. Only rows the LEDGER holds contribute files;
// bookkeeper-only rows are workbook-only by definition — we have no document.
router.post('/handoff', jsonBig, async (req, res) => {
  try {
    const diff = readDiffBody(req.body);
    if (!diff) return res.status(400).json({ success: false, error: 'Run the reconciliation first.' });
    const { rows: labelRows } = await pool.query('SELECT name FROM labels WHERE id = $1', [req.labelId]);
    const labelName = labelRows[0]?.name || 'Cadence';

    const entries = [];
    const wb = buildDiffWorkbook(diff, { labelName });
    entries.push({ name: '00 - START HERE - Reconciliation Report.xlsx', content: Buffer.from(await wb.xlsx.writeBuffer()) });

    // Re-read the documents from the ledger by entry id rather than trusting the
    // posted body: the client round-trip must not be able to name an R2 key.
    const ids = [...new Set(diff.diffs.map((d) => Number(d.ledger?.id)).filter((n) => Number.isInteger(n) && n > 0))];
    const docs = ids.length
      ? (await pool.query(
        `SELECT id, payee, invoice_number, to_char(invoice_date,'YYYY-MM-DD') AS invoice_date,
                invoice_r2_key, w9_r2_key, proof_r2_key, receipt_r2_key
           FROM expenses WHERE label_id = $1 AND id = ANY($2::int[])`,
        [req.labelId, ids]
      )).rows
      : [];

    let bytes = 0;
    let skippedForSize = 0;
    const missingW9 = new Set();
    const seenW9 = new Set();
    const perVendor = new Map();
    const degraded = !r2Configured();

    const add = async (key, name) => {
      if (!key) return false;
      if (bytes >= HANDOFF_BYTE_CAP) { skippedForSize++; return false; }
      const buf = await loadFileBuffer(key, null).catch(() => null);
      if (!buf) return false;
      if (bytes + buf.length > HANDOFF_BYTE_CAP) { skippedForSize++; return false; }
      bytes += buf.length;
      entries.push({ name, content: buf });
      return true;
    };

    for (const d of docs) {
      const vendor = safeName(d.payee || 'unknown-vendor');
      const stem = `${safeName(d.invoice_number || `entry-${d.id}`)}-${d.invoice_date || 'no-date'}`;
      if (!perVendor.has(vendor)) perVendor.set(vendor, []);
      if (d.invoice_r2_key && await add(d.invoice_r2_key, `01 - Invoices/${vendor}/${stem}.${extOf(d.invoice_r2_key)}`)) {
        perVendor.get(vendor).push(`${d.invoice_number || `entry ${d.id}`} — ${d.invoice_date || 'no date'}`);
      }
      if (d.receipt_r2_key) await add(d.receipt_r2_key, `01 - Invoices/${vendor}/${stem}-receipt.${extOf(d.receipt_r2_key)}`);
      if (d.w9_r2_key) {
        if (!seenW9.has(vendor)) { seenW9.add(vendor); await add(d.w9_r2_key, `02 - W9s and W8s/${vendor}.${extOf(d.w9_r2_key)}`); }
      } else { missingW9.add(d.payee || 'unknown vendor'); }
      if (d.proof_r2_key) await add(d.proof_r2_key, `03 - Proof of Payment/${vendor}-${stem}.${extOf(d.proof_r2_key)}`);
    }

    for (const [vendor, lines] of perVendor) {
      if (lines.length) entries.push({ name: `01 - Invoices/${vendor}/_VENDOR_SUMMARY.txt`, content: lines.join('\n') });
    }
    if (missingW9.size) {
      entries.push({
        name: '02 - W9s and W8s/_MISSING.txt',
        content: ['No W9 / W8 on file for these vendors — please chase before any 1099 filing:', '', ...[...missingW9].sort()].join('\n'),
      });
    }

    const counts = diff.summary?.counts || {};
    const readme = [
      `${labelName} — bookkeeper reconciliation`,
      `Generated ${today()}${diff.summary?.source_file ? ` from ${diff.summary.source_file}` : ''}`,
      '',
      'WHAT IS IN HERE',
      '  00 - START HERE - Reconciliation Report.xlsx   every disagreement, one tab per category',
      '  01 - Invoices/<vendor>/                        the invoice document behind each ledger row',
      '  02 - W9s and W8s/                              one per vendor, plus a chase list',
      '  03 - Proof of Payment/                         payment proof where we hold it',
      '',
      'WHAT THE REPORT FOUND',
      ...DIFF_CATEGORIES.map((c) => `  ${c.label.padEnd(34, ' ')}${String(counts[c.key] || 0).padStart(6, ' ')}   [${c.priority}]`),
      '',
      AT_STAKE_NOTE,
      '',
      'Amounts are compared as filed on each side and never converted between currencies.',
      'Split invoices are compared at the full billed amount (parent plus its live children).',
      degraded ? 'NOTE: document storage was unavailable when this bundle was built, so it may contain the report only.' : null,
      skippedForSize ? `NOTE: ${skippedForSize} document(s) were left out to keep this bundle under ${Math.round(HANDOFF_BYTE_CAP / (1024 * 1024))} MB. Ask for them directly.` : null,
      '',
      'Questions: reply to whoever sent you this bundle.',
      // Only the two conditional lines drop out — a blank-line filter here
      // would also delete every section break and run the README together.
    ].filter((l) => l !== null).join('\n');
    entries.unshift({ name: '00 - README.txt', content: readme });

    const zip = buildZip(entries, Math.floor(Date.now() / 1000));
    await logActivity(req, 'Bookkeeper handoff bundle', `${entries.length} files, ${Math.round(bytes / 1024)} KB of documents`);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="bookkeeper-handoff-${today()}.zip"`);
    res.send(zip);
  } catch (error) {
    console.error('Ledger matching handoff error:', error);
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Could not build the handoff bundle.' });
  }
});

module.exports = router;
