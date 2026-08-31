// The P&L grid. Month columns + Total; every valued cell (and each row
// total) drills. The frozen region is exactly ONE sticky cell per row —
// multiple sticky cells produce sub-pixel gaps that flicker (Ledger's rule).

import { useState } from 'react'
import { AlertTriangle, MoreHorizontal } from 'lucide-react'
import api from '../../api'
import { money } from '../../utils/money'
import { Modal, ConfirmDialog } from '../ui'
import useCategories from '../../hooks/useCategories'

const STICKY_TH = 'sticky left-0 z-20 bg-page shadow-[2px_0_5px_-2px_rgba(0,0,0,0.12)]'
const STICKY_TD = 'sticky left-0 z-10 bg-card shadow-[2px_0_5px_-2px_rgba(0,0,0,0.12)]'

function Cell({ value, onClick, dismissedBadge, negative }) {
  if (!value && !dismissedBadge) return <td className="px-3 py-1.5 text-right text-gray-300">—</td>
  return (
    <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
      {value ? (
        <button onClick={onClick} className={`hover:underline ${negative ? 'text-rose-600' : value < 0 ? 'text-emerald-600' : 'text-ink'}`}>
          {money(value)}
        </button>
      ) : <span className="text-gray-300">—</span>}
      {dismissedBadge ? <span className="ml-1 text-[10px] text-amber-600" title={`$${dismissedBadge.toFixed(2)} dismissed from this line`}>◦</span> : null}
    </td>
  )
}

function MonthHeader({ m, cov }) {
  return (
    <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">
      <span className="inline-flex items-center gap-1">
        {cov === null || cov === undefined ? (
          <span className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block" title="No bank statement data — expenses unverified" />
        ) : cov.pct < 85 ? (
          <AlertTriangle size={11} className="text-amber-500" title={`${cov.pct}% of bank debits reconciled — ${cov.open_n} open; expenses likely missing from this column`} />
        ) : null}
        {m}
      </span>
    </th>
  )
}

export default function PnlTable({ pnl, onDrill, refetch, toast }) {
  const months = pnl.months
  const cats = useCategories()
  const [kebab, setKebab] = useState(null) // { kind, name }
  const [renameTo, setRenameTo] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [classifyOpen, setClassifyOpen] = useState(false)
  const [section, setSection] = useState('operating')
  const [dismissLineOpen, setDismissLineOpen] = useState(false)
  const [movedOutOpen, setMovedOutOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const dismissedForCell = (kind, name) => pnl.dismissed.by_cell[`${kind}|${name}`]

  const lineRows = (bag, kind, negate = false) =>
    Object.entries(bag).map(([name, line]) => (
      <tr key={`${kind}-${name}`} className="group border-t border-divider">
        <td className={`px-3 py-1.5 text-sm ${STICKY_TD}`}>
          <span className="flex items-center gap-1">
            <span className="truncate">{name}</span>
            <button
              onClick={() => { setKebab({ kind, name }); setRenameTo(name) }}
              className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-ink"
              title="Line actions"
            ><MoreHorizontal size={13} /></button>
          </span>
        </td>
        {months.map((m) => (
          <Cell key={m} value={negate ? -(line.series[m] || 0) : (line.series[m] || 0)} negative={negate}
            onClick={() => onDrill({ kind, key: name, month: m, label: `${name} · ${m}`, cellTotal: line.series[m] || 0 })} />
        ))}
        <Cell value={negate ? -line.total : line.total} negative={negate}
          dismissedBadge={dismissedForCell(kind, name)}
          onClick={() => onDrill({ kind, key: name, month: null, label: `${name} · ${months[0]} – ${months[months.length - 1]}`, cellTotal: line.total })} />
      </tr>
    ))

  const totalRow = (label, totals, tone = 'text-ink') => (
    <tr className="border-t-2 border-rule font-bold">
      <td className={`px-3 py-2 text-sm ${STICKY_TD}`}>{label}</td>
      {months.map((m) => (
        <td key={m} className={`px-3 py-2 text-right tabular-nums ${typeof totals.series[m] === 'number' && totals.series[m] < 0 ? 'text-rose-600' : tone}`}>
          {money(totals.series[m] || 0)}
        </td>
      ))}
      <td className={`px-3 py-2 text-right tabular-nums ${totals.total < 0 ? 'text-rose-600' : tone}`}>{money(totals.total)}</td>
    </tr>
  )

  const netSeries = {}
  for (const m of months) netSeries[m] = (pnl.income_totals.series[m] || 0) - (pnl.expense_totals.series[m] || 0)
  const belowNetSeries = {}
  for (const m of months) belowNetSeries[m] = (pnl.below.income_totals.series[m] || 0) - (pnl.below.expense_totals.series[m] || 0)
  const cashSeries = {}
  for (const m of months) cashSeries[m] = netSeries[m] + belowNetSeries[m]
  const hasBelow = Object.keys(pnl.below.income).length > 0 || Object.keys(pnl.below.expenses).length > 0

  const doDismissLine = async () => {
    setBusy(true)
    try {
      await api.post('/reports/dismiss', { scope: 'category', cell_kind: kebab.kind, cell_key: kebab.name })
      toast(`"${kebab.name}" excluded from Reports`)
      setDismissLineOpen(false); setKebab(null); refetch()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') } finally { setBusy(false) }
  }
  const doRename = async () => {
    setBusy(true)
    try {
      const r = await api.post('/reports/rename-category', { kind: kebab.kind, from: kebab.name, to: renameTo })
      toast(r.data.data.merged ? `Merged into "${renameTo}"` : `Renamed to "${renameTo}"`)
      setRenameOpen(false); setKebab(null); refetch()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') } finally { setBusy(false) }
  }
  const doClassify = async () => {
    setBusy(true)
    try {
      await api.post('/reports/classify', { kind: kebab.kind, category: kebab.name, section })
      toast(`"${kebab.name}" → ${section.replace('_', ' ')}`)
      setClassifyOpen(false); setKebab(null); refetch()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') } finally { setBusy(false) }
  }

  return (
    <div>
      {/* Disclosure banners — exclusions move totals, so they are said out loud. */}
      {(pnl.dismissed.count > 0 || pnl.dismissed.category_count > 0) && (
        <div className="card px-4 py-2.5 mb-3 border-amber-200 bg-amber-50/60 text-sm text-amber-800">
          {money(pnl.dismissed.total)} is dismissed and not counted below — {pnl.dismissed.category_count} whole line{pnl.dismissed.category_count === 1 ? '' : 's'} and {pnl.dismissed.item_count} individual item{pnl.dismissed.item_count === 1 ? '' : 's'}. Review them on the Dismissed tab.
        </div>
      )}
      {pnl.reassigned.count > 0 && (
        <div className="card px-4 py-2.5 mb-3 border-indigo-200 bg-indigo-50/60 text-sm text-indigo-800">
          {pnl.reassigned.count} item{pnl.reassigned.count === 1 ? ' is' : 's are'} reported in a different month than paid — {money(pnl.reassigned.total)} moved between columns.
        </div>
      )}
      {pnl.reassigned.moved_out.count > 0 && (
        <div className="card px-4 py-2.5 mb-3 border-violet-200 bg-violet-50/60 text-sm text-violet-800">
          <button className="underline" onClick={() => setMovedOutOpen((v) => !v)}>
            {pnl.reassigned.moved_out.count} item{pnl.reassigned.moved_out.count === 1 ? '' : 's'} ({money(pnl.reassigned.moved_out.total)}) moved OUTSIDE this date range and are in no total below.
          </button>
          {movedOutOpen && (
            <div className="mt-2 space-y-1">
              {pnl.reassigned.moved_out.rows.map((r, i) => (
                <div key={i} className="text-xs flex gap-2">
                  <span className="tabular-nums">{r.date}</span><span className="flex-1 truncate">{r.payee || '—'}</span>
                  <span className="tabular-nums">{money(r.usd)}</span><span>{r.from_month} → {r.to_month}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {pnl.contra.map((c) => (
        <div key={`${c.income_type}-${c.target}`} className="card px-4 py-2 mb-3 text-xs text-gray-500">
          {c.target} is shown net of {money(c.total)} recovered ({c.income_type}).
        </div>
      ))}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-400">
              <th className={`px-3 py-2 text-left font-semibold min-w-[180px] ${STICKY_TH}`}></th>
              {months.map((m) => <MonthHeader key={m} m={m} cov={pnl.coverage[m]} />)}
              <th className="px-3 py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className={`px-3 pt-3 pb-1 text-xs font-bold uppercase tracking-wide text-gray-400 ${STICKY_TD}`}>Income</td>{months.map((m) => <td key={m} />)}<td /></tr>
            {lineRows(pnl.income, 'income')}
            {totalRow('Total Income', pnl.income_totals)}
            <tr><td className={`px-3 pt-4 pb-1 text-xs font-bold uppercase tracking-wide text-gray-400 ${STICKY_TD}`}>Expenses</td>{months.map((m) => <td key={m} />)}<td /></tr>
            {lineRows(pnl.expenses, 'expense')}
            {totalRow('Total Expenses', pnl.expense_totals)}
            {totalRow('Net Income (operating)', { series: netSeries, total: pnl.net }, pnl.net >= 0 ? 'text-emerald-600' : 'text-rose-600')}
            {hasBelow && (
              <>
                <tr><td className={`px-3 pt-4 pb-1 text-xs font-bold uppercase tracking-wide text-gray-400 ${STICKY_TD}`}>Below the line — advances & pass-through</td>{months.map((m) => <td key={m} />)}<td /></tr>
                {lineRows(pnl.below.income, 'income')}
                {lineRows(pnl.below.expenses, 'expense', true)}
                {totalRow('Below-line net', { series: belowNetSeries, total: pnl.below.net }, 'text-gray-500')}
                {totalRow('Net Change in Cash', { series: cashSeries, total: pnl.net + pnl.below.net }, (pnl.net + pnl.below.net) >= 0 ? 'text-emerald-600' : 'text-rose-600')}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Line kebab actions */}
      <Modal open={!!kebab && !renameOpen && !classifyOpen && !dismissLineOpen} onClose={() => setKebab(null)} title={kebab ? `"${kebab.name}"` : ''} size="sm">
        <div className="space-y-2">
          <button className="btn-secondary w-full" onClick={() => setRenameOpen(true)}>Rename / merge line…</button>
          <button className="btn-secondary w-full" onClick={() => setClassifyOpen(true)}>Reclassify section…</button>
          <button className="btn-secondary w-full !text-rose-600" onClick={() => setDismissLineOpen(true)}>Dismiss whole line from Reports…</button>
        </div>
      </Modal>
      <Modal open={renameOpen} onClose={() => setRenameOpen(false)} title={`Rename "${kebab?.name}"`} size="sm"
        footer={<><button className="btn-secondary" onClick={() => setRenameOpen(false)}>Cancel</button><button className="btn-primary" disabled={busy || !renameTo.trim()} onClick={doRename}>{busy ? 'Working…' : 'Rename'}</button></>}>
        <p className="text-xs text-ink-muted mb-2">Renames every row carrying this name — ledger, booking rules, dismissal rules. Renaming onto an existing line merges them.</p>
        <input className="input" value={renameTo} onChange={(e) => setRenameTo(e.target.value)} list="rename-cats" />
        <datalist id="rename-cats">{(kebab?.kind === 'income' ? cats.income : cats.expense).map((c) => <option key={c} value={c} />)}</datalist>
      </Modal>
      <Modal open={classifyOpen} onClose={() => setClassifyOpen(false)} title={`Reclassify "${kebab?.name}"`} size="sm"
        footer={<><button className="btn-secondary" onClick={() => setClassifyOpen(false)}>Cancel</button><button className="btn-primary" disabled={busy} onClick={doClassify}>{busy ? 'Working…' : 'Save'}</button></>}>
        <p className="text-xs text-ink-muted mb-2">Below-the-line keeps advances and pass-through out of operating results — a $700k drawdown month must not read as a record month.</p>
        <select className="input" value={section} onChange={(e) => setSection(e.target.value)}>
          <option value="operating">Operating</option>
          <option value="below_line">Below the line</option>
          <option value="non_recurring">Non-recurring</option>
        </select>
      </Modal>
      <ConfirmDialog open={dismissLineOpen} onClose={() => setDismissLineOpen(false)} onConfirm={doDismissLine} busy={busy}
        title={`Dismiss "${kebab?.name}"?`} confirmLabel="Dismiss line"
        message="The whole line — and anything booked to it later — is excluded from every report total, with the exclusion disclosed in a banner. Restore it any time from the Dismissed tab." />
    </div>
  )
}
