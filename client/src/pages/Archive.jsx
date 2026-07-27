import { useEffect, useState } from 'react'
import { Archive as ArchiveIcon, RotateCcw, Paperclip, Trash2, XCircle } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'

const money = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`

// Recover rejected or deleted ledger entries. Admin-only surface — the safety
// net for accidental deletions and for reviving a rejected submission.
export default function Archive() {
  const { toast } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('deleted')

  const load = () => { setLoading(true); api.get('/ledger/archive').then(r => setRows(r.data.data || [])).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(load, [])

  const restore = async (r) => {
    try { await api.post(`/ledger/entries/${r.id}/restore`); toast(r.deleted ? 'Restored' : 'Sent back to pending'); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const deleted = rows.filter(r => r.deleted)
  const rejected = rows.filter(r => !r.deleted && r.status === 'rejected')
  const list = tab === 'deleted' ? deleted : rejected

  const FileChips = ({ r }) => (
    <span className="inline-flex gap-1.5 text-[11px] text-gray-400">
      {r.has_invoice && <span className="inline-flex items-center gap-0.5"><Paperclip size={11} /> inv</span>}
      {r.has_w9 && <span>W9</span>}
      {r.has_receipt && <span>rct</span>}
      {!r.has_invoice && !r.has_w9 && !r.has_receipt && <span className="text-gray-300">—</span>}
    </span>
  )

  return (
    <div>
      <PageHeader title="Archive" subtitle="Rejected and deleted entries — review and restore" />

      <div className="flex items-center gap-1 mb-4">
        {[['deleted', 'Deleted', deleted.length], ['rejected', 'Rejected', rejected.length]].map(([k, lbl, n]) => (
          <button key={k} onClick={() => setTab(k)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition ${tab === k ? 'bg-brand-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>{lbl} ({n})</button>
        ))}
      </div>

      {loading ? (
        <div className="card p-2"><Skeleton.Table rows={5} cols={5} /></div>
      ) : list.length === 0 ? (
        <div className="card p-10 text-center">
          {tab === 'deleted' ? <Trash2 size={28} className="text-gray-300 mx-auto mb-3" /> : <XCircle size={28} className="text-gray-300 mx-auto mb-3" />}
          <p className="text-sm text-gray-500">Nothing {tab} — the archive is clear.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-page/50 border-b border-divider text-left">
                {['Payee', 'Amount', 'Invoice #', tab === 'deleted' ? 'Deleted by' : 'Reason', 'When', 'Files', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {list.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3"><p className="font-medium text-ink">{r.payee}</p>{r.artist && <p className="text-xs text-gray-400">{r.artist}</p>}</td>
                  <td className="px-4 py-3 text-ink whitespace-nowrap">{money(r.amount, r.currency)}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{r.invoice_number || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{tab === 'deleted' ? (r.deleted_by || '—') : (r.rejected_reason || '—')}</td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{formatDate(tab === 'deleted' ? r.deleted_at : r.approved_at)}</td>
                  <td className="px-4 py-3"><FileChips r={r} /></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => restore(r)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 border border-brand-200 hover:bg-brand-600 hover:text-white hover:border-brand-600 px-2.5 py-1 rounded-lg transition-colors">
                      <RotateCcw size={13} /> {tab === 'deleted' ? 'Restore' : 'Reopen'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-3 inline-flex items-center gap-1"><ArchiveIcon size={12} /> Restoring a deleted entry brings its whole split family back; reopening a rejected entry returns it to the Approvals queue.</p>
    </div>
  )
}
