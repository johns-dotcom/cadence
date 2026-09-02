import {
  LayoutDashboard, Music, Users, UserCheck, Settings, ScrollText,
  Disc3, Building2, Image as ImageIcon,
  Briefcase, TrendingUp, FileText, RefreshCw, BookOpen, Receipt, CreditCard,
  CalendarDays, PieChart, Wallet, Banknote, Megaphone, FileBarChart, GitMerge, Scale,
  FileClock, Shield, Lock, FileSignature, FileSpreadsheet, Layers, PiggyBank, FilePlus2,
  MessageSquarePlus, MessageSquare, Landmark, Coins, ShieldCheck, Users2, UploadCloud, FileSearch,
  PackageCheck, BarChart3, Check,
} from 'lucide-react'

// THE nav definition — one module, three consumers.
//
// It lives here rather than inside Layout because it is not the sidebar's
// private business: Settings' "hide items" editor renders the same rows so it
// can't offer a toggle for a row that doesn't exist, and the ⌘K palette ranks
// pages against these labels, paths and `synonyms`. Three copies of this list
// is how two of them go stale.
//
// `synonyms` is the vocabulary people actually use — "w9" for Vendors, "p&l"
// for Reports, "payroll" for Salary — and exists purely for search.

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

// Sidebar information architecture — grouped the way a label team works.
// Module-level and pure so BOTH the sidebar and Settings' "hide items" list
// read the same definition; two copies would drift and offer people toggles
// for rows that aren't there.
// Items are still filtered by canView (role + per-user page permissions) and
// then by the viewer's own hidden-pages preference.
export function buildNavGroups({ isAdmin, isApprover, chatUnread = 0, pendingApprovals = 0 }) {
  return [
  {
    label: null,
    items: [
      { path: '/',         label: 'Dashboard', icon: LayoutDashboard, synonyms: 'home overview start' },
      { path: '/my-work',  label: 'My Work',   icon: Briefcase, synonyms: 'tasks todo my tasks assignments' },
      // Team leads only. canView() below still applies, so an admin can revoke it.
      ...(isApprover ? [{ path: '/team-work', label: 'Team Work', icon: Users2, synonyms: 'team tasks department workload' }] : []),
      { path: '/messages', label: 'Messages',  icon: MessageSquare, badge: chatUnread, synonyms: 'chat slack dm direct message channels' },
      { path: '/calendar', label: 'Calendar',  icon: CalendarDays, synonyms: 'schedule events dates' },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { path: '/releases', label: 'Releases', icon: Music, synonyms: 'projects singles albums eps drops' },
      { path: '/catalog',  label: 'Catalog',  icon: Disc3, synonyms: 'discography back catalogue library artwork' },
      { path: '/artists',  label: 'Roster',  icon: Users, synonyms: 'roster acts talent signings' },
      { path: '/brand',    label: 'Brand',    icon: ImageIcon, synonyms: 'assets logos artwork press kit' },
    ],
  },
  {
    label: 'A&R',
    items: [
      { path: '/deals',     label: 'Deal Pipeline', icon: TrendingUp, synonyms: 'pipeline kanban prospects signings offers' },
      { path: '/marketing', label: 'Marketing',     icon: Megaphone, synonyms: 'promo campaigns ads' },
      ...(isApprover ? [{ path: '/artist-campaigns', label: 'Artist Campaigns', icon: Megaphone, synonyms: 'campaign spend cobrand promo per artist' }] : []),
    ],
  },
  {
    label: 'Contracts & Legal',
    items: [
      ...(isApprover ? [{ path: '/contracts', label: 'Contracts', icon: FileText, synonyms: 'agreements deals paperwork terms' }] : []),
      ...(isApprover ? [{ path: '/contracts/create', label: 'Create Contract', icon: FilePlus2, synonyms: 'new contract draft agreement generate' }] : []),
      ...(isApprover ? [{ path: '/pending-contracts', label: 'Pending', icon: FileClock, synonyms: 'unsigned awaiting signature drafts' }] : []),
      ...(isApprover ? [{ path: '/renewals', label: 'Renewals', icon: RefreshCw, synonyms: 'expiring contracts renew expiry' }] : []),
      ...(isApprover ? [{ path: '/legal', label: 'NDAs', icon: Shield, synonyms: 'nda non-disclosure confidentiality' }] : []),
      ...(isApprover ? [{ path: '/create-nda', label: 'Create NDA', icon: FilePlus2, synonyms: 'new nda generate non-disclosure' }] : []),
      ...(isApprover ? [{ path: '/label-waivers', label: 'Label Waivers', icon: FileSignature, synonyms: 'waiver release form permission' }] : []),
      ...(isApprover ? [{ path: '/clearances', label: 'Clearances', icon: FileSpreadsheet, synonyms: 'sample clearance rights permission' }] : []),
      ...(isAdmin ? [{ path: '/admin-docs', label: 'Admin Docs', icon: Lock, synonyms: 'documents policies internal files' }] : []),
    ],
  },
  {
    label: 'Bookkeeping',
    items: [
      { path: '/add-invoice', label: 'Add Invoice', icon: Receipt, synonyms: 'new invoice bill submit expense' },
      // Reachable ONLY from a button on /ledger until now — which a User
      // without the ledger page can never see, so the page was unreachable
      // for exactly the people who file reimbursements.
      { path: '/ledger/new-reimbursement', label: 'Add Reimbursement', icon: Wallet, synonyms: 'reimbursement expense claim receipt payback' },
      ...(isApprover ? [{ path: '/approvals', label: 'Approvals', icon: Check, badge: pendingApprovals, synonyms: 'approve review pending queue sign off' }] : []),
      ...(isApprover ? [{ path: '/ledger', label: 'Ledger', icon: BookOpen, synonyms: 'expenses invoices bookkeeping entries transactions bk' }] : []),
      ...(isApprover ? [{ path: '/invoice-search', label: 'Invoice Search', icon: FileSearch, synonyms: 'find invoice lookup expense search' }] : []),
      ...(isApprover ? [{ path: '/bulk-upload', label: 'Bulk Upload', icon: UploadCloud, synonyms: 'import batch upload spreadsheet' }] : []),
      ...(isApprover ? [{ path: '/payments', label: 'Payments', icon: CreditCard, synonyms: 'pay ap accounts payable due schedule remittance' }] : []),
      ...(isAdmin ? [{ path: '/bank-statements', label: 'Bank Statements', icon: Landmark, synonyms: 'statement csv reconcile bank upload' }] : []),
      ...(isAdmin ? [{ path: '/bank-matching', label: 'Bank Matching', icon: GitMerge, synonyms: 'reconcile match bank transactions' }] : []),
      ...(isAdmin ? [{ path: '/bank-ledger', label: 'Bank Ledger', icon: Coins, synonyms: 'bank booked spend no invoice' }] : []),
      ...(isApprover ? [{ path: '/vendors', label: 'Vendors', icon: Building2, synonyms: 'suppliers payees w9 1099 vendor directory' }] : []),
      ...(isApprover ? [{ path: '/creators', label: 'Creator Payments', icon: Users, synonyms: 'influencers ugc paypal creator payments' }] : []),
      ...(isApprover ? [{ path: '/bulk-deals', label: 'Bulk Deals', icon: PackageCheck, synonyms: 'bulk units delivery quantity' }] : []),
      ...(isApprover ? [{ path: '/invoices', label: 'Create Invoice', icon: Receipt, synonyms: 'outbound invoice bill client create invoice' }] : []),
      ...(isApprover ? [{ path: '/financials', label: 'Financials', icon: PieChart, synonyms: 'finance money pnl profit loss revenue cashflow' }] : []),
      ...(isApprover ? [{ path: '/reports', label: 'Reports', icon: FileBarChart, synonyms: 'p&l pnl profit and loss balance sheet spend by artist' }] : []),
      ...(isApprover ? [{ path: '/ad-allocation', label: 'Allocate Ads', icon: Megaphone, synonyms: 'advertising allocate ads spend split' }] : []),
      ...(isApprover ? [{ path: '/artist-budgets', label: 'Artist Budgets', icon: Scale, synonyms: 'budget per artist spend limit' }] : []),
      ...(isApprover ? [{ path: '/recording-budgets', label: 'Recording Budgets', icon: PiggyBank, synonyms: 'studio budget recording session costs' }] : []),
      ...(isApprover ? [{ path: '/recoupments', label: 'Recoupments', icon: Wallet, synonyms: 'recoup advances statements artist balance' }] : []),
      ...(isApprover ? [{ path: '/recoupments/planning', label: 'Recoup. Planning', icon: Layers, synonyms: 'recoup plan forecast projection' }] : []),
      ...(isAdmin ? [{ path: '/salary', label: 'Salary', icon: Banknote, synonyms: 'payroll wages staff pay' }] : []),
    ],
  },
  {
    label: 'Workspace',
    items: [
      { path: '/team', label: 'Team', icon: UserCheck, synonyms: 'people members staff users roles' },
      ...(isAdmin ? [{ path: '/activity', label: 'Activity', icon: ScrollText, synonyms: 'audit log history changes' }] : []),
      ...(isAdmin ? [{ path: '/usage', label: 'Usage', icon: BarChart3, synonyms: 'analytics page views active users' }] : []),
      // Not admin-gated: the catalog + artist checks serve every role, and the
      // money-shaped sections are role-gated server-side (routes/flags.js).
      { path: '/data-quality', label: 'Data Quality', icon: ShieldCheck, synonyms: 'flags duplicates issues checks validation' },
      { path: '/requests', label: 'Requests & feedback', icon: MessageSquarePlus, synonyms: 'support feedback help contact ask' },
      { path: '/settings', label: 'Settings', icon: Settings, synonyms: 'preferences configuration workspace admin account' },
    ],
  },
  ]
}
