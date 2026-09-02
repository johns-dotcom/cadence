import { useState, useEffect, useRef } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Settings, LogOut, LogIn, Eye, ChevronDown, Menu, X, Moon, Sun, Disc3, BookOpen, Link2, Check, Search, Megaphone, MessageSquarePlus, Keyboard,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { getHiddenPages, onNavPrefsChange } from '../utils/navPrefs'
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
import { PAGE_LABELS, buildNavGroups } from '../constants/navConfig'

// Re-exported so existing importers (`from '../components/Layout'`) keep working.
export { PAGE_LABELS, buildNavGroups }

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
      // `/` opens the palette — the muscle memory every search-first app trains.
      // inField() above already excused it while typing, so it can't eat a slash
      // in a filename or a date.
      if (e.key === '/') { e.preventDefault(); setSearchOpen(true); return }
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

  // Edge-swipe the drawer open / drag it closed. Touch listeners are passive —
  // this never calls preventDefault, so vertical page scrolling is untouched;
  // the gesture only fires when the horizontal travel dominates and the swipe
  // STARTED within 24px of the left edge (otherwise every carousel and
  // horizontally-scrolling table on a phone would open the nav).
  useEffect(() => {
    if (!isMobile) return
    let x0 = null, y0 = null, fromEdge = false
    const start = (e) => {
      const t = e.touches[0]
      x0 = t.clientX; y0 = t.clientY
      fromEdge = t.clientX <= 24
    }
    const end = (e) => {
      if (x0 === null) return
      const t = e.changedTouches[0]
      const dx = t.clientX - x0, dy = t.clientY - y0
      x0 = null
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
      if (dx > 0 && fromEdge) setSidebarOpen(true)
      else if (dx < 0) setSidebarOpen(false)
    }
    document.addEventListener('touchstart', start, { passive: true })
    document.addEventListener('touchend', end, { passive: true })
    return () => { document.removeEventListener('touchstart', start); document.removeEventListener('touchend', end) }
  }, [isMobile])

  // Per-person hidden nav items (Settings → Account → Sidebar). Local
  // preference only; re-read on change so the sidebar updates without a reload.
  const [hiddenPages, setHiddenPages] = useState(() => getHiddenPages(user?.id))
  useEffect(() => { setHiddenPages(getHiddenPages(user?.id)) }, [user?.id])
  useEffect(() => onNavPrefsChange(() => setHiddenPages(getHiddenPages(user?.id))), [user?.id])

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

  // ── Usage ping ────────────────────────────────────────────────────────────
  // Fire-and-forget record of which page was opened, feeding /usage. Three
  // things make it safe to leave on:
  //   · the PATHNAME only — `location.search` can carry invite tokens and
  //     signed-URL signatures, and none of that belongs in an analytics table;
  //   · consecutive-duplicate dedup here, plus a 30s per-user+path window on
  //     the server, so a remount storm writes one row;
  //   · skipped entirely while `impersonating` — a platform operator inside a
  //     tenant, or a Superadmin viewing-as, would otherwise show up in that
  //     workspace's "most active people" as traffic its own team never made.
  const lastPingedPath = useRef(null)
  useEffect(() => {
    if (!user || impersonating) return
    const path = location.pathname
    if (lastPingedPath.current === path) return
    lastPingedPath.current = path
    api.post('/analytics/pageview', { path }).catch(() => {})
  }, [location.pathname, user?.id, impersonating])

  const navGroups = buildNavGroups({ isAdmin, isApprover, chatUnread, pendingApprovals })
    // canView is the PERMISSION gate; hiddenPages is the person's own tidying of
    // what's left. Order matters only in that a hidden item was never granted
    // extra reach — everything here is still reachable by URL and by ⌘K.
    .map(g => ({ ...g, items: g.items.filter(i => canView(i.path) && !hiddenPages.includes(i.path)) }))
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
        {/* Impersonation banner. The header Exit pill carries the escape hatch, but
            it names the ADMIN you'd return to — not whose view you are currently
            in. Without this bar the only signal that the page is showing someone
            else's permissions, department and tasks is a button that says
            "Exit". Every destructive thing done from here is done AS them. */}
        {impersonating && (
          <div className="px-4 lg:px-6 py-2 flex items-center gap-2.5 text-xs font-semibold bg-warning/15 text-warning border-b border-warning/30 flex-shrink-0">
            <Eye size={14} className="flex-shrink-0" />
            <span className="min-w-0 truncate">
              Viewing as <span className="font-bold">{user?.name}</span>
              {user?.role ? ` · ${user.role}` : ''}{user?.department ? ` · ${user.department}` : ''}
            </span>
            <button onClick={exitImpersonation} className="ml-auto underline underline-offset-2 hover:no-underline flex-shrink-0">
              Exit
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
          {/* Workspace-wide search (⌘K) */}
          <button
            onClick={() => setSearchOpen(true)}
            title="Search (⌘K or /)"
            aria-label="Search"
            className="inline-flex items-center gap-2 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-rule text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-all"
          >
            <Search size={14} />
            <span className="hidden md:inline">Search</span>
            <kbd className="hidden md:inline text-[10px] border border-rule rounded px-1 leading-tight">⌘K</kbd>
          </button>
          {/* Quick-compose a request from wherever you are, carrying the page as
              context — the whole point of an in-app feedback channel is that
              you file it at the moment you hit the thing. Suppressed while
              impersonating: the request would be attributed to the person whose
              view you borrowed. */}
          {!impersonating && (
            <button
              onClick={() => navigate(`/requests?from=${encodeURIComponent(location.pathname)}`)}
              title="Send a request or report a bug"
              aria-label="Send a request or report a bug"
              className="hidden md:inline-flex items-center text-xs font-semibold p-1.5 rounded-lg border border-rule text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-all"
            >
              <MessageSquarePlus size={15} />
            </button>
          )}
          <button
            onClick={() => setHelpOpen(true)}
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
            className="hidden sm:inline-flex items-center text-xs font-semibold p-1.5 rounded-lg border border-rule text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-all"
          >
            <Keyboard size={15} />
          </button>
          <button
            onClick={() => setManualOpen(true)}
            title="User manual"
            aria-label="User manual"
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
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
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
      {isMobile && <BottomNav onMenu={() => setSidebarOpen(true)} chatUnread={chatUnread} />}
      {isMobile && <Fab />}
    </div>
  )
}
