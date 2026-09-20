// Prior-year recoupments — the subpage tagged rows actually move TO.
//
// Tagging a row with a year sets `expenses.prior_year_tag`, and the main
// Recoupments list filters `prior_year_tag IS NULL`. So before this page existed
// the tag did exactly what its own copy promised — moved the row off Recoupments
// — and there was nowhere for it to land: real recoupable money left the surface
// that accounts for it with no way back except a database edit. The endpoint had
// been written (`GET /financials/recoupments-prior-year`) and had no caller.
//
// The page is deliberately thin: per-artist cards, a per-year filter, totals, and
// un-tagging. It is an archive, not a second Recoupments — anything you want to
// act on, you untag, and it reappears where the claiming happens.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CalendarClock, ChevronDown, ChevronRight, RefreshCw, Search, Undo2 } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { Button, ConfirmDialog } from '../components/ui'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'
import { money, moneyByCurrency, totalsByCurrency } from '../utils/money'
import useCollapsed from '../hooks/useCollapsed'
import useFocusRefetch from '../hooks/useFocusRefetch'

const usdOf = (e) => Number(e.amount_usd || 0)

export default function RecoupmentPriorYear() {
  const { toast } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [year, setYear] = useState('all')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const { isCollapsed, toggleCollapsed, setAllCollapsed } = useCollapsed('recoup_prior_year_collapsed_v1')

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true)
    return api.get('/financials/recoupments-prior-year')
      .then(r => { setRows(r.data.data || []); setError(null) })
      .catch(e => setError(e.response?.data?.error || 'Could not load prior-year entries'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])
  // Several admins work these at once; a stale archive invites a second untag.
  useFocusRefetch(() => load(true))

  const years = useMemo(
    () => [...new Set(rows.map(r => String(r.prior_year_tag || '').trim()).filter(Boolean))].sort().reverse(),
    [rows]
  )

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(r => {
      if (year !== 'all' && String(r.prior_year_tag) !== year) return false
      if (!needle) return true
      return [r.artist, r.song, r.payee, r.description, r.category, r.invoice_number]
        .some(v => String(v || '').toLowerCase().includes(needle))
    })
  }, [rows, year, q])

  // One reduction feeds the header, the cards and the selection bar, so a count
  // on one can never disagree with another.
  const groups = useMemo(() => {
    const by = new Map()
    for (const e of shown) {
      const key = String(e.artist || '').trim() || '—'
      if (!by.has(key)) by.set(key, { key, name: e.artist || 'Unattributed', items: [] })
      by.get(key).items.push(e)
    }
    return [...by.values()]
      .map(g => ({ ...g, usd: g.items.reduce((s, e) => s + usdOf(e), 0), byCurrency: totalsByCurrency(g.items, e => e.amount) }))
      .sort((a, b) => b.usd - a.usd)
  }, [shown])

  const totalUsd = useMemo(() => shown.reduce((s, e) => s + usdOf(e), 0), [shown])
  const byCurrency = useMemo(() => totalsByCurrency(shown, e => e.amount), [shown])
  const selUsd = useMemo(() => shown.filter(e => sel.has(e.id)).reduce((s, e) => s + usdOf(e), 0), [shown, sel])

  // Selection is re-intersected with what is on screen: a filter change must not
  // leave ids selected that the next action would silently act on.
  useEffect(() => {
    setSel(s => {
      const visible = new Set(shown.map(e => e.id))
      const next = new Set([...s].filter(id => visible.has(id)))
      return next.size === s.size ? s : next
    })
  }, [shown])

  const untag = async (ids, what) => {
    if (!ids.length || busy) return
    setBusy(true)
    try {
      await api.post('/financials/recoupments/prior-year', { ids, tag: null })
      setRows(rs => rs.filter(r => !ids.includes(r.id)))
      setSel(new Set())
      toast(`${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} back on Recoupments`, 'success')
    } catch (e) {
      toast(e.response?.data?.error || `Could not untag ${what}`, 'error')
    } finally { setBusy(false); setConfirm(null) }
  }

  const toggleSel = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleGroup = (g) => setSel(s => {
    const n = new Set(s)
    const all = g.items.every(e => n.has(e.id))
    g.items.forEach(e => (all ? n.delete(e.id) : n.add(e.id)))
    return n
  })

  if (loading) return <div><Skeleton.PageHeader /><Skeleton.Table rows={6} /></div>

  if (error) {
    return (
      <div>
        <PageHeader title="Prior-year recoupments" subtitle="Entries tagged out of the main list" />
        <div className="card p-10 text-center">
          <p className="text-sm text-ink">{error}</p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => load()}><RefreshCw size={14} /> Retry</Button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Link to="/recoupments" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline mb-3">
        <ArrowLeft size={13} /> Recoupments
      </Link>

      <PageHeader
        title="Prior-year recoupments"
        subtitle="Tagged out of the main list. Untag an entry to put it back where it can be claimed."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="card p-4">
          <p className="text-2xl font-bold text-ink leading-none tabular-nums" title={moneyByCurrency(byCurrency)}>{money(totalUsd)}</p>
          <p className="text-[11px] text-ink-muted mt-1.5">Tagged{year !== 'all' ? ` in ${year}` : ''}</p>
        </div>
        <div className="card p-4">
          <p className="text-2xl font-bold text-ink leading-none tabular-nums">{shown.length}</p>
          <p className="text-[11px] text-ink-muted mt-1.5">Entries</p>
        </div>
        <div className="card p-4">
          <p className="text-2xl font-bold text-ink leading-none tabular-nums">{groups.length}</p>
          <p className="text-[11px] text-ink-muted mt-1.5">Artists</p>
        </div>
        <div className="card p-4">
          <p className="text-2xl font-bold text-ink leading-none tabular-nums">{years.length}</p>
          <p className="text-[11px] text-ink-muted mt-1.5">{years.length === 1 ? 'Year' : 'Years'} tagged</p>
        </div>
      </div>

      <div className="card px-3 sm:px-4 py-3 mb-4 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[12rem]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
          <input className="input !pl-8 !h-8 text-xs" placeholder="Search artist, song, payee, invoice…"
            value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="flex items-center gap-1">
          {['all', ...years].map(y => (
            <button key={y} onClick={() => setYear(y)} aria-pressed={year === y}
              className={`text-[11px] font-semibold px-2 py-1 rounded transition
                ${year === y ? 'bg-brand-500/15 text-brand-ink' : 'text-ink-muted hover:text-ink'}`}>
              {y === 'all' ? 'All years' : y}
            </button>
          ))}
        </div>
        {groups.length > 1 && (() => {
          const allOpen = groups.every(g => !isCollapsed(g.key))
          return (
            <button onClick={() => setAllCollapsed(groups.map(g => g.key), allOpen)}
              className="text-[11px] font-semibold text-ink-muted hover:text-ink">
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          )
        })()}
        <span className="text-[11px] text-ink-muted ml-auto">{shown.length} of {rows.length}</span>
      </div>

      {!shown.length ? (
        <div className="card p-10 text-center">
          <CalendarClock size={28} className="text-ink-faint mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm text-ink">{rows.length ? 'Nothing matches these filters.' : 'Nothing has been tagged to a prior year.'}</p>
          <p className="text-xs text-ink-muted mt-1">
            {rows.length
              ? 'Clear the search or pick another year.'
              : <>Tag entries from an artist on <Link to="/recoupments" className="text-brand-ink hover:underline">Recoupments</Link> to move them here.</>}
          </p>
        </div>
      ) : groups.map(g => {
        const open = !isCollapsed(g.key)
        const allSel = g.items.every(e => sel.has(e.id))
        return (
          <section key={g.key} className="card mb-3 overflow-hidden">
            <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5 border-b border-divider">
              <input type="checkbox" checked={allSel} onChange={() => toggleGroup(g)}
                aria-label={`Select every entry for ${g.name}`} className="cursor-pointer flex-shrink-0" />
              <button onClick={() => toggleCollapsed(g.key)} aria-expanded={open}
                className="flex items-center gap-1.5 min-w-0 flex-1 text-left rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                {open ? <ChevronDown size={13} className="text-ink-muted flex-shrink-0" /> : <ChevronRight size={13} className="text-ink-muted flex-shrink-0" />}
                <span className="text-sm font-semibold text-ink truncate">{g.name}</span>
                <span className="text-[11px] text-ink-muted flex-shrink-0">{g.items.length}</span>
              </button>
              <span className="text-sm font-bold text-ink tabular-nums flex-shrink-0" title={moneyByCurrency(g.byCurrency)}>{money(g.usd)}</span>
              <button
                onClick={() => setConfirm({ ids: g.items.map(e => e.id), what: g.name })}
                disabled={busy}
                className="text-[11px] font-semibold text-brand-ink hover:underline flex-shrink-0 disabled:opacity-50"
              >Untag all</button>
            </div>

            {open && (
              <table className="w-full text-xs">
                <thead className="bg-page/50">
                  <tr className="text-left text-ink-muted">
                    <th className="px-3 py-1.5 w-8" />
                    <th className="px-3 py-1.5 font-semibold">Date</th>
                    <th className="px-3 py-1.5 font-semibold">Payee</th>
                    <th className="px-3 py-1.5 font-semibold">Song</th>
                    <th className="px-3 py-1.5 font-semibold">Category</th>
                    <th className="px-3 py-1.5 font-semibold">Year</th>
                    <th className="px-3 py-1.5 font-semibold text-right">Amount</th>
                    <th className="px-3 py-1.5 w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {g.items.map(e => (
                    <tr key={e.id} className={sel.has(e.id) ? 'bg-selected' : 'hover:bg-elev'}>
                      <td className="px-3 py-1.5">
                        <input type="checkbox" checked={sel.has(e.id)} onChange={() => toggleSel(e.id)}
                          aria-label={`Select ${e.payee || 'entry'}`} className="cursor-pointer" />
                      </td>
                      <td className="px-3 py-1.5 text-ink-muted whitespace-nowrap">{formatDate(e.payment_date || e.invoice_date)}</td>
                      <td className="px-3 py-1.5 text-ink truncate max-w-[14rem]">{e.payee || '—'}</td>
                      <td className="px-3 py-1.5 text-ink-muted truncate max-w-[10rem]">{e.song || '—'}</td>
                      <td className="px-3 py-1.5 text-ink-muted truncate max-w-[10rem]">{e.category || '—'}</td>
                      <td className="px-3 py-1.5"><span className="text-[10px] px-1.5 py-0.5 rounded bg-elev text-ink-muted">{e.prior_year_tag}</span></td>
                      <td className="px-3 py-1.5 text-right text-ink tabular-nums whitespace-nowrap">
                        {money(usdOf(e))}
                        {e.currency !== 'USD' && <span className="text-[10px] text-ink-faint ml-1">{e.currency} {Number(e.amount).toFixed(2)}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <div className="inline-flex items-center gap-2">
                          <Link to={`/ledger?focus=${e.id}`} className="text-[11px] text-ink-muted hover:text-brand-ink">Ledger</Link>
                          <button onClick={() => untag([e.id], 'this entry')} disabled={busy}
                            title="Put this entry back on Recoupments"
                            className="text-ink-faint hover:text-brand-ink disabled:opacity-50">
                            <Undo2 size={13} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )
      })}

      {sel.size > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-20 card shadow-lg px-4 py-2.5 flex items-center gap-3">
          <span className="text-xs text-ink">
            <span className="font-bold tabular-nums">{sel.size}</span> selected ·
            <span className="font-bold tabular-nums ml-1">{money(selUsd)}</span>
          </span>
          <Button size="sm" disabled={busy}
            onClick={() => setConfirm({ ids: [...sel], what: `${sel.size} selected ${sel.size === 1 ? 'entry' : 'entries'}` })}>
            <Undo2 size={13} /> Untag
          </Button>
          <button onClick={() => setSel(new Set())} className="text-[11px] font-semibold text-ink-muted hover:text-ink">Clear</button>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        title="Put these back on Recoupments?"
        message={confirm ? `${confirm.what} will lose the prior-year tag and reappear in the main Recoupments list, where they can be claimed onto a statement.` : ''}
        confirmLabel="Untag"
        variant="primary"
        busy={busy}
        onConfirm={() => untag(confirm.ids, confirm.what)}
        onClose={() => setConfirm(null)}
      />
    </div>
  )
}
