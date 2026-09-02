// Finding a PAGE by typing what you call it.
//
// Pure and separate from the palette component so the ranking can be asserted
// without a DOM. It is the half of the palette that never touches the network —
// the whole vocabulary is ~60 rows already in the bundle — and a page you are
// trying to reach should not wait on a request.
//
// The palette used to search releases, artists, contracts and deals only. None
// of those are how people actually use the app: the thing most often being
// looked for is a PAGE, and until this existed ⌘K could not find one at all.
//
// Pages match against label, path and the `synonyms` string nav items carry, so
// "w9" reaches Vendors, "p&l" reaches Reports and "payroll" reaches Salary.
//
// Scoring is deliberately crude and stable — exact label, then label prefix,
// then label substring, then path, then anything in the synonyms — because a
// palette that reorders subtly between keystrokes is worse than one that ranks
// imperfectly.
export function scorePage(page, q) {
  const label = String(page.label || '').toLowerCase()
  const path = String(page.path || '').toLowerCase()
  const hay = `${label} ${path} ${(page.synonyms || '').toLowerCase()}`
  if (label === q) return 100
  if (label.startsWith(q)) return 80
  if (label.includes(q)) return 60
  if (path.includes(q)) return 40
  if (hay.includes(q)) return 20
  return 0
}

// The visible page results for a query: allowed, matching, ranked, capped.
//
// `canView` is applied BEFORE ranking, not after, so the cap of six is six
// pages you can actually open. Filtering afterwards would silently return four
// when two of the top six were forbidden.
export function searchPages(pages, query, canView, limit = 6) {
  const q = String(query || '').trim().toLowerCase()
  if (q.length < 2) return []
  return pages
    .filter(p => (canView ? canView(p.path) : true))
    .map(p => ({ ...p, score: scorePage(p, q) }))
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score || String(a.label).length - String(b.label).length)
    .slice(0, limit)
}
