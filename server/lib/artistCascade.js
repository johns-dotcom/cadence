// Artist-name cascade.
//
// `artists.name` is not just a label — several tables reference an artist by
// the STRING rather than by id, because they predate the roster or because the
// value arrives from outside (a vendor form, a bank statement, an invoice).
// Renaming the roster row without rewriting those strings silently detaches the
// artist from their own money: `GET /artists/:id` matches spend on
// `LOWER(TRIM(artist))`, so the Spends tab reads zero the instant someone fixes
// a typo in a name.
//
// One list, used by every rename/merge path (artists PATCH, flags rename-artist,
// flags merge-artists) so they cannot drift apart.

// [table, column]. Every one of these is label-scoped.
const NAME_KEYED = [
  ['expenses', 'artist'],              // the ledger — the expensive one to miss
  ['deals', 'artist_name'],            // pipeline cards
  ['recording_budgets', 'artist'],     // recording budgets are name-keyed here
  ['influencer_campaigns', 'artist'],  // creator campaign rows
];

// Deliberately NOT cascaded:
//   artist_budget_sections.artist_key — that is the canonical strip-all key
//     (lib/artistKey.js), carries a UNIQUE (label_id, artist_key, section), and
//     a rename that collides needs section-by-section merging. Owned by the
//     artist-budgets surface, not by a rename.
//   statement_artist_rules.artist — a learned bank-descriptor rule; rewriting
//     it changes reconciliation history, which belongs to bank matching.

// Rewrite every name-keyed reference from `oldName` to `newName` inside one
// label. Case/whitespace-insensitive on the way in so " ezra" matches "Ezra".
// Must be handed a client already inside a transaction — a partial cascade is
// worse than none.
async function cascadeArtistName(client, labelId, oldName, newName) {
  if (!oldName || !newName) return;
  for (const [table, col] of NAME_KEYED) {
    await client.query(
      `UPDATE ${table} SET ${col} = $1
        WHERE LOWER(TRIM(${col})) = LOWER(TRIM($2)) AND label_id = $3`,
      [newName, oldName, labelId]
    );
  }
}

module.exports = { cascadeArtistName, NAME_KEYED };
