import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, Briefcase, CalendarDays, Search, Menu } from 'lucide-react'

// Mobile-only bottom tab bar. Mirrors the most-used destinations; "More" opens
// the full sidebar, and the search tab opens the ⌘K palette.
const TABS = [
  { path: '/', label: 'Home', icon: LayoutDashboard },
  { path: '/my-work', label: 'Work', icon: Briefcase },
  { path: '/calendar', label: 'Calendar', icon: CalendarDays },
]

export default function BottomNav({ onSearch, onMenu }) {
  const location = useLocation()
  const isActive = (p) => p === '/' ? location.pathname === '/' : location.pathname.startsWith(p)

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-rule flex items-stretch h-14 safe-bottom">
      {TABS.map(({ path, label, icon: Icon }) => (
        <Link key={path} to={path} className={`flex-1 flex flex-col items-center justify-center gap-0.5 ${isActive(path) ? 'text-brand-600' : 'text-gray-400'}`}>
          <Icon size={19} strokeWidth={isActive(path) ? 2.2 : 1.8} />
          <span className="text-[10px] font-medium">{label}</span>
        </Link>
      ))}
      <button onClick={onSearch} className="flex-1 flex flex-col items-center justify-center gap-0.5 text-gray-400">
        <Search size={19} strokeWidth={1.8} />
        <span className="text-[10px] font-medium">Search</span>
      </button>
      <button onClick={onMenu} className="flex-1 flex flex-col items-center justify-center gap-0.5 text-gray-400">
        <Menu size={19} strokeWidth={1.8} />
        <span className="text-[10px] font-medium">More</span>
      </button>
    </nav>
  )
}
