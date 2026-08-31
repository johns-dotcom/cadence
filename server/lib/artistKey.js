// Does a row name an artist, and which one — ONE definition.
//
// Cadence previously held three competing artist-key rules (financials.js
// LOWER(artist), artist-campaigns.js strip-all normKey, flags.js collapsed
// whitespace). This file is the canonical one. `artistKeyOf` is
// character-for-character the rule artist-campaigns.js already used, so
// existing `artist_meta.artist_key` / `song_campaign_status.artist_key` rows
// stay valid.
//
// Two different questions, two different rules — keep them apart:
//   * "how many artists are there / which bucket does this row roll into"
//     → artistBucketKey (strip punctuation+spacing, fold placeholders to '')
//   * "is this the artist the filter asked for"
//     → LOWER(TRIM()) equality at the call site, never this key.

const artistKeyOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Things typed into the artist field that carry no artist information.
// Normalized keys, so "N/A", "n/a" and "NA" are one entry. "unknown" is
// deliberately NOT here (reference-app decision 2026-08-19: it must stay
// usable as a real artist name) — do not add it without asking John.
const PLACEHOLDER_ARTIST_KEYS = new Set([
  'na', 'nan', 'none', 'null', 'unassigned', 'tbd', 'tba',
  'various', 'variousartists', 'misc', 'miscellaneous', 'other', 'general',
]);

/** '' means unattributed — empty, or a placeholder standing in for a name. */
const artistBucketKey = (raw) => {
  const k = artistKeyOf(raw);
  return PLACEHOLDER_ARTIST_KEYS.has(k) ? '' : k;
};

/**
 * Is this a real artist name? `!namesAnArtist(x)` is the correct test for
 * "this row still needs an artist" — an emptiness check lets a placeholder
 * masquerade as an answer.
 */
const namesAnArtist = (raw) => artistBucketKey(raw) !== '';

/** What to SHOW for a row's artist, or null when there is nothing to show. */
const artistLabel = (raw) => (namesAnArtist(raw) ? String(raw).trim() : null);

module.exports = { artistKeyOf, PLACEHOLDER_ARTIST_KEYS, artistBucketKey, namesAnArtist, artistLabel };
