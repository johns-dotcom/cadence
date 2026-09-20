# Multiple sender addresses per tenant — plan

**Status**: agreed shape, not built. Decisions taken by John on 2026-09-20:
routing is **by purpose**, verification is **by domain**.

---

## 1 · What exists today

One sender per workspace, stored as four keys in `labels.settings`:

```
email_from_name          "Boom Records"
email_from_address       ap@boomrecords.co
email_reply_to           finance@boomrecords.co
email_from_verified_at   2026-09-12T…       ← the stamp
email_from_verified_for  ap@boomrecords.co  ← what EARNED the stamp
```

`lib/email.js identityFor(label)` returns `{from, replyTo}` and uses the custom
address **only** when `email_from_verified_for` equals `email_from_address`
case-insensitively — otherwise it falls back to the platform address. That
"verified FOR this exact value" rule is the load-bearing part of the current
design and the whole model below is the same rule at a coarser grain.

Verification is a live test send from the candidate address
(`POST /api/label/email-sender/verify`), with the candidate identity forced for
that one send so a first verification doesn't test the address it is replacing.

**15 send sites.** 11 pass a workspace identity. **4 are deliberately platform**
and must stay that way — they are about Cadence, not about a tenant:

| Site | What it sends |
|---|---|
| `platform.js:1146` | operator invite |
| `platform.js:1410` | workspace-owner invite |
| `auth.js:476` | password reset |
| `labels.js:244` | the workspace's own "test email" |

8 template kinds are already enumerated in `lib/emailDispatch.js TEMPLATES`;
four more send directly (chat mention, task assignment, internal request, the
verify/test sends).

---

## 2 · The shape

**A workspace has N senders. Each email KIND resolves to a purpose, each
purpose resolves to a sender, and a sender is usable only if its domain is
verified.** Anything unresolved falls back to the workspace default, and an
unverified default falls back to the platform address — so there is never a
state where email silently stops.

```
kind (vendor_approved)  →  purpose (finance)  →  sender (ap@label.co)  →  domain (label.co) verified?
                                   ↓ no sender for that purpose
                            workspace default sender
                                   ↓ not verified
                            platform address ("Label via Cadence")
```

---

## 3 · Schema

Two new tables. **Not more `settings` JSONB keys** — `PATCH /api/label` shallow-
merges that column, so two concurrent saves can clobber each other's siblings,
and per-row verification state needs its own constraints and audit anyway.

```sql
label_email_domains (
  id, label_id, domain            CITEXT/lower-trimmed, unique per label,
  provider                        'resend' | 'sendgrid' | 'smtp',
  provider_domain_id              TEXT,       -- the provider's handle
  dns_records                     JSONB,      -- what the customer must publish
  status                          'pending' | 'verified' | 'failed',
  verified_at, last_checked_at, created_by, created_at
)

label_email_senders (
  id, label_id,
  address                         lower-trimmed, unique per label,
  display_name                    TEXT,
  reply_to                        TEXT NULL,  -- per sender; falls back to the workspace value
  domain_id                       FK → label_email_domains ON DELETE RESTRICT,
  is_default                      BOOLEAN,    -- exactly one per label
  created_by, created_at
)

label_email_routes (
  label_id, purpose, sender_id    -- PK (label_id, purpose)
)
```

Both in `db.js TENANT_TABLES` and `full-export` — a workspace's outbound
identity is part of its record.

Constraints worth spelling out:

- `ON DELETE RESTRICT` on `domain_id`: deleting a domain while senders point at
  it must refuse and name them, the same way `BankAccountsManager` refuses to
  drop an in-use account key.
- Exactly one default per label, enforced by a partial unique index
  (`WHERE is_default`) — the same mechanism `operator_workspace_roles` uses.
- A sender's address MUST be on its domain. Checked on write, and **re-checked
  at resolution time**: that is the domain-grain version of
  `email_from_verified_for`.

---

## 4 · The resolution rule

One function, `resolveSender(labelId, purpose)`, in a new `lib/emailSenders.js`.
It is the only thing that answers "what does this leave from":

1. `label_email_routes` for the purpose → sender, else the label's default sender.
2. The sender's domain must be `verified` **and** the address must still be on
   that domain. Either fails → platform address.
3. No sender at all → today's `labels.settings` identity (so nothing changes for
   a workspace that never configures this) → platform address.

`identityFor()` keeps its current signature and behaviour; `resolveSender`
produces the object it consumes. **That is what keeps the change additive**: any
call site that doesn't know about purposes keeps working and gets the default.

Cache per label for ~60s. This runs on every outbound email and the answer only
changes when an admin edits Settings.

---

## 5 · Purposes

Deliberately a **small closed set** — a per-kind UI would be twelve dropdowns
nobody fills in.

| Purpose | Kinds |
|---|---|
| `finance` | `vendor_approved`, `vendor_rejected`, `payment_confirmation`, `bulk_payment_confirmation`, `approval_request` |
| `people` | `welcome` (invites), `task_assigned` |
| `notifications` | chat mentions, statement reminders, anything internal and automatic |
| `default` | everything unmapped |

`KIND_PURPOSE` lives **next to `TEMPLATES` in `emailDispatch.js`**, and a fixture
asserts every key of `TEMPLATES` appears in it. A new template kind that routes
nowhere would otherwise silently fall to the default and nobody would notice.

---

## 6 · Server changes

| File | Change |
|---|---|
| `lib/emailSenders.js` **new** | `resolveSender`, `listSenders`, `assertAddressOnDomain`, the cache |
| `lib/emailDomains.js` **new** | provider adapters: create domain, fetch DNS records, poll status |
| `lib/email.js` | `sendEmail({…, purpose})` — optional, defaults to `'default'`; `identityFor` unchanged |
| `lib/emailDispatch.js` | `KIND_PURPOSE` map; `dispatch()` passes the derived purpose |
| `routes/labels.js` | CRUD under `/api/label/email/domains` and `/email/senders`, plus `/routes`; all `requireAdmin` |
| `routes/team.js`, `chat.js`, `taskNotify.js`, `internal-requests.js` | pass a purpose (one argument each) |

**Untouched on purpose**: the four platform sends. A fixture asserts they never
acquire a `label` or `purpose` argument — routing a password reset through a
tenant's domain would mean a tenant admin could intercept Cadence's own auth mail.

---

## 7 · Verification, per provider

The customer publishes DNS records once per domain; every address on it is then
sendable. This is what Resend and SendGrid actually check — today's test-send is
a proxy for it that proves only that one send didn't error.

- **Resend / SendGrid** — create the domain through the provider API, store the
  returned DKIM/SPF records, show them in Settings with copy buttons, poll for
  status. *Verify the exact endpoints and record shapes against current provider
  docs at build time — do not trust this document for third-party API details.*
- **SMTP** — there is no domain concept. The relay accepts the `From` or refuses
  it, so the relay IS the gate: mark the domain `verified` on a successful test
  send from one address on it, and say so in the UI. Not a weaker version of the
  same check — a different trust model, and the page should not imply otherwise.

Status must be re-checked, not stamped once: DNS records get removed, and a
domain that silently stops verifying should degrade to the platform address
rather than start bouncing. A daily poll of `pending` and `verified` domains,
in the existing boot/daily sweep slot.

---

## 8 · Client

Settings → **Email** (new panel; it outgrows the Finance tab):

- **Domains** — add, the DNS records to publish with copy buttons, status pill,
  "Check again", and a delete that refuses while senders point at it *and names
  them*.
- **Addresses** — list with display name, reply-to, domain status, a default
  marker. Add is a form, not a modal — it is the primary action on the panel.
- **Where each kind of email comes from** — four rows (the purposes) each with a
  sender picker, showing the resolved address underneath in the form it will
  appear: `Boom Records <ap@boomrecords.co>`. An unverified selection renders the
  fallback it will actually use, not a warning icon alone.

`SettingsShell` already has the rail + `?tab=` mechanism, and
`lib/settingsSections.js` is the one list the fixture cross-checks — add the
section there, not inline.

---

## 9 · Migration and rollout

1. **Schema + `resolveSender` with nothing pointing at it.** Behaviour identical.
2. **Backfill**: a workspace with a verified `settings.email_from_address`
   becomes one domain (`verified`, provider `'legacy'`) + one sender
   (`is_default`). Unverified ones are NOT migrated — they are currently falling
   back to the platform address and must keep doing so.
3. **Read path switches** to `resolveSender`, projecting to the same
   `identityFor` input. The legacy `settings.email_*` keys stay readable as the
   step-3 fallback and are not deleted (same treatment `invoice_settings` got
   when `label_records` landed).
4. **Domains UI + provider adapters.**
5. **Purpose routing UI** and the `purpose` argument at the call sites.

Steps 1–3 are invisible to every tenant; the feature becomes real at 4.

---

## 10 · What will go wrong

- **A tenant verifies a domain they don't control.** The provider's DNS check is
  the real defence — but the *add domain* form should still refuse free-mail
  domains (`gmail.com`, `outlook.com`…) outright, because a verified `gmail.com`
  is impossible and the error the provider returns won't say that.
- **Reply-to is the thing people actually get wrong.** A finance sender with no
  reply-to sends vendor replies to an unmonitored mailbox. The panel should make
  reply-to visible per sender, and default it to the workspace value rather than
  to empty.
- **No bounce or complaint handling exists.** Domain verification means email
  starts arriving *from the tenant's own domain*, so their reputation is now on
  the line, and today the first sign of trouble is a customer telling you. A
  provider webhook for bounces/complaints is a genuine follow-on — out of scope
  here, but do not ship this and call outbound email "done".
- **`trust proxy` is 1** (`server/index.js:96`). Unrelated to senders, but it is
  the same blast radius: if Railway sits behind Cloudflare that is two hops and
  every IP-keyed limiter is bucketing on a proxy address. Worth settling
  independently.
- **The 4 platform sends.** Every future email must consciously choose tenant or
  platform. The fixture is what stops the next contributor defaulting one wrongly.

---

## 11 · Gates

- `server/scripts/finance-fixtures.cjs` — pure assertions on `resolveSender`:
  every fallback rung, address-not-on-domain refused, unverified domain refused,
  exactly-one-default, and that a route to a deleted sender degrades rather than
  throws.
- A new `email-fixture.mjs` (modelled on `navpresets-fixture`) — every
  `TEMPLATES` key has a purpose; every purpose is offered in the UI; the four
  platform sends carry no tenant identity.
- `settings-fixture` — the new section has both a rail entry and a panel.

---

## 12 · Not in scope

Per-user "send as" (every teammate's address would need its own domain, and the
support burden is the product). A From picker at send time — the sender table
makes it a small addition later, and `EmailPreviewModal` is where it would go.
Inbound mail / reply parsing. Per-sender templates or signatures. Bounce
handling (flagged above as the real follow-on, not a nice-to-have).
