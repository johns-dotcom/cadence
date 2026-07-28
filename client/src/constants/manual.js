// In-app user manual content. Each section maps to a page path; the manual
// drawer shows a section ONLY if the current user can view that path, tailors a
// "Start here" set to their department, and filters each section's tips by role.
//
// Shape: { path, title, group, depts?: [department], summary, steps: [string],
//          tips?: [{ roles?: [role], text }] }
// A tip with no `roles` is shown to everyone; otherwise only to those roles.

export const MANUAL_GROUPS = [
  'Getting started', 'Artists & releases', 'Marketing', 'Finance', 'Contracts & legal', 'Workspace',
]

export const MANUAL_SECTIONS = [
  // ── Getting started ──
  { path: '/', group: 'Getting started', title: 'Dashboard', depts: ['Executive', 'Operations', 'A&R', 'Marketing', 'Finance', 'Legal'],
    summary: 'Your workspace at a glance — tasks, upcoming releases, and recent activity.',
    steps: [
      'Your open / due-today / overdue task counts link straight to My Work.',
      'The releases-by-month and genre charts summarize your catalog momentum.',
      'The upcoming-releases list shows anything dropping in the next three weeks.',
    ],
    tips: [{ roles: ['Superadmin', 'Admin', 'Approver'], text: 'You also see a bookkeeping widget with logged/paid month-to-date and pending approvals.' }] },
  { path: '/my-work', group: 'Getting started', title: 'My Work', depts: ['Operations', 'Executive'],
    summary: 'Your personal task board plus a "Waiting on you" rail for things needing action.',
    steps: [
      'Add a task with a priority and due date; assign it to a teammate if you\'re an admin.',
      'Move tasks across To do / In progress / Done with the status dropdown on each card.',
      'The "Waiting on you" rail surfaces overdue tasks, pending approvals, and campaigns to review.',
    ] },
  { path: '/calendar', group: 'Getting started', title: 'Calendar', depts: ['Operations', 'Marketing'],
    summary: 'A month view of releases, meetings, and deadlines across the workspace.',
    steps: ['Filter by event type using the legend toggles.', 'Click a day to add a manual event.'] },

  // ── Artists & releases ──
  { path: '/releases', group: 'Artists & releases', title: 'Release Tracker', depts: ['A&R', 'Marketing', 'Operations'],
    summary: 'Plan and ship releases with a checklist, DSP tracking, and per-release budgets.',
    steps: [
      'Open a release to work its 7 tabs (Checklist, Metadata, DSP, Budget, Activity, Comments, Details) — keys 1–7 jump between them.',
      'The grouped checklist (Content / Distribution / Pitching) drives the completion % you see on the list.',
      'Switch the list between table and calendar views; the banner flags anything dropping within 14 days.',
    ],
    tips: [{ roles: ['Superadmin', 'Admin', 'Approver'], text: 'Assign a release owner on the Details tab so everyone knows who\'s shepherding it.' }] },
  { path: '/catalog', group: 'Artists & releases', title: 'Catalog', depts: ['Operations', 'Marketing'],
    summary: 'Your released back-catalog, grouped by year with artwork and identifiers.',
    steps: ['Filter by genre, type, or date range and search by title / UPC / ISRC.', 'Use "Sync artwork" to pull covers from Spotify in bulk.'] },
  { path: '/artists', group: 'Artists & releases', title: 'Artists', depts: ['A&R'],
    summary: 'Your roster — open an artist for their profile, releases, contracts, and dev log.',
    steps: ['Search or filter the roster, then click through to a profile.', 'The profile\'s color-coded development log tracks meetings, demos, and offers.'] },
  { path: '/deals', group: 'Artists & releases', title: 'Deal Pipeline', depts: ['A&R', 'Executive'],
    summary: 'A drag-and-drop A&R pipeline from scouting to signed.',
    steps: ['Press "n" to add a deal.', 'Drag a card between stages to advance it.', 'Click a card to open its detail drawer (contacts, links, notes).'] },

  // ── Marketing ──
  { path: '/marketing', group: 'Marketing', title: 'Marketing', depts: ['Marketing'],
    summary: 'Track marketing campaigns and their status.',
    steps: ['Create a campaign and update its stage as it progresses.'] },
  { path: '/artist-campaigns', group: 'Marketing', title: 'Artist Campaigns', depts: ['Marketing'],
    summary: 'Per-artist campaign hub with reviewers, comments, and a review inbox.',
    steps: ['Open an artist to see their campaign spend and collaboration threads.', 'Add reviewers and @mention teammates in comments to pull them in.'] },

  // ── Finance ──
  { path: '/ledger', group: 'Finance', title: 'Ledger', depts: ['Finance'],
    summary: 'The master expense ledger with inline editing, splits, and rich filters.',
    steps: [
      'Toggle which columns show; edits save inline and "z" undoes your last change.',
      'Split an entry across artists from its drawer, or carve off a reimbursement.',
      'Filter by status, category, artist, amount range, method, and more.',
    ],
    tips: [{ roles: ['Superadmin', 'Admin', 'Approver'], text: 'Approve or reject pending entries right from the row actions.' }] },
  { path: '/approvals', group: 'Finance', title: 'Approvals', depts: ['Finance', 'Executive'],
    summary: 'A dedicated queue for reviewing and approving pending invoices.',
    steps: ['Review each card, edit in place if needed, then approve or reject.', 'Bulk-approve and notify vendors from the queue.'],
    tips: [{ roles: ['Superadmin', 'Admin', 'Approver'], text: 'Only Approvers, Admins, and Superadmins can approve — a rejection asks for a reason.' }] },
  { path: '/payments', group: 'Finance', title: 'Payments', depts: ['Finance'],
    summary: 'Work your payables: schedule, rush/hold, and send payment confirmations.',
    steps: [
      'Use the quick filters (Due soon / Overdue / Rush / Hold / Paid).',
      'Flag a payment rush or put it on hold; mark paid singly or in a batch.',
      'Send a vendor confirmation (with the rep CC\'d if you choose) after paying.',
    ] },
  { path: '/vendors', group: 'Finance', title: 'Vendors', depts: ['Finance'],
    summary: 'Manage payees — spend, W9s on file, aliases, and saved emails.',
    steps: ['Merge duplicate vendors or add aliases so spend rolls up correctly.', 'Batch-scan W9s and save vendor emails for auto-CC on confirmations.'] },
  { path: '/invoices', group: 'Finance', title: 'Create Invoice', depts: ['Finance'],
    summary: 'Generate label-branded outbound invoices with line items and remittance.',
    steps: ['Add line items and a currency; the number auto-increments.', 'Print to PDF and keep a saved list of what you\'ve issued.'] },
  { path: '/financials', group: 'Finance', title: 'Financials', depts: ['Finance', 'Executive'],
    summary: 'Spend trends, per-artist P&L, top vendors, and exportable summaries.',
    steps: ['Use the charts and pivots to see where money is going.', 'Export any view to CSV.'] },
  { path: '/recoupments', group: 'Finance', title: 'Recoupments', depts: ['Finance'],
    summary: 'Track recoupable spend per artist against income, with statement stamping.',
    steps: ['Drill into an artist to see recoupable entries and running balance.', 'Mark entries UFR and stamp statement months.'] },
  { path: '/recording-budgets', group: 'Finance', title: 'Recording Budgets', depts: ['Finance', 'A&R'],
    summary: 'Draft → approved → locked budgets with costs-to-date vs. plan.',
    steps: ['Build sections and line items, then move the budget through its lifecycle.', 'Actuals pull from the ledger by artist automatically.'] },
  { path: '/bulk-upload', group: 'Finance', title: 'Bulk Upload', depts: ['Finance', 'Operations'],
    summary: 'Import many ledger entries at once from a CSV / master sheet.',
    steps: ['Map your columns, review the preview, then import.'] },

  // ── Contracts & legal ──
  { path: '/contracts', group: 'Contracts & legal', title: 'Contracts', depts: ['Legal', 'Executive'],
    summary: 'Artist agreements with terms, PDF attachments, and AI clause drafting.',
    steps: ['Log a contract\'s split, advance, territory, and expiration.', 'Use "Draft a clause with AI" to generate clause text into the notes.'] },
  { path: '/pending-contracts', group: 'Contracts & legal', title: 'Pending Contracts', depts: ['Legal'],
    summary: 'A negotiation tracker; promote a signed deal into an active contract.',
    steps: ['Move a row through Not sent → Sent → In review → Signed.', 'Click "Activate" on a signed row to create the active contract.'] },
  { path: '/renewals', group: 'Contracts & legal', title: 'Renewals', depts: ['Legal'],
    summary: 'Contracts expiring soon, color-coded by urgency.',
    steps: ['Review the list and renew or terminate before expiry.'] },
  { path: '/create-nda', group: 'Contracts & legal', title: 'NDA Builder', depts: ['Legal'],
    summary: 'Generate an NDA from a template and export it as PDF or Word.',
    steps: ['Pick a template (standard / mutual / corporate), fill the fields, toggle optional clauses.', 'Preview live, then export to PDF (jsPDF) or Word (.docx).'] },
  { path: '/legal', group: 'Contracts & legal', title: 'NDAs', depts: ['Legal'],
    summary: 'Track executed counterparty NDAs and their signed files.',
    steps: ['Log a counterparty, status, and dates; attach the signed document.'] },
  { path: '/clearances', group: 'Contracts & legal', title: 'Clearances', depts: ['Legal'],
    summary: 'Track sample and artist clearances.',
    steps: ['Record each clearance and its status.'] },
  { path: '/label-waivers', group: 'Contracts & legal', title: 'Label Waivers', depts: ['Legal'],
    summary: 'Draft exclusivity waivers for co-primary releases, with live preview + print.',
    steps: ['Fill the parties and terms; edit the body if needed; print to PDF.'] },

  // ── Workspace ──
  { path: '/team', group: 'Workspace', title: 'Team', depts: ['Executive', 'Operations'],
    summary: 'Manage members, roles, and per-page permissions.',
    steps: ['Invite a teammate and set their role.', 'Grant or restrict individual pages with permission templates.'],
    tips: [{ roles: ['Superadmin', 'Admin'], text: 'Only Admins and Superadmins can manage the team.' }] },
  { path: '/activity', group: 'Workspace', title: 'Activity', depts: ['Executive', 'Operations'],
    summary: 'A chronological audit log of what happened in the workspace.',
    steps: ['Scan or search the feed to see who changed what, and when.'] },
  { path: '/requests', group: 'Workspace', title: 'Requests & feedback', depts: ['Executive', 'Operations', 'A&R', 'Marketing', 'Finance', 'Legal'],
    summary: 'Send a feature idea, bug report, or question to the Cadence team.',
    steps: ['Pick a type, write it up, preview, and send.'] },
  { path: '/settings', group: 'Workspace', title: 'Settings', depts: ['Executive', 'Operations', 'A&R', 'Marketing', 'Finance', 'Legal'],
    summary: 'Your profile, theme, and personal navigation preferences.',
    steps: ['Update your display name, switch light/dark mode, and tailor your nav.'] },
]

// Assemble a personalized manual for one user.
export function buildManual({ role, department, canView }) {
  const accessible = MANUAL_SECTIONS
    .filter(s => canView(s.path))
    .map(s => ({ ...s, tips: (s.tips || []).filter(t => !t.roles || t.roles.includes(role)) }))

  const deptMatches = department ? accessible.filter(s => s.depts?.includes(department)) : []
  const recommended = (deptMatches.length ? deptMatches : accessible).slice(0, 4)

  const groups = MANUAL_GROUPS
    .map(name => ({ name, sections: accessible.filter(s => s.group === name) }))
    .filter(g => g.sections.length)

  return { accessible, recommended, groups }
}
