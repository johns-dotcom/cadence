# missing--vendor-preview-lab — Vendor form sandbox (OLD `/admin/vendor-lab`)

## 1. What it is
The internal, admin-only way to LOOK AT and EXPERIMENT ON the public vendor form
without creating anything: a generated copy of VendorSubmit that submits to a
write-nothing sandbox endpoint which still runs every validation the live form runs.
- Route: `/admin/vendor-lab` → `VendorSubmitLab`, rendered outside the shell, login
  required (OLD `client/src/App.jsx:152-160`); nav label "Vendor Form (sandbox)"
  (`components/Layout.jsx:70`).
- History that matters: a THIRD surface, `/admin/vendor-preview` (the real form,
  admin-only, which still WROTE — real approval, real R2 upload, real email), was
  deleted 2026-08-27; its path now redirects to the lab so bookmarks land on the
  write-nothing surface (App.jsx:143-151; rationale repeated in the generated lab
  header via `client/scripts/sync-vendor-lab.mjs` HEADER block).
- Server: `?sandbox=1` branch inside the real `POST /api/vendor/submit`
  (OLD `server/routes/vendor-submit.js:763`, branch :1135-1170).

## 2. OLD anatomy

**Client — `VendorSubmitLab.jsx` (1870 lines, GENERATED — do not hand-edit)**
Produced from `VendorSubmit.jsx` by `client/scripts/sync-vendor-lab.mjs` applying
exactly FOUR named, anchored deltas (script DELTAS array):
1. component rename `VendorSubmit` → `VendorSubmitLab`;
2. submit call → `POST /api/vendor/submit?sandbox=1` with `Authorization: Bearer
   <localStorage token>` (the live form posts unauthenticated);
3. admin tools always on — `adminPreview = true`, exposing the skip-validation
   toggle everywhere (in the live form that toggle is gated behind
   `?admin_preview=1` and only skips step-gating: `VendorSubmit.jsx:324-325,
   :721-722, :742, :1009-1042`);
4. amber "submissions here are REAL" banner → indigo **SANDBOX** banner ("nothing
   here is submitted… Validation still runs in full" + link to live `/submit`).
Sync mechanics (all in the script): each delta's `find` anchor must match EXACTLY
once or the script exits non-zero naming the broken delta (nothing half-written);
a **post-condition on the OUTPUT** greps every `/api/vendor/submit` occurrence and
fails unless there is exactly one and it carries `sandbox=1` — the generated lab
must be unable to write; `--check` mode exits 1 when the lab is out of date (CI
drift guard). Why a copy, not a variant prop: a prop puts every sandbox experiment
one prop-check away from the live public route; the copy exists so it can be
broken (script header, incl. the real drift story that motivated generation).

**Server — sandbox branch (`server/routes/vendor-submit.js`)**
- `sandboxAuth` (:34-48): runs `auth` ONLY when `?sandbox=1`, mounted BEFORE the
  multer `fileFields` (:763) so an anonymous sandbox request is refused without
  buffering 10 MB of upload; rationale comments :34-46 (the endpoint spends real
  AI calls, so it must not be a public bill).
- The branch sits LATE in the handler (:1111-1135), after required-field checks,
  email format, `normalizeInvoiceNum`, duplicate lookup, the typed-vs-document
  invoice-number anti-spoof gate (:903 comment — checked before the branch so the
  lab reports the same result), payment-coordinates change detection (:1057), and
  the off-roster-artist roster test (:1100-1108) — deliberately NOT at the top,
  so the lab exercises the real rules.
- Second lock inside the branch (:1136-1142): 401 if `!req.user` even though
  sandboxAuth already ran — a refactor of the conditional middleware must not
  silently open an AI-spending endpoint.
- Response (:1143-1170): `{ sandbox: true, would_create: {...full row shape,
  payment_last4 MASKED even for admins...}, files: {name+bytes per upload},
  not_exercised: ['INSERT INTO expenses','R2 upload','vendor + rep emails','AI
  discrepancy scan','W9 cross-check','vendor_payment_details upsert'] }` — the
  not-exercised list is explicit so a green sandbox result is never read as
  "this submission would have worked".
- Everything below the branch (INSERT/R2/emails, :1173+) never runs.

## 3. NEW status — confirmed absent
- Grep of cadence `server` + `client/src` for `sandbox|vendor-lab|vendor-preview|
  admin_preview` → only an unrelated comment in `server/lib/zip.js:22`.
- NEW's only vendor-form surfaces: the LIVE public `/submit/:slug` route
  (`client/src/App.jsx:113`, token-only per the security pass) and Settings'
  link + rotate (`Settings.jsx:81-85`). An admin who wants to see what vendors
  see must open the real form — and its Submit creates a real pending expense +
  R2 upload. No preview, no sandbox param in NEW `server/routes/vendor.js`.

## 4. Port requirements
- Server: `?sandbox=1` branch in NEW `routes/vendor.js` submit handler, placed
  after all validation, gated by conditional auth BEFORE multer (NEW's public
  vendor routes sit above the auth gate, so the conditional-auth-with-second-lock
  pattern ports as-is) + label scoping via the form token; return
  would_create/files/not_exercised with masked payment data.
- Client: NEW should weigh the copy-vs-prop call again — OLD's hard-won position
  is generated-copy-with-anchored-deltas (`sync-vendor-lab.mjs` ports nearly
  verbatim; add its `--check` to the verify-before-push step alongside `npm run build`). Route
  `/vendor-lab` inside the authed shell (admin-gated), plus the indigo SANDBOX
  banner and always-on skip-validation tools.
- Do NOT port `/admin/vendor-preview` — OLD deleted it deliberately (App.jsx:144-147).
- Low-cost interim alternative: a read-only preview link on Settings is NOT
  equivalent — the lab's value is submitting through the full validation path.

## 5. Defects
- [P2] No internal way to view or test the vendor form without creating real data — OLD's `/admin/vendor-lab` (generated sandbox copy + `?sandbox=1` write-nothing branch that still runs every validation, with anchored-delta sync + cannot-write post-condition) has no NEW counterpart; NEW admins must use the live token link, where Submit creates a real pending expense (OLD App.jsx:143-160, vendor-submit.js:34-48/:1111-1170, client/scripts/sync-vendor-lab.mjs) — fix: new page + sandbox branch (MED)
