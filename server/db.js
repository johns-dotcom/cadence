const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// ── Dev-only label-scoping assertion ──────────────────────────────────────
// Cheap regression heuristic: in non-production, warn (never throw) when a
// read/write against a known tenant table has no `label_id` in the SQL text.
// Catches an unscoped query slipping into a route before it becomes a
// cross-tenant leak. Interpolated identifiers (info_schema sweeps) and
// explicit opt-outs (a `/* no-tenant */` marker) are ignored.
if (process.env.NODE_ENV !== 'production' && process.env.DISABLE_TENANT_ASSERT !== '1') {
  const TENANT_TABLES = [
    'users', 'artists', 'releases', 'expenses', 'contracts', 'pending_contracts',
    'deals', 'tasks', 'calendar_events', 'activity_log', 'vendors', 'vendor_aliases',
    'invoices', 'campaigns', 'clearances', 'ndas', 'label_waivers', 'admin_docs',
    'salary_employees', 'salary_payments', 'artist_income', 'payment_installments',
    'bulk_deal_items', 'ledger_history', 'dsp_submissions', 'release_comments',
    'release_budget_items', 'user_page_permissions', 'user_visible_reps',
    'user_login_logs', 'entity_files', 'reps', 'artist_dev_log',
  ];
  const tableRe = new RegExp(`\\b(from|join|into|update|delete\\s+from)\\s+"?(${TENANT_TABLES.join('|')})"?\\b`, 'i');
  const origQuery = pool.query.bind(pool);
  pool.query = (text, params, cb) => {
    const sql = typeof text === 'string' ? text : text?.text;
    if (sql && !/\/\*\s*no-tenant\s*\*\//i.test(sql)) {
      const m = sql.match(tableRe);
      // Skip DDL (CREATE/ALTER) and information_schema catalog reads.
      if (m && !/^\s*(create|alter)\b/i.test(sql) && !/information_schema/i.test(sql) && !/\blabel_id\b/i.test(sql)) {
        console.warn(`[tenant-assert] query touches "${m[2]}" without label_id:\n  ${sql.replace(/\s+/g, ' ').trim().slice(0, 160)}`);
      }
    }
    return origQuery(text, params, cb);
  };
}

module.exports = pool;
