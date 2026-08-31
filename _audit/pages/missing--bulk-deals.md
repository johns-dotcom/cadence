# missing--bulk-deals — Bulk/influencer deals tracker (OLD `/bk/bulk-deals`)

## 1. What it is
Delivery-tracking surface for "bulk" invoices — one payment buying N deliverables
(influencer videos, posts). Answers: what did we buy, what arrived, is money running
ahead of delivery, which deals have gone silent. A bulk deal IS an approved `expenses`
row flagged `is_bulk_deal`; this page adds a per-deal deliverables checklist + risk view.
- Route: `/bk/bulk-deals` → `BkBulkDeals` (OLD `client/src/App.jsx:242`, import :59); nav label "Bulk Deals" (`components/Layout.jsx:83`).
- Permissions: inside the Protected shell; API sits behind the `/api/bk` page-permission gate — a User needs SOME bk page grant, Admin/Superadmin/Approver bypass (`server/routes/bookkeeping.js:40-60`, `/bk/bulk-deals` listed at :58). The list/item endpoints themselves have no extra role check (:13036, :13087, :13100, :13120, :13151).

## 2. OLD anatomy (`client/src/pages/BkBulkDeals.jsx`, 1002 lines)

**Header rollups** (:343-363, :379-387): active-deal count · `totalCompleted/totalDeliverables`
contracted deliverables received · committed total **per currency** (`committedByCur`, joined
with " + ") · avg cost/deliverable per currency (`unitEcon`) · completed count.

**Deal list — active section** (:409-836), one expandable card per deal:
- Header row (:423-536): payee, artist, "N artists" split badge (:435-439), category chip,
  **socials chip** — sky chip listing first handle `+n` when `social_handles` exist, amber
  "Add socials" CTA when missing (:448-469); **Stalled Nd** rose badge (:470-477); **Paid ahead**
  amber badge when `pay.pct - pct >= 25 && pct < 100` (:416, :478-485); description; amount
  (`combined_amount || amount`, currency-aware `fmt` :46-52); **per-unit cost**
  `total/contracted` (:497-501); invoice date; TWO progress bars — delivered
  `completed_items/contracted` (blue→emerald at 100%) and **Paid %** (emerald, amber when
  paid-ahead) (:504-526); **Complete** button at 100% → `bulk_deal_completed=true` via
  `PUT /bk/entries/:id` (:245-251, :527-535).
- Derivations: `contractedOf = max(bulk_deal_quantity, total_items)` — contracted quantity
  wins over logged checklist length (:303-306). `paidOf`: installment rows
  (`expense_payments`) are the precise paid signal when they exist, else family
  `payment_status='Paid'` sum from the endpoint (:307-315). **Stalled** = paid > 0, still
  under-delivered, nothing delivered in ≥30 days (anchor `last_delivery_at || invoice_date`;
  mirrors the `/api/notifications` smart alert) (:320-334; server twin: OLD
  `routes/notifications.js:264-318`, type `bulk_deal_stalled`). Stalled deals stable-sort to
  the top (:337-341).
- Expanded card (:539-833):
  - **Deal parameters**: blur-saved `bulk_deal_quantity` (number) + `bulk_deal_unit` (free
    text "videos, posts…") via `PUT /bk/entries/:id` (:160-165, :542-569), live per-unit cost.
  - **Socials section** (:570-597) + centered **socials editor modal** (:900-999): rows of
    platform (from `SOCIAL_PLATFORMS`) / handle / optional per-creator $ amount / optional
    per-artist tag when the deal is split ≥2 artists (:941-953); running total vs deal amount
    w/ balanced ✓ / left / over states (:963-991); saves JSONB `social_handles` via
    `PUT /bk/entries/:id` (:278-301) so handles surface on every reconciliation view (comment :261-265).
  - **Artist Split section** (:598-704): initialize from `artist_breakdown` (:79-85); editable
    artist/song/amount rows; Save disabled until split total == `combined_amount` ±0.01
    (:607, :625); `POST /bk/entries/:id/split {artist_breakdown}` (:124-143); Remove Split →
    `DELETE /bk/entries/:id/splits` (:145-158); <2 rows removes splits entirely (:110-122).
  - **Deliverables checklist** (:706-831): per-item complete toggle (:210-220), blur-edit
    title, **platform select** ("travels with the evidence link into Artist Campaigns"
    :738-748), video/link URL + open-in-new-tab, completed_at stamp, delete. **Ghost slots**
    (:783-811): contracted-but-unlogged deliverables rendered as dashed placeholder rows w/
    "Log" button (creates a real row titled "Video 3" etc.) — no junk DB rows until clicked,
    capped at 25. Add-deliverable input w/ Enter + double-submit guard via `addBusyRef`
    (:68-69, :189-208).
- **Completed section** (:840-898): collapsed toggle; dimmed rows w/ **effective rate**
  (total ÷ items actually received) (:874-881); Restore → `bulk_deal_completed=false` (:253-259).

**Server** (`server/routes/bookkeeping.js`):
- `GET /bk/bulk-deals` (:13035-13085): approved, non-deleted, non-voided, `parent_id IS NULL`
  roots where `is_bulk_deal=true`; three LEFT-JOIN rollups — `bulk_deal_items` counts +
  `last_delivery_at` (:13056-13062); split children `child_count/child_total/paid_child_total`
  (:13063-13070); `expense_payments` installments (:13071-13074); computes `combined_amount`
  (parent+children) and `status_paid_total` (:13043, :13051-13052).
- Items CRUD: `GET /bulk-deals/:expenseId/items` position-ordered (:13086-13098);
  `POST .../items` auto-position `MAX(position)+1` (:13099-13118); `PUT /bulk-deals/items/:itemId`
  allow-list title/video_url/platform/completed/position, auto-sets/clears `completed_at`
  (:13119-13148); `DELETE .../items/:itemId` (:13150-13159).
- Schema (`server/index.js:2833-2846`): `bulk_deal_items(id, expense_id FK CASCADE, title,
  video_url, platform, completed, completed_at, position, created_at)` + expense_id index;
  expenses cols `bulk_deal_quantity INTEGER / bulk_deal_unit TEXT / bulk_deal_completed
  BOOLEAN DEFAULT FALSE` (:1633-1634, :1651-1653).
- Intake: the approval checklist writes the marker at entry (`is_bulk_deal` from the
  answered checklist, quantity/unit from the body — bookkeeping.js:1105-1110, :1121, :1157-1158).

## 3. NEW status — PARTIAL overlap, page confirmed absent
Verified: `grep bulk client/src/App.jsx` → no route; no BulkDeals page in `client/src/pages/`.
What NEW HAS (the plumbing, not the surface):
- `bulk_deal_items` table, label-scoped (`server/index.js:798-810`) — but **no `platform`
  column** (`url` instead of `video_url`), and per-entry CRUD lives in
  `server/routes/ledger.js:1723-1791` (`GET/POST /ledger/entries/:id/bulk-items`,
  `PATCH/DELETE /ledger/bulk-items/:itemId`; POST auto-flags `is_bulk_deal` :1744).
- Drawer UI only: `LedgerEntryDrawer.jsx` bulk-items tab (:33, :89-93) — flat checklist,
  no quantity/ghosts/progress/paid view.
- Columns exist but are near-dead: `bulk_deal_quantity/unit/completed`
  (`server/index.js:663-665`; NEW `bulk_deal_completed` is `INT DEFAULT 0` — a *count*, vs
  OLD's BOOLEAN archive flag — used only by artist-campaigns PATCH
  `server/routes/artist-campaigns.js:361-363` and a chip in `ArtistCampaignDetail.jsx:176`).
- `is_bulk_deal` flag flows: Ledger column/filter/badge (`Ledger.jsx:185,332,633`),
  creators batch stamps it on every row so the family is findable
  (`server/routes/creators.js:171-179,207-212`; OLD creators.js:290-291 states the intent).
What NEW MISSES: the entire tracker — deal list w/ rollups, contracted-vs-delivered +
paid-vs-delivered progress, stalled/paid-ahead risk badges, ghost slots, per-unit economics,
completed/restore archive, socials editor on deals, split editor here, and the
`bulk_deal_stalled` notification (no `bulk` match in NEW `server/routes/notifications.js`).

## 4. Port requirements
- Schema: `ALTER TABLE bulk_deal_items ADD COLUMN platform TEXT` (NEW index.js:798 block);
  decide `bulk_deal_completed` semantics — OLD boolean archive vs NEW int count; adding a
  separate boolean (e.g. `bulk_deal_archived`) avoids repurposing the campaigns count.
- Endpoint: label-scoped `GET /api/ledger/bulk-deals` reproducing OLD's three-rollup query
  (bookkeeping.js:13038-13080) — NEW already has `expense_payments` (installments) and
  parent/child splits, so the SQL ports nearly verbatim + `label_id` predicates; extend the
  bulk-items PATCH allow-list with `platform`/`position` (ledger.js:1758-1776 currently
  title/url/completed only).
- Client: new `/bulk-deals` page + route + nav; reuse NEW primitives — `ui/Modal` (socials
  editor), `Skeleton.PageHeader/StatCards/Card`, `useCategories` not needed here,
  `components/ObjectDiscussion` optional, existing split endpoints
  (`POST /ledger/entries/:id/split` family) instead of OLD's `/bk/entries/:id/split`.
- Notification: port the `bulk_deal_stalled` smart alert (OLD notifications.js:264-318)
  into NEW `server/routes/notifications.js`, label-scoped.

## 5. Defects
- [P1] Bulk-deals tracker page missing — NEW has the flag, items table, and a bare drawer checklist but no surface for contracted-vs-delivered, paid-vs-delivered, stalled (30d) / paid-ahead (≥25pt gap) risk, per-unit economics, ghost slots, socials, or the completed archive (OLD BkBulkDeals.jsx + bookkeeping.js:13035-13159) — fix: new page + `GET /ledger/bulk-deals` rollup endpoint + `platform` col + stalled notification (HIGH)
