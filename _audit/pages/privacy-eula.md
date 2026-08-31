# Privacy / EULA static pages

## 1. Purpose & pairing
Public legal pages, reachable without auth.
- OLD: `boom-dashboard/client/src/pages/Privacy.jsx` (78 lines, full 9-section privacy policy) + `pages/EULA.jsx` (68 lines, full 12-section End-User License Agreement). Routes `/privacy` + `/eula` (`boom App.jsx:162-163,172-173` — rendered pre-auth via pathname check AND as routes).
- NEW: `cadence/client/src/pages/Privacy.jsx` (17 lines) + `pages/EULA.jsx` (16 lines). Routes `/privacy` + `/eula` (`cadence App.jsx:116-117`).

## 2. Route / permissions
Parity: both sides expose both paths publicly. OLD double-registers (pathname short-circuit `boom App.jsx:162-163` + route `:172-173`); NEW registers once in the public route set (`cadence App.jsx:116-117`). No permission gates on either side.

## 3. Server / API diff
No differences found — pure static client pages on both sides; no API calls, no OG/meta handling for these paths on either server (`boom server/index.js` rewrites only `/submit`; `cadence server/index.js` only `/submit/:token`).

## 4. UI structure diff
| Element | OLD | NEW |
|---|---|---|
| Container | bare 800px inline-styled document, system-ui font, no card (`boom Privacy.jsx:3`, `EULA.jsx:3`) | `max-w-2xl` token `card p-8` on `bg-page` (`cadence Privacy.jsx:5-6`, `EULA.jsx:5-6`) |
| Back link | none | "← Back" to `/login` (`cadence Privacy.jsx:7`, `EULA.jsx:7`) — NEW-only nicety |
| Title | "Privacy Policy" / "End-User License Agreement" (`boom Privacy.jsx:4`, `EULA.jsx:4`) | "Privacy Policy" / **"Terms of Service"** (`cadence Privacy.jsx:8`, `EULA.jsx:8`) — the /eula page's own H1 no longer matches its path or OLD's document type |
| Dateline | fixed "Last updated: April 13, 2026" (`boom Privacy.jsx:5`, `EULA.jsx:5`) | dynamic `Last updated: {new Date().getFullYear()}` (`cadence Privacy.jsx:9`, `EULA.jsx:9`) — always shows the current year, falsely implying freshness |
| Body | Privacy: 9 numbered sections (collection, use, sharing incl. Anthropic/Railway disclosure, security, retention, rights, cookies/localStorage, changes, contact w/ postal address) (`boom Privacy.jsx:7-77`). EULA: 12 numbered sections (license grant, accounts, data ownership, third-party integrations, AI-features disclaimer, acceptable use, warranty disclaimer, liability cap, termination, governing law, changes, contact) (`boom EULA.jsx:7-65`) | Two-sentence placeholder each, self-labelled: "This is placeholder copy. Replace it with your organization's actual privacy policy before launch." (`cadence Privacy.jsx:11-12`; `EULA.jsx:11`) |

## 5. Behavior / interactions diff
No differences found — static content both sides; NEW adds the `/login` back-link (`cadence Privacy.jsx:7`).

## 6. Visual / design diff
- OLD deliberately opts out of the app shell (inline styles, `#333` on white, no dark-mode handling); NEW adopts app tokens (`card`, `text-ink`, `bg-page`) so it theme-switches — NEW is arguably the corrected form; not scored.
- NEW uses `prose prose-sm` classes (`cadence Privacy.jsx:10`, `EULA.jsx:10`) but the Tailwind typography plugin is not installed (plugins `[]` — see 01-design-system.md Tailwind-config table), so they are dead classes; visible spacing comes from `space-y-4` only. P3.
- RC-1/RC-2 apply trivially (font, brand accent on links).

## 7. Defect table
| # | Sev | Confidence | Defect | Evidence |
|---|---|---|---|---|
| PE-1 | P2 | HIGH | Legal content is a self-described placeholder — no actual privacy policy or terms exist; OLD ships complete documents (incl. the AI-processing and third-party disclosures a finance app materially needs). Boom-specific entity/contact/governing-law text can't be copied verbatim (multi-tenant), but a product-level Cadence policy is still owed | OLD `boom Privacy.jsx:7-77`, `boom EULA.jsx:7-65`; NEW `cadence Privacy.jsx:11-12`, `cadence EULA.jsx:11` |
| PE-2 | P3 | HIGH | Dynamic "Last updated: {current year}" dateline misrepresents document freshness (and renders as a bare year, e.g. "Last updated: 2026") | NEW `cadence Privacy.jsx:9`, `EULA.jsx:9`; OLD fixed date `boom Privacy.jsx:5` |
| PE-3 | P3 | MED | `/eula` page titled "Terms of Service" — mismatch with the path, the route name, and OLD's EULA framing | NEW `cadence EULA.jsx:8`; OLD `boom EULA.jsx:4` |
| PE-4 | P3 | HIGH | Dead `prose prose-sm` classes (typography plugin not installed) | NEW `cadence Privacy.jsx:10`, `EULA.jsx:10`; plugins `[]` per 01-design-system.md |

Intentional divergences: Boom entity name, postal address, contact email, CA governing-law clause and QuickBooks/Spotify-specific integration language cannot carry over to a multi-tenant product (branding/tenancy); NEW's back-to-login link and tokenized card shell.

Linkage: no footer or in-app link to either page exists on EITHER side (grep across both `client/src` trees — routes only), so NEW's stub pages are equally (un)reachable as OLD's full ones. Parity; noted for completeness.
