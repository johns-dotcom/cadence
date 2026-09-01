// One artist's spend sheet. The six blur-saved section inputs ARE the budget
// creation flow (line-item budget entry died three times in the reference
// app); setting a section to 0 deletes its row, so "no budget" and "a budget
// of nothing" stay one state and `unplanned` keeps meaning something.
//
// It is ONE TABLE on purpose: section rows, category rows and expense rows
// share the same columns, so a figure at any depth lines up with the figure
// above it and the SPENT band at the foot is visibly the sum of the column.

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Download, Loader, RefreshCw, Scale } from 'lucide-react'
import api from '../api'
import Skeleton from '../components/Skeleton'
import BankEvidenceDot from '../components/BankEvidenceDot'
import PayeeLink from '../components/PayeeLink'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'
import { money, moneyOrig } from '../utils/money'
import { STATE_TONE } from '../utils/statements'

// The four states in this sheet's own words. `stateOf` on the server emits
// `awaiting`; the shared tone map keys it `awaiting_statement`.
const STATE = {
  verified: { key: 'verified', label: 'confirmed on a statement', tip: 'A ready bank statement shows this payment — provable to a partner.' },
  awaiting: { key: 'awaiting_statement', label: 'paid, statement not in yet', tip: 'Paid, and no ready statement covers the date yet. Normal, not a problem.' },
  unverified: { key: 'unverified', label: 'paid — no bank line', tip: 'Paid, a statement DOES cover the date, and no line matches. The only discrepancy state.' },
  unpaid: { key: 'unpaid', label: 'unpaid', tip: 'Nothing has left the bank. Counted in Committed, never in Spent.' },
}

// How long an open invoice has been sitting. Anchored at noon UTC so a
// date-only string does not read as the previous day west of Greenwich, and
// SUPPRESSED under 30 days — an invoice a fortnight old is not news, and a
// chip on every row is a chip nobody reads.
function Age({ date }) {
  if (!date) return null
  const d = new Date(`${String(date).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days < 30) return null
  return (
    <span className={`ml-1.5 text-[10px] font-bold ${days >= 90 ? 'text-danger' : 'text-warning'}`}
      title={`Invoiced ${days} days ago and still unpaid`}>{days}d</span>
  )
}

// The budget cell. Six of these are the whole budget, so it reads as a sheet
// cell — transparent until you go near it — rather than as a form field.
function BudgetInput({ section, onSave, saving }) {
  const [v, setV] = useState(section.budget ? String(section.budget) : '')
  useEffect(() => { setV(section.budget ? String(section.budget) : '') }, [section.budget])
  return (
    <span className="inline-flex items-center gap-1 justify-end">
      {saving && <Loader size={11} className="animate-spin text-ink-faint" />}
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => onSave(v, () => setV(section.budget ? String(section.budget) : ''))}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        inputMode="decimal"
        placeholder="—"
        title={section.updated_by_name ? `Set by ${section.updated_by_name}` : 'Type a budget for this section'}
        className="w-24 px-1.5 py-0.5 text-right text-[12.5px] tabular-nums bg-transparent border border-transparent rounded hover:border-rule focus:border-brand-500 focus:bg-card focus:outline-none text-ink"
      />
    </span>
  )
}

// The per-section note. It already existed in the schema and in the workbook's
// Note column and had no way in — a field only an export can read is a field
// nobody fills.
function NoteInput({ section, onSave }) {
  const [v, setV] = useState(section.note || '')
  useEffect(() => { setV(section.note || '') }, [section.note])
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onSave(v)}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      maxLength={500}
      placeholder="note…"
      title="Rides along into the exported workbook's Note column"
      className="w-full px-1.5 py-0.5 text-[11.5px] bg-transparent border border-transparent rounded hover:border-rule focus:border-brand-500 focus:bg-card focus:outline-none text-ink-muted"
    />
  )
}

export default function ArtistBudgetSheet() {
  const { artistKey } = useParams()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [sheet, setSheet] = useState(null)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState({})
  const [saving, setSaving] = useState(null)

  const load = () => {
    setError(null)
    return api.get(`/artist-budgets/${artistKey}`)
      .then((r) => setSheet(r.data.data))
      .catch((err) => setError(err.response?.data?.error || 'Failed to load'))
  }
  useEffect(() => { load() }, [artistKey]) // eslint-disable-line

  // Save on blur ONLY when the number changed; zero with no note deletes the
  // row. An unusable value says so instead of silently snapping back, which
  // reads as the sheet having eaten the keystrokes.
  const saveBudget = (section) => async (raw, revert) => {
    const n = Number(raw || 0)
    if (!Number.isFinite(n) || n < 0) { toast('A budget is zero or more', 'error'); revert(); return }
    if (n === (section.budget || 0)) return
    setSaving(section.key)
    try {
      await api.put(`/artist-budgets/${artistKey}/${section.key}`, { amount: n, note: section.note })
      await load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error'); revert() }
    finally { setSaving(null) }
  }
  const saveNote = (section) => async (raw) => {
    const note = String(raw || '').trim()
    if (note === (section.note || '')) return
    setSaving(section.key)
    try {
      await api.put(`/artist-budgets/${artistKey}/${section.key}`, { amount: section.budget || 0, note })
      await load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setSaving(null) }
  }

  const exportXlsx = async () => {
    try {
      const res = await api.get(`/artist-budgets/${artistKey}/export`, { responseType: 'blob' })
      // The server names the file after the artist's DISPLAY spelling; take its
      // name rather than re-deriving one from the mangled key in the URL.
      const cd = res.headers?.['content-disposition'] || ''
      const named = /filename="?([^"]+)"?/.exec(cd)?.[1]
      const href = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = href; a.download = named || `${sheet?.artist || artistKey} - budget vs actual.xlsx`; a.click()
      URL.revokeObjectURL(href)
    } catch { toast('Export failed', 'error') }
  }

  if (error) return (
    <div className="card p-8 text-center">
      <AlertTriangle size={26} className="text-warning mx-auto mb-3" />
      <p className="text-sm text-ink">Couldn't load this spend sheet</p>
      <p className="text-xs text-ink-muted mt-1">{error}</p>
      <div className="flex items-center justify-center gap-2 mt-4">
        <button className="btn-secondary inline-flex items-center gap-1.5" onClick={load}><RefreshCw size={14} /> Retry</button>
        <Link to="/artist-budgets" className="btn-secondary inline-flex items-center gap-1.5"><ArrowLeft size={14} /> All sheets</Link>
      </div>
    </div>
  )
  if (!sheet) return <div className="card p-6"><Skeleton.Block /></div>
  const t = sheet.totals

  return (
    <div>
      <button onClick={() => navigate('/artist-budgets')} className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink mb-3"><ArrowLeft size={15} /> All artists</button>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-ink tracking-tight flex items-center gap-2"><Scale size={20} /> {sheet.artist}</h1>
          <p className="text-sm text-ink-muted">Budget by section, with every expense matched to it by its category. Saving happens on blur.</p>
        </div>
        <button className="btn-secondary inline-flex items-center gap-1.5" onClick={exportXlsx}><Download size={14} /> Excel</button>
      </div>

      {/* The headline, and the honest split under it. */}
      <div className="card p-4 mb-4">
        <div className="flex items-baseline gap-8 flex-wrap">
          <Figure label="Budget" value={t.budget} display={t.budget ? undefined : '—'} cls={t.budget ? 'text-ink' : 'text-ink-faint'} />
          <Figure label="Spent" value={t.spent} sub="left the bank" />
          {t.open > 0 && <Figure label="Open" value={t.open} cls="text-warning" sub={`${t.open_count} unpaid invoice${t.open_count === 1 ? '' : 's'}`} />}
          <Figure label="Committed" value={t.committed} cls={t.over_committed ? 'text-danger' : 'text-ink'} sub="spent + open" />
          <Figure label="Variance" value={t.variance} display={t.budget ? undefined : '—'}
            cls={!t.budget ? 'text-ink-faint' : t.variance < 0 ? 'text-danger' : 'text-success'} sub="against spent" />
        </div>
        {t.over_committed && (
          <p className="mt-2 text-[11.5px] text-danger inline-flex items-center gap-1">
            <AlertTriangle size={11} /> Within budget on what has been spent, but over it once the open invoices are paid.
          </p>
        )}
        {t.spent > 0 && (
          <div className="mt-3 pt-3 border-t border-divider flex items-center gap-4 flex-wrap text-[11.5px]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">of what has been spent</span>
            {[['verified', t.verified], ['awaiting', t.awaiting], ['unverified', t.unverified]]
              .filter(([, v]) => v > 0)
              .map(([k, v]) => (
                <span key={k} className={STATE_TONE[STATE[k].key].text} title={STATE[k].tip}>
                  <b className="tabular-nums">{money(v)}</b> {STATE[k].label}
                </span>
              ))}
            {t.unverified > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-danger">
                <AlertTriangle size={11} /> a payment with no bank line behind it
              </span>
            )}
          </div>
        )}
      </div>

      {/* The sheet. */}
      <div className="card overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-rule text-[10px] font-bold uppercase tracking-wider text-ink-faint">
              <th className="text-left px-3 py-2">Section</th>
              <th className="text-right px-3 py-2 w-32">Budget</th>
              <th className="text-right px-3 py-2 w-32">Spent</th>
              <th className="text-right px-3 py-2 w-32">Variance</th>
              <th className="text-left px-3 py-2 w-56">Note</th>
              <th className="px-3 py-2 w-24" />
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {sheet.sections.map((s) => {
              const isOpen = !!open[s.key]
              // A section with neither a budget nor spend is not part of this
              // artist's picture. Dimmed, not removed — its input is still live,
              // and that input is how a budget gets set in the first place.
              if (!s.budget && !s.committed) {
                return (
                  <tr key={s.key} className="text-ink-faint">
                    <td className="px-3 py-1.5">{s.label}</td>
                    <td className="px-3 py-1.5 text-right"><BudgetInput section={s} onSave={saveBudget(s)} saving={saving === s.key} /></td>
                    <td className="px-3 py-1.5 text-right">—</td>
                    <td className="px-3 py-1.5 text-right">—</td>
                    <td className="px-3 py-1.5"><NoteInput section={s} onSave={saveNote(s)} /></td>
                    <td />
                  </tr>
                )
              }
              return [
                <tr key={s.key} className="bg-elev">
                  <td className="px-3 py-2 font-bold text-ink">
                    {s.label}
                    {s.unplanned && <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-warning" title="Money was spent or committed in this section and no budget was set for it">unplanned</span>}
                    {s.over_committed && <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-danger" title="Within budget on spend, over it once the open invoices are paid">over-committed</span>}
                  </td>
                  <td className="px-3 py-2 text-right"><BudgetInput section={s} onSave={saveBudget(s)} saving={saving === s.key} /></td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold text-ink">
                    {money(s.spent)}
                    {s.open > 0 && <span className="block text-[10px] font-normal text-warning" title="Open invoices in this section — not spent yet, listed below">+ {money(s.open)} open</span>}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums font-bold ${s.variance == null ? 'text-ink-faint' : s.variance < 0 ? 'text-danger' : 'text-success'}`}>
                    {s.variance == null ? '—' : money(s.variance)}
                  </td>
                  <td className="px-3 py-2"><NoteInput section={s} onSave={saveNote(s)} /></td>
                  <td className="px-3 py-2 text-right">
                    {s.count > 0 && (
                      <button type="button" onClick={() => setOpen((o) => ({ ...o, [s.key]: !o[s.key] }))} className="text-[11px] font-bold text-ink-faint hover:text-ink">
                        {isOpen ? 'hide' : `${s.count} paid item${s.count === 1 ? '' : 's'}`}
                      </button>
                    )}
                  </td>
                </tr>,
                // Categories are always visible under their section — this is
                // the "organized" half of the sheet, and they sum to SPENT.
                ...s.categories.map((c) => (
                  <tr key={`${s.key}:${c.category}`} className="text-ink-muted">
                    <td className="px-3 py-1 pl-8">{c.category}</td>
                    <td />
                    <td className="px-3 py-1 text-right tabular-nums">{money(c.actual)}</td>
                    <td />
                    <td />
                    <td className="px-3 py-1 text-right text-[10.5px] text-ink-faint">{c.count}</td>
                  </tr>
                )),
                ...(isOpen ? s.items.map((it) => (
                  <tr key={`r${it.id}`} className="bg-page text-[11.5px]">
                    <td className="px-3 py-1 pl-12">
                      <span className="inline-flex items-center gap-1.5">
                        <BankEvidenceDot row={{ bank_evidence: it.bank_evidence, bank_expected: it.bank_expected, payment_status: 'Paid' }} />
                        <PayeeLink payee={it.payee} className="text-ink" />
                        {it.song && <span className="text-ink-faint">· {it.song}</span>}
                      </span>
                    </td>
                    <td className="px-3 py-1 text-right text-ink-faint tabular-nums whitespace-nowrap">{it.date ? formatDate(it.date) : '—'}</td>
                    <td className="px-3 py-1 text-right tabular-nums text-ink-muted whitespace-nowrap">
                      {money(it.usd)}
                      {it.currency && it.currency !== 'USD' && <span className="text-ink-faint"> ({moneyOrig(it.amount, it.currency)})</span>}
                    </td>
                    <td className={`px-3 py-1 text-right ${STATE_TONE[STATE[it.state].key].text}`} title={STATE[it.state].tip}>{STATE[it.state].label}</td>
                    <td /><td />
                  </tr>
                )) : []),
              ]
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-rule font-bold">
              <td className="px-3 py-2 text-ink">SPENT</td>
              <td className="px-3 py-2 text-right tabular-nums text-ink">{t.budget ? money(t.budget) : '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums text-ink">{money(t.spent)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${t.variance == null ? 'text-ink-faint' : t.variance < 0 ? 'text-danger' : 'text-success'}`}>
                {t.variance == null ? '—' : money(t.variance)}
              </td>
              <td />
              <td className="px-3 py-2 text-right text-[10.5px] text-ink-faint">{t.count}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Open, unpaid invoices ──────────────────────────────────────────
          Money the label has agreed to pay and has not. Deliberately OUTSIDE
          the spend figure above: an invoice sitting in a drawer is not an
          expenditure. Oldest first ACROSS the whole sheet — the ordering comes
          from the server, because a per-section flatMap orders by section and
          the copy here promises otherwise. */}
      {sheet.open_rows.length > 0 && (
        <div className="card overflow-hidden mt-4">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-rule flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wider text-warning">Open · unpaid invoices</span>
            <span className="text-[11px] text-ink-faint tabular-nums">
              {sheet.open_rows.length} invoice{sheet.open_rows.length === 1 ? '' : 's'} · still to pay · oldest first
            </span>
            <span className="ml-auto text-[15px] font-black tabular-nums text-warning">{money(t.open)}</span>
          </div>
          <table className="w-full text-[12px]">
            <tbody className="divide-y divide-divider">
              {sheet.open_rows.map((it) => (
                <tr key={`o${it.id}`} className="hover:bg-elev">
                  <td className="px-3 py-1.5">
                    <PayeeLink payee={it.payee} className="font-bold text-ink" />
                    {it.song && <span className="text-ink-faint"> · {it.song}</span>}
                  </td>
                  <td className="px-3 py-1.5 text-ink-muted">{it.category || '—'}</td>
                  <td className="px-3 py-1.5 text-right text-ink-faint tabular-nums whitespace-nowrap">
                    {it.invoice_date ? formatDate(it.invoice_date) : '—'}
                    <Age date={it.invoice_date} />
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-bold text-ink w-32">{money(it.usd)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-rule font-bold">
                <td className="px-3 py-2 text-ink" colSpan={3}>STILL TO PAY</td>
                <td className="px-3 py-2 text-right tabular-nums text-warning">{money(t.open)}</td>
              </tr>
              <tr className="border-t border-divider">
                <td className="px-3 py-2 text-ink-muted" colSpan={3}>Committed — spent plus open</td>
                <td className={`px-3 py-2 text-right tabular-nums font-black ${t.over_committed ? 'text-danger' : 'text-ink'}`}>{money(t.committed)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-[11px] text-ink-faint mt-3">
        Expenses land in a section by their category — nothing is assigned by hand. A section you have not
        budgeted still shows its spend, marked unplanned. Spent is money that has left the bank; open invoices
        are counted separately and added into the committed total. Every row carries a bank-evidence state:{' '}
        <span className={`${STATE_TONE.verified.chip} px-1 rounded`}>confirmed</span> is provable to a partner;{' '}
        <span className={`${STATE_TONE.awaiting_statement.chip} px-1 rounded`}>statement not in yet</span> is normal;{' '}
        <span className={`${STATE_TONE.unverified.chip} px-1 rounded`}>no bank line</span> is the only discrepancy.
        The sheet reports — it does not block an invoice for being over budget.
      </p>
    </div>
  )
}

function Figure({ label, value, cls, sub, display }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">{label}</div>
      <div className={`text-[20px] font-black tabular-nums ${cls || 'text-ink'}`}>{display ?? money(value)}</div>
      {sub && <div className="text-[10px] text-ink-faint">{sub}</div>}
    </div>
  )
}
