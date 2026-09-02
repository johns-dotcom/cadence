const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { createZipStream, toCsv } = require('../lib/zip');
const { loadFileBuffer } = require('../lib/r2');

const router = express.Router();
router.use(authMiddleware, withTenant);

// Whole-workspace export — SUPERADMIN only, scoped entirely to req.labelId.
// This one endpoint hands over every invoice, contract, payout and W9 the
// workspace holds; `requireAdmin` also admits Admins, which is a wider door
// than the thing behind it deserves.
function requireSuperadmin(req, res, next) {
  if (req.user?.role !== 'Superadmin') {
    return res.status(403).json({ success: false, error: 'Only a Superadmin can export the whole workspace' });
  }
  next();
}
router.use(requireSuperadmin);

// Each table → the columns we export (and the SQL to pull them). Every query is
// anchored to label_id so one workspace can never export another's data.
const TABLES = [
  { file: 'artists.csv', sql: 'SELECT id,name,genre,archived,created_at FROM artists WHERE label_id=$1 ORDER BY name', cols: ['id', 'name', 'genre', 'archived', 'created_at'] },
  { file: 'releases.csv', sql: 'SELECT id,project_name,artist_id,release_date,release_type,genre,status,upc,isrc,priority,in_catalog,archived,subgenre,producer,featured_artists FROM releases WHERE label_id=$1 ORDER BY release_date DESC NULLS LAST', cols: ['id', 'project_name', 'artist_id', 'release_date', 'release_type', 'genre', 'status', 'upc', 'isrc', 'priority', 'in_catalog', 'archived', 'subgenre', 'producer', 'featured_artists'] },
  { file: 'deals.csv', sql: 'SELECT id,artist_name,genre,stage,ar_rep,source,deal_type,offer_amount,priority,added_date,last_contact_date,next_followup_date FROM deals WHERE label_id=$1 ORDER BY added_date DESC NULLS LAST, id DESC', cols: ['id', 'artist_name', 'genre', 'stage', 'ar_rep', 'source', 'deal_type', 'offer_amount', 'priority', 'added_date', 'last_contact_date', 'next_followup_date'] },
  // Bulk-deal deliverables. The expenses row is already in ledger.csv; without
  // this its checklist — the evidence a creator actually delivered — leaves the
  // workspace with nothing to show.
  { file: 'bulk_deal_items.csv', sql: 'SELECT id,expense_id,title,platform,url,completed,completed_at,position FROM bulk_deal_items WHERE label_id=$1 ORDER BY expense_id, position, id', cols: ['id', 'expense_id', 'title', 'platform', 'url', 'completed', 'completed_at', 'position'] },
  { file: 'contracts.csv', sql: 'SELECT id,artist_id,type,status,date_signed,expiration_date,royalty_split,advance,territory FROM contracts WHERE label_id=$1', cols: ['id', 'artist_id', 'type', 'status', 'date_signed', 'expiration_date', 'royalty_split', 'advance', 'territory'] },
  { file: 'ledger.csv', sql: "SELECT id,invoice_date,payee,category,artist,invoice_number,amount,currency,status,payment_status,payment_date,rep FROM expenses WHERE label_id=$1 AND (deleted=false OR deleted IS NULL) AND parent_id IS NULL ORDER BY invoice_date DESC NULLS LAST", cols: ['id', 'invoice_date', 'payee', 'category', 'artist', 'invoice_number', 'amount', 'currency', 'status', 'payment_status', 'payment_date', 'rep'] },
  { file: 'vendors.csv', sql: 'SELECT id,name,email,address,bank,w9_filename FROM vendors WHERE label_id=$1 ORDER BY name', cols: ['id', 'name', 'email', 'address', 'bank', 'w9_filename'] },
  { file: 'invoices.csv', sql: 'SELECT id,invoice_number,bill_to,description,amount,payment_status,due_by FROM invoices WHERE label_id=$1 ORDER BY invoice_number DESC', cols: ['id', 'invoice_number', 'bill_to', 'description', 'amount', 'payment_status', 'due_by'] },
  { file: 'artist_income.csv', sql: 'SELECT id,artist_id,source,amount,currency,income_date FROM artist_income WHERE label_id=$1', cols: ['id', 'artist_id', 'source', 'amount', 'currency', 'income_date'] },
  { file: 'categories.csv', sql: 'SELECT kind,name,active,seeded,sort_order,ui_group,report_section,contra_of FROM categories WHERE label_id=$1 ORDER BY kind,sort_order NULLS LAST,name', cols: ['kind', 'name', 'active', 'seeded', 'sort_order', 'ui_group', 'report_section', 'contra_of'] },
  { file: 'report_dismissals.csv', sql: 'SELECT scope,cell_kind,cell_key,bs_ref,row_fingerprint,reason,dismissed_by,dismissed_at FROM report_dismissals WHERE label_id=$1 ORDER BY dismissed_at DESC', cols: ['scope', 'cell_kind', 'cell_key', 'bs_ref', 'row_fingerprint', 'reason', 'dismissed_by', 'dismissed_at'] },
  { file: 'artist_budget_sections.csv', sql: 'SELECT artist_key,section,amount,currency,note,updated_by,updated_at FROM artist_budget_sections WHERE label_id=$1 ORDER BY artist_key,section', cols: ['artist_key', 'section', 'amount', 'currency', 'note', 'updated_by', 'updated_at'] },
  { file: 'recoupment_notes.csv', sql: "SELECT artist_key,song_key,note,updated_by,updated_at FROM recoupment_notes WHERE label_id=$1 ORDER BY artist_key,song_key", cols: ['artist_key', 'song_key', 'note', 'updated_by', 'updated_at'] },
  { file: 'recoupment_class_rules.csv', sql: 'SELECT scope,rule_key,reason,created_by,created_at FROM recoupment_class_rules WHERE label_id=$1 ORDER BY scope,rule_key', cols: ['scope', 'rule_key', 'reason', 'created_by', 'created_at'] },
  { file: 'label_level_spend_rules.csv', sql: 'SELECT scope,rule_key,reason,created_by,created_at FROM label_level_spend_rules WHERE label_id=$1 ORDER BY scope,rule_key', cols: ['scope', 'rule_key', 'reason', 'created_by', 'created_at'] },
  { file: 'campaigns.csv', sql: 'SELECT id,artist_id,name,platform,status,planned_budget,actual_spend,currency FROM campaigns WHERE label_id=$1', cols: ['id', 'artist_id', 'name', 'platform', 'status', 'planned_budget', 'actual_spend', 'currency'] },
  { file: 'dsp_submissions.csv', sql: 'SELECT release_id,platform,status,submitted_date,live_date FROM dsp_submissions WHERE label_id=$1', cols: ['release_id', 'platform', 'status', 'submitted_date', 'live_date'] },
  { file: 'salary.csv', sql: 'SELECT e.name,e.department,e.monthly_amount,p.month,p.year,p.paid FROM salary_employees e LEFT JOIN salary_payments p ON p.employee_id=e.id AND p.label_id=e.label_id WHERE e.label_id=$1', cols: ['name', 'department', 'monthly_amount', 'month', 'year', 'paid'] },
  { file: 'salary_payment_history.csv', sql: 'SELECT h.month,h.year,h.action,h.amount,h.performed_at,e.name AS employee,u.name AS performed_by FROM salary_payment_history h JOIN salary_employees e ON e.id=h.employee_id AND e.label_id=h.label_id LEFT JOIN users u ON u.id=h.performed_by AND u.label_id=h.label_id WHERE h.label_id=$1 ORDER BY h.performed_at DESC', cols: ['month', 'year', 'action', 'amount', 'performed_at', 'employee', 'performed_by'] },
  // `sql` and `cols` are parallel — a length mismatch shifts every column, so add to both.
  { file: 'tasks.csv', sql: 'SELECT id,description,category,priority,status,due_date,completed_at,notes FROM tasks WHERE label_id=$1', cols: ['id', 'description', 'category', 'priority', 'status', 'due_date', 'completed_at', 'notes'] },
  // Legal documents. The generated body/track payloads are what make these
  // rows re-issuable, so they ship as columns rather than being summarised.
  { file: 'nda_documents.csv', sql: 'SELECT id,template,title,custom_body,created_at FROM nda_documents WHERE label_id=$1 ORDER BY created_at DESC, id DESC', cols: ['id', 'template', 'title', 'custom_body', 'created_at'] },
  { file: 'label_waivers.csv', sql: 'SELECT id,effective_date,artist_name,releasing_label,other_label_artist,song_title,release_date,release_format,royalty_percent,contact_email,signatory_name,signatory_title,custom_body,created_at FROM label_waivers WHERE label_id=$1 ORDER BY created_at DESC, id DESC', cols: ['id', 'effective_date', 'artist_name', 'releasing_label', 'other_label_artist', 'song_title', 'release_date', 'release_format', 'royalty_percent', 'contact_email', 'signatory_name', 'signatory_title', 'custom_body', 'created_at'] },
  { file: 'admin_docs.csv', sql: 'SELECT id,title,category,status,confidentiality,counterparty,signed_date,expiration_date,tags,notes,is_template,created_at FROM admin_docs WHERE label_id=$1 ORDER BY updated_at DESC NULLS LAST, id DESC', cols: ['id', 'title', 'category', 'status', 'confidentiality', 'counterparty', 'signed_date', 'expiration_date', 'tags', 'notes', 'is_template', 'created_at'] },
  { file: 'clearances.csv', sql: 'SELECT id,artist_id,title,project_number,product_commitment,contractual_members,effective_date,royalty_rate,royalty_account,tracks,created_at FROM clearances WHERE label_id=$1 ORDER BY created_at DESC, id DESC', cols: ['id', 'artist_id', 'title', 'project_number', 'product_commitment', 'contractual_members', 'effective_date', 'royalty_rate', 'royalty_account', 'tracks', 'created_at'] },
  // Usage analytics ships as a per-page ROLLUP, not the raw rows. The raw table
  // is a per-person browsing history with a deliberate 180-day life; exporting
  // it would hand out a permanent copy of the thing retention exists to expire.
  { file: 'usage_by_page.csv', sql: "SELECT path,COUNT(*)::int AS views,COUNT(DISTINCT user_id)::int AS users,MIN(ts) AS first_seen,MAX(ts) AS last_seen FROM page_views WHERE label_id=$1 GROUP BY path ORDER BY views DESC", cols: ['path', 'views', 'users', 'first_seen', 'last_seen'] },
];

// ── Uploaded documents ──────────────────────────────────────────────────────
// Every place this workspace stores a file, and the folder it lands in inside
// the archive. Each row yields { key, legacy, folder, name } — `legacy` is the
// pre-R2 inline base64 fallback, which loadFileBuffer takes as its 2nd arg.
const FILE_SOURCES = [
  {
    folder: 'files/invoices',
    sql: `SELECT id, invoice_r2_key AS r2_key, NULL::text AS inline, invoice_filename AS filename, payee
            FROM expenses WHERE label_id=$1 AND invoice_r2_key IS NOT NULL`,
  },
  {
    folder: 'files/receipts',
    sql: `SELECT id, receipt_r2_key AS r2_key, NULL::text AS inline, receipt_filename AS filename, payee
            FROM expenses WHERE label_id=$1 AND receipt_r2_key IS NOT NULL`,
  },
  {
    folder: 'files/payment-proofs',
    sql: `SELECT id, proof_r2_key AS r2_key, NULL::text AS inline, NULL::text AS filename, payee
            FROM expenses WHERE label_id=$1 AND proof_r2_key IS NOT NULL`,
  },
  {
    folder: 'files/w9s',
    sql: `SELECT id, w9_r2_key AS r2_key, NULL::text AS inline, w9_filename AS filename, name AS payee
            FROM vendors WHERE label_id=$1 AND w9_r2_key IS NOT NULL`,
  },
  {
    folder: 'files/attachments',
    sql: `SELECT id, r2_key, file_data AS inline, COALESCE(original_name, filename) AS filename,
                 entity_type || '-' || entity_id AS payee
            FROM entity_files WHERE label_id=$1`,
  },
];

const safeName = (s) => String(s || '').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 90) || 'file';

// ── Formatted workbooks ─────────────────────────────────────────────────────
// The CSVs are the machine-readable copy; these are the ones a person opens.
// Built from the SAME rows the CSVs came from, so the two can never disagree.
const WORKBOOKS = [
  { file: 'Ledger.xlsx', sheets: ['ledger.csv', 'invoices.csv', 'vendors.csv', 'artist_income.csv'] },
  { file: 'Catalog.xlsx', sheets: ['artists.csv', 'releases.csv', 'dsp_submissions.csv', 'campaigns.csv'] },
  { file: 'Business.xlsx', sheets: ['deals.csv', 'contracts.csv', 'tasks.csv', 'salary.csv'] },
];

async function buildWorkbook(spec, byFile) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cadence';
  for (const csvName of spec.sheets) {
    const src = byFile[csvName];
    if (!src) continue;
    const ws = wb.addWorksheet(csvName.replace(/\.csv$/, '').slice(0, 31));
    ws.columns = src.cols.map(c => ({ header: c, key: c, width: Math.min(38, Math.max(12, c.length + 4)) }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of src.rows) ws.addRow(src.cols.map(c => (r[c] === null || r[c] === undefined ? '' : r[c])));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// GET /api/full-export/summary — what the archive will contain, so the confirm
// dialog can state it instead of asking for blind consent.
router.get('/summary', async (req, res) => {
  try {
    // COUNT over the same SQL, not the SQL itself — this dialog must not cost
    // as much as the export it is asking permission for.
    const countOf = async (sql) => {
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM (${sql}) _x`, [req.labelId]);
      return rows[0]?.n || 0;
    };
    const sections = [];
    for (const t of TABLES) sections.push({ file: t.file, rows: await countOf(t.sql) });
    let files = 0;
    for (const src of FILE_SOURCES) files += await countOf(src.sql);
    res.json({
      success: true,
      data: {
        sections,
        tables: sections.length,
        total_rows: sections.reduce((s, x) => s + x.rows, 0),
        files,
        workbooks: WORKBOOKS.map(w => w.file),
      },
    });
  } catch (error) {
    console.error('Export summary error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/full-export?files=1 — STREAMS a .zip of every table as CSV, the
// formatted workbooks, every uploaded document, and a manifest.
//
// Streamed, not buffered: a workspace's documents run to gigabytes, and
// building the archive in memory first would bound the export by RAM. Nothing
// larger than one file is ever resident.
router.get('/', async (req, res) => {
  const includeFiles = req.query.files !== '0';
  const label = await pool.query('SELECT name, slug FROM labels WHERE id = $1', [req.labelId]);
  const slug = label.rows[0]?.slug || 'workspace';
  const ts = Math.floor(Date.now() / 1000);

  // A streamed body can't switch to a JSON error once it has begun, so headers
  // and the socket timeout are set up before the first byte.
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}-export.zip"`);
  res.setHeader('Cache-Control', 'no-store');
  if (typeof req.setTimeout === 'function') req.setTimeout(0);
  if (res.socket) res.socket.setTimeout(0);

  const zip = createZipStream(res, ts);
  const manifest = [];
  let fileCount = 0;
  let fileBytes = 0;
  const skipped = [];

  try {
    // 1. CSVs. Kept in memory only long enough to also feed the workbooks.
    const byFile = {};
    for (const t of TABLES) {
      const { rows } = await pool.query(t.sql, [req.labelId]);
      byFile[t.file] = { cols: t.cols, rows };
      await zip.add(t.file, toCsv(t.cols, rows));
      manifest.push(`${t.file}: ${rows.length} rows`);
    }

    // 2. Formatted workbooks from those same rows.
    for (const spec of WORKBOOKS) {
      try {
        await zip.add(spec.file, await buildWorkbook(spec, byFile));
        manifest.push(`${spec.file}: ${spec.sheets.length} sheets`);
      } catch (e) {
        skipped.push(`${spec.file} (${e.message})`);
      }
    }

    // 3. Uploaded documents, one at a time.
    if (includeFiles) {
      const used = new Set();
      for (const src of FILE_SOURCES) {
        const { rows } = await pool.query(src.sql, [req.labelId]);
        for (const r of rows) {
          // Inline fallbacks were stored either raw-base64 or as a data: URL;
          // handing the prefix to Buffer.from() yields silent garbage, not an error.
          const inline = r.inline ? String(r.inline).replace(/^data:[^;]*;base64,/, '') : null;
          let buf = null;
          try { buf = await loadFileBuffer(r.r2_key, inline); } catch { buf = null; }
          if (!buf || !buf.length) { skipped.push(`${src.folder}/${r.id}`); continue; }
          // Names collide constantly (twelve "invoice.pdf"), so the row id
          // prefixes every entry — a ZIP with duplicate names loses files
          // silently on extract.
          let name = `${src.folder}/${r.id}-${safeName(r.filename || `${r.payee || 'file'}`)}`;
          while (used.has(name)) name = name.replace(/(\.[^.]*)?$/, (m) => `-dup${m || ''}`);
          used.add(name);
          await zip.add(name, buf);
          fileCount += 1;
          fileBytes += buf.length;
        }
      }
      manifest.push(`files/: ${fileCount} documents (${(fileBytes / 1048576).toFixed(1)} MB)`);
    } else {
      manifest.push('files/: skipped (requested without documents)');
    }

    await zip.add('README.txt',
      `Cadence workspace export\n` +
      `Workspace: ${label.rows[0]?.name || ''} (${slug})\n` +
      `Generated: ${new Date(ts * 1000).toISOString()}\n` +
      `Exported by: ${req.user?.email || ''}\n\n` +
      `CONFIDENTIAL — this archive contains contracts, payment details and tax documents.\n\n` +
      `Contents:\n${manifest.map(m => '  - ' + m).join('\n')}\n` +
      (skipped.length ? `\nUnavailable (${skipped.length}):\n${skipped.slice(0, 200).map(x => '  - ' + x).join('\n')}\n` : ''));

    await zip.finish();
    res.end();
    await logActivity(req, 'Full workspace export',
      `${TABLES.length} tables, ${fileCount} files (${(fileBytes / 1048576).toFixed(1)} MB)`);
  } catch (error) {
    console.error('Full export error:', error);
    // Headers are already out — destroying the socket is what makes the client
    // see a failed download rather than a silently truncated, valid-looking zip.
    res.destroy();
  }
});

module.exports = router;
