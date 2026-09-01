// Presentation for the statement-month keys the server stamps.
//
// The RULE itself lives server-side (server/lib/statementMonth.js) so stamping
// and bucketing cannot disagree. This file only formats the `YYYY-MM` key the
// server hands back — it must never re-derive a month from a timestamp.

/** "Jun 2026" — the tab label. */
export function statementLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym || '')
  if (!m) return ym || 'Unstamped'
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
    .toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/**
 * "May 21, 2026 – Jun 20, 2026" — the upload window a statement covers.
 * Surfaced as the tab tooltip so nobody has to remember the 21/20 rule.
 */
export function statementWindowLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym || '')
  if (!m) return ''
  const year = Number(m[1])
  const month = Number(m[2])
  let sy = year
  let sm = month - 1
  if (sm < 1) { sm = 12; sy = year - 1 }
  const f = (y, mo, day) => new Date(Date.UTC(y, mo - 1, day))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  return `${f(sy, sm, 21)} – ${f(year, month, 20)}`
}

/** The last N statement months ending at the current one, newest first. */
export function recentStatementMonths(n = 14) {
  const out = []
  const now = new Date()
  let y = now.getUTCFullYear()
  let m = now.getUTCMonth() + 1
  if (now.getUTCDate() >= 21) { m += 1; if (m > 12) { m = 1; y += 1 } }
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m -= 1
    if (m < 1) { m = 12; y -= 1 }
  }
  return out
}

// Tone classes for the four bank-evidence states, in design tokens. A map, not
// a ternary: there are four tones and a ternary paints any new one danger.
export const STATE_TONE = {
  verified: { text: 'text-success', dot: 'bg-success', chip: 'bg-success/10 text-success' },
  awaiting_statement: { text: 'text-info', dot: 'bg-info', chip: 'bg-info/10 text-info' },
  unverified: { text: 'text-danger', dot: 'bg-danger', chip: 'bg-danger/10 text-danger' },
  unpaid: { text: 'text-ink-muted', dot: 'bg-ink-faint', chip: 'bg-elev text-ink-muted' },
}
