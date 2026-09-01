import { useState, useEffect, useRef } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Music, Users, UserCheck, Settings, ScrollText,
  LogOut, LogIn, Eye, ChevronDown, Menu, X, Moon, Sun, Disc3, Building2, Image as ImageIcon,
  Briefcase, TrendingUp, FileText, RefreshCw, BookOpen, Receipt, CreditCard,
  Link2, Check, CalendarDays, Search, PieChart, Wallet, Banknote, Megaphone, FileBarChart, GitMerge, Scale,
  FileClock, Shield, Lock, FileSignature, FileSpreadsheet, Layers, PiggyBank, FilePlus2,
  MessageSquarePlus, MessageSquare, Landmark, Coins, ShieldCheck, Users2, UploadCloud, FileSearch,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useSocket } from '../context/SocketContext'
import { useTheme } from '../context/ThemeContext'
import api from '../api'
import GlobalSearch from './GlobalSearch'
import NotificationBell from './NotificationBell'
import UserManual from './UserManual'
import BottomNav from './BottomNav'
import Fab from './Fab'
import KeyboardShortcutsHelp from './KeyboardShortcutsHelp'
import ErrorBoundary from './ErrorBoundary'

export const PAGE_LABELS = {
  '/':           'Dashboard',
  '/my-work':    'My Work',
  '/team-work':  'Team Work',
  '/calendar':   'Calendar',
  '/financials': 'Financials',
  '/reports': 'Reports',
  '/ad-allocation': 'Allocate Advertising',
  '/bank-matching': 'Bank Matching',
  '/bank-ledger': 'Bank Ledger',
  '/bulk-upload': 'Bulk Upload',
  '/approvals/archive': 'Approvals Archive',
  '/creators': 'Creator Payments',
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
  '/activity':   'Activity',
  '/requests':   'Requests & feedback',
  '/settings':   'Settings',
  '/workspaces': 'Workspaces',
}

// "View as" dropdown — Superadmin-only impersonation within the workspace.
function ViewAsDropdown() {
  const { user, impersonate, impersonating, exitImpersonation, adminUser } = useAuth()
  const [open, setOpen] = useState(false)
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleOpen = async () => {
    if (!open && users.length === 0) {
      setLoading(true)
      try { const res = await api.get('/auth/users'); setUsers(res.data.data || []) } catch {}
      setLoading(false)
    }
    setOpen(v => !v)
  }

  if (impersonating) {
    return (
      <button
        onClick={exitImpersonation}
        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-all"
      >
        <LogIn size={13} /> Exit — back to {adminUser?.name || 'Admin'}
      </button>
    )
  }

  if (user?.role !== 'Superadmin') return null

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={handleOpen}
        className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${
          open ? 'bg-gray-900 text-white border-gray-900'
               : 'text-gray-500 border-rule hover:text-gray-700 hover:bg-gray-50'
        }`}
      >
        <Eye size={13} /> View as
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-card rounded-xl border border-rule shadow-modal z-50 overflow-hidden">
          <p className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-widest border-b border-divider">
            View dashboard as…
          </p>
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-5 h-5 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="py-1">
              {users.filter(u => u.id !== user?.id).map(u => (
                <button
                  key={u.id}
                  onClick={async () => { setOpen(false); await impersonate(u.id) }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="w-6 h-6 rounded-full bg-brand-500/15 flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-bold text-brand-700">{u.name?.charAt(0)?.toUpperCase()}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{u.name}</p>
                    <p className="text-[10px] text-gray-400 truncate">{u.role} · {u.department}</p>
                  </div>
                </button>
              ))}
              {users.filter(u => u.id !== user?.id).length === 0 && (
                <p className="px-3 py-3 text-xs text-gray-400">No other members yet.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const { user, label, adminUser, logout, impersonating, exitImpersonation, canView } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [vendorLinkCopied, setVendorLinkCopied] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const navigate = useNavigate()

  // Keyboard shortcuts: ⌘K search, ? help, and "g"-prefixed quick navigation
  // (g d/r/a/c/w). Ignored while typing in a field.
  useEffect(() => {
    let gPending = false
    let gTimer = null
    const inField = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(v => !v); return }
      if (inField(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '?') { e.preventDefault(); setHelpOpen(v => !v); return }
      if (gPending) {
        const dest = { d: '/', r: '/releases', a: '/artists', c: '/calendar', w: '/my-work' }[e.key.toLowerCase()]
        if (dest) { e.preventDefault(); navigate(dest) }
        gPending = false; clearTimeout(gTimer); return
      }
      if (e.key.toLowerCase() === 'g') { gPending = true; gTimer = setTimeout(() => { gPending = false }, 800) }
    }
    window.addEventListener('keydown', handler)
    return () => { window.removeEventListener('keydown', handler); clearTimeout(gTimer) }
  }, [navigate])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const handler = (e) => { setIsMobile(e.matches); if (!e.matches) setSidebarOpen(false) }
    handler(mq)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => { if (isMobile) setSidebarOpen(false) }, [location.pathname, isMobile])

  // Platform announcements — dismissible banner stack.
  const [announcements, setAnnouncements] = useState([])
  useEffect(() => {
    if (!user) return
    api.get('/announcements/active').then(r => setAnnouncements(r.data.data || [])).catch(() => {})
  }, [user?.id])
  const dismissAnnouncement = (id) => { setAnnouncements(a => a.filter(x => x.id !== id)); api.post(`/announcements/${id}/dismiss`).catch(() => {}) }

  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)
  const isApprover = ['Superadmin', 'Admin', 'Approver'].includes(user?.role)

  // Public vendor submission form — unique per workspace via the label slug.
  const copyVendorLink = () => {
    if (!label?.slug) return
    const url = `${window.location.origin}/submit/${label.vendor_form_token}`
    navigator.clipboard.writeText(url).then(() => {
      setVendorLinkCopied(true)
      setTimeout(() => setVendorLinkCopied(false), 2000)
    }).catch(() => {})
  }

  // Pending ledger approvals → nav badge (approvers only). Refreshes on nav.
  const [pendingApprovals, setPendingApprovals] = useState(0)
  useEffect(() => {
    if (!isApprover) return
    api.get('/ledger/pending-count').then(r => setPendingApprovals(r.data?.data?.count || 0)).catch(() => {})
  }, [isApprover, location.pathname])

  // Live chat unread badge. Refetch on nav (covers read-clearing) and whenever a
  // new message lands over the socket.
  const { on: onSocket } = useSocket()
  const [chatUnread, setChatUnread] = useState(0)
  const refreshChatUnread = () => api.get('/chat/unread').then(r => setChatUnread(r.data?.data?.total || 0)).catch(() => {})
  useEffect(() => { refreshChatUnread() }, [location.pathname])
  useEffect(() => onSocket('message:new', () => refreshChatUnread()), [onSocket])

  // Sidebar information architecture — grouped the way a label team works.
  // Items are filtered by canView (role + per-user page permissions).
  const navGroups = [
    {
      label: null,
      items: [
        { path: '/',         label: 'Dashboard', icon: LayoutDashboard },
        { path: '/my-work',  label: 'My Work',   icon: Briefcase },
        // Team leads only. canView() below still applies, so an admin can revoke it.
        ...(isApprover ? [{ path: '/team-work', label: 'Team Work', icon: Users2 }] : []),
        { path: '/messages', label: 'Messages',  icon: MessageSquare, badge: chatUnread },
        { path: '/calendar', label: 'Calendar',  icon: CalendarDays },
      ],
    },
    {
      label: 'Catalog',
      items: [
        { path: '/releases', label: 'Releases', icon: Music },
        { path: '/catalog',  label: 'Catalog',  icon: Disc3 },
        { path: '/artists',  label: 'Roster',  icon: Users },
        { path: '/brand',    label: 'Brand',    icon: ImageIcon },
      ],
    },
    {
      label: 'A&R',
      items: [
        { path: '/deals',     label: 'Deal Pipeline', icon: TrendingUp },
        { path: '/marketing', label: 'Marketing',     icon: Megaphone },
        ...(isApprover ? [{ path: '/artist-campaigns', label: 'Artist Campaigns', icon: Megaphone }] : []),
      ],
    },
    {
      label: 'Contracts & Legal',
      items: [
        ...(isApprover ? [{ path: '/contracts', label: 'Contracts', icon: FileText }] : []),
        ...(isApprover ? [{ path: '/pending-contracts', label: 'Pending', icon: FileClock }] : []),
        ...(isApprover ? [{ path: '/renewals', label: 'Renewals', icon: RefreshCw }] : []),
        ...(isApprover ? [{ path: '/legal', label: 'NDAs', icon: Shield }] : []),
        ...(isApprover ? [{ path: '/create-nda', label: 'Create NDA', icon: FilePlus2 }] : []),
        ...(isApprover ? [{ path: '/label-waivers', label: 'Label Waivers', icon: FileSignature }] : []),
        ...(isApprover ? [{ path: '/clearances', label: 'Clearances', icon: FileSpreadsheet }] : []),
        ...(isAdmin ? [{ path: '/admin-docs', label: 'Admin Docs', icon: Lock }] : []),
      ],
    },
    {
      label: 'Bookkeeping',
      items: [
        { path: '/add-invoice', label: 'Add Invoice', icon: Receipt },
        ...(isApprover ? [{ path: '/approvals', label: 'Approvals', icon: Check, badge: pendingApprovals }] : []),
        ...(isApprover ? [{ path: '/ledger', label: 'Ledger', icon: BookOpen }] : []),
        ...(isApprover ? [{ path: '/invoice-search', label: 'Invoice Search', icon: FileSearch }] : []),
        ...(isApprover ? [{ path: '/bulk-upload', label: 'Bulk Upload', icon: UploadCloud }] : []),
        ...(isApprover ? [{ path: '/payments', label: 'Payments', icon: CreditCard }] : []),
        ...(isAdmin ? [{ path: '/bank-statements', label: 'Bank Statements', icon: Landmark }] : []),
        ...(isAdmin ? [{ path: '/bank-matching', label: 'Bank Matching', icon: GitMerge }] : []),
        ...(isAdmin ? [{ path: '/bank-ledger', label: 'Bank Ledger', icon: Coins }] : []),
        ...(isApprover ? [{ path: '/vendors', label: 'Vendors', icon: Building2 }] : []),
        ...(isApprover ? [{ path: '/creators', label: 'Creator Payments', icon: Users }] : []),
        ...(isApprover ? [{ path: '/invoices', label: 'Create Invoice', icon: Receipt }] : []),
        ...(isApprover ? [{ path: '/financials', label: 'Financials', icon: PieChart }] : []),
        ...(isApprover ? [{ path: '/reports', label: 'Reports', icon: FileBarChart }] : []),
        ...(isApprover ? [{ path: '/ad-allocation', label: 'Allocate Ads', icon: Megaphone }] : []),
        ...(isApprover ? [{ path: '/artist-budgets', label: 'Artist Budgets', icon: Scale }] : []),
        ...(isApprover ? [{ path: '/recording-budgets', label: 'Recording Budgets', icon: PiggyBank }] : []),
        ...(isApprover ? [{ path: '/recoupments', label: 'Recoupments', icon: Wallet }] : []),
        ...(isApprover ? [{ path: '/recoupments/planning', label: 'Recoup. Planning', icon: Layers }] : []),
        ...(isAdmin ? [{ path: '/salary', label: 'Salary', icon: Banknote }] : []),
      ],
    },
    {
      label: 'Workspace',
      items: [
        ...(isAdmin ? [{ path: '/team', label: 'Team', icon: UserCheck }] : []),
        ...(isAdmin ? [{ path: '/activity', label: 'Activity', icon: ScrollText }] : []),
        // Not admin-gated: the catalog + artist checks serve every role, and the
        // money-shaped sections are role-gated server-side (routes/flags.js).
        { path: '/data-quality', label: 'Data Quality', icon: ShieldCheck },
        { path: '/requests', label: 'Requests & feedback', icon: MessageSquarePlus },
        { path: '/settings', label: 'Settings', icon: Settings },
      ],
    },
  ]
    .map(g => ({ ...g, items: g.items.filter(i => canView(i.path)) }))
    .filter(g => g.items.length > 0)

  return (
    <div className="flex h-screen bg-page">
      {/* Mobile backdrop */}
      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 bg-overlay z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <div className={`
        ${isMobile ? 'fixed inset-y-0 left-0 z-40 transform transition-transform duration-200' : ''}
        ${isMobile && !sidebarOpen ? '-translate-x-full' : 'translate-x-0'}
        w-60 bg-sidebar border-r border-rule flex flex-col flex-shrink-0
      `}>
        {/* Logo + workspace */}
        <div className="h-16 flex items-center justify-between px-5 border-b border-divider">
          <div className="flex items-center gap-2.5 min-w-0">
            {label?.logo_url ? (
              <img src={label.logo_url} alt="" className="w-8 h-8 rounded-lg object-contain flex-shrink-0 bg-gray-100" />
            ) : (
              <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-sm">{label?.settings?.logo_initials || label?.name?.charAt(0)?.toUpperCase() || 'C'}</span>
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink tracking-tight leading-none truncate">{label?.name || 'Workspace'}</p>
              <p className="text-[11px] text-gray-400 mt-0.5 truncate">{label?.settings?.tagline || 'Label Operations'}</p>
            </div>
          </div>
          {isMobile && (
            <button onClick={() => setSidebarOpen(false)} className="p-1 text-gray-400 hover:text-gray-600 lg:hidden">
              <X size={18} />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-4">
          {navGroups.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <p className="px-3 mb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-widest">{group.label}</p>
              )}
              <div className="space-y-0.5">
                {group.items.map(({ path, label, icon: Icon, badge }) => {
                  const isActive = path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)
                  return (
                    <Link
                      key={path}
                      to={path}
                      className={`group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                        isActive ? 'bg-brand-500/10 text-brand-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                    >
                      <Icon size={17} strokeWidth={isActive ? 2 : 1.5}
                        className={isActive ? 'text-brand-600' : 'text-gray-400 group-hover:text-gray-600'} />
                      <span>{label}</span>
                      {badge > 0 && (
                        <span className="ml-auto bg-brand-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">{badge}</span>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User + logout */}
        <div className="p-3 border-t border-divider">
          {/* Public vendor form link — per-workspace, easy to copy and share. */}
          {isApprover && label?.slug && (
            <button
              onClick={copyVendorLink}
              title={`${window.location.origin}/submit/${label.vendor_form_token}`}
              className="w-full flex items-center gap-2.5 px-3 py-2 mb-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-all border-b border-divider pb-3 rounded-b-none"
            >
              <Link2 size={16} strokeWidth={1.5} className="text-gray-400 flex-shrink-0" />
              <span>Vendor Form</span>
              <span className={`ml-auto inline-flex items-center gap-1 text-xs font-semibold ${vendorLinkCopied ? 'text-emerald-600' : 'text-gray-400'}`}>
                {vendorLinkCopied ? <><Check size={13} /> Copied</> : 'Copy link'}
              </span>
            </button>
          )}
          {user && (
            <div className="flex items-center gap-3 px-3 py-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-brand-500/15 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-semibold text-brand-700">{user.name?.charAt(0)?.toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink truncate">{user.name}</p>
                <p className="text-xs text-gray-500 truncate">{user.role}</p>
              </div>
            </div>
          )}
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-all"
          >
            <LogOut size={16} strokeWidth={1.5} /> <span>Sign out</span>
          </button>
          {/* Subtle co-branding — the label's identity leads, Cadence powers it. */}
          <div className="flex items-center justify-center gap-1.5 pt-2 mt-1 text-[10px] text-gray-400">
            <Disc3 size={11} className="text-gray-400" />
            <span>Powered by Cadence</span>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* The amber "Operating in X as platform admin" / "Viewing as" banner used to
            live here. Removed — the header's "Exit — back to <name>" button carries
            the same state and the same escape hatch, so the bar was pure duplication.
            That button is force-shown while impersonating (see ViewAsDropdown's
            wrapper below), because it is now the ONLY way out. */}

        {/* Header */}
        <div className="h-14 flex items-center gap-3 px-4 lg:px-6 border-b border-divider bg-header flex-shrink-0">
          {isMobile && (
            <button onClick={() => setSidebarOpen(true)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg lg:hidden">
              <Menu size={20} />
            </button>
          )}
          <h1 className="text-sm font-semibold text-ink">{PAGE_LABELS[location.pathname] || ''}</h1>
          <div className="flex-1" />
          {/* Workspace-wide search (⌘K) */}
          <button
            onClick={() => setSearchOpen(true)}
            title="Search (⌘K)"
            className="inline-flex items-center gap-2 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-rule text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-all"
          >
            <Search size={14} />
            <span className="hidden md:inline">Search</span>
            <kbd className="hidden md:inline text-[10px] border border-rule rounded px-1 leading-tight">⌘K</kbd>
          </button>
          <button
            onClick={() => setManualOpen(true)}
            title="User manual"
            className="inline-flex items-center text-xs font-semibold p-1.5 rounded-lg border border-rule text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-all"
          >
            <BookOpen size={15} />
          </button>
          <NotificationBell />
          {/* Normally desktop-only, but while impersonating this is the only exit. */}
          <span className={impersonating ? 'block' : 'hidden sm:block'}><ViewAsDropdown /></span>
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="inline-flex items-center text-xs font-semibold px-3 py-1.5 rounded-lg border border-rule text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-all"
          >
            {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
          </button>
        </div>

        <main className="flex-1 overflow-auto">
          {announcements.length > 0 && (
            <div>
              {announcements.map(a => {
                const style = a.level === 'critical' ? 'bg-red-50 text-red-800 border-red-200'
                  : a.level === 'warning' ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-brand-500/10 text-brand-800 border-brand-200'
                return (
                  <div key={a.id} className={`px-4 sm:px-6 py-2.5 flex items-start gap-3 border-b ${style}`}>
                    <Megaphone size={15} className="mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0 text-sm"><span className="font-semibold">{a.title}</span>{a.body && <span className="opacity-80"> — {a.body}</span>}</div>
                    <button onClick={() => dismissAnnouncement(a.id)} className="opacity-60 hover:opacity-100 flex-shrink-0" title="Dismiss"><X size={15} /></button>
                  </div>
                )
              })}
            </div>
          )}
          <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 sm:py-8 pb-20 lg:pb-8">
            <ErrorBoundary key={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <KeyboardShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <UserManual open={manualOpen} onClose={() => setManualOpen(false)} />
      {isMobile && <BottomNav onMenu={() => setSidebarOpen(true)} />}
      {isMobile && <Fab />}
    </div>
  )
}
