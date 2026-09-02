import {
  AlertTriangle, Banknote, BarChart3, BookOpen, Briefcase, Building2,
  CalendarDays, CheckSquare, Coins, CreditCard, Disc3, FileBarChart, FileClock,
  FilePlus2, FileSearch, FileSignature, FileSpreadsheet, FileText, FlaskConical,
  FolderOpen, GitMerge, Image as ImageIcon, Landmark, Layers, LayoutDashboard,
  Lock, Megaphone, MessageSquare, MessageSquarePlus, Music, PackageCheck,
  PieChart, PiggyBank, PlusCircle, Receipt, RefreshCw, Scale, ScrollText,
  Settings, Shield, ShieldCheck, Target, TrendingUp, UploadCloud, UserCheck,
  UserPlus, Users, Users2, Wallet,
} from 'lucide-react'

// THE nav definition — one module, four consumers (sidebar, Settings' "hide
// items" editor, the ⌘K palette, and check-render's shell pre-flight).
//
// It lives here rather than inside Layout because it is not the sidebar's
// private business: Settings' editor renders the same rows so it can't offer a
// toggle for a row that doesn't exist, and the ⌘K palette ranks pages against
// these labels, paths and `synonyms`. Three copies of this list is how two of
// them go stale.
//
// `synonyms` is the vocabulary people actually use — "w9" for Vendors, "p&l"
// for Reports, "payroll" for Salary — and exists purely for search.
//
// EVERY icon referenced below must appear in the import above. A JSX identifier
// that was never imported builds perfectly cleanly (Rollup leaves it as an
// unresolved global) and then white-screens every authenticated page, because
// Layout calls buildNavGroups on all of them. `npm run check:render` executes
// this module for all three role shapes for exactly that reason.

export const PAGE_LABELS = {
  '/':           'Dashboard',
  '/my-work':    'My Work',
  '/messages':   'Messages',
  '/team-work':  'Team Work',
  '/calendar':   'Calendar',
  '/financials': 'Financials',
  '/reports': 'Reports',
  '/ad-allocation': 'Allocate Advertising',
  '/bank-statements': 'Bank Statements',
  '/bank-matching': 'Bank Matching',
  '/ledger-matching': 'Bookkeeper Reconcile',
  '/bank-ledger': 'Bank Ledger',
  '/bulk-upload': 'Bulk Upload',
  '/approvals/archive': 'Approvals Archive',
  '/creators': 'Creator Payments',
  '/bulk-deals': 'Bulk Deals',
  '/artist-budgets': 'Artist Budgets',
  '/recording-budgets': 'Recording Budgets',
  '/recoupments':'Recoupments',
  '/recoupments/planning': 'Recoupment Planning',
  '/recoupments/audit': 'Recoupment Audit',
  '/salary':     'Salary',
  '/marketing':  'Marketing',
  '/artist-campaigns': 'Artist Campaigns',
  '/pending-contracts': 'Pending Contracts',
  '/legal':      'NDAs',
  '/create-nda': 'Create NDA',
  '/label-waivers': 'Label Waivers',
  '/clearances': 'Clearances',
  '/admin-docs': 'Admin Docs',
  '/releases':   'Releases',
  '/catalog':    'Catalog',
  '/brand':      'Brand',
  '/artists':    'Roster',
  '/deals':      'Deal Pipeline',
  '/contracts':  'Contracts',
  '/contracts/create': 'Create Contract',
  '/renewals':   'Renewals',
  '/approvals':  'Approvals',
  '/ledger':     'Ledger',
  '/invoice-search': 'Invoice Search',
  '/ledger/new-invoice': 'Add invoice',
  '/ledger/new-reimbursement': 'Add reimbursement',
  '/payments':   'Payments',
  '/vendors':    'Vendors',
  '/vendors/added-expenses': 'Added-expense vendors',
  '/vendor-lab': 'Vendor Form (sandbox)',
  '/invoices':   'Create Invoice',
  '/add-invoice': 'Add Invoice',
  '/invoices/new': 'Create invoice',
  '/team':       'Team',
  '/data-quality': 'Data Quality',
  '/activity':   'Activity',
  '/usage':      'Usage',
  '/requests':   'Requests & feedback',
  '/settings':   'Settings',
  '/workspaces': 'Workspaces',
}

// ── Sidebar information architecture ──────────────────────────────────────
//
// Grouped the way a label team works, and in that order:
//
//   (top)         what every person opens to start the day
//   Artists       A&R surface — roster, pipeline
//   Releases      release ops — tracker, catalog, brand assets, marketing
//   Contracts &   the paperwork lifecycle, tracked and generated
//     Legal
//   Bookkeeping   day-to-day money in / money out. Ordered by daily-use
//                 FREQUENCY, not alphabetically and not by when it was built:
//                 pending review → outgoing payments → master ledger → add →
//                 reference data → rare tools.
//   Reports       read-and-analyse surfaces. Split from Bookkeeping — an admin
//                 opening a P&L should not have to scan past twelve data-entry
//                 actions to find it, and the two lists are used by different
//                 people on different days.
//   Team          people + personal settings
//   System        admin-only audit, usage and tooling
//
// An Admin can see fifty-odd pages here. At that size grouping is not
// decoration, it is the only thing that makes the rail scannable — which is
// why the flat sixteen-row Bookkeeping list this replaced did not work.
//
// Three row kinds:
//   · a plain page      { path, label, icon, synonyms }
//   · a TAB FAMILY      { tabbed, key, label, icon, children } — one rail row
//     for a family of pages that already carry their own in-page links between
//     each other. Links to the first child the viewer can actually reach, and
//     survives as long as ANY child is viewable: the row is a way IN, not a
//     page, so losing one member must not remove the entrance.
//   · a SUB-GROUP       { collapsible, key, label, icon, children } — a chevron
//     disclosure for the rare tools, open by default, its open/closed state
//     remembered per person in localStorage `nav_collapsed`.
// Both container kinds flatten back into individual PAGES for Settings and ⌘K
// (see navPageGroups) — hiding a row and removing a page are different acts.
//
// Items are still filtered by canView (role + per-user page permissions) and
// then by the viewer's own hidden-pages preference. The role spreads below are
// only the coarse cut, so a rail doesn't advertise a page the role can never
// open; canView remains the gate.
export function buildNavGroups({ isAdmin, isApprover, chatUnread = 0, pendingApprovals = 0 }) {
  const groups = [
  {
    label: null,
    items: [
      { path: '/',         label: 'Dashboard', icon: LayoutDashboard, synonyms: 'home overview start' },
      { path: '/my-work',  label: 'My Work',   icon: Briefcase, synonyms: 'tasks todo my tasks assignments' },
      // Team leads only. canView() below still applies, so an admin can revoke it.
      ...(isApprover ? [{ path: '/team-work', label: 'Team Work', icon: Users2, synonyms: 'team tasks department workload' }] : []),
      { path: '/messages', label: 'Messages',  icon: MessageSquare, badge: chatUnread, synonyms: 'chat slack dm direct message channels' },
      { path: '/calendar', label: 'Calendar',  icon: CalendarDays, synonyms: 'schedule events dates' },
      // Top-level and ungated, not tucked under Workspace: the hub spans the
      // catalog, the roster and the ledger, so it belongs to no one group —
      // and its catalog/artist checks are work for every role, with the
      // money-shaped sections gated server-side (routes/flags.js).
      { path: '/data-quality', label: 'Data Quality', icon: AlertTriangle, synonyms: 'flags duplicates issues checks validation problems review' },
    ],
  },
  {
    label: 'Artists',
    items: [
      { path: '/artists', label: 'Roster',        icon: Users, synonyms: 'roster acts talent signings artist list' },
      { path: '/deals',   label: 'Deal Pipeline', icon: TrendingUp, synonyms: 'pipeline kanban prospects signings offers deals' },
    ],
  },
  {
    label: 'Releases',
    items: [
      { path: '/releases',  label: 'Releases',  icon: Music, synonyms: 'projects singles albums eps drops release schedule dsp' },
      { path: '/catalog',   label: 'Catalog',   icon: Disc3, synonyms: 'discography back catalogue library artwork songs masters tracks' },
      { path: '/brand',     label: 'Brand',     icon: ImageIcon, synonyms: 'assets logos artwork press kit' },
      { path: '/marketing', label: 'Marketing', icon: Megaphone, synonyms: 'promo campaigns ads' },
    ],
  },
  {
    label: 'Contracts & Legal',
    items: [
      ...(isApprover ? [{ path: '/contracts', label: 'Contracts', icon: FileText, synonyms: 'agreements deals paperwork terms signed' }] : []),
      ...(isApprover ? [{ path: '/pending-contracts', label: 'Pending', icon: FileClock, synonyms: 'unsigned awaiting signature drafts' }] : []),
      ...(isApprover ? [{ path: '/renewals', label: 'Renewals', icon: RefreshCw, synonyms: 'expiring contracts renew expiry option' }] : []),
      ...(isApprover ? [{ path: '/legal', label: 'NDAs', icon: Shield, synonyms: 'nda non-disclosure confidentiality' }] : []),
      ...(isApprover ? [{ path: '/contracts/create', label: 'Create Contract', icon: FilePlus2, synonyms: 'new contract draft agreement generate' }] : []),
      ...(isApprover ? [{ path: '/create-nda', label: 'Create NDA', icon: FilePlus2, synonyms: 'new nda generate non-disclosure' }] : []),
      ...(isApprover ? [{ path: '/label-waivers', label: 'Label Waivers', icon: FileSignature, synonyms: 'waiver release form permission' }] : []),
      ...(isApprover ? [{ path: '/clearances', label: 'Clearances', icon: FileSpreadsheet, synonyms: 'sample clearance rights permission feature' }] : []),
    ],
  },
  {
    label: 'Bookkeeping',
    items: [
      ...(isApprover ? [{ path: '/approvals', label: 'Approvals', icon: CheckSquare, badge: pendingApprovals, synonyms: 'approve review pending queue sign off submitted vendor' }] : []),
      ...(isApprover ? [{ path: '/payments', label: 'Payments', icon: CreditCard, synonyms: 'pay ap accounts payable due schedule remittance wire ach rush' }] : []),
      ...(isApprover ? [{ path: '/ledger', label: 'Ledger', icon: BookOpen, synonyms: 'expenses invoices bookkeeping entries transactions bk master register' }] : []),
      // The statement half, kept next to the ledger it was split from rather
      // than down with the bank tools: it is the same register, read the same
      // way — it just holds the rows nobody invoiced us for.
      ...(isAdmin ? [{ path: '/bank-ledger', label: 'Bank Ledger', icon: Coins, synonyms: 'bank booked spend no invoice statement entries' }] : []),
      { path: '/add-invoice', label: 'Add Invoice', icon: PlusCircle, synonyms: 'new invoice bill submit expense ap payable' },
      ...(isApprover ? [{ path: '/invoices', label: 'Create Invoice', icon: Receipt, synonyms: 'outbound invoice bill client ar receivable charge' }] : []),
      // Vendors and the payees that arrived without one, behind a single row.
      // Same subject from two angles, and the directory page already links
      // across to the added-expense list, so this costs no reach.
      ...(isApprover ? [{
        tabbed: true,
        key: 'vendors',
        label: 'Vendors',
        icon: Building2,
        children: [
          { path: '/vendors', label: 'Directory', icon: Building2, synonyms: 'suppliers payees w9 1099 vendor directory contact' },
          { path: '/vendors/added-expenses', label: 'Added-expense', icon: UserPlus, synonyms: 'added expense payees no invoice number recoupments campaigns' },
        ],
      }] : []),
      ...(isApprover ? [{ path: '/creators', label: 'Creator Payments', icon: Users, synonyms: 'influencers ugc paypal creator payments socials no invoice' }] : []),
      ...(isAdmin ? [{ path: '/bank-statements', label: 'Bank Statements', icon: Landmark, synonyms: 'statement csv pdf reconcile bank upload month paypal' }] : []),
      ...(isAdmin ? [{ path: '/bank-matching', label: 'Bank Matching', icon: GitMerge, synonyms: 'reconcile match bank transactions unmatched book' }] : []),
      ...(isApprover ? [{ path: '/invoice-search', label: 'Invoice Search', icon: FileSearch, synonyms: 'find invoice lookup expense search documents files' }] : []),
      ...(isApprover ? [{ path: '/bulk-upload', label: 'Bulk Upload', icon: UploadCloud, synonyms: 'import batch upload spreadsheet many invoices at once' }] : []),
      // Less-frequent actions behind one disclosure. Add Reimbursement is the
      // most-used of them so it leads — and it is the ONE bookkeeping page a
      // plain User has business on, which is why the sub-group opens by
      // default rather than hiding it behind a click.
      {
        collapsible: true,
        key: 'bk-more',
        label: 'More',
        icon: FolderOpen,
        children: [
          { path: '/ledger/new-reimbursement', label: 'Add Reimbursement', icon: Wallet, synonyms: 'reimbursement expense claim receipt payback staff expense report' },
          ...(isAdmin ? [{ path: '/ledger-matching', label: 'Bookkeeper Reconcile', icon: FileSpreadsheet, synonyms: 'bookkeeper reconcile diff spreadsheet xlsx outstanding invoices accountant handoff' }] : []),
        ],
      },
    ],
  },
  {
    // Read-and-analyse surfaces. Split from Bookkeeping so an admin reviewing
    // a P&L doesn't have to scan past every entry action to find it.
    label: 'Reports',
    items: [
      ...(isApprover ? [{ path: '/financials', label: 'Financials', icon: PieChart, synonyms: 'finance money pnl profit loss revenue cashflow balance sheet cash month' }] : []),
      ...(isApprover ? [{ path: '/reports', label: 'Reports', icon: FileBarChart, synonyms: 'p&l pnl profit and loss balance sheet spend by artist income statement export' }] : []),
      ...(isApprover ? [{ path: '/recording-budgets', label: 'Recording Budgets', icon: PiggyBank, synonyms: 'studio budget recording session costs producer template' }] : []),
      // One subject, one row. The overview page carries its own Planning and
      // Audit links, so the family row is the entrance and the page is the tab
      // bar — /recoupments/audit had no rail entry of any kind before this.
      ...(isApprover ? [{
        tabbed: true,
        key: 'recoupments',
        label: 'Recoupments',
        icon: Wallet,
        children: [
          { path: '/recoupments', label: 'Overview', icon: Wallet, synonyms: 'recoup ufr artist advance claim statements balance' },
          { path: '/recoupments/planning', label: 'Planning', icon: Layers, synonyms: 'recoup plan forecast projection stage batch' },
          { path: '/recoupments/audit', label: 'Audit', icon: ShieldCheck, synonyms: 'advances over-claim guard integrity check audit' },
        ],
      }] : []),
      ...(isApprover ? [{ path: '/artist-budgets', label: 'Artist Budgets', icon: Scale, synonyms: 'budget per artist spend limit variance committed' }] : []),
      ...(isApprover ? [{ path: '/artist-campaigns', label: 'Artist Campaigns', icon: Megaphone, synonyms: 'campaign spend cobrand promo per artist per song marketing' }] : []),
      ...(isApprover ? [{ path: '/ad-allocation', label: 'Allocate Ads', icon: Target, synonyms: 'advertising allocate ads spend split facebook meta attribute pool' }] : []),
      ...(isAdmin ? [{ path: '/salary', label: 'Salary', icon: Banknote, synonyms: 'payroll wages staff pay compensation' }] : []),
      ...(isApprover ? [{ path: '/bulk-deals', label: 'Bulk Deals', icon: PackageCheck, synonyms: 'bulk units delivery quantity mark deals batch recoupable' }] : []),
    ],
  },
  {
    label: 'Team',
    items: [
      // 'Members' in the rail, 'Team' as the page title — deliberately not the
      // same string. A 200px rail wants the short word; the page header wants
      // the one on the door. PAGE_LABELS above owns the latter.
      { path: '/team', label: 'Members', icon: UserCheck, synonyms: 'people members staff users roles team' },
      { path: '/settings', label: 'Settings', icon: Settings, synonyms: 'preferences configuration workspace admin account theme my nav permissions' },
      { path: '/requests', label: 'Requests & feedback', icon: MessageSquarePlus, synonyms: 'support feedback help contact ask bug report' },
    ],
  },
  {
    label: 'System',
    items: [
      ...(isAdmin ? [{ path: '/admin-docs', label: 'Admin Docs', icon: Lock, synonyms: 'documents policies internal files documentation runbook' }] : []),
      ...(isAdmin ? [{ path: '/activity', label: 'Activity', icon: ScrollText, synonyms: 'audit log history changes who changed' }] : []),
      ...(isAdmin ? [{ path: '/usage', label: 'Usage', icon: BarChart3, synonyms: 'analytics page views active users logins' }] : []),
      // Opens in a new tab so the admin's session stays put — and so the
      // sandbox signal can never be lost to a client-side route transition.
      ...(isAdmin ? [{ path: '/vendor-lab', label: 'Vendor Form (sandbox)', icon: FlaskConical, external: true, synonyms: 'vendor form preview sandbox test dry run submit lab' }] : []),
    ],
  },
  ]

  // A container whose children were all filtered out is not an empty row, it is
  // a crash: the sidebar reads `children[0].path` to decide where a family row
  // points. Drop them here, once, rather than in each of the four consumers.
  return groups
    .map(g => ({ ...g, items: g.items.filter(i => !i.children || i.children.length > 0) }))
    .filter(g => g.items.length > 0)
}

/**
 * The same groups with both container kinds flattened into their child pages.
 *
 * Settings' hide-list and the ⌘K palette want one row per PAGE — a tab or a
 * sub-group child is still a page you can hide and still a page you can search
 * for. Order is preserved exactly, which is the point: the checkbox list reads
 * in the same sequence as the rail it configures.
 */
export function flattenNavGroups(groups) {
  return groups.map(g => ({
    ...g,
    items: g.items.flatMap(i => (i.children ? i.children : [i])),
  }))
}

/** buildNavGroups + flattenNavGroups, for consumers that only want pages. */
export function navPageGroups(opts) {
  return flattenNavGroups(buildNavGroups(opts))
}

/**
 * The tab family that owns a path, or null. One definition so a future in-page
 * tab bar and the sidebar row can never disagree about who owns a URL.
 */
export function tabFamilyFor(groups, path) {
  for (const g of groups) {
    for (const item of g.items) {
      if (item.tabbed && item.children.some(c => c.path === path)) return item
    }
  }
  return null
}
