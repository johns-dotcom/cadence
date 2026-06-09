const pool = require('../db');

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'label';
}

// Generate a label slug that isn't already taken, appending -2, -3, … on
// collision. Optionally runs against a provided client (e.g. inside a tx).
async function uniqueSlug(base, client = pool) {
  const root = slugify(base);
  let slug = root;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { rows } = await client.query('SELECT 1 FROM labels WHERE slug = $1', [slug]);
    if (!rows.length) return slug;
    n += 1;
    slug = `${root}-${n}`;
  }
}

module.exports = { slugify, uniqueSlug };
