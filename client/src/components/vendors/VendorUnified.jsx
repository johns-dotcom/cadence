import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Landmark, Check, Minus, ChevronRight, Link2 } from 'lucide-react'
import api from '../../api'
import Skeleton from '../Skeleton'
import VendorTypeahead from './VendorTypeahead'
import useCollapsed from '../../hooks/useCollapsed'
import { money } from '../../utils/money'
import { formatDate } from '../../utils/dates'

// One row per COMPANY: what we invoiced, what actually left the bank, and the
// three queues that stop a vendor's file from being finished.
//
// The worklist counts come from the SAME rows the totals come from (the server
// aggregates once), so a chip can never claim a number the table can't show.

const VIEWS = [
  ['all', 'All vendors', 'Everyone with ledger or bank activity.'],
  ['needs_matching', 'Needs matching', 'Marked paid, a statement covers the date, and no bank line matches it. The only bank state that is a discrepancy.'],
  ['needs_artist', 'Needs artist', 'Invoices filed under this vendor with no artist on them — they are missing from every per-artist number.'],
  ['to_attach', 'To attach', 'Invoices with no document on file. Nothing proves what was bought.'],
]

export default function VendorUnified({ onOpenVendor, isAdmin, toast }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [view, setView] = useState('all')
  const [onlySeveral, setOnlySeveral] = useState(false)
  // Collapsed by default: the queue is a backlog, not the headline.
  const { isCollapsed, toggleCollapsed } = useCollapsed('vendors.unlinked')
  const queueOpen = !isCollapsed('queue')
  const [linking, setLinking] = useState(null)
  const [pick, setPick] = useState('')

  const load = () => {
    setLoading(true)
    api.get('/ledger/vendors/unified')
      .then((r) => { setData(r.data.data); setError(null) })
      .catch((e) => setError(e.response?.data?.error || 'Could not load the unified view'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const rows = data?.rows || []
  const counts = useMemo(() => ({
    all: rows.length,
    needs_matching: rows.filter((r) => r.needs_matching > 0).length,
    needs_artist: rows.filter((r) => r.needs_artist > 0).length,
    to_attach: rows.filter((r) => r.to_attach > 0).length,
  }), [rows])

  const shown = useMemo(() => {
    let out = view === 'all' ? rows : rows.filter((r) => r[view] > 0)
    if (onlySeveral && view !== 'all') out = out.filter((r) => r[view] > 1)
    if (view !== 'all') out = [...out].sort((a, b) => b[view] - a[view])
    return out
  }, [rows, view, onlySeveral])

  const linkPayee = async (g, vendor, confirmNew) => {
    try {
      const r = await api.post('/ledger/vendors/link-bank-payee', {
        vendor, txn_ids: g.txn_ids, bank_payee: g.name, confirm_new: confirmNew === true,
      })
      toast(`${r.data.data.updated} bank line${r.data.data.updated === 1 ? '' : 's'} now read as “${vendor}”`)
      setLinking(null); setPick(''); load()
    } catch (e) {
      if (e.response?.status === 409 && e.response.data?.unknown_vendor) {
        if (window.confirm(`${e.response.data.error}`)) return linkPayee(g, vendor, true)
        return
      }
      toast(e.response?.data?.error || 'Failed', 'error')
    }
  }

  if (loading) return <div className="card p-2"><Skeleton.Table rows={8} cols={7} /></div>
  if (error) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm text-danger mb-3">{error}</p>
        <button onClick={load} className="btn-secondary mx-auto">Retry</button>
      </div>
    )
  }

  const blurb = VIEWS.find(([k]) => k === view)?.[2]

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {VIEWS.map(([k, label]) => (
          <button key={k} onClick={() => setView(k)}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${view === k ? 'bg-brand-500/15 text-brand-ink border-rule' : 'bg-elev text-ink-muted border-divider hover:text-ink'}`}>
            {label} <span className="tabular-nums">{counts[k]}</span>
          </button>
        ))}
        {view !== 'all' && (
          <label className="ml-2 inline-flex items-center gap-1.5 text-xs text-ink-muted">
            <input type="checkbox" checked={onlySeveral} onChange={(e) => setOnlySeveral(e.target.checked)} />
            Only the {shown.length} with more than one
          </label>
        )}
      </div>
      <p className="text-xs text-ink-muted mb-3">{blurb}</p>

      {!data?.has_bank_data && (
        <p className="text-xs text-ink-faint mb-3 inline-flex items-center gap-1.5">
          <Landmark size={13} /> No ready bank statements yet — the bank columns are empty because nothing has been uploaded, not because nothing was paid.
        </p>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b border-divider text-left">
              {['Vendor', 'Inv', 'Invoiced', 'Bank out', 'Bank − invoiced', 'Open', 'Needs matching', 'Needs artist', 'To attach', 'Books as', 'Last activity'].map((h) => (
                <th key={h} className="px-3 py-2.5 text-[10px] font-extrabold text-ink-muted uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {shown.map((r) => (
              <tr key={r.key} onClick={() => onOpenVendor(r.name)} className="hover:bg-elev cursor-pointer">
                <td className="px-3 py-2.5 font-medium text-ink whitespace-nowrap">{r.name}</td>
                <td className="px-3 py-2.5 text-ink-muted tabular-nums">{r.invoices}</td>
                <td className="px-3 py-2.5 text-ink tabular-nums">{money(r.invoiced_usd)}</td>
                <td className="px-3 py-2.5 text-ink-muted tabular-nums">{r.bank_txns ? money(r.bank_out) : <span className="text-ink-faint">—</span>}</td>
                <td className="px-3 py-2.5 tabular-nums">
                  {r.in_tolerance === null ? <span className="text-ink-faint">—</span>
                    : r.in_tolerance
                      ? <span className="inline-flex items-center gap-1 text-success"><Check size={12} /> {money(r.delta)}</span>
                      : <span className="text-warning">{money(r.delta)}</span>}
                </td>
                <td className="px-3 py-2.5 text-ink-muted tabular-nums">{r.open_usd ? money(r.open_usd) : <span className="text-ink-faint">—</span>}</td>
                <td className={`px-3 py-2.5 tabular-nums ${r.needs_matching ? 'text-danger font-semibold' : 'text-ink-faint'}`}>{r.needs_matching || <Minus size={11} />}</td>
                <td className={`px-3 py-2.5 tabular-nums ${r.needs_artist ? 'text-warning font-semibold' : 'text-ink-faint'}`}>{r.needs_artist || <Minus size={11} />}</td>
                <td className={`px-3 py-2.5 tabular-nums ${r.to_attach ? 'text-ink font-semibold' : 'text-ink-faint'}`}>{r.to_attach || <Minus size={11} />}</td>
                <td className="px-3 py-2.5 text-ink-faint text-xs whitespace-nowrap">{r.books_as || '—'}</td>
                <td className="px-3 py-2.5 text-ink-muted text-xs whitespace-nowrap">{formatDate(r.last_activity)}</td>
              </tr>
            ))}
            {!shown.length && (
              <tr><td colSpan={11} className="px-3 py-10 text-center text-sm text-ink-muted">Nothing in this queue.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink-faint mt-2">
        Bank − invoiced ticks green inside the wire-fee tolerance (the greater of $35 or 1%). A dash means the bank has nothing to say yet, which is not agreement.
      </p>

      {(data?.unlinked || []).length > 0 && (
        <div className="card mt-4">
          <button onClick={() => toggleCollapsed('queue')} className="w-full flex items-center gap-2 px-4 py-3 text-left">
            <ChevronRight size={15} className={`text-ink-faint transition-transform ${queueOpen ? 'rotate-90' : ''}`} />
            <span className="text-sm font-bold text-ink">Unlinked bank payees ({data.unlinked.length})</span>
            <span className="text-xs text-ink-faint">— descriptors that name nobody in the ledger</span>
          </button>
          {queueOpen && (
            <div className="px-4 pb-4 space-y-2">
              {data.unlinked.map((g) => (
                <div key={g.key} className="flex flex-wrap items-center gap-2 border-t border-divider pt-2">
                  <span className="flex-1 min-w-[180px] text-sm text-ink truncate">{g.name}</span>
                  <span className="text-xs text-ink-faint tabular-nums whitespace-nowrap">
                    {g.n} line{g.n === 1 ? '' : 's'} · {money(g.total)} · last {formatDate(g.last_seen)}
                  </span>
                  {isAdmin && (linking === g.key ? (
                    <div className="flex items-center gap-2 w-full sm:w-72">
                      <VendorTypeahead value={pick} onPick={setPick} allowNew autoFocus className="flex-1"
                        placeholder="Which vendor is this?" />
                      <button disabled={!pick} onClick={() => linkPayee(g, pick)} className="btn-secondary !py-1.5 text-xs">Link</button>
                      <button onClick={() => { setLinking(null); setPick('') }} className="text-xs text-ink-faint hover:text-ink">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => { setLinking(g.key); setPick('') }} className="btn-secondary !py-1.5 text-xs">
                      <Link2 size={13} /> Link to a vendor
                    </button>
                  ))}
                </div>
              ))}
              <p className="text-[11px] text-ink-faint pt-1">
                Linking writes both facts: these lines read as that vendor, and the descriptor is remembered so the next statement matches on its own.
                Review the rest on <Link to="/bank-matching" className="text-brand-ink hover:underline">Bank Matching</Link>.
              </p>
            </div>
          )}
        </div>
      )}
    </>
  )
}
