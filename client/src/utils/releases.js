import { RELEASE_CHECKLIST, PRIORITY_TONES } from '../constants'
import { daysUntilLocal, dateOnly } from './dates'

// Pure helpers shared by the Releases list, the release workspace and the
// Catalog. Kept out of the components so the list, the calendar and the
// expanded row can never disagree about a percentage or a countdown.

const CHECK_KEYS = RELEASE_CHECKLIST.map(c => c.key)

// Completion of the 14-item prep checklist, 0–100.
export function progressOf(release) {
  const done = CHECK_KEYS.filter(k => release[k]).length
  return Math.round((done / CHECK_KEYS.length) * 100)
}

// Parse a DB date as LOCAL midnight. `new Date('2026-03-15')` is UTC midnight,
// which lands on the 14th anywhere west of UTC — that off-by-one is why the
// calendar has to use this instead of the bare constructor.
export function parseLocalDate(value) {
  const s = dateOnly(value)
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Colour-coded countdown label. Returns null when there is no date.
export function countdownOf(value) {
  const d = daysUntilLocal(value)
  if (d === null) return null
  if (d < 0) return { days: d, label: `${Math.abs(d)}d ago`, cls: 'text-ink-faint' }
  if (d === 0) return { days: 0, label: 'Today', cls: 'text-success' }
  if (d <= 14) return { days: d, label: `${d}d away`, cls: 'text-warning' }
  return { days: d, label: `${d}d away`, cls: 'text-ink-faint' }
}

// A priority badge is shown only when the priority is set, is not the neutral
// 'Standard' default, AND the release hasn't happened yet — a shipped record
// can't be urgent, and leaving stale red pills across the back-catalog was the
// reason boom gated it on the date too.
export function priorityToneOf(release) {
  const p = release?.priority
  if (!p || p === 'Standard' || p === 'standard') return null
  const d = daysUntilLocal(release?.release_date)
  if (d === null || d < 0) return null
  return PRIORITY_TONES[p] || 'neutral'
}

// Spotify URI (or bare id) → an open.spotify.com URL. Returns null when there
// is nothing to link to.
export function spotifyUrl(uri) {
  if (!uri) return null
  const s = String(uri).trim()
  if (!s) return null
  if (s.startsWith('http')) return s
  const m = s.match(/^spotify:(track|album|playlist|artist):(.+)$/)
  if (m) return `https://open.spotify.com/${m[1]}/${m[2]}`
  return `https://open.spotify.com/album/${s}`
}

// True when a cover-art URL is a real image. The batch sync stamps permanent
// misses with the 'not_found' sentinel so it stops retrying them forever;
// rendering that string as an <img src> shows a broken-image icon.
export function hasArtwork(release) {
  const u = release?.cover_art_url
  return !!u && u !== 'not_found'
}
