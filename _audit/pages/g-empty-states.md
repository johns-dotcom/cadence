# g-empty-states — "no data yet" patterns across major pages (global surface)

OLD: no shared primitive — ad-hoc per page (~10 `py-12/16 text-center` text empties + scattered icon-above-copy blocks on secondary pages).
NEW: no shared primitive either, but a de-facto standard — `card p-10 text-center` + lucide icon 28 `text-gray-300 mx-auto mb-3` + `text-sm text-gray-500` copy — repeated on Ledger/Payments/Releases/Deals/Vendors.

Route & permissions: global surface — sampled 8 page pairs (Ledger, Payments, Releases, Deals, Vendors, Calendar, Messages, Dashboard) per the audit plan; per-page passes own the deeper anatomy.

Design-system diffs covered by RC-1..RC-6 in `_audit/01-design-system.md`.

## 1. Layout & structure

**OLD** anatomy varies by page: bare centered text `text-sm text-gray-400 py-12` (BkLedger.jsx:2905), inline-style `#999` divs (BkVendors.jsx:4172-4175), a table row `td colSpan text-gray-300 py-16` (Releases/index.jsx:617), and icon-above-copy blocks only on secondary surfaces (BkStatements.jsx:616 Landmark 28, Duplicates.jsx:949 AlertTriangle 28 emerald "done" state, ArtistProfile.jsx:108/118 Disc3/Music 32, ArtistCampaignsQueue.jsx:204 CheckCircle2 28).

**NEW** anatomy is one repeated block on the majors: `<div className="card p-10 text-center"><Icon size={28} className="text-gray-300 mx-auto mb-3"/><p className="text-sm text-gray-500">…</p></div>` — BookOpen (Ledger.jsx:429), CreditCard (Payments.jsx:269), Music (Releases.jsx:154), TrendingUp + `kbd` CTA (Deals.jsx:106), Building2 + explainer (Vendors.jsx:257). Dashboard widgets use bare text on both sides (OLD Dashboard.jsx:633,:739 / NEW Dashboard.jsx:134,:156). TaskSurface is NEW's best form: separate truly-empty copy per surface (TaskSurface.jsx:293) and a filtered-empty state with a "Clear filters" Button (:302-311).

## 2. Visual differences

| Page | OLD | NEW | Source |
|---|---|---|---|
| Ledger | text-only `text-gray-400 py-12` (cards) / plain "No entries found." (table) | icon card, single message | OLD BkLedger.jsx:2905,:3720 / NEW Ledger.jsx:429 |
| Payments | text-only "No payments match the current filters." / mobile inline-style "No payments found." | icon card, per-tab copy + 🎉 emoji | OLD BkPayments.jsx:2923,:3394 / NEW Payments.jsx:269 |
| Releases | table row `text-gray-300` "No releases found", no icon, no CTA | icon card "No releases yet." + separate filtered "No releases match." | OLD Releases/index.jsx:617 / NEW Releases.jsx:154,:186 |
| Deals | none found (empty kanban columns render bare; only a drag "Drop here" hint, DealPipeline.jsx:386-389) | icon card + "Press `n` to add one" CTA | NEW Deals.jsx:106 |
| Vendors | branched: "No vendors found." vs "No vendors match your filters." (inline styles) | icon card "No vendors yet. They appear once you have approved ledger entries." (no filter exists on the NEW list — see vendors page pass) | OLD BkVendors.jsx:4172-4175 / NEW Vendors.jsx:256-257 |
| Calendar | "No events this day" (day panel), "Nothing upcoming" (rail) | zero empty-state strings (grep) — no day-panel/upcoming equivalents | OLD Calendar.jsx:298,:330 / NEW Calendar.jsx |
| Messages | — (no OLD chat) | "This is the beginning of …" (:537), "No people found." (:701), "No channels to join — create one instead." (:715), search "No matches" (:463) | NEW Messages.jsx |
| Dashboard | chart-empty "No releases match these filters" (:633), "No releases in the next two weeks" (:739) | "No releases yet." (:134), "Nothing in the next three weeks." (:156) | both text-only |

## 3. Copy & content differences

- NEW copy is shorter and states the *next step* twice (Deals `n` hotkey CTA, Vendors provenance explainer) — OLD empties never carry a CTA on the sampled majors.
- NEW Payments introduces the repo's only emoji empty ("Nothing here. All caught up. 🎉", Payments.jsx:269); OLD has none.
- Punctuation: NEW ends empties with periods; OLD mostly doesn't ("No releases found", "No entries found.").

## 4. Feature & interaction differences

- **Filtered-empty vs truly-empty**: OLD distinguishes on Vendors (BkVendors.jsx:4173-4175) and implies filter-awareness in Ledger/Payments copy ("…match the current filters"). NEW distinguishes on Releases (:154 vs :186) and TaskSurface (:293 vs :302-311 with Clear-filters CTA + a comment noting filters-matching-nothing used to fall through) — but **not** on Ledger (one "No entries match." for both cases) or Payments (post-filter `shown.length === 0` renders "All caught up. 🎉" even when quick filters/search are hiding rows, Payments.jsx:268-269).
- **CTA affordances**: NEW-only (Deals `kbd n`, TaskSurface Clear filters button). OLD's only interactive empty is the drag "Drop here" target.
- **Consistency**: NEW's five majors share one block verbatim; OLD's eight sampled surfaces use five different anatomies (text div, inline-style div, table row, icon block, nothing).

## 5. Data layer differences

None — rendering-only surface.

## 6. Tables & forms (if present)

Table-empty handling: OLD renders an in-table `<td colSpan>` row (Releases/index.jsx:617); NEW replaces the whole table with the empty card (e.g. Vendors.jsx:256-259, Payments.jsx:268-269) — NEW hides column headers when empty, OLD keeps them. Minor pattern difference, no severity.

## 7. Defects found

1. **P3** — Ledger empty state collapses truly-empty and filtered-empty into one message ("No entries match.", Ledger.jsx:429) where OLD's copy is filter-aware (BkLedger.jsx:2905 "No entries match the current filters." / :3720 "No entries found.") — a brand-new workspace reads as a filter problem — fix: branch on raw vs filtered length exactly like NEW's own Releases.jsx:154/:186. (HIGH)
2. **P3** — Payments empty gates on post-filter `shown` so an active quick filter/search renders "Nothing here. All caught up. 🎉" over hidden due rows (Payments.jsx:268-269) vs OLD's "No payments match the current filters." (BkPayments.jsx:2923) — fix: branch raw vs filtered; keep the celebration only for a genuinely clear Due tab. (HIGH)
3. **P3** — Calendar empty copy gone: OLD's "No events this day" / "Nothing upcoming" (Calendar.jsx:298,:330) have no NEW analog (zero empty strings in NEW Calendar.jsx — grep) — largely subsumed by the missing day-panel/upcoming rail (see calendar.md per-page pass). (LOW — surface-level symptom of a per-page layout gap)
4. **P3** — Dashboard chart filtered-empty lost: OLD renders "No releases match these filters" inside the chart region (Dashboard.jsx:630-635); NEW widgets have only truly-empty text (Dashboard.jsx:134,:156; window drift two→three weeks) — cross-ref dashboard.md. (MED)

Intentional divergences / NEW-only improvements (keep): the standardized icon-card empty block across the five majors (more consistent than OLD's five anatomies); Releases' and TaskSurface's truly-vs-filtered split + Clear-filters CTA (TaskSurface.jsx:293-311) — the pattern defects 1-2 should copy; Deals' `n`-hotkey CTA; all Messages empties (chat has no OLD counterpart).
