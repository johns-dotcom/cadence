import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

// The frame around Settings: a left rail split into two halves, and a URL that
// says which panel you are on.
//
// ── Why two halves rather than one row of tabs ──
// Settings held two unrelated things behind one strip of tabs: preferences that
// belong to YOU (your name, your password, your theme, your sidebar) and
// configuration that belongs to the WORKSPACE and changes what everybody else
// sees. A flat tab bar gave no clue which was which, so "Workspace" sat beside
// "Account" as if they were the same kind of decision. Splitting them under two
// headings makes the blast radius of a panel legible before it is opened.
//
// ── Why `?tab=` ──
// Every panel here is somewhere people get SENT — "set your reply-to address",
// "the departments list is in Settings". Without a URL for each one the only
// way to send somebody is prose directions, and the back button could not
// return them. The tab is therefore held in the query string, not state.
//
// The rail collapses to a horizontal scroller on small screens; it does not
// turn into a dropdown, because a dropdown hides the two-halves split that is
// the entire point.
export default function SettingsShell({ sections, tab, onTab, aliases = {}, children }) {
  const [params, setParams] = useSearchParams()

  // Flatten once — used for validating the incoming tab and for the aria label.
  const items = useMemo(
    () => sections.flatMap(s => s.items),
    [sections]
  )

  // URL → state. Runs on mount and on back/forward. An unknown or
  // no-longer-permitted tab (an Admin's deep link opened by a User) falls back
  // to the first panel they CAN see rather than rendering an empty page.
  useEffect(() => {
    const raw = params.get('tab')
    if (!raw) return
    // Old links keep working. The tab keys changed when Settings split into two
    // halves, and `?tab=team` is in people's bookmarks, in Slack, and in this
    // app's own cross-links. Silently landing them on Profile would read as the
    // link being broken.
    const want = aliases[raw] || raw
    const found = items.find(i => i.key === want)
    if (found) { if (found.key !== tab) onTab(found.key) }
    else if (items.length) onTab(items[0].key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, items, aliases])

  // state → URL. `replace` so clicking through panels does not bury the page
  // someone arrived from under a dozen history entries.
  const pick = (key) => {
    onTab(key)
    const next = new URLSearchParams(params)
    next.set('tab', key)
    setParams(next, { replace: true })
  }

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <nav
        aria-label="Settings sections"
        className="md:w-56 md:flex-shrink-0 md:sticky md:top-4"
      >
        <div className="flex gap-4 overflow-x-auto pb-2 md:block md:overflow-visible md:pb-0 md:space-y-5">
          {sections.map(section => (
            <div key={section.half} className="flex-shrink-0">
              <p className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-widest text-ink-faint">
                {section.half}
              </p>
              <ul className="flex gap-1 md:block md:space-y-0.5">
                {section.items.map(item => {
                  const Icon = item.icon
                  const active = tab === item.key
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        onClick={() => pick(item.key)}
                        aria-current={active ? 'page' : undefined}
                        className={`flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-sm transition
                          focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                          active
                            ? 'bg-brand-500/10 font-semibold text-brand-ink'
                            : 'text-ink-muted hover:bg-elev hover:text-ink'
                        }`}
                      >
                        {Icon && <Icon size={14} className="flex-shrink-0" />}
                        {item.label}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className="min-w-0 flex-1 space-y-6 md:max-w-2xl">
        {children}
      </div>
    </div>
  )
}
