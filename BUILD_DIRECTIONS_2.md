# Cadence Build Directions — Phase 2 (approved items)

Twelve approved additions, transcribed from the Boom dashboard's production
implementation with its accumulated gotchas. Work them in the milestone order
below — earlier items are correctness/launch-blockers, later ones are feature
ports. Everything is tenant-scoped (`label_id` on every table and query) and
follows the conventions in BUILD_SPEC.md. Commit per milestone; run the build
and exercise the affected pages before moving on.

Milestones:
- **M1 (correctness):** items 1, 2, 3
- **M2 (splits):** item 4
- **M3 (statements):** item 8 — the big one; read its section fully first
- **M4 (recoupments):** item 9
- **M5 (data quality):** item 10
- **M6 (polish):** items 14, 15, 16, 18, 19

---

## Item 1 — Split-family payment cascade (M1)

**Invariant to build:** a split family (parent + children via `parent_id`)
must NEVER disagree about payment state. Boom learned this in production;
build it in from the start.

Server (`routes/ledger.js` + a new `lib/paymentFamily.js`):

1. `cascadePaymentFieldsToFamily(client, rootId, fields)` — inside a
   transaction, `UPDATE expenses SET <payment fields> WHERE (id = $1 OR
   parent_id = $1) AND label_id = $2`. Payment fields: `payment_status`,
   `payment_date`, `paid_by`, `paid_marked_at`, `payment_method`,
   `payment_ref`, `fx_rate_to_usd`, `rush*`, `on_hold*`.
2. Every path that flips payment state calls it with the family ROOT
   (`root = parent_id || id` — resolve before writing): mark-paid,
   pay-with-proof, batch-pay, installment recompute, PATCH when it touches a
   payment field, rush/hold toggles.
3. `recomputeFamilyPaymentStatus(client, rootId)` — sum
   `payment_installments` for the family; if sum ≥ family total (parent
   slice + children, cents-tolerant) promote the WHOLE family to Paid; if
   0 < sum < total → Partial. Call after every installment insert/delete.
4. FX stamping happens once per family flip (stamp the root's rate, cascade
   it), so split children never carry divergent historical rates.

**Client rule:** one PUT per logical flip. Never loop per-row PUTs for a
family — the server cascades; the client mirrors by updating every row where
`id === rootId || parent_id === rootId` in local state.

**Gotchas:** unpaid flip must NULL `payment_date`/`paid_by`/`payment_ref`/
`fx_rate_to_usd` across the family, not just the touched row. Totals code
everywhere assumes "parent keeps only its own slice; children carry theirs —
sum ALL rows"; never `if (row.parent_id) continue` in a money path.

## Item 2 — Forgot-password flow (M1)

- `POST /auth/forgot-password { email, workspace? }` — always 200 (never
  reveal account existence). If the email maps to multiple labels and no
  workspace given, send one email listing workspaces (or reset for all —
  pick one, document it). Store `reset_token` (crypto-random, hashed at
  rest) + `reset_expires` (60 min) on users.
- `POST /auth/reset-password { token, password }` — validate + expiry,
  set hash, clear token, **increment token_version** (kills all sessions),
  log to activity_log and user_login_logs.
- Rate-limit by IP and by email (e.g. 5/hour) — this endpoint is an
  enumeration/spam vector.
- Client: "Forgot password?" link on Login → email form → generic
  confirmation; reset page at `/reset-password?token=` with password +
  confirm, then auto-login.
- Email via the existing dispatch layer with a new `password_reset` kind.

## Item 3 — Per-tenant email identity (M1)

Every outbound email currently reads as generic "Cadence" from one address.

1. Label settings gain `email_reply_to` and reuse existing `name`,
   `accent_color`, logo.
2. The shared email shell (`lib/email.js`) takes a `label` context: label
   name in the from display (`"<Label Name> via Cadence" <platform@…>`),
   `Reply-To: email_reply_to` when set, accent-colored header bar + label
   name (logo optional — inline base64 or hosted URL) in the HTML, footer
   "Sent by <Label> via Cadence".
3. Thread the label through EVERY dispatch call site (vendor decisions,
   payment confirmations, invites, task assignments). Platform-level mail
   (operator invites, announcements) stays neutral.
4. Settings → Workspace: reply-to field + a "send test email" button.

Full white-label sending domains (per-tenant DKIM) are explicitly out of
scope for this pass — design the `label` context so a `from_override` can
slot in later.

## Item 4 — Finish splits UI (M2)

Depends on item 1. Port Boom's split surface:

- **Split modal** on a ledger row: N rows of artist / song / amount;
  running remainder footer (emerald when |remaining| < 0.01 and total > 0,
  amber otherwise); "add artist" prefills the remainder; submit calls
  `POST /entries/:id/split`. Server: parent keeps its own slice (parent
  amount is REDUCED to its slice), children created with `parent_id`,
  inherit category/payment fields/recoup flags/entry_source; write
  `artist_breakdown` JSONB on the parent so unsplit can restore.
- **Unsplit** (`DELETE /entries/:id/splits`): restore parent amount from
  artist_breakdown, delete children — refuse if any child has its own
  files or installments.
- **Cross-artist split modal** (the deferred campaigns piece): same modal
  reachable from Artist Campaigns rows, with per-row artist select.
- **Ledger rendering:** children indent under the parent with a chevron
  ("3 splits") toggling visibility; children carry their OWN toggles
  (cobrand/recoup/finished) and can carry their own files; family payment
  pill edits go through the cascade (item 1).
- **Auto-split on comma songs** (optional, port if cheap): updating a song
  field to "Song A, Song B" on a childless row splits it evenly.

**Gotchas:** soft-deleting a parent must soft-delete children (and restore
restores them). Vendor/campaign/recoupment totals count children; lists that
collapse families (Payments) fold children into the parent display but sum
family totals.

---

## Item 8 — Bank Statements / reconciliation (M3)

The flagship port. Boom's most differentiated subsystem — build it as a
premium-tier feature. Admin/Superadmin only (statements expose balances).
Every table below gains `label_id`; per-account here means per bank account
(seed with a per-label configurable account list, e.g. `bofa`, `paypal`).

### Tables

- `bank_statements(id, label_id, account, filename, r2_key, period_start,
  period_end, txn_count, status 'parsing'|'ready'|'error', error,
  import_summary JSONB, uploaded_by, created_at)`
- `bank_transactions(id, statement_id FK CASCADE, txn_date, description,
  payee_guess, amount NUMERIC, direction 'debit'|'credit', currency,
  reference, fee, matched_expense_id, match_method, match_score,
  matched_by, matched_at, dismissed, dismissed_reason, created_at)` —
  `matched_expense_id` is ALWAYS a family root id.
- `statement_dismiss_rules(id, label_id, pattern, created_by, created_at)`
- `statement_category_rules(id, label_id, pattern, category, created_by)`
- `statement_payee_map(id, label_id, bank_payee, ledger_payee, created_by)`
  with unique index on `(label_id, LOWER(bank_payee))`.

### Ingest pipeline

1. **Upload** `POST /statements/upload` (multipart file + account). CSV →
   parse synchronously; PDF → create row `status='parsing'`, respond
   immediately, parse in background. **Never parse a PDF inside the request**
   — a dense statement takes 5–10 minutes and the proxy kills the request
   (Boom shipped a 502 before learning this).
2. **PDF parsing via Claude:** stream the response (`messages.stream` +
   `finalMessage()` — the SDK refuses non-streaming calls that could exceed
   10 min at high max_tokens); max_tokens ≥ 32k; output format is
   **pipe-delimited lines, not JSON** (`DATE|DIRECTION|AMOUNT|PAYEE|
   REFERENCE|DESCRIPTION`, one per txn) — half the output tokens of JSON and
   no truncated-array failure mode. If `usage.output_tokens` hits the
   ceiling, ERROR the statement ("too long — upload the CSV") rather than
   silently reconciling a partial month. Queue background parses at
   **max 2 concurrent** — six parallel 30k-token streams starve each other
   on org rate limits and nothing finishes.
3. **CSV parsing:** header-row detection (banks put summary blocks first),
   forgiving column mapping, per-bank payee extraction (wire `BNF:`
   beneficiary, ACH `DES:` blocks, checkcard merchants, Zelle recipients;
   PayPal Name column, gross/fee/net — match on gross, fall back to net).
4. **On insert:** (a) **dedupe** — skip txns already present in another
   statement of the same account (date+amount+direction, plus reference
   when both have one else identical description); (b) **auto-dismiss
   internal movement** (currency conversion, withdrawal to bank, account
   hold, reversal, transfer patterns) with reason `internal` — on EVERY
   parse path, both CSV and PDF; (c) apply dismiss rules; then run
   auto-match; then category rules (AFTER matching so a rule never shadows
   a real invoice); write `import_summary` = {dup_skipped, auto_matched,
   rule_booked, rule_dismissed}.
5. **Stale-parse guard:** flip `parsing` rows older than 25 min to error
   ("interrupted — re-upload") in the list handler; deploys kill in-flight
   parses.

### The matcher (tiered, learning)

Candidates = ledger **families** (root + children total — the bank sees one
payment), approved/live, method-compatible with the account, same currency,
date-plausible (Paid: payment_date within ±5d of txn; Unpaid: txn not before
invoice_date − 5d). Skip internal rows entirely. Then:

1. **Exact amount tier:** single candidate → match. Name evidence via
   `nameEvidence()`: learned payee-map hit = score 1.0 (`auto-learned`),
   else fuzzy vendorsMatch tiers (parentheticals, suffix-strip, token
   Jaccard) (`auto-exact`/`auto-fuzzy`); multiple candidates need a unique
   best ≥ 0.6. **Amount-only single-candidate matches require a non-empty
   bank payee** — a nameless currency conversion once swallowed a real
   invoice by bare amount.
2. **Fee-tolerant tier:** |Δ| ≤ max($35, 1%) AND name evidence ≥ 0.6
   (`auto-fee`) — wires land a fee above the invoice.
3. **Learning:** every manual match and every created entry upserts
   `statement_payee_map` (bank descriptor → ledger payee). Month 2 mostly
   matches itself.
4. Also fold `vendor_aliases` into name evidence.

### The mini-ledger view (this is the product)

One table per statement — every debit a row: Date | Payee (linked vendor
when matched as the title, raw descriptor as sub-line, bank payee as
context — never a bare "—") | Category | Amount | Status chip | actions.
Disposition chips as filters: All / Open / To confirm / Matched / Booked /
Dismissed, with counts. Search + sortable headers. Category totals strip up
top ("Marketing $41k · Travel $2.3k · Unorganized $9k") — the statement
summarizes itself. Coverage stat = $ matched of $ live debits.

Row actions by disposition:
- **Open:** inline "Categorize…" select — picking a category BOOKS the
  debit immediately as an approved+Paid ledger entry (bank date, inferred
  method, reference, locked historical fx, `entry_source='bank_statement'`,
  learns the payee map). Fuller "Entry" form for custom payee/artist +
  "always book <payee> as <category>" rule checkbox. "Match…" ledger
  search; top-3 near-miss suggestion chips (amount-prefiltered then
  name-scored; one click links); Dismiss; "always dismiss" rule.
- **To confirm** (matched + Unpaid): Mark Paid (single or bulk) — writes
  bank date + reference through the family cascade.
- **Booked:** **Unbook** = soft-delete the created entry AND reopen the
  debit in one transaction (plain unlink orphans entries). **Matched:**
  plain unlink.
- **Dismissed:** restore; tag rows `auto` (rule) vs `internal`.

Bulk: checkbox selection across dispositions; bar offers Book-as-category /
Dismiss for open rows, Mark Paid for confirm rows, "Accept N high-confidence"
for ≥90% suggestions (confirm dialog lists the pairings). Below the table:
"Paid on ledger, no bank evidence" section (paid rows in-period with no
debit); credits collapsed. Rules manager card lists Book + Dismiss rules
with delete. `no staging copy` — everything writes straight to the master
ledger; the statement is a lens, not a second ledger.

**Excluded from the payments queue:** entries with
`entry_source='bank_statement'` are records, not payables — but they're
already Paid so the standard scope handles them; just verify.

## Item 9 — Recoupments depth (M4)

- **statementMonthFor(date):** ONE shared implementation — day-of-month
  ≥ 21 rolls to the NEXT month (use UTC getters; local getters caused
  off-by-one-month bugs). Everything that stamps or buckets statements
  uses it.
- **Recoupments page:** recoupable rows grouped artist → song/category;
  UFR toggle per item stamps the statement month; tabs Pending / Uploaded /
  Total / per-month slices; default sort = pending amount. Priority is a
  TAG with subtabs, never a sort key. Ready-for-planning markers at artist
  and release level (shared `artist_meta` from campaigns). Page + per-artist
  notes. **Add-expense** modal creates auto-approved/auto-paid/recoupable
  rows stamped `entry_source='recoupments'` with a paid toggle; deleting an
  added expense cascades app-wide. Socials editor with running $ vs amount.
  Ledger deep links (`?focus=`).
- **Prior-year subpage:** `prior_year_tag` on expenses; tagging moves rows
  to a dedicated subpage with per-artist key cards + summary + unmark.
- **Planning page** (`/recoupments/planning`): staged batch of items added
  from Recoupments/Ledger; group by song or renameable bucket labels
  (cancel must NOT wipe label edits); select-all per group; selection bar
  with per-currency + ≈USD totals; **mass-UFR commit** — on partial
  failure keep failed + uncommitted items staged (`failedIds.has(id) ||
  !committedIds.has(id)`), never wipe the batch; save-for-later deferred
  artists excluded from commit; flags + notes on cards; paid/unpaid pills.

## Item 10 — Duplicates & data-quality page (M5)

One admin page, sectioned:

- **Release dupes:** same normalized name / UPC / ISRC / Spotify URI →
  merge flow (survivor keeps union of filled fields).
- **Artist dupes:** normalized-key collisions + Levenshtein-close names →
  merge (updates artists table + every expenses/deals/income reference
  in ONE transaction — never swallow mid-transaction errors with
  `.catch(() => {})`, that no-ops the COMMIT).
- **Vendor dupes:** same-name variants (case/whitespace — compare
  LOWER(TRIM())), W9-name vs payee mismatches → link to vendor merge.
- **Invoice dupes:** normalized invoice number (strip #/INV-/leading
  zeros) colliding on the same vendor, 4 severity tiers (same number+
  vendor+amount worst).
- **Ledger artist flags:** unknown artist (not on roster), casing variants,
  multi-name strings, missing artist on artist-required categories,
  artist↔song mismatch vs releases, missing song, missing socials.
- **Dismissals:** per-flag AND per-group dismiss with audit + restore —
  operators must be able to say "this one is fine" permanently.
- **Normalization map:** "collab string → base artist" entries applied in
  bulk (transactional rename across expenses/deals/income) and remembered
  so future ingests auto-collapse.

## Item 14 — Payment analytics (M6)

Two endpoints + two cards on Payments: submissions-per-week (created
entries) and paid-per-week (payment_date), last 12 weeks, tiny bar charts
(Recharts), range preset. Anchor week boundaries in the label's timezone,
not UTC (Boom used an LA-timezone anchor to stop Sunday-night entries
drifting a week).

## Item 15 — Frozen ledger columns (M6)

Port Boom's pattern EXACTLY: all frozen data (Date, Payee, Artist, Amount,
Currency) renders inside **ONE sticky `<td>`** with an internal flex layout —
separate sticky cells produce sub-pixel gaps that flicker on scroll. Sticky
left: 0 with a right-edge shadow when scrolled; the row's background must be
painted on the sticky cell too (or row-level washes vanish under it). Do not
restructure into multiple sticky cells later; add a code comment saying so.

## Item 16 — Notifications page + smart alerts (M6)

- **Computed side** (fresh every poll): releases in the next N days,
  contracts expiring, tasks overdue, **stalled bulk deals** (is_bulk_deal
  rows with no delivered item in X days), pending approvals count.
- **Persisted side:** `user_mentions` rows (already written) — per-item
  mark-read, deep links to the source (expense comment, chat room, task).
- Bell dropdown: object shape `{ total_count, mentions, smart_alerts,
  releases, contracts }` — and "clear all" watermarks ONLY computed items;
  **mentions must be excluded from clear-all** (each is individually
  actionable) — Boom shipped that bug.
- A full `/notifications` page listing both, filterable, with mark-all-read
  for mentions separately.

## Item 18 — Keyboard shortcuts (M6)

- `useHotkeys` hook: ignores events when target is INPUT/SELECT/TEXTAREA or
  contentEditable; supports single keys + sequences (`g d`).
- Global: `⌘K` search (exists), `?` opens a shortcuts help modal (grouped
  by page), `g d/r/l/p` quick-nav.
- Per-page: Approvals `j/k` row nav, `a` approve, `r` reject, `Shift+A`
  bulk-approve confirm; Ledger `z` undo (exists) + `c` toggle columns;
  Releases `j/k/Enter` + `1-7` tabs; Calendar `←/→` month, `t` today.
- The help modal reads from one registry so it never drifts from reality.

## Item 19 — In-app user manual (M6)

- `/manual` page: one entry per app page — intro + task bullets — filtered
  by the VIEWER's live permissions (refetch permissions on window focus so
  a grant shows up without re-login).
- Sections: per-page entries grouped by nav group, keyboard shortcuts
  (pull from the item-18 registry), cross-page workflow walkthroughs
  (vendor invoice lifecycle; monthly reconciliation once M3 lands).
- Print stylesheet.
- **Standing rule going forward:** every feature PR that adds a page or a
  major capability updates the manual in the same commit.

---

## Cross-cutting requirements for every item

1. `label_id` on every new table + every query; run the dev-mode tenant
   assertion clean.
2. New expenses columns → any light-columns constant, PATCH allow-lists,
   and (when a mock adapter lands) the mock.
3. Every mutation → activity_log with a human label; bookkeeping mutations
   also → the ledger audit trail.
4. Soft-deletes attributed (`deleted_by/at`) and restorable wherever a
   restore surface exists.
5. Static routes before param routes in every router you touch.
6. Foreign currency never converts 1:1 — locked fx first, live ECB rate
   fallback, shared helper on both client and server.
7. Enter-key submit handlers get in-flight guards; drafts survive polling
   refetches.
8. `vite build` + `node --check` before every commit; exercise the page.
