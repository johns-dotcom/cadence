# Login / auth screens

> This file also covers the `g-auth-screens` global surface: it inventories every unauthenticated screen on both sides (login, invite-accept, password reset, forgot-password, suspended-workspace messaging, session-expired state).

## 1. Purpose & pairing
Sign-in and account-activation surfaces.
- OLD: `boom-dashboard/client/src/pages/Login.jsx` (124 lines) — the ONLY auth screen. No forgot-password, no reset, no invite-accept (users are provisioned by an admin via the authed `POST /auth/register`, `boom server/routes/auth.js:148`). Server: `boom server/routes/auth.js` (306 lines).
- NEW: `cadence/client/src/pages/Login.jsx` (154), `pages/AcceptInvite.jsx` (79), `pages/ResetPassword.jsx` (66). Server: `cadence server/routes/auth.js` (488) adding `GET /invite/:token`:275, `POST /accept-invite`:296, `POST /forgot-password`:404, `POST /reset-password`:456.
- NEW is a superset. The additional flows are provisioning/auth machinery required by multi-tenancy (no public signup; owner invited by email — spec §5) → **Intentional divergence**.

## 2. Route / permissions
| | OLD | NEW |
|---|---|---|
| Login route | no `<Route>`; `AppContent` renders `<Login/>` whenever `!token` (`boom App.jsx:159-166`) | explicit `/login`, redirects home when a token exists (`cadence App.jsx:112`) — equivalent behavior, cleaner form |
| Public auth routes | none besides login | `/accept-invite`, `/reset-password` (`cadence App.jsx:114-115`) — **[INT]** |
| Session-expired | `?expired=1` amber banner (`boom Login.jsx:10,106-110`) | same mechanism (`cadence Login.jsx:11,136-140`) — parity |
| Suspended workspace | n/a (single tenant) | login/google/accept-invite all 403 "This workspace has been suspended. Contact the platform operator." (`cadence auth.js:95,152,309`) — **[INT]** |
| Multi-workspace email | n/a | 409 + workspace list → client renders a workspace `<select>` (`cadence auth.js:82-85,147`; `Login.jsx:31,95-100`) — **[INT]** (known trade-off: reveals an email's workspaces, already logged in CLAUDE.md security notes) |

## 3. Server / API diff
- `POST /login`: both require email+password (`boom auth.js:12-17` area; `cadence auth.js:53-57`), both answer `Invalid credentials` uniformly (`boom auth.js` :24/:30/:35 region — grep shows three 401s; `cadence auth.js:72,92`). Parity.
- `POST /google`: OLD no-account copy "Contact your admin." (`boom auth.js:102` region, grep offset :25 within 78-150); NEW "Contact your workspace admin." (`cadence auth.js:139`) — **[INT]** wording.
- OLD-only: none (register/me/impersonate/users/logout-all/change-password exist on both — `boom auth.js:148-306`, `cadence auth.js:167-403`).
- NEW-only: invite + forgot/reset endpoints (`cadence auth.js:275-488`) — **[INT]**.
- Token claims and per-request user re-read are covered by the tenancy audit, not re-reported here.

## 4. UI structure diff
| Element | OLD (`boom Login.jsx`) | NEW (`cadence Login.jsx`) |
|---|---|---|
| Shell | centered `max-w-sm` on `bg-surface-50` (:46-47) | identical geometry on `bg-page` (:60-61) — background token drift is RC (01-design-system tokens table, page-bg row); not re-scored |
| Logo | 40px `bg-boom-600` tile w/ "B" + "boom." wordmark (:50-55) | 40px `bg-brand-600` tile w/ Disc3 icon + "Cadence" (:63-68) — RC-2 **[INT]** branding |
| Tagline | "Sign in to your dashboard" (:56) | "Sign in to your workspace" / "Reset your password" per mode (:69) — [INT] |
| Google | `<GoogleLogin … useOneTap width="280">` always rendered, helper line "Use your Boom Records Google account" (:61-72) | rendered only when `VITE_GOOGLE_CLIENT_ID` is set (:12,75-86), width 288, **no `useOneTap`**, no helper line |
| Divider | "or" hairline (:74-79) | identical (:80-84) |
| Form | email + password + dark-gray submit (`bg-gray-900 hover:bg-gray-800`, :83-103) | email + password + conditional workspace select + `btn-primary` submit (:88-105) |
| Below form | expired banner, error banner (:106-115) | forgot-password link (:107-108), forgotMsg/expired/error banners (:131-145) |
| Footer | "Boom Records Admin Dashboard" (:118-120) | "Need a workspace? Contact your administrator." (:148-150) — [INT] |
| Forgot mode | absent | inline mode swap w/ email + "Send reset link" (:110-128) — **[INT]** |

NEW-only screens (no OLD counterpart — **[INT]**, listed for g-auth-screens completeness):
- **AcceptInvite** (`cadence AcceptInvite.jsx`): token lookup on mount (:16-21), invalid/expired card w/ "Go to sign in" (:54-59), welcome card showing first name + workspace, disabled email, password ≥8 + confirm, "Set password & sign in" auto-login via localStorage + hard navigation (:23-38,61-74).
- **ResetPassword** (`cadence ResetPassword.jsx`): missing-token card (:44-48), new+confirm password ≥8, auto-login on success (:14-31).

## 5. Behavior / interactions diff
- Email/password submit flow is line-for-line equivalent (trim guard, disabled-while-empty, "Signing in…" label): `boom Login.jsx:31-43,97-103` vs `cadence Login.jsx:24-33,102-104`.
- **Google One Tap lost**: OLD passes `useOneTap` (`boom Login.jsx:68`) so returning users get the auto prompt; NEW omits it (`cadence Login.jsx:78`). P3 defect.
- Google failure copy: OLD "Google sign-in was cancelled or failed. Try again." (`boom Login.jsx:28`); NEW "Google sign-in failed." (`cadence Login.jsx:78`). P3 copy drift.
- Expired-banner copy drift: "Your session has expired." → "Your session expired." (`boom :108` / `cadence :138`). P3 (cosmetic).
- Remember-me: absent on both sides — no difference.
- NEW workspace-picker retry loop (409 → select → resubmit) and forgot-password happy path (`cadence Login.jsx:43-55`) have no OLD counterpart — [INT].
- NEW gracefully hides the Google block without a client id (`cadence Login.jsx:12,75`); OLD renders it unconditionally and would error without config — NEW-only improvement, not a defect.

## 6. Visual / design diff
- RC-1 (Inter not loaded), RC-2 (accent), RC-5 (input/button height + placeholder token) all apply; see 01-design-system.md.
- One page-specific choice beyond RC-2: OLD's submit button is deliberately **neutral dark** (`bg-gray-900 hover:bg-gray-800`, `boom Login.jsx:100`) so the Google button carries the color; NEW uses brand `btn-primary` (`cadence Login.jsx:102`). P3, MED confidence (may be an intentional part of the rebrand).
- OLD inputs use `placeholder:text-gray-300` (:88,95) vs NEW `.input` placeholder gray-400 — RC-5, not re-scored.
- NEW banner set (green forgotMsg / amber expired / red error, `cadence Login.jsx:131-145`) matches OLD's amber/red pattern (`boom :106-115`) with the same paddings. Parity.

## 7. Defect table
| # | Sev | Confidence | Defect | Evidence |
|---|---|---|---|---|
| LG-1 | P3 | HIGH | Google One Tap (`useOneTap`) dropped — returning users lose the auto sign-in prompt | OLD `boom Login.jsx:68`; NEW `cadence Login.jsx:78` |
| LG-2 | P3 | HIGH | Google-failure copy degraded ("cancelled or failed. Try again." → "failed.") and helper line "Use your … Google account" removed | OLD `boom Login.jsx:28,61-63`; NEW `cadence Login.jsx:78` |
| LG-3 | P3 | MED | Submit button re-colored from OLD's deliberate neutral `bg-gray-900` to brand primary | OLD `boom Login.jsx:100`; NEW `cadence Login.jsx:102` |
| LG-4 | P3 | LOW | Expired-session banner copy drift ("has expired" → "expired") | OLD `boom Login.jsx:108`; NEW `cadence Login.jsx:138` |

Intentional divergences: `/login` route form + token redirect (`cadence App.jsx:112`); Cadence logo/wordmark/tagline/footer (RC-2); 409 multi-workspace picker (`cadence auth.js:82-85`, `Login.jsx:95-100`); suspended-workspace 403 messaging (`cadence auth.js:95,152,309`); forgot/reset-password flow (`cadence auth.js:404-488`, `ResetPassword.jsx`); invite acceptance screen (`cadence auth.js:275-334`, `AcceptInvite.jsx`); Google block hidden without client id (`cadence Login.jsx:12`); "Contact your workspace admin" wording (`cadence auth.js:139`).

No differences found: form field set, validation gates, disabled/submitting states, session-expired mechanism, remember-me (absent both), uniform "Invalid credentials" posture.
