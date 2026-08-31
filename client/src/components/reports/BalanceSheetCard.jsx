// Balance Sheet — cash from captured statement balances, A/R from outbound
// invoices, A/P from approved unpaid ledger entries (as-of-aware), drawdowns
// as a funding liability. Per-line and per-item exclusions with disclosure.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../api'
import { money, moneyOrig } from '../../utils/money'
import Skeleton from '../Skeleton'

function LineRows({ line, asOf, toast, onChanged }) {
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState(false)
  const loadRows = async () => {
    if (!open && !rows) {
      try { const r = await api.get('/reports/balance-sheet/detail', { params: { line, as_of: asOf } }); setRows(r.data.data.rows) }
      catch { toast('Failed to load rows', 'error') }
    }
    setOpen((v) => !v)
  }
  const toggleItem = async (r) => {
    try {
      if (r.excluded) await api.post('/reports/dismiss/restore', { scope: 'bs_item', bs_ref: r.bs_ref })
      else await api.post('/reports/dismiss', { scope: 'bs_item', bs_ref: r.bs_ref })
      setRows(null); setOpen(false); onChanged()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  return (
    <>
      <button className="text-[11px] text-gray-400 underline" onClick={loadRows}>{open ? 'hide rows' : 'rows'}</button>
      {open && rows && (
        <div className="mt-1 mb-2 space-y-0.5 max-h-64 overflow-y-auto">
          {rows.map((r) => (
            <div key={r.bs_ref} className={`flex items-center gap-2 text-xs ${r.excluded ? 'opacity-40 line-through' : ''}`}>
              <span className="tabular-nums text-gray-400 w-20 shrink-0">{r.date}</span>
              <span className="flex-1 truncate">{r.counterparty || '—'}{r.number ? ` · #${r.number}` : ''}</span>
              <span className="tabular-nums">{money(r.usd)}</span>
              <button className="text-gray-400 hover:text-ink" title={r.excluded ? 'Restore into the balance sheet' : 'Exclude from the balance sheet'} onClick={() => toggleItem(r)}>{r.excluded ? '↩' : '✕'}</button>
            </div>
          ))}
          {!rows.length && <p className="text-xs text-gray-400">No rows.</p>}
        </div>
      )}
    </>
  )
}

export default function BalanceSheetCard({ bs, error, refetch, toast }) {
  if (error) return (
    <div className="card p-8 text-center">
      <p className="text-sm text-ink">{error}</p>
      <p className="text-xs text-ink-muted mt-2">Cash is unknown before the first statement with a captured balance — pick a later date, or set balances on <Link className="underline" to="/bank-statements">Bank Statements</Link>.</p>
    </div>
  )
  if (!bs) return <div className="card p-6"><Skeleton.Block /></div>

  const Row = ({ label, value, bold, tone, children }) => (
    <div className="flex items-baseline justify-between py-1">
      <span className={`text-sm ${bold ? 'font-bold text-ink' : 'text-gray-600'}`}>{label} {children}</span>
      <span className={`tabular-nums ${bold ? 'font-bold' : ''} ${tone || 'text-ink'}`}>{money(value)}</span>
    </div>
  )

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="card p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Assets · as of {bs.as_of}</p>
        {bs.cash.accounts.length ? bs.cash.accounts.map((c) => (
          <Row key={c.account} label={`Cash — ${c.account}`} value={c.excluded ? 0 : c.balance}>
            <span className="text-[11px] text-gray-400">as of {c.as_of}</span>
          </Row>
        )) : (
          <div className="card p-3 bg-amber-50/60 border-amber-200 text-xs text-amber-800 mb-2">
            No captured statement balances yet — upload statements (or set balances) on <Link className="underline" to="/bank-statements">Bank Statements</Link> and Cash will fill in.
          </div>
        )}
        <Row label={`Accounts receivable (${bs.accounts_receivable.count})`} value={bs.accounts_receivable.total}>
          <LineRows line="ar" asOf={bs.as_of} toast={toast} onChanged={refetch} />
        </Row>
        <div className="border-t border-rule mt-2 pt-2"><Row label="Total assets" value={bs.total_assets} bold /></div>
      </div>

      <div className="card p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Liabilities & funding</p>
        <Row label={`Accounts payable (${bs.accounts_payable.count})`} value={bs.accounts_payable.total}>
          <LineRows line="ap" asOf={bs.as_of} toast={toast} onChanged={refetch} />
        </Row>
        {(bs.advances_outstanding.count > 0 || bs.advances_outstanding.total > 0) && (
          <Row label={`Advances outstanding (${bs.advances_outstanding.count})`} value={bs.advances_outstanding.total}>
            <LineRows line="adv" asOf={bs.as_of} toast={toast} onChanged={refetch} />
          </Row>
        )}
        <p className="text-[11px] text-gray-400 mb-1">{bs.advances_outstanding.note}</p>
        <div className="border-t border-rule mt-2 pt-2"><Row label="Total liabilities" value={bs.total_liabilities} bold /></div>
        <div className="border-t-2 border-rule mt-3 pt-2">
          <Row label="Net assets" value={bs.net_assets} bold tone={bs.net_assets >= 0 ? 'text-emerald-600' : 'text-rose-600'} />
        </div>
        <p className="text-[11px] text-gray-400 mt-3">
          Memo — {money(bs.memo.recoupable.total)} of recoupable artist spend across {bs.memo.recoupable.count} entries. {bs.memo.recoupable.note}.
        </p>
        {(bs.excluded.item_count > 0 || bs.excluded.lines.length > 0) && (
          <p className="text-[11px] text-amber-600 mt-2">
            {bs.excluded.item_count} item{bs.excluded.item_count === 1 ? '' : 's'} ({money(bs.excluded.item_total)}){bs.excluded.lines.length ? ` and ${bs.excluded.lines.length} whole line${bs.excluded.lines.length === 1 ? '' : 's'}` : ''} excluded by review.
          </p>
        )}
      </div>
    </div>
  )
}
