import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Archive, ChevronDown, ChevronRight, RotateCcw, Search } from 'lucide-react'
import api from '../api'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { formatDate } from '../utils/dates'
import { moneyOrig } from '../utils/money'

// Admin browser for the two "gone" buckets — rejected and soft-deleted
// invoices — with restore for both. Restore semantics differ on purpose:
// a deleted row returns to the ledger as it was; a rejected row returns to
// PENDING (undoing a rejection restores the question, not the answer).
// Server: GET /ledger/archive + POST /ledger/entries/:id/restore (admin).

const FIELDS = ['payee', 'artist', 'invoice_number', 'rejected_reason', 'deleted_by', 'approved_by']

function Section({ title, rows, total, restoreLabel, onRestore, attribution }) {
  const [open, setOpen] = useState(true)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="card overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-5 py-3 text-left border-b border-divider">
        <Chevron size={15} className="text-ink-faint" />
        <span className="text-sm font-semibold text-ink">{title}</span>
        <span className="text-xs text-ink-muted">{rows.length === total ? total : `${rows.length}/${total}`}</span>
      </button>
      {open && (rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted border-b border-divider">
                <th className="px-5 py-2">Date</th>
                <th className="px-3 py-2">Payee</th>
                <th className="px-3 py-2">Artist</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">{attribution}</th>
                <th className="px-5 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-5 py-2 whitespace-nowrap text-ink-muted">{formatDate(r.deleted_at || r.approved_at || r.created_at)}</td>
                  <td className="px-3 py-2">
                    <span className="text-ink">{r.payee || '—'}</span>
                    {r.invoice_number && <span className="ml-1.5 text-[11px] text-ink-faint">#{r.invoice_number}</span>}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{r.artist || '—'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{moneyOrig(r.amount, r.currency)}</td>
                  <td className="px-3 py-2 text-[12px] text-ink-muted max-w-xs">
                    {r.deleted
                      ? <>{r.deleted_by || 'Unknown'} · {formatDate(r.deleted_at)}</>
                      : <>{r.approved_by || 'Unknown'} · {formatDate(r.approved_at)}{r.rejected_reason && <span className="text-danger"> — {r.rejected_reason}</span>}</>}
                  </td>
                  <td className="px-5 py-2 text-right">
                    <button type="button" onClick={() => onRestore(r)}
                      className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-ink hover:underline">
                      <RotateCcw size={12} /> {restoreLabel}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-5 py-6 text-sm text-ink-muted">Nothing here.</div>
      ))}
    </div>
  )
}

export default function LedgerArchive() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [banner, setBanner] = useState(null)

  const load = async () => {
    try {
      setError(null)
      const res = await api.get('/ledger/archive')
      setRows(res.data.data || [])
    } catch {
      setError('Failed to load the archive')
    }
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    if (!rows) return []
    const needle = q.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter(r => FIELDS.some(f => (r[f] || '').toLowerCase().includes(needle)))
  }, [rows, q])

  const deleted = filtered.filter(r => r.deleted)
  const rejected = filtered.filter(r => !r.deleted && r.status === 'rejected')
  const allDeleted = (rows || []).filter(r => r.deleted).length
  const allRejected = (rows || []).filter(r => !r.deleted && r.status === 'rejected').length

  const restore = async (r) => {
    try {
      await api.post(`/ledger/entries/${r.id}/restore`)
      setBanner(r.deleted ? 'Entry restored to the ledger.' : 'Entry returned to Approvals as pending.')
      setConfirm(null)
      load()
    } catch (e) {
      setBanner(e.response?.data?.error || 'Restore failed')
      setConfirm(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink flex items-center gap-2"><Archive size={18} /> Approvals archive</h1>
          <p className="text-sm text-ink-muted mt-0.5">Rejected and deleted invoices. Nothing is hard-deleted — restore either kind from here.</p>
        </div>
        <Link to="/approvals" className="btn-secondary">Back to Approvals</Link>
      </div>

      {banner && (
        <div className="card px-4 py-2.5 text-sm text-ink flex items-center justify-between">
          <span>{banner} {banner.includes('pending') && <Link to="/approvals" className="text-brand-ink hover:underline">Go to Approvals →</Link>}</span>
          <button type="button" className="text-ink-faint text-xs" onClick={() => setBanner(null)}>Dismiss</button>
        </div>
      )}

      {error ? (
        <div className="card px-5 py-8 text-center">
          <p className="text-sm text-danger">{error}</p>
          <button type="button" className="btn-secondary mt-3" onClick={load}>Retry</button>
        </div>
      ) : rows === null ? (
        <div className="card px-5 py-8 text-sm text-ink-muted">Loading…</div>
      ) : (
        <>
          <div className="relative max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input className="input pl-8" placeholder="Search payee, artist, invoice #, reason…"
              value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <Section title="Rejected invoices" rows={rejected} total={allRejected}
            attribution="Rejected by" restoreLabel="Back to pending"
            onRestore={r => setConfirm(r)} />
          <Section title="Deleted invoices" rows={deleted} total={allDeleted}
            attribution="Deleted by" restoreLabel="Restore"
            onRestore={r => setConfirm(r)} />
        </>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.deleted ? 'Restore this entry?' : 'Return to pending?'}
        message={confirm ? (confirm.deleted
          ? `"${confirm.payee}" (${moneyOrig(confirm.amount, confirm.currency)}) returns to the ledger with its prior status.`
          : `"${confirm.payee}" (${moneyOrig(confirm.amount, confirm.currency)}) goes back to the Approvals queue as pending — the rejection is undone, not reversed.`) : ''}
        confirmLabel={confirm?.deleted ? 'Restore' : 'Back to pending'}
        variant="primary"
        onConfirm={() => restore(confirm)}
        onClose={() => setConfirm(null)}
      />
    </div>
  )
}
