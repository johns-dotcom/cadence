// Per-label category vocabulary seed.
//
// The `categories` table lists dropdown OPTIONS — it is NEVER a constraint on
// stored data. `expenses.category` and `artist_income.source` are free text;
// history can hold values no longer offered, and every reader must keep
// treating them as such (unknown values render as their own lines).
//
// Order is load-bearing: `sort_order` is the seed position, and the review
// deck's 1-9 hotkeys index into the rendered list. Royalties/Reimbursements
// sit between Salary and Advance, and income Reimbursements between Drawdown
// Fund and Refund, per STATEMENTS_V3_AND_REPORTS_DIRECTIONS.md §A1.
//
// report_section drives the P&L (operating vs below_line — a $700k drawdown
// month must not read as a record revenue month); ui_group drives the Artist
// Budgets sheet sections and grouped pickers. A human's reclassification
// (section_set = TRUE) survives reseeding.

// [name, ui_group, report_section]
const EXPENSE_SEED = [
  ['Recording', 'record', 'operating'],
  ['Mixing & Mastering', 'record', 'operating'],
  ['Music Video', 'campaign', 'operating'],
  ['Marketing', 'campaign', 'operating'],
  ['PR', 'campaign', 'operating'],
  ['Sync/Licensing', 'campaign', 'operating'],
  ['Distribution', 'campaign', 'operating'],
  ['Design', 'campaign', 'operating'],
  ['Production', 'record', 'operating'],
  ['Legal', 'label', 'operating'],
  ['Services', 'record', 'operating'],
  ['Merch', 'other', 'operating'],
  ['Tour/Live', 'artist', 'operating'],
  ['Travel', 'label', 'operating'],
  ['Meals & Entertainment', 'label', 'operating'],
  ['Software / Subscriptions', 'label', 'operating'],
  ['Bank Fees', 'label', 'operating'],
  ['Salary', 'people', 'operating'],
  ['Royalties', 'artist', 'operating'],
  ['Reimbursements', 'other', 'below_line'],
  ['Advance', 'artist', 'below_line'],
  ['Other', 'other', 'operating'],
];

const INCOME_SEED = [
  ['Streaming / Distribution', 'earnings', 'operating'],
  ['Sync Licensing', 'earnings', 'operating'],
  ['Publishing', 'earnings', 'operating'],
  ['Merch', 'earnings', 'operating'],
  ['Performance', 'earnings', 'operating'],
  ['Drawdown Fund', 'other', 'below_line'],
  ['Reimbursements', 'recoveries', 'below_line'],
  ['Refund', 'recoveries', 'below_line'],
  ['Other Income', 'other', 'operating'],
];

// The six Artist-Budgets sheet sections, in display order.
const SECTION_KEYS = ['campaign', 'record', 'artist', 'people', 'label', 'other'];
const SECTION_LABELS = {
  campaign: 'Campaign & promotion',
  record: 'Making the record',
  artist: 'The artist',
  people: 'People & partners',
  label: 'Running the label',
  other: 'Other',
};
const INCOME_GROUP_LABELS = { earnings: 'Earnings', recoveries: 'Recoveries', other: 'Other' };

/**
 * Idempotent per-label seed. New names insert; existing rows only gain
 * ui_group/report_section/sort_order when a human hasn't classified them
 * (section_set IS NOT TRUE). A deactivated seeded row (tombstone left by a
 * rename) is never resurrected — the ON CONFLICT arm never touches `active`.
 */
async function seedCategoriesForLabel(db, labelId) {
  const upsert = async (kind, seed) => {
    for (let i = 0; i < seed.length; i++) {
      const [name, uiGroup, section] = seed[i];
      await db.query(
        `INSERT INTO categories (label_id, kind, name, active, seeded, sort_order, ui_group, report_section)
         VALUES ($1, $2, $3, TRUE, TRUE, $4, $5, $6)
         ON CONFLICT (label_id, kind, LOWER(TRIM(name)))
         DO UPDATE SET
           sort_order = COALESCE(categories.sort_order, EXCLUDED.sort_order),
           ui_group = CASE WHEN categories.section_set IS TRUE THEN categories.ui_group
                           ELSE EXCLUDED.ui_group END,
           report_section = CASE WHEN categories.section_set IS TRUE THEN categories.report_section
                                 ELSE EXCLUDED.report_section END,
           seeded = TRUE`,
        [labelId, kind, name, i + 1, uiGroup, section]
      );
    }
  };
  await upsert('expense', EXPENSE_SEED);
  await upsert('income', INCOME_SEED);
}

/** Seed every existing label — called from runMigrations. Never throws. */
async function seedAllLabels(db) {
  try {
    const { rows } = await db.query(`SELECT id FROM labels /* no-tenant */`);
    for (const l of rows) await seedCategoriesForLabel(db, l.id);
  } catch (e) {
    console.warn('seedCategories:', e.message);
  }
}

module.exports = {
  seedCategoriesForLabel, seedAllLabels,
  EXPENSE_SEED, INCOME_SEED,
  SECTION_KEYS, SECTION_LABELS, INCOME_GROUP_LABELS,
};
