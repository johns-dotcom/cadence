import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, Briefcase, MessageSquare, Wallet, Menu } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

// Mobile-only bottom tab bar (<1024px). Home / Chat / Work / Finance / More,
// permission-filtered. "Finance" resolves to the first bookkeeping page the
// user may see; "More" opens the full sidebar.
//
// Five slots, and they are full. Releases lost its slot to Chat when messaging
// shipped — messaging is checked many times a day, a release list is not — and
// Releases stays one tap away under More. Adding a sixth tab makes every target
// narrower than a thumb.
export default function BottomNav({ onMenu, chatUnread = 0 }) {
  const location = useLocation()
  const { canView } = useAuth()

  const financePath = ['/ledger', '/payments', '/financials', '/approvals'].find(p => canView(p))
  const tabs = [
    { path: '/', label: 'Home', icon: LayoutDashboard },
    { path: '/messages', label: 'Chat', icon: MessageSquare, badge: chatUnread },
    canView('/my-work') && { path: '/my-work', label: 'Work', icon: Briefcase },
    financePath && { path: financePath, label: 'Finance', icon: Wallet },
  ].filter(Boolean)

  const isActive = (p) => p === '/' ? location.pathname === '/' : location.pathname.startsWith(p)

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-rule flex items-stretch h-14 safe-bottom">
      {tabs.map(({ path, label, icon: Icon, badge }) => (
        <Link key={label} to={path} className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 ${isActive(path) ? 'text-brand-600' : 'text-gray-400'}`}>
          <span className="relative">
            <Icon size={19} strokeWidth={isActive(path) ? 2.2 : 1.8} />
            {badge > 0 && (
              <span className="absolute -top-1.5 -right-2 bg-red-500 text-white text-[9px] font-bold min-w-[15px] h-[15px] px-1 rounded-full flex items-center justify-center leading-none">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </span>
          <span className="text-[10px] font-medium">{label}</span>
        </Link>
      ))}
      <button onClick={onMenu} className="flex-1 flex flex-col items-center justify-center gap-0.5 text-gray-400">
        <Menu size={19} strokeWidth={1.8} />
        <span className="text-[10px] font-medium">More</span>
      </button>
    </nav>
  )
}
