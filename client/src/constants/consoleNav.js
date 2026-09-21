// The operator console's sidebar. Its own module, not a const inside
// PlatformLayout, because the walkthroughs build the console welcome walk FROM
// it — and importing the layout to read its nav created a cycle
// (tours → PlatformLayout → Tour → tours). That cycle happened to resolve only
// because the array is read at call time; a later edit that read it at module
// scope would have hit a TDZ that the build cannot see.
import {
  BarChart3, Building2, CalendarDays, CheckSquare, LayoutDashboard, Megaphone,
  Inbox, MessageSquare, ScrollText, Settings,
} from 'lucide-react'

export const CONSOLE_NAV = [
  { path: '/', label: 'Overview', icon: LayoutDashboard },
  { path: '/my-work', label: 'My Work', icon: CheckSquare },
  { path: '/messages', label: 'Messages', icon: MessageSquare },
  { path: '/workspaces', label: 'Workspaces', icon: Building2 },
  { path: '/calendar', label: 'Calendar', icon: CalendarDays },
  { path: '/activity', label: 'Activity', icon: ScrollText },
  { path: '/analytics', label: 'Analytics', icon: BarChart3 },
  { path: '/announcements', label: 'Announcements', icon: Megaphone },
  { path: '/requests', label: 'Requests', icon: Inbox },
  { path: '/settings', label: 'Settings', icon: Settings },
]
