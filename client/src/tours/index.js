// The click-through walkthroughs. ONE file, read by components/Tour.jsx (the
// spotlight engine), the "?" help modal (the list) and
// client/scripts/tours-fixture.mjs — which FAILS when a tour names a page that
// is not in the nav, or when a nav page has no tour at all.
//
// THE RULE: a change to a page changes its tour in the same commit, and bumps
// that tour's `version` (a date). Somebody who finished an older version is
// offered it again rather than never seeing the new steps.
//
// `target` is a comma-separated list of CSS selectors in PREFERENCE order; the
// first with a VISIBLE match wins. Every page either renders `PageHeader`
// (which always emits `data-page-header`) or carries a hand-placed
// `data-tour="<slug>-header"`, so a step always has something to point at.
// A step whose anchor never appears is SHOWN centred with a note — never
// silently skipped, because silent skipping reads as the tour being broken.
//
// `path` gates a tour with the same canView the sidebar uses: a User never sees
// the Ledger walkthrough.
import { buildNavGroups } from '../constants/navConfig'
import { CONSOLE_NAV } from '../components/PlatformLayout'

const hdr = (slug) => `[data-tour="${slug}-header"], [data-page-header]`

// ── Per-page tours ─────────────────────────────────────────────────────────
// Kept in nav order so a reader can follow the sidebar down the file.
export const PAGE_TOURS = [
  { id: 'home', title: 'Home', path: '/', version: '2026-09-20', steps: [
    { target: hdr('dashboard'), title: 'Where the day starts', body: 'Your workspace at a glance: what is due, what is waiting on you, and what the team changed. Every tile links to the page it summarises.' },
    { target: hdr('dashboard'), title: 'Built from your permissions', body: 'You only see tiles for pages you can open, so this is never a list of things you cannot act on. An admin can hide individual widgets in Settings.' },
  ]},
  { id: 'my-work', title: 'My Work', path: '/my-work', version: '2026-09-20', steps: [
    { target: hdr('my-work'), title: 'Everything assigned to you', body: 'Tabs widen as you go right: To Do Today, My Tasks, My Releases, then Team if you lead one, then every workspace if you are a platform operator.' },
    { target: hdr('my-work'), title: 'To Do Today', body: 'Overdue first, then due today, then what you already started. Each task appears in exactly one section, so the list is a running order, not a pile.' },
    { target: hdr('my-work'), title: 'My Tasks is a database', body: 'Split, Board, Table, Calendar and List views over the same tasks, with grouping, filters and saved views. Split is the default: the list on the left, the task you are reading beside it.' },
  ]},
  { id: 'messages', title: 'Messages', path: '/messages', version: '2026-09-20', steps: [
    { target: hdr('messages'), title: 'Team chat', body: 'Channels for the workspace, direct messages for one person, and threads that hang off a specific record. Everyone here can use it.' },
    { target: hdr('messages'), title: '#activity writes itself', body: 'A bot posts what the workspace does — vendor submissions, approvals, deals reaching Signed, new releases — so the feed is a running record without anyone typing it.' },
  ]},
  { id: 'calendar', title: 'Calendar', path: '/calendar', version: '2026-09-20', steps: [
    { target: hdr('calendar'), title: 'One month, every source', body: 'Release dates, DSP submissions, contract signings and expiries, your own task deadlines and anything added by hand.' },
    { target: hdr('calendar'), title: 'Filters and the day panel', body: 'Chips at the top turn each source on and off. Click a day to see its events in full, with descriptions — clicking a chip navigates, deleting is a separate explicit action.' },
  ]},
  { id: 'flags', title: 'Flags', path: '/data-quality', version: '2026-09-20', steps: [
    { target: hdr('data-quality'), title: 'Everything that looks wrong', body: 'Duplicate releases, artists, vendors and invoice numbers, plus ledger rows missing an artist, a song or a social handle. Grouped into problems (a decision to make) and incomplete fields (data entry).' },
    { target: hdr('data-quality'), title: 'Fix it here', body: 'Merge duplicates, rename an artist everywhere at once, or edit a ledger row in place. Anything you decide is fine can be dismissed permanently — that is recorded, and restorable.' },
  ]},
  { id: 'roster', title: 'Roster', path: '/artists', version: '2026-09-20', steps: [
    { target: hdr('artists'), title: 'The artists you work with', body: 'Search, filter by genre, and see who has released recently. Open one for their releases, spend, contracts, documents and a dev log.' },
    { target: hdr('artists'), title: 'Renaming is a cascade', body: 'An artist name is a foreign key in string form across expenses, deals and budgets, so renaming here rewrites all of them in one transaction rather than detaching the artist from their own money.' },
  ]},
  { id: 'releases', title: 'Releases', path: '/releases', version: '2026-09-20', steps: [
    { target: hdr('releases'), title: 'The pipeline', body: 'Every release still in progress, with its checklist completion. The tabs above switch to Catalog (what has shipped) and Marketing.' },
    { target: hdr('releases'), title: 'Open a row', body: 'Seven tabs per release: Checklist, Metadata & Links, DSP, Budget, Activity, Comments and Details — the same workspace whether you open it inline or on its own page.' },
  ]},
  { id: 'catalog', title: 'Catalog', path: '/catalog', version: '2026-09-20', steps: [
    { target: hdr('catalog'), title: 'What has shipped', body: 'Released records grouped by year, with artwork pulled from Spotify. A release moves here from the pipeline once it is out.' },
  ]},
  { id: 'marketing', title: 'Marketing', path: '/marketing', version: '2026-09-20', steps: [
    { target: hdr('marketing'), title: 'Campaigns', body: 'Influencer and promo campaigns with their creators, deliverables and spend.' },
  ]},
  { id: 'deals', title: 'Deals', path: '/deals', version: '2026-09-20', steps: [
    { target: hdr('deals'), title: 'Scouting to Signed', body: 'Prospects move left to right across six stages. Drag a card, or use Next on the card itself — which is the move most people make most of the time.' },
    { target: hdr('deals'), title: 'Open a card', body: 'Terms, contact details, links, priority and follow-up date. Failed saves keep the drawer open with your edits intact.' },
  ]},
  { id: 'contracts', title: 'Contracts', path: '/contracts', version: '2026-09-20', steps: [
    { target: hdr('contracts'), title: 'Agreements on file', body: 'Every contract with its dates, royalty split, advance and documents. Two folds above the table warn about artists with no contract and contracts expiring soon.' },
    { target: hdr('contracts'), title: 'Open one', body: 'The detail view shows the terms, the financial obligations, every document revision, and everything linked to it — releases, income and spend, converted to USD at the locked rate.' },
  ]},
  { id: 'pending-contracts', title: 'Pending', path: '/pending-contracts', version: '2026-09-20', steps: [
    { target: hdr('pending-contracts'), title: 'Out for signature', body: 'Agreements sent but not signed. Promoting one here makes it an active contract.' },
  ]},
  { id: 'renewals', title: 'Renewals', path: '/renewals', version: '2026-09-20', steps: [
    { target: hdr('renewals'), title: 'The whole portfolio', body: 'Every contract by expiry, banded: expired, under 30 days, under 90, and healthy. Days are counted on your local calendar, so a contract that ended yesterday reads as expired, not as due today.' },
  ]},
  { id: 'legal', title: 'NDAs', path: '/legal', version: '2026-09-20', steps: [
    { target: hdr('legal'), title: 'Who has signed what', body: 'The NDA counterparty tracker: who it went to, its status and notes. The Documents tab is where you create one.' },
  ]},
  { id: 'doc-contract', title: 'Draft a contract', path: '/contracts/create', version: '2026-09-20', steps: [
    { target: hdr('contracts-create'), title: 'Generate a draft', body: 'Enter the terms and the AI drafts the agreement, using your workspace name and your recent contracts of the same type as the house style. Nothing is saved until you export it.' },
  ]},
  { id: 'doc-nda', title: 'Create an NDA', path: '/create-nda', version: '2026-09-20', steps: [
    { target: hdr('create-nda'), title: 'Five templates', body: 'Pick one, toggle the optional clauses, and the numbering closes up behind anything you remove. Export as PDF or Word; editing the body by hand keeps working as you change the parties.' },
  ]},
  { id: 'doc-waiver', title: 'Label waiver', path: '/label-waivers', version: '2026-09-20', steps: [
    { target: hdr('label-waivers'), title: 'Issue a waiver', body: 'Fills the standard grant of rights and files the PDF on the artist’s Documents tab when the name matches someone on the roster.' },
  ]},
  { id: 'doc-clearance', title: 'Artist clearance', path: '/clearances', version: '2026-09-20', steps: [
    { target: hdr('clearances'), title: 'The clearance chart', body: 'One block per track with the credits, splits and approvals. Exports as the canonical XLSX and files it against the artist.' },
  ]},
  { id: 'doc-invoice', title: 'Create an invoice', path: '/invoices', version: '2026-09-20', steps: [
    { target: hdr('invoices'), title: 'Invoice a client', body: 'An invoice you send OUT, not a bill you receive. Terms decide the printed due date, and the date is stamped in your workspace timezone so an evening invoice is not dated tomorrow.' },
  ]},
  { id: 'brand', title: 'Brand', path: '/brand', version: '2026-09-20', steps: [
    { target: hdr('brand'), title: 'Assets', body: 'Logos, artwork and press material for the label, in one place to hand out.' },
  ]},
  { id: 'approvals', title: 'Approvals', path: '/approvals', version: '2026-09-20', steps: [
    { target: hdr('approvals'), title: 'The queue', body: 'Everything submitted and waiting on a decision, vendor-submitted or entered by staff. j and k move, a approves, r rejects.' },
    { target: hdr('approvals'), title: 'Review, not a single click', body: 'Approving opens a checklist deck: bulk deal, co-brand, recoupable, artist campaign. The answers are written onto the row, so the decision is recorded rather than assumed.' },
    { target: hdr('approvals'), title: 'What the card tells you', body: 'Duplicate warnings, a W-9 chip, unknown artists with a suggested spelling, and a banner when the vendor’s payment details have changed since last time — the shape invoice fraud takes.' },
  ]},
  { id: 'payments', title: 'Payments', path: '/payments', version: '2026-09-20', steps: [
    { target: hdr('payments'), title: 'What is owed', body: 'Approved invoices waiting to be paid, with quick filters, per-vendor chips and an amount grammar in the search box: 500, 500-1000, >500.' },
    { target: hdr('payments'), title: 'Paying', body: 'Mark paid, pay with proof, or batch-pay a selection with one reference and one proof file. Rush and hold are mutually exclusive, and paying clears both across the whole split family.' },
  ]},
  { id: 'ledger', title: 'Ledger', path: '/ledger', version: '2026-09-20', steps: [
    { target: hdr('ledger'), title: 'Every expense', body: 'The register: filter, sort, edit inline, and undo up to twenty steps with z. The first column is frozen so the date and payee stay with the row as you scroll.' },
    { target: hdr('ledger'), title: 'Splits are families', body: 'An invoice split across artists is a parent plus children. Totals count the family once; the row you see is the parent holding the first slice.' },
    { target: hdr('ledger'), title: 'Export what you filtered', body: 'c toggles columns, x exports. The workbook carries the filters on screen, so what the accountant gets is the page you were looking at.' },
  ]},
  { id: 'creators', title: 'Creators', path: '/creators', version: '2026-09-20', steps: [
    { target: hdr('creators'), title: 'Payments without an invoice', body: 'Small creator and influencer payments, usually PayPal. A batch becomes one row per recipient, because that is how the statement will show it.' },
    { target: hdr('creators'), title: '1099 exposure', body: 'The directory totals each creator per calendar year against the filing threshold, so the ones that need a form are visible before January.' },
  ]},
  { id: 'add-invoice', title: 'Add an invoice', path: '/add-invoice', version: '2026-09-20', steps: [
    { target: hdr('add-invoice'), title: 'Enter a bill', body: 'Attach the invoice and the AI reads the number, amount, currency and category. Everything it filled is marked so you can check it.' },
    { target: hdr('add-invoice'), title: 'Duplicates are caught here', body: 'The invoice number is checked against what is already filed as you type — including different spellings of the same number — and again on save.' },
  ]},
  { id: 'reimburse', title: 'Reimbursement', path: '/ledger/new-reimbursement', version: '2026-09-20', steps: [
    { target: hdr('reimburse'), title: 'Claim an expense', body: 'The same form in reimbursement mode: a receipt instead of an invoice, and the money goes back to a person rather than out to a vendor.' },
  ]},
  { id: 'invoice-search', title: 'Search invoices', path: '/invoice-search', version: '2026-09-20', steps: [
    { target: hdr('invoice-search'), title: 'Find any invoice', body: 'One row per invoice family, searchable by payee, number, description or artist — and by a normalised number, so INV-0002 and inv.2 find each other.' },
    { target: hdr('invoice-search'), title: 'The charts filter the list', body: 'Weekly intake and outflow. Click a bar to narrow the table to that week on the same basis the bar was bucketed by.' },
  ]},
  { id: 'bulk-upload', title: 'Bulk upload', path: '/bulk-upload', version: '2026-09-20', steps: [
    { target: hdr('bulk-upload'), title: 'Many invoices at once', body: 'Drop the invoices and any payment proofs. Each is read by the AI, proofs are matched to invoices by payee and amount, and you review the grid before anything is created.' },
  ]},
  { id: 'bank-review', title: 'Bank — for review', path: '/bank-matching', version: '2026-09-20', steps: [
    { target: hdr('bank-matching'), title: 'Lines still to answer', body: 'Every bank transaction that is not yet tied to an invoice. Each row has three possible answers: match it, book it as an expense nobody invoiced, or say no invoice is coming.' },
    { target: hdr('bank-matching'), title: 'Suggestions, not decisions', body: 'A suggestion arms a comparison panel rather than filing the money on one click. Where two candidates are within a hair of each other it says so.' },
    { target: hdr('bank-matching'), title: 'Rules keep the queue finite', body: 'Teach it once — this descriptor is that vendor, these charges never have an invoice — and the same lines answer themselves next month.' },
  ]},
  { id: 'bank-ledger', title: 'Bank — categorized', path: '/bank-ledger', version: '2026-09-20', steps: [
    { target: hdr('bank-ledger'), title: 'The bank half of the ledger', body: 'The rows that came from a statement, with a month lens: opened, in, out, closed, and whether it ties to the statement’s own printed balances.' },
    { target: hdr('bank-ledger'), title: 'Lines with no row here', body: 'Below the table, the statement lines that have no editable row on this page — so a month can be read to the end rather than looking complete because something is missing.' },
  ]},
  { id: 'bank-statements', title: 'Statements', path: '/bank-statements', version: '2026-09-20', steps: [
    { target: hdr('bank-statements'), title: 'The files', body: 'Upload a PDF or CSV per account per month. Parsing is checked against the statement’s own printed totals — a parse that does not reconcile is refused rather than trusted.' },
    { target: hdr('bank-statements'), title: 'By month', body: 'Coverage per month with the accounts still missing named, so a month cannot read as complete while an entire account was never uploaded.' },
  ]},
  { id: 'ledger-matching', title: 'Reconcile', path: '/ledger-matching', version: '2026-09-20', steps: [
    { target: hdr('ledger-matching'), title: 'Against an outside sheet', body: 'Upload the bookkeeper’s workbook and see the differences in eight categories. Nothing is saved: a diff of a file you do not control is stale the moment either side edits.' },
  ]},
  { id: 'vendors', title: 'Vendors', path: '/vendors', version: '2026-09-20', steps: [
    { target: hdr('vendors'), title: 'Who you pay', body: 'Every payee with their spend, invoice count, W-9 status and saved email addresses. Totals are per currency with a USD equivalent, never a mixed sum.' },
    { target: hdr('vendors'), title: 'Merging is reversible', body: 'Folding two spellings together records exactly what moved, so it can be undone by id — and the bank matcher is repointed at the same time, or the next statement would recreate the vendor you just merged away.' },
  ]},
  { id: 'vendors-added', title: 'Added expenses', path: '/vendors/added-expenses', version: '2026-09-20', steps: [
    { target: hdr('vendors-added'), title: 'Payees with no invoice', body: 'Vendors that exist only because somebody added an expense on Recoupments or Campaigns. Those rows carry no invoice number, so the usual duplicate check cannot see them — this page pairs them up instead.' },
  ]},
  { id: 'bulk-deals', title: 'Bulk deals', path: '/bulk-deals', version: '2026-09-20', steps: [
    { target: hdr('bulk-deals'), title: 'Paid versus delivered', body: 'Deals bought in bulk, with two bars per card: how much has been delivered and how much has been paid. The gap between them is the exposure.' },
  ]},
  { id: 'reports', title: 'Reports', path: '/reports', version: '2026-09-20', steps: [
    { target: hdr('reports'), title: 'P&L and balance sheet', body: 'Cash basis, mastered by the ledger: every live split slice counted once and dated by its family. Any figure drills through to the rows behind it.' },
    { target: hdr('reports'), title: 'Drill and fix', body: 'From a drilled cell you can recategorise, set an artist, move a row to another reported month or dismiss it — and review a whole cell as a deck.' },
  ]},
  { id: 'financials', title: 'Financials', path: '/financials', version: '2026-09-20', steps: [
    { target: hdr('financials'), title: 'The other basis', body: 'Invoice basis, including unpaid — so it will not equal Reports, deliberately. KPI cards, weekly trend, aging and a cash forecast, each clickable through to its rows.' },
  ]},
  { id: 'recoupments', title: 'Recoupments', path: '/recoupments', version: '2026-09-20', steps: [
    { target: hdr('recoupments'), title: 'What is recoupable', body: 'Per artist, on a bank basis: what is provable against a statement, what is still waiting for one, and what is unpaid. Claiming an item stamps the statement month it belongs to.' },
    { target: hdr('recoupments'), title: 'Review before claiming', body: 'Bank-born rows are recoupable by column default, which is not a decision — the review queue is where somebody actually answers, and for which artist.' },
  ]},
  { id: 'recoup-planning', title: 'Planning', path: '/recoupments/planning', version: '2026-09-20', steps: [
    { target: hdr('recoupments-planning'), title: 'Stage a batch', body: 'A draft of what goes on this month’s statement. It lives in your browser until you commit, because a half-finished thought is not shared state.' },
    { target: hdr('recoupments-planning'), title: 'Commit', body: 'Marks everything staged as claimed and stamps its batch label. Anything that fails stays staged and is named, rather than the batch being wiped.' },
  ]},
  { id: 'recoup-audit', title: 'Audit', path: '/recoupments/audit', version: '2026-09-20', steps: [
    { target: hdr('recoupments-audit'), title: 'Five integrity checks', body: 'Money not claimed, money never judged, and money claimed twice — never summed into one number, because they need opposite actions.' },
  ]},
  { id: 'recoup-prior', title: 'Prior year', path: '/recoupments/prior-year', version: '2026-09-20', steps: [
    { target: hdr('recoupments-prior-year'), title: 'The archive', body: 'Entries tagged out of the main list, by artist and year. Untag one and it reappears on Recoupments where it can be claimed.' },
  ]},
  { id: 'artist-budgets', title: 'Artist budgets', path: '/artist-budgets', version: '2026-09-20', steps: [
    { target: hdr('artist-budgets'), title: 'Planned against actual', body: 'Six section numbers per artist versus what has been spent. Spent and open are kept apart — an unpaid invoice is committed, not gone.' },
  ]},
  { id: 'artist-campaigns', title: 'Campaigns', path: '/artist-campaigns', version: '2026-09-20', steps: [
    { target: hdr('artist-campaigns'), title: 'Two layers', body: 'Settled money (already in the P&L) and committed money (not yet), never double-counted — the split is by membership of what the P&L actually counted, not a second guess at the rule.' },
  ]},
  { id: 'recording-budgets', title: 'Recording budgets', path: '/recording-budgets', version: '2026-09-20', steps: [
    { target: hdr('recording-budgets'), title: 'Per project', body: 'A budget or a fund, six sections of line items, contingency on top, and a costs-to-date view against the real ledger spend for that artist.' },
  ]},
  { id: 'settings', title: 'Settings', path: '/settings', version: '2026-09-20', steps: [
    { target: hdr('settings'), title: 'Your workspace', body: 'Branding, the outbound email identity, invoice details, the business timezone, per-person page permissions and your own theme and sidebar.' },
  ]},
  { id: 'requests', title: 'Requests', path: '/requests', version: '2026-09-20', steps: [
    { target: hdr('requests'), title: 'Ask for something', body: 'Send a feature request or a bug straight to the platform team, with a preview before it goes.' },
  ]},
  { id: 'team', title: 'People', path: '/team', version: '2026-09-20', steps: [
    { target: hdr('team'), title: 'Who is here', body: 'Invite people, set a role and a department, and see each person’s open work. Department is a permission boundary, not a label — it decides whose tasks a lead can see.' },
  ]},
  { id: 'salary', title: 'Salary', path: '/salary', version: '2026-09-20', steps: [
    { target: hdr('salary'), title: 'Payroll', body: 'Staff, their pay and what has been marked paid this month, grouped by department with per-currency totals.' },
  ]},
  { id: 'activity', title: 'Activity', path: '/activity', version: '2026-09-20', steps: [
    { target: hdr('activity'), title: 'The audit feed', body: 'Who did what, filterable by person, department, category, method and date.' },
  ]},
  { id: 'usage', title: 'Usage', path: '/usage', version: '2026-09-20', steps: [
    { target: hdr('usage'), title: 'Who uses what', body: 'Page views, logins and the most active people. Operators viewing a workspace are excluded, so the numbers are your team’s own.' },
  ]},
  { id: 'admin-docs', title: 'Admin docs', path: '/admin-docs', version: '2026-09-20', steps: [
    { target: hdr('admin-docs'), title: 'The vault', body: 'Company documents with expiry tracking and a confidentiality tier. Restricted documents are visible only to a Superadmin.' },
  ]},
  { id: 'vendor-lab', title: 'Vendor sandbox', path: '/vendor-lab', version: '2026-09-20', steps: [
    { target: hdr('vendor-lab'), title: 'The real form, writing nothing', body: 'The public vendor form wired to a dry run: every validation still runs, so a refusal here is the refusal a vendor gets, but no row, file or email is ever created.' },
  ]},
]

// ── The welcome walk, BUILT FROM THE NAV ───────────────────────────────────
// Not a hand-kept list: it walks buildNavGroups in sidebar order and takes each
// page's own steps. A page added to the nav joins the walk automatically, which
// is the only way "the walkthrough covers everything" stays true.
export function buildWelcome(groups) {
  const byPath = new Map(PAGE_TOURS.map(t => [t.path, t]))
  const steps = []
  for (const g of groups) {
    for (const item of g.items || []) {
      const kids = item.tabbed || item.collapsible ? item.children : [item]
      for (const c of kids) {
        const t = byPath.get(c.path)
        if (!t) continue
        for (const st of t.steps) {
          steps.push({
            ...st,
            path: c.path,
            page: c.label,
            family: item.tabbed ? item.key : null,
            familyLabel: item.tabbed ? item.label : null,
          })
        }
      }
    }
  }
  return {
    id: 'welcome', title: 'Welcome to Cadence', path: '/', multipage: true,
    version: '2026-09-20', steps,
  }
}


// ── The operator console ───────────────────────────────────────────────────
// A DIFFERENT SHELL with its own nav, and — the trap — four paths in common
// with the tenant app: `/`, `/my-work`, `/messages` and `/calendar` are
// different pages in each. Tours are therefore chosen by SHELL, never by path
// alone, or an operator reading the console Overview would be told about the
// workspace Dashboard.
//
// Every console page inherits `[data-tour="console-header"]` from
// PlatformLayout's topbar, so these anchor without touching the pages.
const chdr = '[data-tour="console-header"], [data-page-header]'

export const CONSOLE_TOURS = [
  { id: 'console-overview', title: 'Overview', path: '/', version: '2026-09-20', steps: [
    { target: chdr, title: 'Every workspace at once', body: 'Counts, this month\'s money and the backlog for each tenant you can reach — each figure is the sum of the cards below it, never a separate query that could disagree.' },
    { target: chdr, title: 'Needs attention', body: 'Only conditions you can act on: suspended, no members, an approval backlog, idle for a month. A suspended workspace is not also reported as idle — it is idle by design.' },
  ]},
  { id: 'console-my-work', title: 'My Work', path: '/my-work', version: '2026-09-20', steps: [
    { target: chdr, title: 'Your tasks, everywhere', body: 'One to-do list across every workspace you can reach, including Platform HQ. Each row carries its workspace\'s colour and two-letter tag.' },
    { target: chdr, title: 'Two lists, never summed', body: 'What is waiting on you, and what you handed to somebody inside a workspace. They need opposite actions, so they are never added together.' },
    { target: chdr, title: 'Filing and assigning', body: 'New task picks a workspace — filing into one you have never opened creates your membership there, which is logged in that workspace. Assigning to their people emails them and is recorded in their activity log.' },
  ]},
  { id: 'console-messages', title: 'Messages', path: '/messages', version: '2026-09-20', steps: [
    { target: chdr, title: 'Operator chat and workspace boards', body: 'Your own channels in Platform HQ, plus every tenant\'s PUBLIC channels. Private channels, DMs and record threads are deliberately never served here.' },
    { target: chdr, title: 'Reading is recorded', body: 'Posting shows up in their channel badged "Cadence team". Reading does not, which is exactly why every view and search is written to an access log the other operators can see.' },
  ]},
  { id: 'console-workspaces', title: 'Workspaces', path: '/workspaces', version: '2026-09-20', steps: [
    { target: chdr, title: 'The tenants', body: 'Every workspace with its members, artists, releases and ledger size. Open one for the full drawer: owner, roster, recent activity and branding.' },
    { target: chdr, title: 'Enter one', body: 'Entering drops you inside that workspace as yourself, with the role its owner decided — Superadmin if you are the platform owner. Everything you do there is attributed to you and logged in their feed.' },
    { target: chdr, title: 'Colour and tag', body: 'Each workspace has a colour and a two-letter tag used everywhere in the console. Colours default to the tenant\'s own brand; when two are too close to tell apart the console measures it and offers a fix.' },
  ]},
  { id: 'console-calendar', title: 'Calendar', path: '/calendar', version: '2026-09-20', steps: [
    { target: chdr, title: 'Every tenant\'s month', body: 'Releases, events, contract dates and DSP submissions across all the workspaces you can reach, colour-and-tag coded. DSP is off by default — it outnumbers everything else combined.' },
  ]},
  { id: 'console-activity', title: 'Activity', path: '/activity', version: '2026-09-20', steps: [
    { target: chdr, title: 'Cross-tenant audit', body: 'What happened in every workspace you can see, filterable by workspace and person. Scoped to your access — a workspace you are blocked from does not appear here either.' },
  ]},
  { id: 'console-analytics', title: 'Analytics', path: '/analytics', version: '2026-09-20', steps: [
    { target: chdr, title: 'Platform growth', body: 'Signups by month, busiest workspaces, largest catalogues. A different question from a workspace\'s own Usage page, which is about people rather than tenants.' },
  ]},
  { id: 'console-announcements', title: 'Announcements', path: '/announcements', version: '2026-09-20', steps: [
    { target: chdr, title: 'Broadcast a banner', body: 'A message shown inside workspaces, at three severities. Each person can dismiss it for themselves.' },
  ]},
  { id: 'console-operators', title: 'Operators', path: '/operators', version: '2026-09-20', steps: [
    { target: chdr, title: 'Who else has the console', body: 'Platform owners and workspace admins. Owners are never restricted — that is the guaranteed way back into any tenant.' },
    { target: chdr, title: 'What each one may reach', body: 'The sliders set which workspaces an admin-tier operator can see AND what they may do inside each: Superadmin, Admin, Approver or User, as a default with per-workspace overrides. It is a real limit, enforced on every request, and a demotion takes effect immediately.' },
  ]},
  { id: 'console-account', title: 'Account', path: '/account', version: '2026-09-20', steps: [
    { target: chdr, title: 'Your operator profile', body: 'Your name, password and theme for the console itself.' },
  ]},
]

// The console welcome, built from CONSOLE_NAV in sidebar order — same rule as
// the tenant walk, so a console page added to the nav joins it automatically.
export function buildConsoleWelcome(navItems = CONSOLE_NAV) {
  const byPath = new Map(CONSOLE_TOURS.map(t => [t.path, t]))
  const steps = []
  for (const it of navItems) {
    const t = byPath.get(it.path)
    if (!t) continue
    for (const st of t.steps) steps.push({ ...st, path: it.path, page: it.label })
  }
  return { id: 'console-welcome', title: 'The operator console', path: '/', multipage: true, version: '2026-09-20', steps }
}

/**
 * The tours for ONE shell.
 *
 * `shell` is the whole point: the operator console and the tenant app share
 * four paths (`/`, `/my-work`, `/messages`, `/calendar`) that are different
 * pages in each. Choosing a tour by path alone would describe the wrong page —
 * and the tenant welcome walk, loose in the console, would march an operator
 * through /artists and /ledger, which are not even routes there.
 */
export function allTours({ shell = 'tenant', consoleNav, ...navOpts } = {}) {
  if (shell === 'console') return [buildConsoleWelcome(consoleNav), ...CONSOLE_TOURS]
  const groups = buildNavGroups(navOpts)
  return [buildWelcome(groups), ...PAGE_TOURS]
}

export const tourById = (tours, id) => tours.find(t => t.id === id) || null
// The page tour for a path. `multipage` walks are excluded as a CLASS, not by
// id: both welcome walks carry path '/', so an id test missed the console one
// and made the Overview's "page tour" the whole 17-step walk — which then
// auto-started itself again every time somebody landed on '/'.
export const tourForPath = (tours, path) => tours.find(t => !t.multipage && t.path === path) || null
