# Artist Campaigns — Full Feature Spec

Contract for the Artist Campaigns surface, transcribed from the production
implementation in the Boom dashboard (`client/src/pages/ArtistCampaigns.jsx`,
~4,500 lines; `server/routes/artist-campaigns.js`, ~1,200 lines). Cadence has a
partial implementation (index cards, cobrand toggles, review-inbox route,
Excel export); this document is the complete target. Everything below is
tenant-scoped — every table gains `label_id`, every query filters on it, and
"rep" replaces Boom's `boom_rep`.

## 1. Purpose and the core invariant

The page reconciles **every marketing-ish ledger row** against the campaigns
the marketing team actually ran, artist by artist, song by song. It answers:
what did we spend on this artist's campaigns, which influencer posts did we
pay for, which spends are co-branded, and is each song's campaign finished?

**Visibility-parity invariant (standing, non-negotiable):** every ledger row
that belongs on this page MUST appear on it. A row belongs when it is
approved, not deleted, not voided, and not reclassified (see §7 dismissals).
Rows silently missing from campaign reconciliation are treated as bugs of the
highest severity — operators sign off on totals here.

Split children are first-class: a split parent keeps only its own slice, so
**children always count in totals and always render** (grouped into their
song). Never sum "parents only."

## 2. Data model

Tenant tables (all with `label_id`):

- `expenses` — already exists. Campaign-relevant columns: `artist`, `song`,
  `category`, `cobrand BOOLEAN`, `artist_campaign` (tri-state: TRUE / FALSE /
  NULL = undecided), `is_bulk_deal` + `bulk_deal_quantity/unit/completed`,
  `social_handles JSONB`, `parent_id`, `entry_source`, `flagged`,
  `flag_reason`, `flagged_by`, `flagged_at`, `item_finished BOOLEAN`,
  `item_finished_at`, `item_finished_by`, `fx_rate_to_usd`.
- `artist_meta` — one row per normalized artist key:
  `artist_key TEXT PK, dismissed, dismissed_at/by, priority TEXT (High/
  Medium/Low or NULL), priority_updated_at/by, flagged/flag_reason/
  flagged_at/by, complete BOOLEAN (+at/by), ready_for_planning BOOLEAN
  (+at/by)`.
- `song_campaign_status` — one row per (artist_key, song_key):
  `finished BOOLEAN, notes TEXT, notes_updated_at/by, flagged/flag_reason/
  flagged_at/by`.
- `flag_dismissals` — per-expense reclassification with `flag_kind`:
  - `'artist_campaign'` = fully hidden from the page (dismissed).
  - `'artist_campaign_not_campaign'` = visible but segregated: excluded from
    all stats/totals/export; hidden entirely from non-admins.
- `review_assignments` — `expense_id, user_id, assigned_by, created_at`.
  Replace-set semantics (assigning writes the full set).
- `expense_comments` — threaded comments per expense (`author, body,
  created_at`), with @mention parsing → `user_mentions` rows.
- `campaign_chat_messages` — `room TEXT, user_id, body, created_at,
  edited_at, deleted (soft)`. Room key = URL path (index, artist, song each
  get a unique room).
- `campaign_chat_reads` — `room, user_id, last_read_at` (unread watermarks).
- `influencer_campaigns` — marketing campaigns; `expense_id` links a campaign
  to its anchoring ledger row (nullable = unlinked).

**Artist normalization:** artists group by `normalize_artist_key(name)`
(lowercase, strip non-alphanumerics) so "LIFE/LINE" ≡ "LIFELINE". Multi-artist
strings ("A feat. B", "A x B") resolve to a base artist via a normalization
map maintained on the data-quality page. All grouping on this page keys on
the normalized key; display uses the most common raw spelling.

**Song grouping:** `song_key = lower(trim(song)) || '__no_song__'`. Songs
match releases by comparing song_key to `lower(trim(release.project_name))`
so section headers can show release type/date.

## 3. Routes (server)

Mounted at `/api/artist-campaigns`, auth + page-permission gated. Order
matters: static routes (`/review-feed`, `/review-assign`, `/chat/*`,
`/export`, `/link`, `/dismiss`, `/restore`, `/not-campaign`) MUST register
before `/:artist`.

- `GET /` — index rollup. Per artist_key: display name, spend_count,
  actual_total (USD — see §10), unpaid_count/total, missing_socials_count,
  campaign_count, planned_total, unlinked_campaign_count; merged with
  artist_meta (priority, flags, dismissed, complete, ready_for_planning) and
  per-artist flagged-song counts.
- `GET /:artist` — detail: every visible ledger row for the artist (light
  columns + `social_handles`, parent socials, campaign link, comment_count,
  review_assignees JSONB, bulk-deal progress + evidence links, has_invoice),
  releases for section labels, song_campaign_status rows, influencer
  campaigns.
- `GET /review-feed` — cross-artist needs-review inbox: flagged expenses +
  flagged songs/artists + open comment threads, grouped artist → song → item,
  each with its assignees.
- `POST /review-assign` — `{ expense_id, user_ids[] }` replace-set; assigning
  surfaces the item in each assignee's My Work rail.
- Chat: `GET /chat/:room` (messages + members + unread watermark),
  `POST /chat/:room` (new message; parse @mentions → notifications),
  `POST /chat/:room/read`, `PUT /chat/messages/:id` (edit own),
  `DELETE /chat/messages/:id` (soft-delete own; moderators may delete any).
- `GET /export?artist=&song=` — styled XLSX (§11).
- `POST /link` — `{ campaign_id, expense_id }` anchor a marketing campaign to
  a ledger row (and `{ campaign_id, expense_id: null }` to unlink).
- `POST /dismiss` / `POST /restore` — per-expense `flag_kind =
  'artist_campaign'` hide/unhide.
- `POST /not-campaign` — toggle `'artist_campaign_not_campaign'`; **cascades
  to the whole split family** (parent + children) in one transaction.
- `POST /:artist/rename-song` — bulk-move every row from one song_key to a
  new song string (updates expenses.song across the family; transactional).

Per-row mutations reuse the general bookkeeping endpoints (PUT
`/ledger/:id` for artist/song/category/cobrand/is_bulk_deal/paid edits,
socials, splits); the add-expense modal POSTs the standard create endpoint
with `entry_source: 'artist_campaigns'` (auto-approved, auto-paid,
recoupable, cascades entry_source to split children).

## 4. Index view (`/artist-campaigns`)

- Header: title, subtitle, **Export Excel** button (all artists).
- **Needs-review inbox** (collapsible, renders only when non-empty): grouped
  flagged items + open threads from `/review-feed`, with per-item assignee
  chips and a multi-user assign popover.
- **Artist cards**, sorted priority-first (High → Medium → Low → none), then
  by actual+planned total descending. This sort is a deliberate product
  decision — do not "fix" it to amount-first. Each card:
  - artist name (strikethrough + emerald check when `complete`),
  - priority TAG (colored chip, never a sort-only value; editable inline),
  - actual spend (USD), planned total, unpaid badge,
  - missing-socials count, flagged-songs rollup badge,
  - ready-for-planning folder icon when set,
  - click → artist detail.
- Dismissed artists collapse into a "Dismissed" section with restore.
- Artists whose only rows are `not_campaign` get **no card at all**.
- Page-level chat opener (floating button, bottom-right, stacked above
  mobile nav/FAB) → slide-over chat room for the index.

## 5. Artist detail (`/artist-campaigns/:artist`)

- Header: artist name, priority editor, flag button (with reason popover),
  complete toggle, ready-for-planning toggle, **Add Expense**, **Export
  Excel** (artist-scoped).
- **Stat strip**: actual (USD), planned, unpaid, per-currency native totals.
- **Category breakdown card**: horizontal bars of USD-equivalent spend per
  category across every song (split children included).
- **Cobrand summary card** (renders only when ≥1 cobrand row): count,
  per-currency native totals + USD total, and a by-song breakdown. Split
  children count individually — never skip `parent_id` rows here.
- **Song groups** (one card per song_key, release-labeled when matched,
  renameable via rename-song):
  - header: song title, release type/date, per-song total, Finished toggle
    (strikethrough when done), flag button, per-song notes (§8), chat link
    to the song room, campaign links (linked influencer_campaigns chips).
  - entries table (per row): date, payee (+ bulk-deal progress chip with
    evidence-link popover), category, socials chips (§9), amount (+ USD
    suffix for foreign), paid status pill, rep, and an **icon action strip**
    (instant tooltips): view/attach invoice, cobrand toggle, bulk-deal
    toggle, edit artist/song/category (inline selects/datalists),
    cross-artist split modal, not-campaign toggle (family cascade), mark
    paid/unpaid, ledger deep-link (`/ledger?focus=<id>`), flag, comments
    thread opener, assign reviewers.
  - selection checkboxes + floating bulk bar: cobrand / un-cobrand /
    bulk-deal / paid / unpaid across selected rows.
  - row washes by provenance: indigo = born on this page, purple = born on
    Recoupments, gray+50% = dismissed. **Finished rows: emerald wash +
    strikethrough — EXCEPT flagged rows, which keep an amber wash even when
    finished** (an open flag must never blend into done-green).
- Sub-navigation: song title links to the song subpage.

## 6. Song subpage (`/artist-campaigns/:artist/:song`)

Everything scoped to one song: stat cards (total / paid / unpaid,
per-currency), category breakdown for the song, cobrand rollup, song notes,
the song's entries table (same row grammar as §5), Add Expense pinned to the
song, Export Excel scoped `?artist=&song=`, and the song's own chat room.

## 7. Dismiss vs not-campaign (two different verbs)

- **Dismiss** (`artist_campaign` kind): "this row shouldn't be on this page
  at all." Hidden everywhere (page, stats, export); restorable from the
  dismissed section.
- **Not a campaign expense** (`artist_campaign_not_campaign` kind): "real
  spend, but not campaign spend" (e.g. a manager fee invoiced under the
  artist). Stays visible to admins (segregated styling), excluded from every
  stat/total/export, hidden from non-admins, and **cascades across the split
  family** so a family can't be half-in.

## 8. Notes, comments, chat (three tiers, don't merge them)

1. **Song notes** — one shared text per song (`song_campaign_status.notes`),
   autosaving on blur with updated-by attribution. Draft must survive a
   background refetch mid-typing (keep local draft state; don't clobber from
   polling).
2. **Comment threads** — per-expense threads (expense_comments) opened from
   the row's comment icon; @mentions notify via the bell. Enter-key posting
   needs an in-flight guard (rapid Enter = one post, not two).
3. **Chat rooms** — per-page slide-over chat (index, artist, song = distinct
   rooms keyed by path). 8s polling with a full refresh every ~4th tick so
   edits/deletes propagate; @mention autocomplete over team members;
   edit/delete own messages (soft delete shows "message deleted");
   unread watermark per user; badge on the opener.

## 9. Socials editor

每 row carries `social_handles JSONB`: array of `{ platform, handle,
amount? }`. The editor is a popover with platform select + handle input +
optional per-handle amount, a running $ total vs the row amount, and
**family-artist tagging**: on split families the tag options are the union of
family artists + the row's artist + existing tags. Split children INHERIT the
parent's socials for display (muted chips) until they have their own — the
editor retargets to the child when opened from an inherited chip. Missing
socials (empty array) on a parent row counts toward the artist's
missing-socials badge; children don't double-count.

## 10. Currency

USD-equivalents use `fx_rate_to_usd` when locked (stamped at payment time
from historical ECB rates), else the cached live ECB rate — **never a silent
1:1 for foreign currency**. Per-currency native totals render alongside
(e.g. "$68,106.56 + €1,000.00"). One shared `entryUsd(expense)` helper on the
client and one `usdEquivalent(row)` on the server; every card, bar, rollup,
and export cell goes through them.

## 11. Excel export

`GET /export` streams a styled workbook (ExcelJS):
- scope narrows with the page: no params = all artists; `?artist=` = one
  artist; `?artist=&song=` = one release (button appears on index header,
  artist header, and song subpage header).
- One sheet per artist: title row, subtitle ("N songs with spend · N
  finished · Actual $X · Planned $Y · Unpaid $Z"), red header band with
  autofilter, frozen panes, sections per song (merged colored header rows
  showing song + release + section total + finished status), banded rows.
- Columns: Date, Vendor, Category, Amount (native, currency-formatted), USD,
  Status (Paid/Unpaid pill colors), Paid date, Rep, Socials (flattened),
  Invoice #, Campaign, Notes.
- Row filter matches the page: dismissed and not-campaign rows excluded;
  split children included in totals (sum ALL rows — parents keep only their
  own slice).
- Sheet names Excel-safe (31 chars, strip `\/*?[]:`) and deduped.
- No summary tab.

## 12. Add Expense modal

Fields: payee, amount, currency, date, category, song (prefilled on song
pages), rep, socials rows, optional invoice upload. Creates auto-approved +
auto-Paid + recoupable entries stamped `entry_source='artist_campaigns'`
(source cascades to any split children). These rows are EXCLUDED from the
Payments queue (they're records, not payables) and carry an indigo
provenance wash on ledger-style tables.

## 13. Mobile pass

Scrollable tab strips, wrapping toolbars, thumb-size icon strips, tables in
overflow-x wrappers with min-widths, chat as full-screen sheet with
safe-area composer, floating chat/FAB buttons stacked above bottom nav.

## 14. Engineering gotchas (each one was a production bug — build them in)

1. Route order: `/review-feed`, `/chat/*`, `/export` before `/:artist`.
2. Sum ALL rows of a split family; never `if (row.parent_id) continue` in a
   totals path.
3. `not-campaign` cascades the family transactionally; per-row toggles that
   leave siblings inconsistent are bugs.
4. Flagged + finished rows keep the amber wash (flag outranks done-green).
5. Song-note drafts and chat composer text must survive polling refetches.
6. Enter-key submit handlers need in-flight guards.
7. Priority is a TAG and a sort tier on the index — never a numeric rank
   column, and don't replace priority-first ordering with amount-first.
8. Index sort, visibility parity, and "no card for not-campaign-only
   artists" are product decisions; changing them requires an explicit ask.
9. Foreign currency never converts 1:1 (see §10) and export totals must
   equal the page totals for the same scope.
10. Assign-reviewer writes the full set (replace, not append); assignees
    surface in their My Work rail.
