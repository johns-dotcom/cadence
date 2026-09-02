// My Work — your own tasks as a switchable database (Board / Table / Calendar /
// List) with grouping, filters, sort, inline editing, drag-to-reorder and saved
// views. All of that lives in TaskSurface, shared with Team Work.
//
// This page no longer has a "My tasks / Everyone" selector: seeing other people's
// work is Team Work's job (/team-work), which scopes by department server-side.
//
// The page wraps TaskSurface in the two things a personal command centre needs and
// a task database can't provide from a task payload: a live status line for the
// day, and the RELEASES you own — a second dimension of assigned work that the
// tasks table knows nothing about.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ChevronDown, ChevronRight, Disc3 } from 'lucide-react'
import api from '../api'
import TaskSurface from '../components/mywork/TaskSurface'
import Skeleton from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { RELEASE_CHECKLIST } from '../constants'
import { daysUntilLocal, formatDate } from '../utils/dates'

// Time-of-day greeting. Local clock, deliberately — this is the one place in the
// app where the user's own wall time is the right frame of reference.
function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

const completionOf = (r) =>
  Math.round((RELEASE_CHECKLIST.filter(c => r[c.key]).length / RELEASE_CHECKLIST.length) * 100)

// Four sorts, matching boom's release control. Kept as data so the button row and
// the comparator can't disagree about what "Completion" means.
const RELEASE_SORTS = [
  { key: 'date', label: 'Date', cmp: (a, b) => String(a.release_date || '9999').localeCompare(String(b.release_date || '9999')) },
  { key: 'completion', label: 'Completion', cmp: (a, b) => completionOf(a) - completionOf(b) },
  { key: 'name', label: 'Name', cmp: (a, b) => String(a.project_name || '').localeCompare(String(b.project_name || '')) },
  { key: 'artist', label: 'Artist', cmp: (a, b) => String(a.artist_name || '').localeCompare(String(b.artist_name || '')) },
]

function MyReleases() {
  const [releases, setReleases] = useState([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState('date')
  const [open, setOpen] = useState(true)

  useEffect(() => {
    // `in_catalog=any` opts out of GET /releases' pipeline default: a record can be
    // catalogued and still be yours to finish. `archived` keeps its default
    // (unarchived only) — an archived release is retired, not outstanding.
    api.get('/releases', { params: { assigned_to: 'me', in_catalog: 'any', limit: 200 } })
      .then(r => setReleases(r.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const sorted = useMemo(() => {
    const cmp = RELEASE_SORTS.find(s => s.key === sort)?.cmp
    return cmp ? [...releases].sort(cmp) : releases
  }, [releases, sort])

  // The 14-day risk window: dropping soon AND not finished. A release at 100% two
  // days out is not an alert, and saying so is the difference between a banner
  // people read and one they learn to scroll past.
  const atRisk = useMemo(
    () => releases.filter(r => {
      const d = daysUntilLocal(r.release_date)
      return d !== null && d >= 0 && d <= 14 && completionOf(r) < 100
    }),
    [releases]
  )

  if (loading) return <Skeleton.Block h="h-24" className="mb-6" />
  if (!releases.length) return null

  return (
    <div className="mb-6">
      {atRisk.length > 0 && (
        <div className="card p-3 mb-3 border-l-4 border-l-amber-500 flex items-start gap-2">
          <AlertTriangle size={15} className="text-warning mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-ink">
              {atRisk.length} release{atRisk.length === 1 ? '' : 's'} dropping in the next 14 days with an incomplete checklist
            </p>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {atRisk.map(r => (
                <Link
                  key={r.id}
                  to={`/releases/${r.id}`}
                  className="text-[10px] rounded-full bg-elev border border-divider px-2 py-0.5 text-ink-muted hover:text-brand-ink"
                >
                  {r.project_name} · {daysUntilLocal(r.release_date)}d · {completionOf(r)}%
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mb-2">
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 text-xs font-bold text-ink-muted uppercase tracking-wide rounded
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
          My releases ({releases.length})
        </button>
        {open && (
          <div className="flex items-center gap-1">
            {RELEASE_SORTS.map(s => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                aria-pressed={sort === s.key}
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded transition
                  ${sort === s.key ? 'bg-brand-500/15 text-brand-ink' : 'text-ink-muted hover:text-ink'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="card divide-y divide-divider">
          {sorted.map(r => {
            const pct = completionOf(r)
            const d = daysUntilLocal(r.release_date)
            return (
              <Link key={r.id} to={`/releases/${r.id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-elev transition">
                <Disc3 size={14} className="text-ink-faint flex-shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink truncate">
                    {r.project_name}
                    {String(r.priority || '').toLowerCase().includes('high') && (
                      <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide text-danger">High</span>
                    )}
                  </p>
                  <p className="text-[11px] text-ink-muted truncate">
                    {r.artist_name || 'Unknown artist'} · {formatDate(r.release_date)}
                  </p>
                </div>
                <div className="w-24 flex-shrink-0 hidden sm:block">
                  <div className="h-1.5 rounded-full bg-rule overflow-hidden">
                    <div
                      className={`h-full rounded-full ${pct === 100 ? 'bg-success' : 'bg-brand-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <span className={`text-[11px] w-9 text-right flex-shrink-0 ${pct === 100 ? 'text-success' : 'text-ink-muted'}`}>{pct}%</span>
                <span className={`text-[11px] w-14 text-right flex-shrink-0 ${
                  d === null ? 'text-ink-faint' : d < 0 ? 'text-ink-faint' : d <= 7 ? 'text-danger font-medium' : 'text-ink-muted'
                }`}>
                  {d === null ? '—' : d < 0 ? `${-d}d ago` : d === 0 ? 'Today' : `${d}d`}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function MyWork() {
  const { user } = useAuth()
  const first = String(user?.name || '').trim().split(/\s+/)[0] || 'there'

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-ink tracking-tight">{greeting()}, {first}.</h1>
        <p className="text-sm text-ink-muted mt-1">Tasks and releases assigned to you</p>
      </div>

      <MyReleases />
      <TaskSurface surface="mine" />
    </div>
  )
}
