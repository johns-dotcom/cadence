// The statement flags worklist — every flag carries an action button. Reads
// { flags, acked } defensively (older servers returned a bare array). Every
// action refetches, so fixing something clears its flag immediately.

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import api from '../../api'

const SEV = { error: 'bg-rose-50 border-rose-200 text-rose-700', warn: 'bg-amber-50 border-amber-200 text-amber-800' }

export default function StatementFlagsCard({ toast, onChanged }) {
  const [data, setData] = useState(null)
  const [busyFp, setBusyFp] = useState(null)
  const [showAcked, setShowAcked] = useState(false)

  const load = useCallback(() => {
    api.get('/bank-statements/flags')
      .then((r) => {
        const d = r.data.data
        setData(Array.isArray(d) ? { flags: d, acked: [], counts: {} } : d)
      })
      .catch(() => setData({ flags: [], acked: [], counts: {}, error: true }))
  }, [])
  useEffect(() => { load() }, [load])

  const run = async (f) => {
    setBusyFp(f.fingerprint)
    try {
      const a = f.action
      if (a.kind === 'unmatch') await api.post(`/bank-statements/txns/${a.txn_id}/unmatch`, {})
      else if (a.kind === 'dismiss-pair') await api.post('/bank-statements/txns/dismiss-pair', { txn_ids: a.txn_ids })
      else if (a.kind === 'unbook-income') await api.post(`/bank-statements/txns/${a.txn_id}/unbook-income`, {})
      else if (a.kind === 'mark-unpaid') await api.post('/bank-statements/flags/mark-unpaid', { entry_id: a.entry_id })
      toast('Fixed')
      load(); onChanged?.()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusyFp(null) }
  }
  const alias = async (f) => {
    setBusyFp(f.fingerprint)
    try {
      await api.post('/bank-statements/rules/alias', f.alt_action)
      toast('Alias recorded — the pairing reads as intended now')
      load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusyFp(null) }
  }
  const ack = async (f, undo) => {
    try {
      if (undo) await api.delete('/bank-statements/flags/ack', { data: { fingerprint: f.fingerprint } })
      else await api.post('/bank-statements/flags/ack', { fingerprint: f.fingerprint })
      load()
    } catch { toast('Failed', 'error') }
  }

  if (!data) return null
  const flags = data.flags || []

  return (
    <div id="statement-flags" className="card p-5 mt-4 scroll-mt-16">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-ink">Reconciliation flags</h3>
        <button onClick={load} className="text-gray-400 hover:text-ink" title="Re-run the checks"><RefreshCw size={14} /></button>
      </div>
      {flags.length === 0 ? (
        <p className="text-sm text-gray-500 flex items-center gap-2"><ShieldCheck size={16} className="text-emerald-400" /> No issues detected.</p>
      ) : (
        <div className="space-y-2">
          {flags.map((f) => (
            <div key={f.fingerprint} className={`rounded-lg border px-3 py-2 text-sm ${SEV[f.severity]}`}>
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{f.title}</p>
                  <p className="text-xs opacity-90">{f.detail}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 text-xs">
                  {f.statement_id && <Link className="underline" to={`/bank-statements/${f.statement_id}`}>View</Link>}
                  {f.action && (
                    <button className="underline font-semibold" disabled={busyFp === f.fingerprint} onClick={() => run(f)}>
                      {{ unmatch: 'Unmatch', 'dismiss-pair': 'Dismiss both', 'unbook-income': 'Unbook income', 'mark-unpaid': 'Mark unpaid' }[f.action.kind] || 'Fix'}
                    </button>
                  )}
                  {f.alt_action?.kind === 'alias' && (
                    <button className="underline" disabled={busyFp === f.fingerprint} onClick={() => alias(f)}>Add alias</button>
                  )}
                  <button className="opacity-70 hover:opacity-100" title="Acknowledge — it resurfaces if the facts change" onClick={() => ack(f)}><Check size={13} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {data.acked?.length > 0 && (
        <div className="mt-3">
          <button className="text-xs text-gray-400 underline" onClick={() => setShowAcked((v) => !v)}>
            {showAcked ? 'Hide' : 'Show'} acknowledged ({data.acked.length})
          </button>
          {showAcked && data.acked.map((f) => (
            <div key={f.fingerprint} className="flex items-center gap-2 text-xs text-gray-400 py-1">
              <span className="flex-1 truncate">{f.title} · acked by {f.acked_by}</span>
              <button className="underline inline-flex items-center gap-1" onClick={() => ack(f, true)}><RotateCcw size={11} /> Un-ignore</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
