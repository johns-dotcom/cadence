/**
 * Optional demo seed. Creates ONE label (tenant) with a single Superadmin so
 * you can log in and click around. It is NOT required for the app to run —
 * the real onboarding path is the public /signup flow, which provisions a new
 * label + owner per workspace.
 *
 * Configure via env (see .env.example):
 *   SEED_LABEL_NAME, SEED_ADMIN_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD
 *
 * Refuses to run without SEED_ADMIN_PASSWORD so we never ship a default
 * credential. Re-running is a no-op if the label slug already exists.
 *
 *   npm run seed   (from server/)
 */

const pool = require('./db');
const bcrypt = require('bcryptjs');
require('dotenv').config();

function slugify(name) {
  return String(name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'label';
}

const seed = async () => {
  const labelName = process.env.SEED_LABEL_NAME || 'Demo Label';
  const adminName = process.env.SEED_ADMIN_NAME || 'Demo Admin';
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@example.com').toLowerCase();
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
      `INSERT INTO users (label_id, name, email, password_hash, role, department, hierarchy_level, created_at)
       VALUES ($1, $2, $3, $4, 'Superadmin', 'Executive', 1, NOW())
       ON CONFLICT (label_id, email) DO NOTHING`,
      [labelId, adminName, adminEmail, hash]
    );

    await client.query('COMMIT');
    console.log('Done.');
    console.log(`  Workspace : ${labelName} (slug: ${slug})`);
    console.log(`  Login     : ${adminEmail}`);
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
