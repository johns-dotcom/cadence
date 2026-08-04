import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, CheckCheck, Layers } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'

const money = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`

// Stage recoupable entries into a batch and commit them to a statement (mass
// UFR). Grouped artist → song; select whole groups; the selection bar shows
// per-currency + ≈USD totals before you commit.
export default function RecoupmentPlanning() {
  const { toast } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState(new Set())
  const [deferred, setDeferred] = useState(new Set()) // artists saved for later — excluded from commit
  const [committing, setCommitting] = useState(false)

  const load = () => { setLoading(true); setSel(new Set()); api.get('/financials/planning').then(r => setRows(r.data.data || [])).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [])
  const toggleDefer = (artist, items) => setDeferred(d => { const n = new Set(d); if (n.has(artist)) n.delete(artist); else { n.add(artist); setSel(s => { const ss = new Set(s); items.forEach(r => ss.delete(r.id)); return ss }) } return n })

  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  // Group artist → song.
  const groups = useMemo(() => {
    const byArtist = {}
    rows.forEach(r => {
      const a = r.artist || '—'
      const s = r.song || '—'
      byArtist[a] = byArtist[a] || {}
      ;(byArtist[a][s] = byArtist[a][s] || []).push(r)
    })
    return byArtist
  }, [rows])

  const toggleGroup = (items, on) => setSel(s => { const n = new Set(s); items.forEach(r => on ? n.add(r.id) : n.delete(r.id)); return n })

  const selectedRows = rows.filter(r => sel.has(r.id))
  const selByCur = selectedRows.reduce((t, r) => { t[r.currency || 'USD'] = (t[r.currency || 'USD'] || 0) + Number(r.amount || 0); return t }, {})
  const selUsd = selectedRows.reduce((s, r) => s + Number(r.amount_usd || 0), 0)

  const commit = async () => {
    if (!sel.size) return
    if (!window.confirm(`Commit ${sel.size} entr${sel.size === 1 ? 'y' : 'ies'} to this statement (mark UFR)?`)) return
    setCommitting(true)
    try { const { data } = await api.post('/financials/recoupments/ufr-bulk', { ids: [...sel] }); toast(`Committed ${data.data.committed}`); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setCommitting(false) }
  }

  return (
    <div className="pb-24">
      <PageHeader title="Recoupment planning" subtitle="Stage recoupable entries and commit them to a statement" />

      {loading ? (
        <div className="card p-2"><Skeleton.Table rows={8} cols={4} /></div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center"><Layers size={28} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">Nothing to plan — every recoupable entry is already on a statement.</p></div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groups).map(([artist, songs]) => {
            const artistItems = Object.values(songs).flat()
            const isDeferred = deferred.has(artist)
            return (
            <div key={artist} className={`card overflow-hidden ${isDeferred ? 'opacity-60' : ''}`}>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider bg-page/50">
                <span className="font-semibold text-ink text-sm">{artist}{isDeferred && <span className="ml-2 text-[10px] font-semibold uppercase text-gray-400">Saved for later</span>}</span>
                <button onClick={() => toggleDefer(artist, artistItems)} className="text-[11px] font-medium text-gray-500 hover:text-brand-600">{isDeferred ? 'Include' : 'Save for later'}</button>
              </div>
              {!isDeferred && Object.entries(songs).map(([song, items]) => {
                const allOn = items.every(r => sel.has(r.id))
                const subtotal = items.reduce((s, r) => s + Number(r.amount_usd || 0), 0)
                return (
                  <div key={song} className="border-b border-divider last:border-0">
                    <div className="flex items-center gap-2 px-4 py-1.5 bg-page/20">
                      <button onClick={() => toggleGroup(items, !allOn)} className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${allOn ? 'bg-brand-600 border-brand-600' : 'border-gray-300'}`}>{allOn && <CheckCheck size={11} className="text-white" />}</button>
                      <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide flex-1">{song}</span>
                      <span className="text-[11px] text-gray-400">{usd(subtotal)}</span>
                    </div>
                    {items.map(r => (
                      <div key={r.id} className="flex items-center gap-2 px-4 py-2 text-xs hover:bg-gray-50">
                        <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} />
                        <span className="text-gray-500 w-20 flex-shrink-0">{formatDate(r.payment_date || r.invoice_date)}</span>
                        <span className="text-ink flex-1 truncate">{r.payee || '—'}{r.category ? ` · ${r.category}` : ''}</span>
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${r.payment_status === 'Paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{r.payment_status || 'Unpaid'}</span>
                        <span className="text-ink font-medium tabular-nums w-28 text-right">{money(r.amount, r.currency)}</span>
                        <Link to={`/ledger?focus=${r.id}`} title="View in ledger" className="text-gray-400 hover:text-brand-600"><ExternalLink size={13} /></Link>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )})}
        </div>
      )}

      {/* Sticky selection bar */}
      {sel.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 lg:left-60 z-40 bg-card border-t border-rule shadow-modal px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-ink">
            <span className="font-semibold">{sel.size}</span> selected ·{' '}
            {Object.entries(selByCur).map(([c, a]) => `${c} ${a.toLocaleString(undefined, { minimumFractionDigits: 2 })}`).join(' · ')}
            <span className="text-gray-400"> ≈ {usd(selUsd)}</span>
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSel(new Set())} className="btn-secondary py-1.5">Clear</button>
            <button onClick={commit} disabled={committing} className="btn-primary py-1.5"><CheckCheck size={15} /> {committing ? 'Committing…' : 'Commit to statement'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
