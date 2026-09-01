// The statement flags worklist — every flag carries an action button. Reads
// { flags, acked } defensively (older servers returned a bare array). Every
// action refetches, so fixing something clears its flag immediately.

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import api from '../../api'

// Theme-aware severity tints: the /10 fill and /30 border route through
// color-mix (tailwind.config.js), so these read correctly in dark instead of
// going near-white the way the fixed -50 shades did.
const SEV = { error: 'bg-danger/10 border-danger/30 text-ink', warn: 'bg-warning/10 border-warning/30 text-ink' }

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
    const a = f.action
    // The consequence-bearing fixes name what moves before they run. The
    // others are reversible unlinks and go straight through.
    if (a.kind === 'unbook-rematch' && !window.confirm(
      `Retire the invented copy and tie this bank line to ${a.payee}'s real invoice?\n\n`
      + 'The duplicate entry is archived; the payment stops being counted twice. This can be undone from the rematch panel.')) return
    if (a.kind === 'unbook' && !window.confirm(
      'Unbook this line?\n\nThe entry it invented is archived and the line goes back to unanswered. Nothing else changes.')) return
    if (a.kind === 'relink' && !window.confirm(
      `Point ${a.bank_payees.length === 1 ? `"${a.bank_payees[0]}"` : `${a.bank_payees.length} bank descriptors`} at ${a.ledger_payee}?\n\n`
      + 'This rewrites what the matcher LEARNS, so future statements land on the right vendor. No existing match changes.')) return
    setBusyFp(f.fingerprint)
    try {
      if (a.kind === 'unmatch') await api.post(`/bank-statements/txns/${a.txn_id}/unmatch`, {})
      else if (a.kind === 'unbook') await api.post(`/bank-statements/txns/${a.txn_id}/unbook`, {})
      else if (a.kind === 'dismiss-pair') await api.post('/bank-statements/txns/dismiss-pair', { txn_ids: a.txn_ids })
      else if (a.kind === 'unbook-income') await api.post(`/bank-statements/txns/${a.txn_id}/unbook-income`, {})
      else if (a.kind === 'mark-unpaid') await api.post('/bank-statements/flags/mark-unpaid', { entry_id: a.entry_id })
      // One call: the rematch endpoint already archives the invented entry
      // (with the breadcrumb that makes it restorable) and repoints the txn.
      else if (a.kind === 'unbook-rematch') await api.post(`/bank-matching/tx/${a.txn_id}/rematch`, { expense_id: a.expense_id })
      else if (a.kind === 'relink') await api.post('/bank-statements/rules/relink', { bank_payees: a.bank_payees, ledger_payee: a.ledger_payee })
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
  // The engine caps paid-no-match rows at 150 but counts every one it found.
  // Rendering the capped list without saying so under-reports the size of the
  // problem — the reader has no way to tell 150 from 400.
  const pnmShown = flags.filter((f) => f.type === 'paid-no-match').length
  const pnmTotal = Number(data.counts?.paid_no_match) || 0

  return (
    <div id="statement-flags" className="card p-5 mt-4 scroll-mt-16">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-ink">Reconciliation flags</h3>
        <button onClick={load} className="text-ink-muted hover:text-ink" title="Re-run the checks"><RefreshCw size={14} /></button>
      </div>
      {flags.length === 0 ? (
        <p className="text-sm text-ink-muted flex items-center gap-2"><ShieldCheck size={16} className="text-success" /> No issues detected.</p>
      ) : (
        <div className="space-y-2">
          {flags.map((f) => (
            <div key={f.fingerprint} className={`rounded-lg border px-3 py-2 text-sm ${SEV[f.severity]}`}>
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className={`mt-0.5 shrink-0 ${f.severity === 'error' ? 'text-danger' : 'text-warning'}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{f.title}</p>
                  <p className="text-xs opacity-90">{f.detail}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 text-xs">
                  {f.statement_id && <Link className="underline" to={`/bank-statements/${f.statement_id}`}>View</Link>}
                  {f.ledger_id && <Link className="underline" to={`/ledger?focus=${f.ledger_id}`}>Ledger</Link>}
                  {f.action && (
                    <button className="underline font-semibold" disabled={busyFp === f.fingerprint} onClick={() => run(f)}>
                      {{
                        unmatch: 'Unmatch', unbook: 'Unbook', 'dismiss-pair': 'Dismiss both',
                        'unbook-income': 'Unbook income', 'mark-unpaid': 'Mark unpaid',
                        'unbook-rematch': 'Fix the duplicate', relink: 'Repoint the link',
                      }[f.action.kind] || 'Fix'}
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
      {pnmTotal > pnmShown && (
        <p className="mt-2 text-[11px] text-ink-muted">
          Showing the {pnmShown} largest of <span className="tabular-nums font-semibold">{pnmTotal.toLocaleString()}</span> paid entries with no bank line.{' '}
          <Link to="/bank-matching" className="underline">Work the queue</Link> to see the rest.
        </p>
      )}
      {data.acked?.length > 0 && (
        <div className="mt-3">
          <button className="text-xs text-ink-muted underline" onClick={() => setShowAcked((v) => !v)}>
            {showAcked ? 'Hide' : 'Show'} acknowledged ({data.acked.length})
          </button>
          {showAcked && data.acked.map((f) => (
            <div key={f.fingerprint} className="flex items-center gap-2 text-xs text-ink-muted py-1">
              <span className="flex-1 truncate">{f.title} · acked by {f.acked_by}</span>
              <button className="underline inline-flex items-center gap-1" onClick={() => ack(f, true)}><RotateCcw size={11} /> Un-ignore</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
