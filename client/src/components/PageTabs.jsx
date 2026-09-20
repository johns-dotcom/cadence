import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { buildNavGroups, tabFamilyFor } from '../constants/navConfig'
import { isAdminRole, isApproverRole } from '../constants'

// The in-page tab bar for a nav family — finally the consumer `tabFamilyFor`
// was written for.
//
// A family row in the sidebar links to its first child and then disappears as a
// concept: once you are on /bank-matching nothing tells you /bank-statements is
// its sibling, or that you are inside "Bank" at all. Collapsing rows without
// this is a straight loss — you trade a visible list for an invisible one. The
// tab bar is the other half of that trade.
//
// Rendered once by Layout above the outlet rather than imported by each page:
// a family gains a member by editing navConfig, and the bar follows. Nothing to
// remember, nothing to drift.
export default function PageTabs() {
  const { pathname } = useLocation()
  const { user, canView } = useAuth()

  // Role shape only — the badge counts drive numbers this bar never shows, and
  // passing live ones would rebuild the groups on every unread message.
  const groups = buildNavGroups({
    isAdmin: isAdminRole(user?.role),
    isApprover: isApproverRole(user?.role),
  })
  const family = tabFamilyFor(groups, pathname)
  if (!family) return null

  // canView is the permission gate and applies to every tab.
  //
  // The person's own hidden-pages tidying deliberately does NOT: hiding a row
  // from your sidebar is a statement about the rail, not a revocation, and the
  // pages stay reachable by URL and ⌘K. Dropping hidden siblings here would
  // also mean someone who hid /renewals and then opened it from search would
  // see a tab bar that did not contain the page they were standing on.
  const tabs = family.children.filter(c => canView(c.path))
  if (tabs.length < 2) return null

  return (
    <nav
      className="flex items-center gap-1 border-b border-divider mb-5 -mt-1 overflow-x-auto"
      aria-label={`${family.label} pages`}
    >
      {tabs.map(tab => {
        const active = pathname === tab.path
        const Icon = tab.icon
        return (
          <Link
            key={tab.path}
            to={tab.path}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap
              border-b-2 -mb-px transition-colors focus:outline-none focus-visible:ring-2
              focus-visible:ring-brand-400 rounded-t ${
              active
                ? 'border-brand-500 text-ink'
                : 'border-transparent text-ink-muted hover:text-ink hover:border-rule'
            }`}
          >
            {Icon && <Icon size={14} aria-hidden="true" />}
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
