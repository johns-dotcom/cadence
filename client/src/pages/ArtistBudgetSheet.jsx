// One artist's spend sheet. The six blur-saved section inputs ARE the budget
// creation flow (line-item budget entry died three times in the reference
// app); setting a section to 0 deletes its row, so "no budget" and "a budget
// of nothing" stay one state and `unplanned` keeps meaning something.

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronRight, Download, Scale } from 'lucide-react'
import api from '../api'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'
import { money, moneyOrig } from '../utils/money'
import BankEvidenceDot from '../components/BankEvidenceDot'
import { STATE_LABEL, STATE_TONE } from '../utils/recoupState'

const CHIP = {
  verified: ['confirmed', 'bg-emerald-100 text-emerald-700'],
  awaiting: ['paid, not confirmed', 'bg-sky-100 text-sky-700'],
  unverified: ['no bank line', 'bg-rose-100 text-rose-700'],
  unpaid: ['unpaid', 'bg-gray-100 text-gray-500'],
}

function BudgetInput({ section, artistKey, onSaved, toast }) {
  const [v, setV] = useState(section.budget ? String(section.budget) : '')
  useEffect(() => { setV(section.budget ? String(section.budget) : '') }, [section.budget])
  const save = async () => {
    const n = Number(v || 0)
    if (!Number.isFinite(n) || n < 0) { setV(section.budget ? String(section.budget) : ''); return }
    if (n === (section.budget || 0)) return // save only when the number changed
    try {
      await api.put(`/artist-budgets/${artistKey}/${section.key}`, { amount: n, note: section.note })
      onSaved()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  return (
    <input
      className="input !py-1 !px-2 text-sm w-28 text-right tabular-nums"
      placeholder="—" value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
    />
  )
}

export default function ArtistBudgetSheet() {
  const { artistKey } = useParams()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [sheet, setSheet] = useState(null)
  const [open, setOpen] = useState({})

  const load = () => api.get(`/artist-budgets/${artistKey}`).then((r) => setSheet(r.data.data)).catch(() => toast('Failed to load', 'error'))
  useEffect(() => { load() }, [artistKey]) // eslint-disable-line

  const exportXlsx = async () => {
    try {
      const res = await api.get(`/artist-budgets/${artistKey}/export`, { responseType: 'blob' })
      const href = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = href; a.download = `artist-budget-${artistKey}.xlsx`; a.click()
      URL.revokeObjectURL(href)
    } catch { toast('Export failed', 'error') }
  }

  if (!sheet) return <div className="card p-6"><Skeleton.Block /></div>
  const t = sheet.totals

  return (
    <div>
      <button onClick={() => navigate('/artist-budgets')} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-ink mb-3"><ArrowLeft size={15} /> All artists</button>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-ink tracking-tight flex items-center gap-2"><Scale size={20} /> {sheet.artist}</h1>
          <p className="text-sm text-gray-400">The budget is six numbers — type them below; saving happens on blur.</p>
        </div>
        <button className="btn-secondary inline-flex items-center gap-1.5" onClick={exportXlsx}><Download size={14} /> Excel</button>
      </div>

      {/* Figures row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        <div className="card p-3"><p className="text-[10px] font-semibold uppercase text-gray-400">Budget</p><p className="text-xl font-bold text-ink">{t.budget ? money(t.budget) : '—'}</p></div>
        <div className="card p-3"><p className="text-[10px] font-semibold uppercase text-gray-400">Spent</p><p className="text-xl font-bold text-ink">{money(t.spent)}</p><p className="text-[10px] text-gray-400">left the bank</p></div>
        <div className="card p-3"><p className="text-[10px] font-semibold uppercase text-gray-400">Open</p><p className="text-xl font-bold text-amber-600">{money(t.open)}</p><p className="text-[10px] text-gray-400">unpaid invoices</p></div>
        <div className="card p-3"><p className="text-[10px] font-semibold uppercase text-gray-400">Committed</p><p className={`text-xl font-bold ${t.budget > 0 && t.committed > t.budget ? 'text-rose-600' : 'text-ink'}`}>{money(t.committed)}</p><p className="text-[10px] text-gray-400">spent + open</p></div>
        <div className="card p-3"><p className="text-[10px] font-semibold uppercase text-gray-400">Variance</p><p className={`text-xl font-bold ${t.budget > 0 ? (t.budget - t.spent < 0 ? 'text-rose-600' : 'text-emerald-600') : 'text-gray-300'}`}>{t.budget > 0 ? money(t.budget - t.spent) : '—'}</p><p className="text-[10px] text-gray-400">against spent</p></div>
      </div>

      {/* Sections */}
      <div className="card divide-y divide-divider">
        {sheet.sections.map((s) => (
          <div key={s.key} className="px-5 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <button className="flex items-center gap-1.5 text-sm font-bold text-ink min-w-[180px]" onClick={() => setOpen((o) => ({ ...o, [s.key]: !o[s.key] }))}>
                {open[s.key] ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                {s.label}
              </button>
              <BudgetInput section={s} artistKey={artistKey} onSaved={load} toast={toast} />
              <span className="tabular-nums text-sm text-ink w-28 text-right">{money(s.spent)} <span className="text-[10px] text-gray-400">spent</span></span>
              <span className={`tabular-nums text-sm w-28 text-right ${s.variance == null ? 'text-gray-300' : s.variance < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                {s.variance == null ? '—' : money(s.variance)}
              </span>
              {s.open > 0 && <span className="text-xs text-amber-600 tabular-nums">+ {money(s.open)} open</span>}
              {s.unplanned && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" title="Money was spent or committed here and no budget was set for it">unplanned</span>}
              {s.over_committed && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700" title="Within budget on spend, over it once the open invoices are paid">over-committed</span>}
              <span className="ml-auto text-xs text-gray-400">{s.items.length ? `${s.items.length} paid item${s.items.length === 1 ? '' : 's'}` : ''}</span>
            </div>
            {Object.keys(s.by_category).length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-gray-400 mt-1 ml-6">
                {Object.entries(s.by_category).map(([c, v]) => <span key={c}>{c}: <span className="text-gray-600 tabular-nums">{money(v)}</span></span>)}
              </div>
            )}
            {open[s.key] && (
              <div className="mt-2 ml-6 divide-y divide-divider">
                {s.items.map((it) => (
                  <div key={it.id} className="flex items-center gap-3 py-1.5 text-sm">
                    <BankEvidenceDot row={{ bank_evidence: it.bank_evidence, bank_expected: it.bank_expected, payment_status: it.state === 'unpaid' ? 'Unpaid' : 'Paid' }} />
                    <span className="text-xs text-gray-400 tabular-nums w-20 shrink-0">{it.date ? formatDate(it.date) : '—'}</span>
                    <Link to={`/ledger?focus=${it.id}`} className="flex-1 truncate text-ink hover:text-brand-600">{it.payee}</Link>
                    <span className="text-[11px] text-gray-400 truncate max-w-[140px]">{it.song || it.category}</span>
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${CHIP[it.state][1]}`}>{CHIP[it.state][0]}</span>
                    <span className="tabular-nums text-gray-600 w-24 text-right">{money(it.usd)}</span>
                  </div>
                ))}
                {!s.items.length && <p className="text-xs text-gray-400 py-1.5">Nothing paid in this section yet.</p>}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Open invoices — a worklist, oldest first */}
      {t.open > 0 && (
        <div className="card p-5 mt-4">
          <h3 className="text-sm font-bold text-ink mb-1">Open · unpaid invoices</h3>
          <p className="text-xs text-gray-400 mb-3">Counted in Committed, never in Spent. Oldest first — it is a worklist.</p>
          <div className="divide-y divide-divider">
            {sheet.sections.flatMap((s) => s.open_items.map((it) => ({ ...it, section: s.label }))).map((it) => {
              const age = it.invoice_date ? Math.max(0, Math.round((Date.now() - new Date(String(it.invoice_date).slice(0, 10)).getTime()) / 86400000)) : null
              return (
                <div key={it.id} className="flex items-center gap-3 py-1.5 text-sm">
                  <span className="text-xs text-gray-400 tabular-nums w-20 shrink-0">{it.invoice_date ? formatDate(it.invoice_date) : '—'}</span>
                  <Link to={`/ledger?focus=${it.id}`} className="flex-1 truncate text-ink hover:text-brand-600">{it.payee}</Link>
                  <span className="text-[11px] text-gray-400">{it.section}</span>
                  {age != null && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${age > 90 ? 'bg-rose-100 text-rose-700' : age > 30 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`} title={`Invoiced ${age} days ago and still unpaid`}>{age}d</span>}
                  <span className="tabular-nums text-gray-600 w-24 text-right">{money(it.usd)}</span>
                </div>
              )
            })}
          </div>
          <div className="flex justify-between border-t border-rule mt-2 pt-2 text-sm font-bold">
            <span>Committed — spent plus open</span>
            <span className={`tabular-nums ${t.budget > 0 && t.committed > t.budget ? 'text-rose-600' : 'text-ink'}`}>{money(t.committed)}</span>
          </div>
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-3">
        Every row carries a bank-evidence state: <span className={STATE_TONE.verified + ' px-1 rounded'}>{STATE_LABEL.verified}</span> is provable to a partner; <span className={STATE_TONE.awaiting_statement + ' px-1 rounded'}>{STATE_LABEL.awaiting_statement}</span> is normal; <span className={STATE_TONE.unverified + ' px-1 rounded'}>{STATE_LABEL.unverified}</span> is the only discrepancy. The sheet reports — it does not block an invoice for being over budget.
      </p>
    </div>
  )
}
