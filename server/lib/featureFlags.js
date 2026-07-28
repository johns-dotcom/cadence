// Feature-flag registry. Keys are defined here (not in the DB) so the app can
// reference them safely; the DB only stores overrides. Everything defaults ON
// so a fresh install behaves exactly as before — operators opt features OFF.

const FLAGS = [
  { key: 'artist_campaigns', label: 'Artist Campaigns', description: 'Campaign hub, reviewers, comments, review inbox.', default: true },
  { key: 'recording_budgets', label: 'Recording Budgets', description: 'Budget lifecycle (draft → approved → locked) + costs-to-date.', default: true },
  { key: 'bulk_upload', label: 'Bulk Upload', description: 'CSV / master-sheet bulk ledger import.', default: true },
  { key: 'nda_builder', label: 'NDA Builder', description: 'Template-driven NDA generation with PDF / Word export.', default: true },
  { key: 'ai_features', label: 'AI features', description: 'Invoice parsing, W9 scans, and contract clause drafting.', default: true },
]
const KEYS = new Set(FLAGS.map(f => f.key))
const DEFAULTS = Object.fromEntries(FLAGS.map(f => [f.key, f.default]))

// Resolve the effective flag map for a workspace: code defaults, then the
// global override (label_id IS NULL), then the per-workspace override.
async function resolveFlags(pool, labelId) {
  const map = { ...DEFAULTS }
  if (!labelId) return map
  const { rows } = await pool.query(
    'SELECT flag_key, label_id, enabled FROM feature_flags WHERE label_id IS NULL OR label_id = $1',
    [labelId]
  )
  for (const r of rows.filter(r => r.label_id === null)) if (KEYS.has(r.flag_key)) map[r.flag_key] = r.enabled
  for (const r of rows.filter(r => r.label_id !== null)) if (KEYS.has(r.flag_key)) map[r.flag_key] = r.enabled
  return map
}

module.exports = { FLAGS, KEYS, DEFAULTS, resolveFlags }
