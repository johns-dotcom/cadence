import {
  AlertTriangle, Banknote, BarChart3, BookOpen, Briefcase, Building2, CalendarClock, CalendarDays, CheckSquare, ClipboardList, Coins, CreditCard, Disc3, FileBarChart, FileClock, FilePlus2, FileSearch, FileSignature, FileSpreadsheet, FileText, FlaskConical, FolderOpen, GitMerge, Image as ImageIcon, Landmark, Layers, LayoutDashboard, Link2, Lock, Megaphone, MessageSquare, MessageSquarePlus, Music, PackageCheck, PieChart, PiggyBank, PlusCircle, Receipt, RefreshCw, Scale, ScrollText, SearchCheck, Send, Settings, Shield, ShieldCheck, TrendingUp, UploadCloud, UserCheck, UserPlus, Users, Users2, Wallet } from 'lucide-react'

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
  '/calendar':   'Calendar',
  '/financials': 'Financials',
  '/reports': 'Reports',
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
  '/recoupments/prior-year': 'Prior-year Recoupments',
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
  '/reimbursements': 'Reimbursements',
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
      { path: '/',             label: 'Home',     icon: LayoutDashboard, synonyms: 'home dashboard overview start' },
      { path: '/my-work',      label: 'My Work',  icon: Briefcase, synonyms: 'tasks todo my tasks assignments team work department' },
      { path: '/messages',     label: 'Messages', icon: MessageSquare, badge: chatUnread, synonyms: 'chat slack dm direct message channels' },
      { path: '/calendar',     label: 'Calendar', icon: CalendarDays, synonyms: 'schedule events dates' },
      // Top-level and ungated: the hub spans the catalog, the roster and the
      // ledger, so it belongs to no one group — and its catalog/artist checks
      // are work for every role, with the money-shaped sections gated
      // server-side (routes/flags.js).
      { path: '/data-quality', label: 'Flags',    icon: AlertTriangle, synonyms: 'data quality duplicates issues checks validation problems review' },
    ],
  },
  {
    label: 'Artists & releases',
    items: [
      { path: '/artists', label: 'Roster', icon: Users, synonyms: 'roster acts talent signings artist list' },
      {
        // Same records either side of the drop date: GET /releases defaults to
        // the pipeline, Catalog asks for in_catalog=true.
        tabbed: true, key: 'releases', label: 'Releases', icon: Music,
        children: [
          { path: '/releases',  label: 'Pipeline',  icon: Music, synonyms: 'projects singles albums eps drops release schedule dsp tracker upcoming' },
          { path: '/catalog',   label: 'Catalog',   icon: Disc3, synonyms: 'discography back catalogue library artwork songs masters tracks' },
          { path: '/marketing', label: 'Marketing', icon: Megaphone, synonyms: 'campaigns promo influencer marketing' },
        ],
      },
      ...(isApprover ? [{
        // Left to right is the lifecycle: a deal becomes a contract, a contract
        // goes out unsigned, a signed one comes up for renewal. The NDA
        // counterparty tracker rides along — it is a record of an agreement,
        // not a tool that makes one (those are under Documents).
        tabbed: true, key: 'contracts', label: 'Contracts', icon: FileText,
        children: [
          { path: '/deals',             label: 'Deals',    icon: TrendingUp, synonyms: 'pipeline kanban prospects signings offers deals' },
          { path: '/contracts',         label: 'Active',   icon: FileText, synonyms: 'agreements signed contract active royalty advance' },
          { path: '/pending-contracts', label: 'Pending',  icon: ClipboardList, synonyms: 'unsigned awaiting signature pending promote' },
          { path: '/renewals',          label: 'Renewals', icon: RefreshCw, synonyms: 'expiring renew option term portfolio' },
          { path: '/legal',             label: 'NDAs',     icon: ShieldCheck, synonyms: 'nda counterparty tracker confidentiality legal' },
        ],
      }] : []),
      ...(isApprover ? [{
        // Tools that produce a document, not records. Create Invoice issues an
        // invoice TO a client (receivable) — a document, which is why it is
        // here and not under Money.
        tabbed: true, key: 'documents', label: 'Documents', icon: FileSignature,
        children: [
          { path: '/contracts/create', label: 'Contract',  icon: PlusCircle, synonyms: 'new contract draft ai generate create contract' },
          { path: '/create-nda',       label: 'NDA',       icon: FileText, synonyms: 'nda non-disclosure new create template' },
          { path: '/label-waivers',    label: 'Waiver',    icon: FileText, synonyms: 'label waiver release new create' },
          { path: '/clearances',       label: 'Clearance', icon: FileSpreadsheet, synonyms: 'artist clearance sample feature chart new create' },
          { path: '/invoices',         label: 'Invoice',   icon: Receipt, synonyms: 'create invoice outgoing receivable bill a client' },
          { path: '/brand',            label: 'Brand',     icon: ImageIcon, synonyms: 'assets logos artwork press kit brand' },
        ],
      }] : []),
    ],
  },
  ...(isApprover ? [{
    // Money out. Two sides of one ledger — what we owe (Invoices) and what the
    // bank says left (Bank) — plus who we pay (Vendors).
    label: 'Money',
    items: [
      {
        tabbed: true, key: 'invoices', label: 'Invoices', icon: CheckSquare,
        children: [
          { path: '/approvals',               label: 'Approvals',   icon: CheckSquare, badge: pendingApprovals, synonyms: 'review pending submitted vendor queue approve' },
          { path: '/payments',                label: 'Payments',    icon: CreditCard, synonyms: 'pay due outgoing wire ach rush unpaid' },
          { path: '/reimbursements',          label: 'Reimbursements', icon: Coins, synonyms: 'out of pocket owed paid personally front money reimburse fund source who paid' },
          { path: '/ledger',                  label: 'Ledger',      icon: BookOpen, synonyms: 'expenses master register search spend' },
          { path: '/creators',                label: 'Creators',    icon: Users, synonyms: 'creator influencer paypal no invoice small payments 1099' },
          { path: '/add-invoice',             label: 'Add',         icon: PlusCircle, synonyms: 'add invoice expense payable new bill manual entry' },
          { path: '/ledger/new-reimbursement', label: 'Reimburse',  icon: Receipt, synonyms: 'expense report reimbursement staff claim receipt' },
          { path: '/invoice-search',          label: 'Search',      icon: SearchCheck, synonyms: 'find invoice number payee browse all invoices' },
          { path: '/bulk-upload',             label: 'Bulk upload', icon: UploadCloud, synonyms: 'batch ai invoices proofs many at once' },
        ],
      },
      ...(isAdmin ? [{
        // Four views of one bank month: the files it arrived in, the lines
        // still to answer, the register of the answered ones, and the diff
        // against an outside bookkeeper's sheet.
        tabbed: true, key: 'banking', label: 'Bank', icon: Landmark,
        children: [
          { path: '/bank-matching',   label: 'For review',  icon: Link2, synonyms: 'bank matching reconcile transactions unmatched book rules' },
          { path: '/bank-ledger',     label: 'Categorized', icon: Landmark, synonyms: 'bank ledger booked rows nobody invoiced statement entries' },
          { path: '/bank-statements', label: 'Statements',  icon: FileText, synonyms: 'pdf csv upload bank statement month paypal' },
          { path: '/ledger-matching', label: 'Reconcile',   icon: FileSpreadsheet, synonyms: 'bookkeeper accountant spreadsheet diff compare handoff' },
        ],
      }] : []),
      {
        tabbed: true, key: 'vendors', label: 'Vendors', icon: Building2,
        children: [
          { path: '/vendors',                 label: 'Directory',  icon: Building2, synonyms: 'payee supplier w9 w8 directory contact 1099' },
          { path: '/vendors/added-expenses',  label: 'Added',      icon: PlusCircle, synonyms: 'added expenses implicit vendors recoupment campaign no invoice' },
          { path: '/bulk-deals',              label: 'Bulk deals', icon: PackageCheck, synonyms: 'bulk units delivery quantity deliverables batch recoupable' },
        ],
      },
    ],
  }] : []),
  ...(isApprover ? [{
    label: 'Reports',
    items: [
      {
        // Two bases, deliberately side by side: Reports is cash, tied to the
        // bank; Financials is invoice-basis and includes unpaid.
        tabbed: true, key: 'reports', label: 'Reports', icon: FileBarChart,
        children: [
          { path: '/reports',    label: 'P&L / BS',   icon: FileBarChart, synonyms: 'p&l pnl profit loss income statement balance sheet cash basis export' },
          { path: '/financials', label: 'Financials', icon: TrendingUp, synonyms: 'executive kpi trends aging forecast invoice basis unpaid' },
        ],
      },
      {
        tabbed: true, key: 'recoupments', label: 'Recoupments', icon: Wallet,
        children: [
          { path: '/recoupments',            label: 'Overview',   icon: Wallet, synonyms: 'recoup ufr artist advance claim statements balance' },
          { path: '/recoupments/planning',   label: 'Planning',   icon: Layers, synonyms: 'recoup plan forecast projection stage batch' },
          { path: '/recoupments/audit',      label: 'Audit',      icon: ShieldCheck, synonyms: 'advances over-claim guard integrity check audit' },
          { path: '/recoupments/prior-year', label: 'Prior year', icon: CalendarClock, synonyms: 'prior year archive tagged historic recoupments' },
        ],
      },
      {
        // Three views of one artist's spend: planned, settled, and the studio.
        tabbed: true, key: 'artist-spend', label: 'Artist Spend', icon: Scale,
        children: [
          { path: '/artist-budgets',   label: 'Budgets',   icon: Scale, synonyms: 'budget per artist spend limit variance committed' },
          { path: '/artist-campaigns', label: 'Campaigns', icon: Megaphone, synonyms: 'campaign spend cobrand promo per artist per song marketing' },
          { path: '/recording-budgets', label: 'Recording', icon: FileText, synonyms: 'recording budget studio producer fund advance template' },
        ],
      },
    ],
  }] : []),
  {
    // One row. Settings is self-service for everyone; every other tab carries
    // its own route guard, which Layout and PageTabs both honour.
    label: 'Admin',
    items: [
      {
        tabbed: true, key: 'settings', label: 'Settings', icon: Settings,
        children: [
          { path: '/settings',   label: 'Settings',  icon: Settings, synonyms: 'preferences theme my nav permissions workspace branding email' },
          { path: '/requests',   label: 'Requests',  icon: Send, synonyms: 'request feature bug feedback support platform team' },
          ...(isAdmin ? [
            { path: '/team',       label: 'People',     icon: UserCheck, synonyms: 'staff people users team members accounts access roster' },
            { path: '/salary',     label: 'Salary',     icon: Banknote, synonyms: 'payroll wages staff pay compensation' },
            { path: '/activity',   label: 'Activity',   icon: ScrollText, synonyms: 'audit log history who changed' },
            { path: '/usage',      label: 'Usage',      icon: BarChart3, synonyms: 'analytics pageviews logins most active' },
            { path: '/admin-docs', label: 'Admin docs', icon: ShieldCheck, synonyms: 'documentation runbook confidential vault' },
            { path: '/vendor-lab', label: 'Sandbox',    icon: FlaskConical, external: true, synonyms: 'vendor form sandbox lab test preview' },
          ] : []),
        ],
      },
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
