import { useState, useEffect } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, Building2, BarChart3, ScrollText, UserCog, LogOut, Disc3, Menu, X, Moon, Sun } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'

// Neutral operator shell shown to platform admins who are NOT inside a
// workspace. No label branding, no label-scoped nav — just platform tools.
const NAV = [
  { path: '/', label: 'Overview', icon: LayoutDashboard },
  { path: '/workspaces', label: 'Workspaces', icon: Building2 },
  { path: '/analytics', label: 'Analytics', icon: BarChart3 },
  { path: '/activity', label: 'Activity', icon: ScrollText },
  { path: '/account', label: 'Account', icon: UserCog },
]
const TITLES = { '/': 'Overview', '/workspaces': 'Workspaces', '/analytics': 'Analytics', '/activity': 'Activity', '/account': 'Account' }

export default function PlatformLayout() {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const handler = (e) => { setIsMobile(e.matches); if (!e.matches) setSidebarOpen(false) }
    handler(mq); mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  useEffect(() => { if (isMobile) setSidebarOpen(false) }, [location.pathname, isMobile])

  const isActive = (p) => p === '/' ? location.pathname === '/' : location.pathname.startsWith(p)

  return (
    <div className="flex h-screen bg-page">
      {isMobile && sidebarOpen && <div className="fixed inset-0 bg-overlay z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <div className={`${isMobile ? 'fixed inset-y-0 left-0 z-40 transform transition-transform duration-200' : ''} ${isMobile && !sidebarOpen ? '-translate-x-full' : 'translate-x-0'} w-60 bg-sidebar border-r border-rule flex flex-col flex-shrink-0`}>
        {/* Platform identity (neutral — not a label) */}
        <div className="h-16 flex items-center justify-between px-5 border-b border-divider">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center flex-shrink-0">
              <Disc3 size={18} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink tracking-tight leading-none">Cadence</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Platform Console</p>
            </div>
          </div>
          {isMobile && <button onClick={() => setSidebarOpen(false)} className="p-1 text-gray-400 hover:text-gray-600 lg:hidden"><X size={18} /></button>}
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-0.5">
          {NAV.map(({ path, label, icon: Icon }) => (
            <Link key={path} to={path}
              className={`group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${isActive(path) ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'}`}>
              <Icon size={17} strokeWidth={isActive(path) ? 2 : 1.5} className={isActive(path) ? 'text-brand-600' : 'text-gray-400 group-hover:text-gray-600'} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t border-divider">
          {user && (
            <div className="flex items-center gap-3 px-3 py-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center flex-shrink-0"><span className="text-sm font-semibold text-white">{user.name?.charAt(0)?.toUpperCase()}</span></div>
              <div className="flex-1 min-w-0"><p className="text-sm font-medium text-ink truncate">{user.name}</p><p className="text-xs text-gray-500 truncate">Platform admin</p></div>
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
          <h1 className="text-sm font-semibold text-ink">{TITLES[location.pathname] || 'Platform'}</h1>
          <div className="flex-1" />
          <button onClick={toggleTheme} title="Toggle theme" className="inline-flex items-center text-xs font-semibold px-3 py-1.5 rounded-lg border border-rule text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-all">
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
