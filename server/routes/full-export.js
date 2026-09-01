const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { buildZip, toCsv } = require('../lib/zip');

const router = express.Router();
// Whole-workspace export — admin only, scoped entirely to req.labelId.
router.use(authMiddleware, withTenant, requireAdmin);

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
  // `sql` and `cols` are parallel — a length mismatch shifts every column, so add to both.
  { file: 'tasks.csv', sql: 'SELECT id,description,category,priority,status,due_date,completed_at,notes FROM tasks WHERE label_id=$1', cols: ['id', 'description', 'category', 'priority', 'status', 'due_date', 'completed_at', 'notes'] },
];

// GET /api/full-export — streams a .zip of every table as CSV + a manifest.
router.get('/', async (req, res) => {
  try {
    const entries = [];
    const manifest = [];
    for (const t of TABLES) {
      const { rows } = await pool.query(t.sql, [req.labelId]);
      entries.push({ name: t.file, content: toCsv(t.cols, rows) });
      manifest.push(`${t.file}: ${rows.length} rows`);
    }
    // Label metadata header.
    const label = await pool.query('SELECT name, slug FROM labels WHERE id = $1', [req.labelId]);
    const ts = Math.floor(Date.now() / 1000);
    entries.unshift({
      name: 'README.txt',
      content: `Cadence workspace export\nWorkspace: ${label.rows[0]?.name || ''} (${label.rows[0]?.slug || ''})\nGenerated: ${new Date(ts * 1000).toISOString()}\n\nContents:\n${manifest.map(m => '  - ' + m).join('\n')}\n`,
    });

    const zip = buildZip(entries, ts);
    await logActivity(req, 'Full workspace export', `${entries.length} files`);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${label.rows[0]?.slug || 'workspace'}-export.zip"`);
    res.send(zip);
  } catch (error) {
    console.error('Full export error:', error);
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

module.exports = router;
