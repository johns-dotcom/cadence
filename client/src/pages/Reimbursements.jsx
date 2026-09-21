import { useEffect, useMemo, useState } from 'react'
import { Check, RotateCcw, Users, ChevronRight, ChevronDown, Coins, Pencil } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { moneyByCurrency, money } from '../utils/money'
import { formatDate } from '../utils/dates'
import useFundingSources from '../hooks/useFundingSources'

// Out-of-pocket reimbursement tracker. When a workspace has no bank account,
// individuals front money for vendors; each such paid invoice is owed to them
// until reimbursed. This groups what's owed by who fronted it, and closes the
// loop with mark-reimbursed (per item or a whole person at once).
const STATUS_TABS = [['owed', 'Owed'], ['reimbursed', 'Reimbursed'], ['all', 'All']]

export default function Reimbursements() {
  const { toast } = useToast()
  const { sources: allSources, addSource, refetch: refetchSources } = useFundingSources()
  const [status, setStatus] = useState('owed')
  const [data, setData] = useState(null) // { sources, items }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState({}) // source_id → expanded
  const [busy, setBusy] = useState(null)
  const [managePayers, setManagePayers] = useState(false)

  const load = () => {
    setLoading(true); setError(false)
    api.get('/ledger/reimbursements', { params: { status } })
      .then(r => setData(r.data.data)).catch(() => setError(true)).finally(() => setLoading(false))
  }
  useEffect(load, [status]) // eslint-disable-line

  const itemsBySource = useMemo(() => {
    const m = {}
    for (const it of data?.items || []) (m[it.paid_source_id] ||= []).push(it)
    return m
  }, [data])

  const setItem = async (item, reimbursed) => {
    setBusy(item.id)
    try {
      await api.post(`/ledger/entries/${item.id}/reimburse`, { reimbursed })
      load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(null) }
  }
  const reimburseAll = async (source) => {
    const ids = (itemsBySource[source.source_id] || []).map(i => i.id)
    if (!ids.length) return
    setBusy(`src-${source.source_id}`)
    try {
      const { data: res } = await api.post('/ledger/reimburse-bulk', { ids, reimbursed: true })
      toast(`Marked ${res.data.rows} reimbursed`)
      load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(null) }
  }

  const totalOwedUsd = (data?.sources || []).reduce((a, s) => a + (s.usd_total || 0), 0)

  return (
    <div>
      <PageHeader
        title="Reimbursements"
        subtitle="Money individuals fronted out of pocket, and what's still owed"
        action={<button onClick={() => setManagePayers(v => !v)} className="btn-secondary inline-flex items-center gap-1.5"><Users size={15} /> Manage payers</button>}
      />

      {managePayers && <ManagePayers sources={allSources} addSource={addSource} refetch={refetchSources} onClose={() => setManagePayers(false)} />}

      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div className="inline-flex rounded-lg border border-rule overflow-hidden">
          {STATUS_TABS.map(([val, lbl]) => (
            <button key={val} onClick={() => setStatus(val)}
              className={`px-3 py-1.5 text-xs font-semibold transition ${status === val ? 'bg-brand-500/10 text-brand-ink' : 'text-ink-muted hover:bg-elev'}`}>{lbl}</button>
          ))}
        </div>
        {status === 'owed' && totalOwedUsd > 0 && (
          <p className="text-sm text-ink-muted">Outstanding ≈ <span className="font-bold text-danger">{money(totalOwedUsd)}</span></p>
        )}
      </div>

      {loading ? (
        <div className="card p-2"><Skeleton.Table rows={4} cols={3} /></div>
      ) : error ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-ink-muted mb-3">Couldn't load reimbursements.</p>
          <button onClick={load} className="btn-secondary">Retry</button>
        </div>
      ) : !data?.sources?.length ? (
        <div className="card p-10 text-center">
          <Coins size={26} className="text-ink-faint mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm text-ink-muted">{status === 'owed' ? 'Nothing owed — every out-of-pocket payment is reimbursed.' : 'No out-of-pocket payments here.'}</p>
          <p className="text-[11px] text-ink-faint mt-1">When someone fronts money for a vendor, pick them as the payer on the Payments page and it'll show up here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.sources.map(src => {
            const items = itemsBySource[src.source_id] || []
            const expanded = open[src.source_id]
            return (
              <div key={src.source_id} className="card overflow-hidden">
                <div className="flex items-center gap-3 p-4">
                  <button onClick={() => setOpen(o => ({ ...o, [src.source_id]: !o[src.source_id] }))} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                    {expanded ? <ChevronDown size={16} className="text-ink-faint flex-shrink-0" /> : <ChevronRight size={16} className="text-ink-faint flex-shrink-0" />}
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-ink truncate">{src.source_name}</span>
                      <span className="block text-[11px] text-ink-faint">{src.count} payment{src.count === 1 ? '' : 's'}</span>
                    </span>
                  </button>
                  <span className="text-right">
                    <span className="block text-sm font-bold text-ink tabular-nums">{moneyByCurrency(src.by_currency)}</span>
                    {Object.keys(src.by_currency).length > 1 && <span className="block text-[11px] text-ink-faint">≈ {money(src.usd_total)}</span>}
                  </span>
                  {status === 'owed' && (
                    <button disabled={busy === `src-${src.source_id}`} onClick={() => reimburseAll(src)}
                      className="btn-primary !py-1.5 text-xs inline-flex items-center gap-1.5 flex-shrink-0"><Check size={13} /> Reimburse all</button>
                  )}
                </div>
                {expanded && (
                  <div className="border-t border-divider divide-y divide-divider">
                    {items.map(it => (
                      <div key={it.id} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-ink truncate">{it.payee}{it.invoice_number ? <span className="text-ink-faint"> · #{it.invoice_number}</span> : ''}</span>
                          <span className="block text-[11px] text-ink-faint">{it.category || 'Uncategorized'}{it.payment_date ? ` · paid ${formatDate(it.payment_date)}` : ''}{it.reimbursed && it.reimbursed_at ? ` · reimbursed ${formatDate(it.reimbursed_at)}` : ''}</span>
                        </span>
                        <span className="text-sm font-semibold text-ink tabular-nums whitespace-nowrap">{it.currency} {Number(it.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        {it.reimbursed
                          ? <button disabled={busy === it.id} onClick={() => setItem(it, false)} className="text-ink-faint hover:text-ink p-1" title="Reopen"><RotateCcw size={15} /></button>
                          : <button disabled={busy === it.id} onClick={() => setItem(it, true)} className="text-ink-muted hover:text-success p-1" title="Mark reimbursed"><Check size={16} /></button>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Lightweight payer management: add, rename, deactivate. A source referenced by
// paid expenses is deactivated (hidden from the picker), never deleted, so
// history stays intact.
function ManagePayers({ sources, addSource, refetch, onClose }) {
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(null)
  const [editVal, setEditVal] = useState('')

  const add = async () => {
    const n = name.trim()
    if (!n) return
    try { await addSource(n); setName(''); toast('Payer added') } catch { toast('Failed', 'error') }
  }
  const patch = async (id, body) => {
    try { await api.patch(`/ledger/funding-sources/${id}`, body); refetch(); setEditing(null) }
    catch { toast('Failed', 'error') }
  }

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-ink">Payers</h2>
        <button onClick={onClose} className="text-xs text-ink-muted hover:text-ink">Done</button>
      </div>
      <div className="flex items-center gap-1.5 mb-3">
        <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} placeholder="Add a person or entity who fronts money" className="input" />
        <button onClick={add} className="btn-primary !py-1.5 text-xs whitespace-nowrap">Add payer</button>
      </div>
      {sources.length === 0 ? (
        <p className="text-xs text-ink-faint">No payers yet.</p>
      ) : (
        <ul className="divide-y divide-divider">
          {sources.map(s => (
            <li key={s.id} className="flex items-center gap-2 py-2">
              {editing === s.id ? (
                <>
                  <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') patch(s.id, { name: editVal.trim() }); if (e.key === 'Escape') setEditing(null) }} className="input !py-1 text-sm flex-1" />
                  <button onClick={() => patch(s.id, { name: editVal.trim() })} className="text-success hover:opacity-80 p-1"><Check size={15} /></button>
                </>
              ) : (
                <>
                  <span className={`flex-1 text-sm ${s.active === false ? 'text-ink-faint line-through' : 'text-ink'}`}>{s.name}</span>
                  <button onClick={() => { setEditing(s.id); setEditVal(s.name) }} className="text-ink-faint hover:text-brand-ink p-1" title="Rename"><Pencil size={13} /></button>
                  <button onClick={() => patch(s.id, { active: s.active === false })} className="text-[11px] font-semibold text-ink-muted hover:text-ink px-1.5">{s.active === false ? 'Reactivate' : 'Deactivate'}</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
