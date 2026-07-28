import { useState, useEffect } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, Building2, BarChart3, ScrollText, UserCog, LogOut, Disc3, Menu, X, Moon, Sun, Users, ShieldCheck, Megaphone, Flag, CreditCard } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import api from '../api'
import ErrorBoundary from './ErrorBoundary'

// Neutral operator shell shown to platform admins who are NOT inside a
// workspace. No label branding, no label-scoped nav — just platform tools.
// Operators (managing other admins) is owner-only.
const NAV = [
  { path: '/', label: 'Overview', icon: LayoutDashboard },
  { path: '/workspaces', label: 'Workspaces', icon: Building2 },
  { path: '/analytics', label: 'Analytics', icon: BarChart3 },
  { path: '/billing', label: 'Billing', icon: CreditCard },
  { path: '/activity', label: 'Activity', icon: ScrollText },
  { path: '/security', label: 'Security', icon: ShieldCheck },
  { path: '/announcements', label: 'Announcements', icon: Megaphone },
  { path: '/feature-flags', label: 'Feature flags', icon: Flag },
  { path: '/operators', label: 'Operators', icon: Users, ownerOnly: true },
  { path: '/account', label: 'Account', icon: UserCog },
]
const META = {
  '/': { title: 'Overview', sub: 'Everything across the platform at a glance' },
  '/workspaces': { title: 'Workspaces', sub: 'Provision, monitor and manage label accounts' },
  '/analytics': { title: 'Analytics', sub: 'Growth and engagement across tenants' },
  '/billing': { title: 'Billing & plans', sub: 'Revenue and per-workspace subscriptions' },
  '/activity': { title: 'Activity', sub: 'Cross-tenant audit feed' },
  '/security': { title: 'Security', sub: 'Login audit and operator access' },
  '/announcements': { title: 'Announcements', sub: 'Broadcast banners to workspaces' },
  '/feature-flags': { title: 'Feature flags', sub: 'Toggle capabilities per workspace' },
  '/operators': { title: 'Operators', sub: 'Platform administrators' },
  '/account': { title: 'Account', sub: 'Your operator profile' },
}

export default function PlatformLayout() {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [pageAccess, setPageAccess] = useState(null) // null = unrestricted (owner or no rows)

  useEffect(() => {
    api.get('/platform/my-access').then(r => setPageAccess(r.data.data?.pages ?? null)).catch(() => setPageAccess(null))
  }, [])
  // Overview + Account are always reachable so an operator is never locked out.
  const canSee = (path) => path === '/' || path === '/account' || !pageAccess || pageAccess.includes(path)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const handler = (e) => { setIsMobile(e.matches); if (!e.matches) setSidebarOpen(false) }
    handler(mq); mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  useEffect(() => { if (isMobile) setSidebarOpen(false) }, [location.pathname, isMobile])

  const isActive = (p) => p === '/' ? location.pathname === '/' : location.pathname.startsWith(p)
  const meta = META[location.pathname] || { title: 'Platform', sub: '' }
  const roleLabel = user?.platform_role === 'owner' ? 'Platform owner' : 'Platform admin'

  return (
    <div className="flex h-screen bg-page">
      {isMobile && sidebarOpen && <div className="fixed inset-0 bg-overlay z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <div className={`${isMobile ? 'fixed inset-y-0 left-0 z-40 transform transition-transform duration-200' : ''} ${isMobile && !sidebarOpen ? '-translate-x-full' : 'translate-x-0'} w-60 bg-sidebar border-r border-rule flex flex-col flex-shrink-0`}>
        {/* Platform identity — a dark, accent-gradient block that reads as the
            operator console, distinct from any label's branded shell. */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-divider">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm" style={{ background: 'linear-gradient(135deg,#111827 0%, rgb(var(--color-brand-600)) 130%)' }}>
              <Disc3 size={19} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink tracking-tight leading-none">Cadence</p>
              <p className="text-[10px] font-semibold text-brand-600 uppercase tracking-widest mt-1">Console</p>
            </div>
          </div>
          {isMobile && <button onClick={() => setSidebarOpen(false)} className="p-1 text-gray-400 hover:text-gray-600 lg:hidden"><X size={18} /></button>}
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-0.5">
          {NAV.filter(n => (!n.ownerOnly || user?.platform_role === 'owner') && canSee(n.path)).map(({ path, label, icon: Icon }) => {
            const active = isActive(path)
            return (
              <Link key={path} to={path}
                className={`group relative flex items-center gap-3 pl-3 pr-3 py-2 rounded-lg text-sm font-medium transition-all ${active ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'}`}>
                {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full bg-brand-600" />}
                <Icon size={17} strokeWidth={active ? 2.2 : 1.6} className={active ? 'text-brand-600' : 'text-gray-400 group-hover:text-gray-600'} />
                <span>{label}</span>
              </Link>
            )
          })}
        </nav>

        <div className="p-3 border-t border-divider">
          {user && (
            <div className="flex items-center gap-3 px-2 py-2 mb-1.5">
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#111827,rgb(var(--color-brand-600)))' }}><span className="text-sm font-semibold text-white">{user.name?.charAt(0)?.toUpperCase()}</span></div>
              <div className="flex-1 min-w-0"><p className="text-sm font-medium text-ink truncate">{user.name}</p><p className="text-[11px] text-gray-500 truncate">{roleLabel}</p></div>
            </div>
          )}
          <button onClick={logout} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-all">
            <LogOut size={16} strokeWidth={1.5} /> <span>Sign out</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-14 flex items-center gap-3 px-4 lg:px-6 border-b border-divider bg-header flex-shrink-0">
          {isMobile && <button onClick={() => setSidebarOpen(true)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg lg:hidden"><Menu size={20} /></button>}
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-ink leading-none">{meta.title}</h1>
            {meta.sub && <p className="text-[11px] text-gray-400 mt-1 truncate hidden sm:block">{meta.sub}</p>}
          </div>
          <div className="flex-1" />
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 bg-gray-100 rounded-full px-2.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Platform console
          </span>
          <button onClick={toggleTheme} title="Toggle theme" className="inline-flex items-center text-xs font-semibold px-3 py-1.5 rounded-lg border border-rule text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-all">
            {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
          </button>
        </div>
        <main className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
            <ErrorBoundary key={location.pathname}>
              {canSee(location.pathname) ? <Outlet /> : (
                <div className="card p-10 text-center">
                  <ShieldCheck size={28} className="text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-gray-500">You don't have access to this page.</p>
                  <Link to="/" className="text-sm text-brand-600 mt-2 inline-block">← Back to overview</Link>
                </div>
              )}
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  )
}
