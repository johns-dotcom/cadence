# Cadence

A multi-tenant **label operations platform** for independent record labels.
Built on the architecture of the internal Boom Dashboard, rebuilt as a clean,
multi-tenant SaaS foundation.

## Stack

- **Client** — React 18 + Vite, React Router, Tailwind CSS (theme-aware via CSS variables)
- **Server** — Express + PostgreSQL (`pg`), JWT auth, Helmet, rate limiting
- **Storage** — Cloudflare R2 (S3-compatible) via `@aws-sdk/client-s3`
- **Deploy** — Nixpacks / Railway (Express serves the built client in production)

## Multi-tenancy

Cadence is multi-tenant from the ground up. The tenant root is the **label**
(`labels` table). Every user and every domain row carries a
`label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE`, and:

- The **JWT carries `label_id`** — `middleware/auth.js` rejects any token
  without one and re-checks it against the DB on every request.
- **`middleware/tenant.js`** exposes `req.labelId` and role gates
  (`requireAdmin`, `requireApprover`, `requireRole(...)`).
- **Every query is scoped** by `label_id` — no request can read or write
  across tenants, and client-supplied foreign keys (e.g. `artist_id`) are
  re-validated against the caller's label.
- **No public signup.** Workspaces are provisioned only by a **platform admin**
  (the SaaS operator) via `POST /api/platform/workspaces` — the in-app
  *Workspaces* screen. Normal users can't create a workspace.
- **Login resolves the tenant** by email; if an email exists in multiple
  workspaces, the caller passes a `workspace` slug to disambiguate.

### Per-workspace branding

Each label co-brands its workspace: its **name + logo + accent color** lead the
UI, with a subtle "Powered by Cadence" mark retained. Admins set this under
**Settings → Workspace branding**:

- **Accent color** — curated presets or any custom hex. The full 50–950 Tailwind
  `brand` scale is generated from the one hex at runtime (`utils/branding.js`)
  and written to `--color-brand-*` CSS variables, so the whole UI re-themes
  live. Clearing it falls back to the Cadence indigo default.
- **Logo** — uploaded to R2 (tenant-namespaced key), shown in the sidebar.

Branding travels with the workspace: it's returned by `/auth/me`, applied on
load (no flash), and re-applied when a platform admin enters another workspace.

### Identities & roles

There are two levels of authority:

- **Platform admin** (`users.is_platform_admin`) — the SaaS *operator*. The
  only identity allowed to act across tenants; provisions new label accounts.
  Bootstrapped via the seed (see below).
- **Label roles** (scoped within one workspace):

| Role | Capability |
|------|------------|
| **Superadmin** | Workspace owner — full control + impersonation ("view as") |
| **Admin** | Manage team and all operational data |
| **Approver** | Review/approve + full read access; cannot manage the team |
| **User** | Day-to-day access, restrictable to specific pages |

## Local development

```bash
# 1. Install (root postinstall installs both client and server)
npm install

# 2. Configure the server
cp server/.env.example server/.env     # set DATABASE_URL and JWT_SECRET
cp client/.env.example client/.env     # optional: VITE_GOOGLE_CLIENT_ID

# 3. Run both (two terminals)
npm run dev:server     # Express on :3001 — runs migrations on boot
npm run dev:client     # Vite on :5173 — proxies /api → :3001
```

### Bootstrap the first platform admin

There's no public signup, so create the first account with the seed (sets
`is_platform_admin = true`):

```bash
cd server
SEED_LABEL_NAME="Your Label" SEED_ADMIN_NAME="Your Name" \
SEED_ADMIN_EMAIL="you@example.com" SEED_ADMIN_PASSWORD="changeme123" \
npm run seed
```

On a hosted deploy (e.g. Railway), set those `SEED_*` env vars instead — the
server auto-bootstraps on first boot when no labels exist.

Then open http://localhost:5173, sign in, and use **Workspaces** (visible to
platform admins) to provision label accounts for your clients.

## Schema & migrations

The schema is **idempotent** and applied on every boot by `runMigrations()` in
`server/index.js` (`CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS`).
One-off changes can also be written as standalone, transactional, re-runnable
scripts under `server/migrations/` — see `add_release_fields.js` for the
canonical pattern. **New tenant tables must always include `label_id`.**

## Production

`npm run build` builds the client; in production Express serves
`client/dist` same-origin and exposes the API under `/api`. Health check at
`/health`.

## Project structure

```
cadence/
├── client/                 # React + Vite SPA
│   └── src/
│       ├── context/        # Auth (tenant-aware), Theme, Toast
│       ├── components/     # Layout (nav, impersonation), PageHeader
│       └── pages/          # Login, Dashboard, Releases, Artists, Team, Settings, Activity, Workspaces
└── server/                 # Express API
    ├── lib/                # r2.js (object storage), constants.js, slug.js
    ├── middleware/         # auth (JWT + tenant binding), tenant (incl. platform-admin gate), sanitize, activityLogger
    ├── migrations/         # standalone migration scripts
    └── routes/             # auth, platform (workspace provisioning), labels, team, artists, releases, dashboard, activity, settings
```
