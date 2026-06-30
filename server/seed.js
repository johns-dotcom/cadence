/**
 * Bootstrap seed. Creates the FIRST label (tenant) and its owner, who is both
 * the label's Superadmin AND the platform admin (is_platform_admin = true).
 *
 * This is how the platform gets its first account, since there's no public
 * signup — thereafter the platform admin provisions new label workspaces via
 * the Workspaces screen (POST /api/platform/workspaces).
 *
 * Configure via env (see .env.example):
 *   SEED_LABEL_NAME, SEED_ADMIN_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD
 *
 * Refuses to run without SEED_ADMIN_PASSWORD so we never ship a default
 * credential. Re-running is a no-op if the label slug already exists. Also run
 * automatically on first boot by index.js when SEED_ADMIN_PASSWORD is present.
 *
 *   npm run seed   (from server/)
 */

const pool = require('./db');
const bcrypt = require('bcryptjs');
const { slugify } = require('./lib/slug');
require('dotenv').config();

const seed = async () => {
  const labelName = process.env.SEED_LABEL_NAME || 'Demo Label';
  const adminName = process.env.SEED_ADMIN_NAME || 'Demo Admin';
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || 'john@deanst.co').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!adminPassword) {
    throw new Error('Seed aborted — set SEED_ADMIN_PASSWORD in your environment first.');
  }

  const client = await pool.connect();
  try {
    console.log('Seeding demo workspace…');
    await client.query('BEGIN');

    const slug = slugify(labelName);
    const labelRes = await client.query(
      `INSERT INTO labels (name, slug, created_at) VALUES ($1, $2, NOW())
       ON CONFLICT (slug) DO NOTHING RETURNING id`,
      [labelName, slug]
    );

    let labelId;
    if (labelRes.rows.length) {
      labelId = labelRes.rows[0].id;
    } else {
      const existing = await client.query('SELECT id FROM labels WHERE slug = $1', [slug]);
      labelId = existing.rows[0].id;
      console.log(`  Label "${labelName}" already exists — reusing.`);
    }

    const hash = await bcrypt.hash(adminPassword, 10);
    await client.query(
      `INSERT INTO users (label_id, name, email, password_hash, role, department, hierarchy_level, is_platform_admin, platform_role, created_at)
       VALUES ($1, $2, $3, $4, 'Superadmin', 'Executive', 1, TRUE, 'owner', NOW())
       ON CONFLICT (label_id, email) DO UPDATE SET is_platform_admin = TRUE, platform_role = 'owner'`,
      [labelId, adminName, adminEmail, hash]
    );

    await client.query('COMMIT');
    console.log('Done.');
    console.log(`  Workspace : ${labelName} (slug: ${slug})`);
    console.log(`  Login     : ${adminEmail}  (platform admin)`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Seeding error:', error.message);
    throw error;
  } finally {
    client.release();
  }
};

if (require.main === module) {
  seed().then(() => process.exit(0)).catch(() => process.exit(1));
} else {
  module.exports = seed;
}
