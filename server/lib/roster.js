// Off-roster detection — one definition, shared by every entry path.
//
// Tenants legitimately market for artists who aren't on their roster (agencies,
// one-off promos). That spend is never blocked or lost — reports bucket by the
// artist string — but it should be MARKED consistently so it's visible and
// promotable, no matter whether it came from the public vendor form or an
// internal Add Invoice. `off_roster_artist` used to be set only by the vendor
// form; this makes internal entries agree.
//
// Matching uses artistKeyOf (strip case + punctuation + spacing) — the SAME
// canonical key money is bucketed by — so "Zeke Bleu" and "zeke  bleu" are the
// same artist here and in the P&L. A blank or placeholder name is NOT off-roster
// (it's unattributed), which namesAnArtist guards.
const pool = require('../db');
const { artistKeyOf, namesAnArtist } = require('./artistKey');

async function loadRosterKeys(labelId) {
  const { rows } = await pool.query('SELECT name FROM artists WHERE label_id = $1', [labelId]);
  return new Set(rows.map(r => artistKeyOf(r.name)).filter(Boolean));
}

// A real artist name that is not on the roster.
function isOffRoster(name, rosterKeys) {
  return namesAnArtist(name) && !rosterKeys.has(artistKeyOf(name));
}

// True when ANY of the entry's artist name(s) — top-level or split lines — is a
// real name absent from the roster. One roster load per call.
async function computeOffRoster(labelId, names) {
  const list = (Array.isArray(names) ? names : [names]).filter(Boolean);
  if (!list.length) return false;
  const keys = await loadRosterKeys(labelId);
  return list.some(n => isOffRoster(n, keys));
}

module.exports = { loadRosterKeys, isOffRoster, computeOffRoster };
