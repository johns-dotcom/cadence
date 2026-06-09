/**
 * Adds commercial / distribution metadata to the releases table:
 *   upc, isrc, spotify_uri, cover_art_url, priority, notes
 *
 * Safe to re-run: every column uses ADD COLUMN IF NOT EXISTS.
 *
 * This is the canonical pattern for a one-off schema change in Cadence —
 * idempotent, transactional, runnable standalone:
 *
 *   npm run migrate:release-fields   (from server/)
 *
 * Note: these columns are NOT label-scoped themselves — they're attributes of
 * a release row that already carries label_id, so tenant isolation is
 * inherited. New *tables* always get their own `label_id INT NOT NULL
 * REFERENCES labels(id) ON DELETE CASCADE` (see runMigrations in index.js).
 */

require('dotenv').config();
const pool = require('../db');

const COLUMNS = [
  ['upc',            'VARCHAR(30)'],
  ['isrc',           'VARCHAR(30)'],
  ['spotify_uri',    'VARCHAR(255)'],
  ['cover_art_url',  'VARCHAR(500)'],
  ['priority',       `VARCHAR(20) DEFAULT 'Standard'`],
  ['notes',          'TEXT'],
];

(async function main() {
  console.log('Adding release fields…\n');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [name, type] of COLUMNS) {
      await client.query(`ALTER TABLE releases ADD COLUMN IF NOT EXISTS ${name} ${type}`);
      console.log(`  ✓ ${name} (${type})`);
    }

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'releases_priority_check'
        ) THEN
          ALTER TABLE releases
            ADD CONSTRAINT releases_priority_check
            CHECK (priority IN ('High','Standard','Low'));
        END IF;
      END$$;
    `);
    console.log('  ✓ releases_priority_check constraint');

    await client.query('COMMIT');
    console.log('\nDone.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed, rolled back:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
