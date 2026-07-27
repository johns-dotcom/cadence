// Shared date helpers. All "overdue / due-today" math uses LOCAL-calendar
// comparisons — never `new Date('YYYY-MM-DD') < new Date()`, which parses the
// DB date as UTC-midnight and makes "due today" read as overdue west of UTC.

// Format a DB date ('YYYY-MM-DD' or ISO timestamp) as "Mon D, YYYY". Parses the
// date parts directly off ISO-date strings so it never TZ-shifts a day.
export function formatDate(dateStr, fallback = '—') {
  if (!dateStr) return fallback
  const s = String(dateStr)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const mo = months[parseInt(m[2], 10) - 1]
    const d = parseInt(m[3], 10)
    if (mo && Number.isFinite(d)) return `${mo} ${d}, ${m[1]}`
  }
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return fallback
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

// Today's local date as 'YYYY-MM-DD'.
export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Extract the 'YYYY-MM-DD' prefix if the value is (or starts with) an ISO date.
export function dateOnly(value) {
  if (!value) return null
  const s = String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

// True when the date is strictly before today (local). "Due today" is NOT past.
export function isPastLocal(value) {
  const s = dateOnly(value)
  return !!s && s < localDateStr()
}

// Whole days from today (local) to the date: 0 = today, negative = past,
// null = missing/invalid.
export function daysUntilLocal(value) {
  const s = dateOnly(value)
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((new Date(y, m - 1, d) - today) / 86400000)
}
