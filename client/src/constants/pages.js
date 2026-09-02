// Canonical page catalog for the permissions matrix + nav gating. Grouped the
// way the sidebar is. `/settings` is intentionally omitted — it's self-service
// (profile, password, appearance, sidebar) and always viewable, never
// permission-gated. `/usage` is omitted for the opposite reason: its API is
// requireAdmin, so granting it to a User would hand them a page that only 403s
// — the same rule that keeps `/admin-docs` out of this list.
export const PAGE_GROUPS = [
  { group: 'General', pages: [
    { path: '/', label: 'Dashboard' },
    { path: '/my-work', label: 'My Work' },
    { path: '/team-work', label: 'Team Work' },
    { path: '/calendar', label: 'Calendar' },
    // Ungated in the sidebar for every role, so it has to be grantable too —
    // a User on an explicit permission set could see the row and not the page.
    // Its API is open (routes/flags.js gates only the money sections + the
    // merge/rename mutations, per-route), so a grant here actually works.
    { path: '/data-quality', label: 'Data Quality' },
  ] },
  { group: 'Artists', pages: [
    { path: '/artists', label: 'Roster' },
    { path: '/deals', label: 'Deal Pipeline' },
  ] },
  { group: 'Releases', pages: [
    { path: '/releases', label: 'Releases' },
    { path: '/catalog', label: 'Catalog' },
    { path: '/brand', label: 'Brand' },
    { path: '/marketing', label: 'Marketing' },
  ] },
  { group: 'Contracts & Legal', pages: [
    { path: '/contracts', label: 'Contracts' },
    { path: '/pending-contracts', label: 'Pending Contracts' },
    { path: '/renewals', label: 'Renewals' },
    { path: '/legal', label: 'NDAs' },
    { path: '/create-nda', label: 'Create NDA' },
    { path: '/label-waivers', label: 'Label Waivers' },
    { path: '/clearances', label: 'Clearances' },
    // '/admin-docs' is deliberately NOT grantable: the vault is admin-gated
    // server-side (requireAdmin), so a grant would only hand a User a page
    // that 403s on every request.
  ] },
  // Ordered as the sidebar orders it — daily-use frequency, not alphabetical.
  // The matrix reads in the same sequence as the rail it configures.
  { group: 'Bookkeeping', pages: [
    { path: '/payments', label: 'Payments' },
    { path: '/ledger', label: 'Ledger' },
    { path: '/invoices', label: 'Create Invoice' },
    { path: '/vendors', label: 'Vendors' },
    { path: '/creators', label: 'Creator Payments' },
    { path: '/invoice-search', label: 'Invoice Search' },
    { path: '/bulk-upload', label: 'Bulk Upload' },
  ] },
  { group: 'Reports', pages: [
    { path: '/financials', label: 'Financials' },
    { path: '/reports', label: 'Reports' },
    { path: '/artist-budgets', label: 'Artist Budgets' },
    { path: '/recoupments', label: 'Recoupments' },
    { path: '/salary', label: 'Salary' },
  ] },
  { group: 'Team', pages: [
    { path: '/team', label: 'Members' },
    { path: '/activity', label: 'Activity' },
    { path: '/requests', label: 'Requests & feedback' },
  ] },
]

export const ALL_PAGES = PAGE_GROUPS.flatMap(g => g.pages.map(p => p.path))
export const PAGE_LABEL = Object.fromEntries(PAGE_GROUPS.flatMap(g => g.pages.map(p => [p.path, p.label])))

// Hardcoded starter presets (admins can also save their own templates).
const P = (...paths) => ['/', '/my-work', ...paths]
export const PERMISSION_PRESETS = [
  { name: 'Full access', pages: ALL_PAGES },
  { name: 'Bookkeeping / AP', pages: P('/calendar', '/ledger', '/invoice-search', '/bulk-upload', '/payments', '/vendors', '/invoices', '/recoupments', '/financials', '/reports') },
  { name: 'Finance exec', pages: P('/financials', '/reports', '/recoupments', '/payments', '/ledger', '/salary') },
  { name: 'Marketing', pages: P('/calendar', '/marketing', '/artists', '/releases', '/catalog', '/deals') },
  { name: 'A&R', pages: P('/calendar', '/deals', '/artists', '/releases', '/contracts', '/pending-contracts') },
  { name: 'Legal', pages: P('/contracts', '/pending-contracts', '/renewals', '/legal', '/create-nda', '/label-waivers', '/clearances') },
]
