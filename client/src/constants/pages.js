// Canonical page catalog for the permissions matrix + nav gating. Grouped the
// way the sidebar is. `/settings` is intentionally omitted — it's self-service
// (My Nav / Theme) and always viewable, never permission-gated.
export const PAGE_GROUPS = [
  { group: 'General', pages: [
    { path: '/', label: 'Dashboard' },
    { path: '/my-work', label: 'My Work' },
    { path: '/team-work', label: 'Team Work' },
    { path: '/calendar', label: 'Calendar' },
  ] },
  { group: 'Catalog', pages: [
    { path: '/releases', label: 'Releases' },
    { path: '/artists', label: 'Artists' },
    { path: '/brand', label: 'Brand' },
  ] },
  { group: 'A&R', pages: [
    { path: '/deals', label: 'Deal Pipeline' },
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
  { group: 'Bookkeeping', pages: [
    { path: '/ledger', label: 'Ledger' },
    { path: '/invoice-search', label: 'Invoice Search' },
    { path: '/bulk-upload', label: 'Bulk Upload' },
    { path: '/payments', label: 'Payments' },
    { path: '/vendors', label: 'Vendors' },
    { path: '/creators', label: 'Creator Payments' },
    { path: '/invoices', label: 'Create Invoice' },
    { path: '/financials', label: 'Financials' },
    { path: '/reports', label: 'Reports' },
    { path: '/artist-budgets', label: 'Artist Budgets' },
    { path: '/recoupments', label: 'Recoupments' },
    { path: '/salary', label: 'Salary' },
  ] },
  { group: 'Workspace', pages: [
    { path: '/team', label: 'Team' },
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
  { name: 'Marketing', pages: P('/calendar', '/marketing', '/artists', '/releases', '/deals') },
  { name: 'A&R', pages: P('/calendar', '/deals', '/artists', '/releases', '/contracts', '/pending-contracts') },
  { name: 'Legal', pages: P('/contracts', '/pending-contracts', '/renewals', '/legal', '/create-nda', '/label-waivers', '/clearances') },
]
