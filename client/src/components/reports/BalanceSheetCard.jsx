// Balance Sheet — cash from captured statement balances, A/R from outbound
// invoices, A/P from approved unpaid ledger entries (as-of-aware).
//
// Drawdowns are FUNDING, not debt. Counting them as liabilities produced the
// "$5.49M of liabilities and a meaningless equity figure" sheet in the
// reference app; per John's 2026-08-07 call, Liabilities is unpaid bills only
// and the money that funded the label gets its own "Funded by" block with the
// accumulated deficit it has been spent into. That block is a presentation,
// not a proof — the deficit is derived, so it balances by construction.
//
// Per-line and per-item exclusions, both disclosed.

import { useState } from 'react'
import { Ban, Undo2 } from 'lucide-react'
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

// Aging strip — how OLD the money is. The line total says how much; only the
// buckets say whether it is a timing question or a collection problem.
function Aging({ aging }) {
  if (!aging) return null
  const parts = [['Current', 'current'], ['31–60', 'd31_60'], ['61–90', 'd61_90'], ['90+', 'd90_plus']]
  if (!parts.some(([, k]) => Math.abs(aging[k] || 0) >= 0.005)) return null
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-muted mt-0.5 mb-1">
      {parts.map(([l, k]) => (
        <span key={k} className={k === 'd90_plus' && (aging[k] || 0) > 0 ? 'text-danger' : ''}>
          {l} <span className="tabular-nums">{money(aging[k] || 0)}</span>
        </span>
      ))}
    </div>
  )
}

// Composition — built from the same filtered rows as the line total, so the
// parts sum to the line rather than to a second query's opinion of it.
function Composition({ label, items }) {
  const [open, setOpen] = useState(false)
  if (!items?.length) return null
  return (
    <div className="mb-1">
      <button className="text-[11px] text-ink-muted underline" onClick={() => setOpen((v) => !v)}>
        {open ? 'hide' : 'show'} {label}
      </button>
      {open && (
        <div className="mt-1 space-y-0.5">
          {items.map((i) => (
            <div key={i.key} className="flex items-center gap-2 text-[11px]">
              <span className="flex-1 truncate text-ink-muted">{i.key}</span>
              <span className="tabular-nums text-ink">{money(i.usd)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
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

  // Whole-line exclusion. The server has supported `bs_line` since the report
  // was built and the Dismissed tab could restore one, but there was no way to
  // exclude a line FROM the sheet — so an excluded line was unreachable from
  // the only page that shows it.
  const toggleLine = async (key, excluded) => {
    try {
      if (excluded) await api.post('/reports/dismiss/restore', { scope: 'bs_line', cell_key: key })
      else await api.post('/reports/dismiss', { scope: 'bs_line', cell_key: key })
      refetch()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const Row = ({ label, value, bold, tone, lineKey, excluded, children }) => (
    <div className="group flex items-baseline justify-between py-1">
      <span className={`text-sm ${bold ? 'font-bold text-ink' : 'text-ink-muted'} ${excluded ? 'line-through opacity-50' : ''}`}>
        {label} {children}
        {lineKey && (
          <button
            onClick={() => toggleLine(lineKey, excluded)}
            className={`ml-1.5 align-middle ${excluded ? 'text-warning' : 'opacity-0 group-hover:opacity-100 text-ink-faint hover:text-danger'}`}
            title={excluded ? 'Put this line back into the balance sheet' : 'Exclude this whole line from the balance sheet'}
          >{excluded ? <Undo2 size={12} /> : <Ban size={12} />}</button>
        )}
      </span>
      <span className={`tabular-nums ${bold ? 'font-bold' : ''} ${tone || 'text-ink'}`}>{money(value)}</span>
    </div>
  )

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="card p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Assets · as of {bs.as_of}</p>
        {bs.cash.accounts.length ? bs.cash.accounts.map((c) => (
          <Row key={c.account} label={`Cash — ${c.account}`} value={c.excluded ? 0 : c.balance}
            lineKey={c.line_key} excluded={c.excluded}>
            <span className="text-[11px] text-ink-faint">as of {c.as_of}</span>
          </Row>
        )) : (
          <div className="card p-3 bg-amber-50/60 border-amber-200 text-xs text-amber-800 mb-2">
            No captured statement balances yet — upload statements (or set balances) on <Link className="underline" to="/bank-statements">Bank Statements</Link> and Cash will fill in.
          </div>
        )}
        <Row label={`Accounts receivable (${bs.accounts_receivable.count})`} value={bs.accounts_receivable.total}
          lineKey="accounts_receivable" excluded={bs.accounts_receivable.line_excluded}>
          <LineRows line="ar" asOf={bs.as_of} toast={toast} onChanged={refetch} />
        </Row>
        <Aging aging={bs.accounts_receivable.aging} />
        <Composition label="A/R by client" items={bs.accounts_receivable.composition} />
        {bs.accounts_receivable.note && <p className="text-[11px] text-ink-faint mb-1">{bs.accounts_receivable.note}.</p>}
        <div className="border-t border-rule mt-2 pt-2"><Row label="Total assets" value={bs.total_assets} bold /></div>
      </div>

      <div className="card p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-2">Liabilities</p>
        <Row label={`Accounts payable (${bs.accounts_payable.count})`} value={bs.accounts_payable.total}
          lineKey="accounts_payable" excluded={bs.accounts_payable.line_excluded}>
          <LineRows line="ap" asOf={bs.as_of} toast={toast} onChanged={refetch} />
        </Row>
        <Aging aging={bs.accounts_payable.aging} />
        <Composition label="A/P by category" items={bs.accounts_payable.composition} />
        {bs.accounts_payable.undated_paid?.count > 0 && (
          <p className="text-[11px] text-warning mb-1">
            {bs.accounts_payable.undated_paid.count} paid bill{bs.accounts_payable.undated_paid.count === 1 ? '' : 's'} ({money(bs.accounts_payable.undated_paid.total)}) have no payment date and cannot be placed in time — excluded from this as-of view.
          </p>
        )}
        <div className="border-t border-rule mt-2 pt-2"><Row label="Total liabilities" value={bs.total_liabilities} bold /></div>
        <div className="border-t-2 border-rule mt-3 pt-2">
          <Row label="Net assets" value={bs.net_assets} bold tone={bs.net_assets >= 0 ? 'text-success' : 'text-danger'} />
        </div>

        {/* Funded by — where the money came from, held apart from what is owed. */}
        {bs.funding && !bs.funding.line_excluded ? (
          <div className="mt-4 pt-3 border-t border-rule">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
              Funded by
              <button onClick={() => toggleLine('funding', false)} className="ml-1.5 align-middle text-ink-faint hover:text-danger" title="Hide the Funded by block"><Ban size={12} /></button>
            </p>
            <Row label={`Drawdowns received (${bs.advances_outstanding.count})`} value={bs.funding.drawdowns}
              lineKey="advances_outstanding" excluded={bs.advances_outstanding.line_excluded}>
              <LineRows line="adv" asOf={bs.as_of} toast={toast} onChanged={refetch} />
            </Row>
            <Composition label="drawdowns by artist" items={bs.funding.composition} />
            <Row label="Accumulated deficit" value={bs.funding.accumulated_deficit}
              tone={bs.funding.accumulated_deficit < 0 ? 'text-danger' : 'text-ink'} />
            <div className="border-t border-rule mt-1 pt-1"><Row label="Total funding" value={bs.funding.total} bold /></div>
            <p className="text-[11px] text-ink-faint mt-1">{bs.funding.note}. Drawdowns are {bs.advances_outstanding.note}.</p>
          </div>
        ) : bs.funding ? (
          <p className="text-[11px] text-ink-muted mt-4">
            The “Funded by” block is hidden.{' '}
            <button className="underline" onClick={() => toggleLine('funding', true)}>Show Funded by</button>
          </p>
        ) : null}
        <p className="text-[11px] text-ink-faint mt-3">
          Memo — {money(bs.memo.recoupable.total)} of recoupable artist spend across {bs.memo.recoupable.count} entries. {bs.memo.recoupable.note}.
        </p>
        {(bs.excluded.item_count > 0 || bs.excluded.lines.length > 0) && (
          <p className="text-[11px] text-warning mt-2">
            {bs.excluded.item_count} item{bs.excluded.item_count === 1 ? '' : 's'} ({money(bs.excluded.item_total)}){bs.excluded.lines.length ? ` and ${bs.excluded.lines.length} whole line${bs.excluded.lines.length === 1 ? '' : 's'}` : ''} excluded by review.
          </p>
        )}
      </div>
    </div>
  )
}
