import { useState, useEffect, useRef } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Music, Users, UserCheck, Settings, ScrollText,
  LogOut, LogIn, Eye, ChevronDown, Menu, X, Moon, Sun, Disc3, Building2,
  Briefcase, TrendingUp, FileText, RefreshCw, BookOpen, Receipt, CreditCard,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import api from '../api'

const PAGE_LABELS = {
  '/':           'Dashboard',
  '/my-work':    'My Work',
  '/releases':   'Releases',
  '/artists':    'Artists',
  '/deals':      'Deal Pipeline',
  '/contracts':  'Contracts',
  '/renewals':   'Renewals',
  '/ledger':     'Ledger',
  '/payments':   'Payments',
  '/vendors':    'Vendors',
  '/invoices':   'Invoices',
  '/team':       'Team',
  '/activity':   'Activity',
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
                  <div className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
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

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const handler = (e) => { setIsMobile(e.matches); if (!e.matches) setSidebarOpen(false) }
    handler(mq)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => { if (isMobile) setSidebarOpen(false) }, [location.pathname, isMobile])

  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)
  const isApprover = ['Superadmin', 'Admin', 'Approver'].includes(user?.role)

  // Pending ledger approvals → nav badge (approvers only). Refreshes on nav.
  const [pendingApprovals, setPendingApprovals] = useState(0)
  useEffect(() => {
    if (!isApprover) return
    api.get('/ledger/pending-count').then(r => setPendingApprovals(r.data?.data?.count || 0)).catch(() => {})
  }, [isApprover, location.pathname])

  // Sidebar information architecture — grouped the way a label team works.
  // Items are filtered by canView (role + per-user page permissions).
  const navGroups = [
    {
      label: null,
      items: [
        { path: '/',        label: 'Dashboard', icon: LayoutDashboard },
        { path: '/my-work', label: 'My Work',   icon: Briefcase },
      ],
    },
    {
      label: 'Catalog',
      items: [
        { path: '/releases', label: 'Releases', icon: Music },
        { path: '/artists',  label: 'Artists',  icon: Disc3 },
      ],
    },
    {
      label: 'A&R',
      items: [
        { path: '/deals', label: 'Deal Pipeline', icon: TrendingUp },
      ],
    },
    {
      label: 'Contracts',
      items: [
        ...(isApprover ? [{ path: '/contracts', label: 'Contracts', icon: FileText }] : []),
        ...(isApprover ? [{ path: '/renewals', label: 'Renewals', icon: RefreshCw }] : []),
      ],
    },
    {
      label: 'Bookkeeping',
      items: [
        ...(isApprover ? [{ path: '/ledger', label: 'Ledger', icon: BookOpen, badge: pendingApprovals }] : []),
        ...(isApprover ? [{ path: '/payments', label: 'Payments', icon: CreditCard }] : []),
        ...(isApprover ? [{ path: '/vendors', label: 'Vendors', icon: Building2 }] : []),
        ...(isApprover ? [{ path: '/invoices', label: 'Invoices', icon: Receipt }] : []),
      ],
    },
    {
      label: 'Workspace',
      items: [
        ...(isAdmin ? [{ path: '/team', label: 'Team', icon: UserCheck }] : []),
        ...(isAdmin ? [{ path: '/activity', label: 'Activity', icon: ScrollText }] : []),
        { path: '/settings', label: 'Settings', icon: Settings },
      ],
    },
    // Platform-admin only — provisioning new label accounts. A level above the
    // current workspace, so it lives in its own section.
    ...(user?.is_platform_admin ? [{
      label: 'Platform',
      items: [{ path: '/workspaces', label: 'Workspaces', icon: Building2 }],
    }] : []),
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
              <img src={label.logo_url} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0 bg-gray-100" />
            ) : (
              <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-sm">{label?.name?.charAt(0)?.toUpperCase() || 'C'}</span>
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink tracking-tight leading-none truncate">{label?.name || 'Workspace'}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Label Operations</p>
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
                        isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
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
          {user && (
            <div className="flex items-center gap-3 px-3 py-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
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
        {impersonating && (
          <div className="flex items-center justify-between px-6 py-2 bg-amber-400 text-amber-900 text-xs font-semibold flex-shrink-0">
            <div className="flex items-center gap-2">
              <Eye size={13} />
              <span>
                Viewing <span className="font-bold">{label?.name || 'workspace'}</span> as{' '}
                <span className="font-bold">{user?.name}</span> ({user?.role})
                {adminUser?.is_platform_admin ? ' — platform admin view' : ''}
              </span>
            </div>
            <button onClick={exitImpersonation} className="flex items-center gap-1 font-bold hover:underline">
              <X size={12} /> Exit
            </button>
          </div>
        )}

        {/* Header */}
        <div className="h-14 flex items-center gap-3 px-4 lg:px-6 border-b border-divider bg-header flex-shrink-0">
          {isMobile && (
            <button onClick={() => setSidebarOpen(true)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg lg:hidden">
              <Menu size={20} />
            </button>
          )}
          <h1 className="text-sm font-semibold text-ink">{PAGE_LABELS[location.pathname] || ''}</h1>
          <div className="flex-1" />
          <span className="hidden sm:block"><ViewAsDropdown /></span>
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="inline-flex items-center text-xs font-semibold px-3 py-1.5 rounded-lg border border-rule text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-all"
          >
            {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
          </button>
        </div>

        <main className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
