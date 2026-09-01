import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ChevronRight, Loader, Search, ArrowDownUp } from 'lucide-react'
import api from '../api'
import Skeleton from '../components/Skeleton'
import useFocusRefetch from '../hooks/useFocusRefetch'

// The catch-up queue: every campaign — an artist+song pair with campaign
// invoices — that nobody has marked complete.
//
// Rendered as a VIEW of /artist-campaigns (`?view=queue`) rather than its own
// route, so it inherits that page's permission instead of needing a carve-out in
// AuthContext.canView.
//
// The money here is INVOICE-side — `invoiced` and `unsettled`, never "settled".
// The cards' Settled figure is the cash-basis by-artist rollup, which has no
// song dimension at all, so a per-song number can only come from the ledger.
// Different question, different name.

const fmt = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtCompact = (n) => {
  const v = Math.abs(Number(n) || 0)
  return v >= 1000 ? `$${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k` : fmt(n)
}
// Keep in step with songUrl in ArtistCampaignDetail.jsx.
const NO_SONG_SLUG = '__no-song__'
const songUrl = (artist, song) =>
  `/artist-campaigns/${encodeURIComponent(artist)}/${song ? encodeURIComponent(song) : NO_SONG_SLUG}`

// Which problems a campaign has. ONE definition, used by the chips, the filter
// buttons and the counts — so a filter can never offer more rows than it shows.
const PROBLEMS = [
  { key: 'unpaid', label: 'unpaid', has: (c) => c.unpaid_count > 0, say: (c) => `${c.unpaid_count} unpaid` },
  { key: 'no_invoice', label: 'no invoice file', has: (c) => c.no_invoice_file_count > 0, say: (c) => `${c.no_invoice_file_count} no invoice file` },
  { key: 'unsettled', label: 'not settled', has: (c) => c.unsettled_count > 0, say: (c) => `${c.unsettled_count} with no bank line` },
]
const isClean = (c) => !PROBLEMS.some((p) => p.has(c))

const SORTS = [
  { key: 'invoiced', label: 'Spend', cmp: (a, b) => b.invoiced - a.invoiced },
  { key: 'unsettled', label: 'Unsettled', cmp: (a, b) => b.unsettled - a.unsettled },
  { key: 'rows', label: 'Rows', cmp: (a, b) => b.rows - a.rows },
  { key: 'oldest', label: 'Oldest', cmp: (a, b) => String(a.oldest || '9999').localeCompare(String(b.oldest || '9999')) },
  { key: 'artist', label: 'Artist', cmp: (a, b) => (a.artist || '').localeCompare(b.artist || '') },
]

export default function ArtistCampaignsQueue({ onClose }) {
  const [state, setState] = useState({ loading: true, rows: [], meta: null, error: null })
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('invoiced')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(null)

  const load = useCallback(async ({ silent } = {}) => {
    if (!silent) setState((s) => ({ ...s, loading: true }))
    try {
      const { data } = await api.get('/artist-campaigns/queue')
      setState({ loading: false, rows: data?.data || [], meta: data?.meta || null, error: null })
    } catch (err) {
      setState({ loading: false, rows: [], meta: null, error: err.response?.data?.error || err.message })
    }
  }, [])
  useEffect(() => { load() }, [load])
  useFocusRefetch(() => load({ silent: true }))

  const shown = useMemo(() => {
    const p = PROBLEMS.find((x) => x.key === filter)
    let list = state.rows
    if (p) list = list.filter(p.has)
    else if (filter === 'clean') list = list.filter(isClean)
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      list = list.filter((c) => `${c.artist} ${c.song}`.toLowerCase().includes(needle))
    }
    return list.slice().sort(SORTS.find((s) => s.key === sort)?.cmp || SORTS[0].cmp)
  }, [state.rows, filter, sort, q])

  // Reduced over `shown`, so the header describes the list under it rather than
  // the whole set.
  const shownTotals = useMemo(() => shown.reduce((t, c) => ({
    invoiced: t.invoiced + c.invoiced, unsettled: t.unsettled + c.unsettled, rows: t.rows + c.rows,
  }), { invoiced: 0, unsettled: 0, rows: 0 }), [shown])

  const markComplete = async (c) => {
    if (busy) return
    setBusy(c.key)
    try {
      await api.post('/artist-campaigns/song-status', { artist: c.artist, song: c.song, finished: true })
      // Drop it locally so the list does not jump; the header counts come from
      // the same rows, so they move together.
      setState((s) => ({ ...s, rows: s.rows.filter((x) => x.key !== c.key) }))
    } catch (err) {
      setState((s) => ({ ...s, error: `Could not mark complete: ${err.response?.data?.error || err.message}` }))
      await load()
    } finally { setBusy(null) }
  }

  if (state.loading) return <div className="space-y-4"><Skeleton.StatCards /><Skeleton.Table /></div>
  if (state.error && !state.rows.length) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-danger">{state.error}</p>
        <button onClick={() => load()} className="mt-3 text-xs font-bold underline decoration-dotted">Try again</button>
      </div>
    )
  }

  const m = state.meta || {}
  const chips = [
    { key: 'all', label: 'All', n: state.rows.length },
    ...PROBLEMS.map((p) => ({ key: p.key, label: p.label, n: state.rows.filter(p.has).length })),
    { key: 'clean', label: 'nothing outstanding', n: state.rows.filter(isClean).length },
  ]

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Campaigns to catch up on</p>
            <p className="text-xl font-black text-ink tabular-nums">{shown.length}</p>
            <p className="text-[10px] text-ink-faint">
              {shown.length === state.rows.length
                ? `songs with ${(m.scope?.categories || []).join(' + ')} invoices, not marked complete`
                : `of ${state.rows.length} not marked complete`}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Invoiced</p>
            <p className="text-xl font-black text-ink tabular-nums">{fmtCompact(shownTotals.invoiced)}</p>
            <p className="text-[10px] text-ink-faint">{shownTotals.rows} invoice rows</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Unsettled</p>
            <p className="text-xl font-black text-warning tabular-nums">{fmtCompact(shownTotals.unsettled)}</p>
            <p className="text-[10px] text-ink-faint">no bank line behind it yet</p>
          </div>
          {onClose && (
            <button onClick={onClose} className="ml-auto text-[11px] font-bold text-ink-muted underline decoration-dotted hover:text-ink">
              ← back to the artist cards
            </button>
          )}
        </div>
        <p className="mt-2 pt-2 border-t border-divider text-[10.5px] text-ink-faint">
          Invoice totals. The cards&rsquo; Settled figure is cash-basis and does not break down by song, so these are
          deliberately different numbers.
          {m.unlinkable?.songs > 0 && (
            <span title="A campaign needs an artist to link to a song page. These have invoices and a song but no artist — attribute them from the artist cards.">
              {' '}· {m.unlinkable.songs} song{m.unlinkable.songs === 1 ? '' : 's'} with no artist cannot be listed
            </span>
          )}
        </p>
      </div>

      {state.error && <div className="card p-3 border-l-4 border-l-danger text-sm text-danger">{state.error}</div>}

      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <button key={c.key} onClick={() => setFilter(c.key)}
              className={`text-[11px] font-bold rounded-full px-2.5 py-1 border transition-colors ${
                filter === c.key ? 'bg-ink text-card border-ink' : 'bg-card text-ink-muted border-rule hover:text-ink'}`}>
              {c.label} <span className="font-normal tabular-nums">{c.n}</span>
            </button>
          ))}
          <span className="flex items-center gap-1 text-[11px] text-ink-muted font-semibold ml-2"><ArrowDownUp size={11} /> Sort</span>
          {SORTS.map((s) => (
            <button key={s.key} onClick={() => setSort(s.key)}
              className={`text-[11px] font-bold rounded-full px-2 py-0.5 border transition-colors ${
                sort === s.key ? 'bg-brand-500/15 text-brand-ink border-brand-300' : 'bg-card text-ink-muted border-rule hover:text-ink'}`}>
              {s.label}
            </button>
          ))}
          <span className="relative ml-auto">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Artist or song…"
              className="w-56 border border-rule rounded-lg bg-card text-ink text-[12.5px] pl-7 pr-2 py-1.5 outline-none focus:border-brand-400" />
          </span>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="card p-12 text-center">
          <CheckCircle2 size={28} className="mx-auto mb-3 text-success" />
          <p className="text-sm text-ink-muted">
            {state.rows.length === 0
              ? 'Every campaign with invoices has been marked complete.'
              : 'Nothing matches this filter.'}
          </p>
        </div>
      ) : (
        <div className="card divide-y divide-divider">
          {shown.map((c) => {
            const clean = isClean(c)
            return (
              <div key={c.key} className="flex items-center gap-3 px-4 py-3 hover:bg-elev">
                <div className="min-w-0 flex-1">
                  <Link to={songUrl(c.artist, c.song)} className="text-[13.5px] font-bold text-ink hover:text-brand-ink truncate block">
                    {c.artist} <span className="text-ink-faint">·</span> {c.song}
                  </Link>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
                    {clean ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-success">
                        <CheckCircle2 size={9} /> nothing outstanding
                      </span>
                    ) : PROBLEMS.filter((p) => p.has(c)).map((p) => (
                      <span key={p.key} className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-warning bg-amber-500/10 rounded px-1.5 py-0.5">
                        <AlertTriangle size={9} /> {p.say(c)}
                      </span>
                    ))}
                    {c.flagged_no_bank_line > 0 && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-danger"
                        title="Marked paid, and a statement covering the date shows no matching line.">
                        {c.flagged_no_bank_line} paid with no bank line
                      </span>
                    )}
                    <span className="text-[10px] text-ink-faint tabular-nums">
                      {c.rows} row{c.rows === 1 ? '' : 's'}{c.oldest ? ` · since ${c.oldest}` : ''}
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[13px] font-bold text-ink tabular-nums">{fmt(c.invoiced)}</p>
                  <p className="text-[10.5px] tabular-nums text-ink-faint">
                    {c.unsettled > 0 ? `${fmtCompact(c.unsettled)} unsettled` : 'all settled'}
                  </p>
                </div>
                <button onClick={() => markComplete(c)} disabled={busy === c.key}
                  title={clean ? 'Mark this campaign complete — it leaves the queue'
                    : 'Mark complete anyway. The chips beside it are still outstanding.'}
                  className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-bold border disabled:opacity-40 ${
                    clean ? 'bg-ink text-card border-ink hover:opacity-85' : 'bg-card text-ink-muted border-rule hover:text-ink'}`}>
                  {busy === c.key ? <Loader size={11} className="animate-spin" /> : null}
                  Mark complete
                </button>
                <Link to={songUrl(c.artist, c.song)} title="Open the song's campaign page" className="shrink-0 text-ink-faint hover:text-brand-ink">
                  <ChevronRight size={16} />
                </Link>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
