// Bookkeeper Reconcile — diff the ledger against an outside bookkeeper's
// spreadsheet, and produce what goes back to them.
//
// NOT bank matching. /bank-matching reconciles bank statement lines against the
// ledger; this reconciles the ledger against a third dataset nothing else in
// the app ingests — a file a human uploads. The header says so out loud,
// because "matching" is otherwise ambiguous on this app's nav.
//
// Nothing is persisted. The diff lives for as long as this page is open,
// because a saved diff of a workbook we do not control is stale the moment
// either side edits a row.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileSpreadsheet, Loader, Download, Package, AlertTriangle, Info, ArrowRight } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Dropzone from '../components/Dropzone'
import PayeeLink from '../components/PayeeLink'
import { useToast } from '../context/ToastContext'
import { money } from '../utils/money'

const MAX_MB = 10

// One tag per issue kind, parsed from the server's prose so the table can be
// scanned without reading a sentence per row. The prose is kept in the title.
const TAGS = [
  { test: /^Amount mismatch/, text: 'AMOUNT', tone: 'text-danger' },
  { test: /^Paid status/, text: 'PAID STATUS', tone: 'text-danger' },
  { test: /^Paid date/, text: 'PAID DATE', tone: 'text-warning' },
  { test: /^Vendor names/, text: 'VENDOR', tone: 'text-ink-muted' },
  { test: /does not appear anywhere|could not be confirmed|Treated as not found/, text: 'MISSING ON CADENCE', tone: 'text-danger' },
  { test: /^The ledger holds this invoice/, text: 'MISSING ON BK', tone: 'text-warning' },
  { test: /no invoice number/, text: 'NO INVOICE #', tone: 'text-ink-muted' },
  { test: /unit difference/, text: 'CURRENCY', tone: 'text-warning' },
  { test: /whole split family/, text: 'SPLIT', tone: 'text-ink-muted' },
]

function IssueTags({ issues }) {
  if (!issues?.length) return <span className="text-ink-faint">—</span>
  return (
    <span className="flex flex-wrap gap-1">
      {issues.map((iss, i) => {
        const hit = TAGS.find(t => t.test.test(iss))
        return (
          <span key={i} title={iss}
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-brand-500/10 ${hit ? hit.tone : 'text-ink-muted'}`}>
            {hit ? hit.text : 'NOTE'}
          </span>
        )
      })}
    </span>
  )
}

function MatchChip({ diff }) {
  if (!diff.vendor_match_label) return <span className="text-ink-faint text-[10px]">—</span>
  const exact = diff.vendor_match_tier === 'exact'
  return (
    <span title={`Vendor match: ${diff.vendor_match_reason}`}
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-brand-500/10 ${exact ? 'text-success' : 'text-warning'}`}>
      {diff.vendor_match_label}
    </span>
  )
}

const PRIORITY_TONE = { HIGH: 'text-danger', MEDIUM: 'text-warning', LOW: 'text-ink-muted', INFO: 'text-ink-faint' }
const amt = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

export default function LedgerMatching() {
  const { toast } = useToast()
  const [file, setFile] = useState(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('amount_mismatch')
  const [busy, setBusy] = useState(null) // 'report' | 'handoff' | 'export'

  const categories = result?.categories || []
  const counts = result?.summary?.counts || {}
  const rows = useMemo(
    () => (result?.diffs || []).filter(d => d.kind === tab),
    [result, tab]
  )
  const activeCat = categories.find(c => c.key === tab)

  const run = async () => {
    if (!file || running) return
    if (file.size > MAX_MB * 1024 * 1024) { setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_MB} MB.`); return }
    setRunning(true); setError(null); setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const { data } = await api.post('/ledger-matching/diff', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const d = data.data
      setResult(d)
      // Open the first category that has something to work, never on "Clean".
      const first = (d.categories || []).find(c => c.key !== 'matched' && (d.summary.counts[c.key] || 0) > 0)
      setTab(first ? first.key : 'matched')
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reconcile that workbook.')
    } finally { setRunning(false) }
  }

  // Every download can come back as EITHER a blob or a JSON error with a blob
  // content-type — without this the user gets a 40-byte "xlsx" that Excel
  // refuses to open and no idea why.
  const download = async (kind, path, body, filename, mime) => {
    if (busy) return
    setBusy(kind)
    try {
      const res = await api.post(path, body, { responseType: 'blob' })
      if (res.data?.type === 'application/json') {
        const text = await res.data.text()
        let msg = 'Export failed.'
        try { msg = JSON.parse(text).error || msg } catch { /* keep the default */ }
        toast(msg, 'error')
        return
      }
      const url = window.URL.createObjectURL(new Blob([res.data], { type: mime }))
      const a = document.createElement('a')
      a.href = url; a.download = filename
      document.body.appendChild(a); a.click(); a.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      toast(err.response?.data?.error || 'Export failed.', 'error')
    } finally { setBusy(null) }
  }

  const stamp = new Date().toISOString().slice(0, 10)
  const diffBody = () => ({ diff: { diffs: result?.diffs || [], summary: result?.summary || {} } })

  return (
    <div>
      <PageHeader
        title="Bookkeeper Reconcile"
        subtitle="Upload the bookkeeper's outstanding-invoice workbook and see only the rows the two of you disagree about."
      />

      <p className="text-xs text-ink-faint -mt-3 mb-5 inline-flex items-center gap-1.5">
        <Info size={12} />
        Looking for bank statement ↔ ledger matching? That is
        <Link to="/bank-matching" className="font-semibold text-brand-ink hover:underline">Bank Matching</Link>.
        This page never touches bank transactions.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-3">1 · The workbook</h2>
          <Dropzone
            value={file}
            onChange={setFile}
            accept=".xlsx,.xls"
            label="Drop the bookkeeper's workbook here"
            hint={`.xlsx · up to ${MAX_MB} MB · nothing is saved`}
          />
          {error && (
            <p className="text-xs text-danger mt-3 inline-flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}
          <button type="button" onClick={run} disabled={!file || running} className="btn-primary mt-4 w-full justify-center">
            {running ? <><Loader size={15} className="animate-spin" /> Reading the workbook…</> : <><FileSpreadsheet size={15} /> Match &amp; flag differences</>}
          </button>
        </div>

        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-2">What the workbook needs</h2>
          <ul className="space-y-1.5 text-[12px] text-ink-muted">
            <li>· Every sheet needs a header row carrying a <span className="font-semibold text-ink">vendor</span> (or payee) column and an <span className="font-semibold text-ink">invoice #</span> column. The header does not have to be row 1 — a title block above it is fine.</li>
            <li>· Amount, paid date, paid amount, artist and description are picked up when present.</li>
            <li>· Invoice numbers are compared after stripping <code className="text-ink">#</code>, <code className="text-ink">INV-</code> and leading zeros, so <span className="font-semibold text-ink">#0011</span> and <span className="font-semibold text-ink">INV-11</span> are the same invoice.</li>
            <li>· Vendor names are matched in tiers — legal suffixes, parenthetical asides and reordered words are treated as the same vendor, and the report says which rule fired.</li>
            <li>· Summary / totals tabs are skipped automatically. A <span className="font-semibold text-ink">WEEK ENDING</span> date in the title block stops recent invoices being reported as “missing” from a sheet that predates them.</li>
            <li>· Amounts are compared as filed on each side and <span className="font-semibold text-ink">never converted between currencies</span>.</li>
          </ul>
        </div>
      </div>

      {result && (
        <>
          <div className="card p-5 mt-6">
            <div className="flex flex-wrap gap-2">
              {categories.map(c => {
                const n = counts[c.key] || 0
                const active = tab === c.key
                return (
                  <button key={c.key} type="button" disabled={!n} onClick={() => setTab(c.key)}
                    title={c.action}
                    className={`px-3 py-2 rounded-lg border text-left transition-colors ${active ? 'border-brand-600 bg-brand-500/10' : 'border-rule hover:bg-elev'} ${!n ? 'opacity-40 cursor-not-allowed' : ''}`}>
                    <span className={`block text-lg font-bold tabular-nums ${n ? PRIORITY_TONE[c.priority] : 'text-ink-faint'}`}>{n}</span>
                    <span className="block text-[10px] uppercase tracking-wider font-semibold text-ink-muted">{c.label}</span>
                  </button>
                )
              })}
            </div>

            <p className="text-[11px] text-ink-faint mt-4">
              {result.summary.bookkeeper_rows} row{result.summary.bookkeeper_rows === 1 ? '' : 's'} read from{' '}
              <span className="font-semibold text-ink-muted">{result.summary.source_file}</span> across {result.summary.sheets_processed} sheet
              {result.summary.sheets_processed === 1 ? '' : 's'} · {result.summary.ledger_rows} ledger invoices considered
              {result.summary.sheet_years?.length ? ` · years ${result.summary.sheet_years.join(', ')}` : ' · no year inferred from the tab names, so nothing was filtered by year'}
              {result.summary.week_ending ? ` · week ending ${result.summary.week_ending}` : ' · no week-ending date on the workbook'}
            </p>
            {(result.summary.suppressed?.outside_sheet_years > 0 || result.summary.suppressed?.after_week_ending > 0) && (
              <p className="text-[11px] text-ink-faint mt-1">
                Held back from “missing on the bookkeeper sheet”: {result.summary.suppressed.outside_sheet_years} outside the workbook’s years,
                {' '}{result.summary.suppressed.after_week_ending} filed after the week ending.
              </p>
            )}
            {result.summary.truncated && (
              <p className="text-[11px] text-warning mt-1 inline-flex items-center gap-1.5">
                <AlertTriangle size={11} /> One or more sheets were longer than the 20,000-row ceiling and were read only that far.
              </p>
            )}
            {result.summary.sheets_skipped?.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {result.summary.sheets_skipped.map(s => (
                  <li key={s.sheet} className="text-[11px] text-ink-faint">Skipped <span className="font-semibold text-ink-muted">{s.sheet}</span> — {s.reason}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-5 mt-6">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
              <div>
                <h2 className="text-sm font-bold text-ink">{activeCat?.label} <span className={`text-[10px] uppercase tracking-wider font-bold ${PRIORITY_TONE[activeCat?.priority]}`}>{activeCat?.priority}</span></h2>
                <p className="text-[11px] text-ink-faint mt-0.5 max-w-3xl">{activeCat?.action}</p>
              </div>
              <button type="button" disabled={!rows.length || !!busy}
                onClick={() => download('export', '/ledger-matching/export', { ...diffBody(), category: tab }, `reconciliation-${tab.replace(/_/g, '-')}-${stamp}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
                className="btn-secondary !py-1.5 text-xs">
                {busy === 'export' ? <Loader size={13} className="animate-spin" /> : <Download size={13} />} Export Excel ({rows.length})
              </button>
            </div>

            {rows.length === 0 ? (
              <p className="text-center text-xs text-ink-faint py-8">Nothing in this category.</p>
            ) : (
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-rule text-[10px] uppercase tracking-wider text-ink-faint">
                      <th className="text-left font-semibold py-2">Sheet</th>
                      <th className="text-left font-semibold py-2" colSpan={4}>Bookkeeper</th>
                      <th className="text-left font-semibold py-2 pl-4 border-l border-rule" colSpan={5}>Cadence ledger</th>
                      <th className="text-left font-semibold py-2 pl-3">Match</th>
                      <th className="text-left font-semibold py-2">Flags</th>
                      <th className="py-2" />
                    </tr>
                    <tr className="border-b border-rule text-[9px] uppercase tracking-wider text-ink-faint">
                      <th className="text-left font-semibold pb-1.5" />
                      <th className="text-left font-semibold pb-1.5">Vendor</th>
                      <th className="text-left font-semibold pb-1.5">Invoice #</th>
                      <th className="text-right font-semibold pb-1.5">Amount</th>
                      <th className="text-left font-semibold pb-1.5">Paid</th>
                      <th className="text-left font-semibold pb-1.5 pl-4 border-l border-rule">Payee</th>
                      <th className="text-left font-semibold pb-1.5">Invoice #</th>
                      <th className="text-right font-semibold pb-1.5">Amount</th>
                      <th className="text-left font-semibold pb-1.5">Status</th>
                      <th className="text-left font-semibold pb-1.5">Paid</th>
                      <th className="pb-1.5 pl-3" />
                      <th className="pb-1.5" />
                      <th className="pb-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d, i) => (
                      <tr key={`${d.kind}-${d.sheet || 'x'}-${d.row_num || 0}-${d.ledger?.id || 0}-${i}`} className="border-b border-divider hover:bg-elev align-top">
                        <td className="py-2 text-ink-faint whitespace-nowrap">{d.sheet || '—'}{d.row_num ? <span className="text-[10px]"> ·{d.row_num}</span> : null}</td>
                        <td className="py-2 text-ink-muted max-w-[180px] truncate" title={d.bookkeeper?.vendor || ''}>{d.bookkeeper?.vendor || '—'}</td>
                        <td className="py-2 text-ink-muted whitespace-nowrap">{d.bookkeeper?.invoice || '—'}</td>
                        <td className="py-2 text-right tabular-nums text-ink-muted whitespace-nowrap">{amt(d.bookkeeper?.amount)}</td>
                        <td className="py-2 text-ink-faint whitespace-nowrap">{d.bookkeeper?.paid_date || (d.bookkeeper?.paid_amount ? amt(d.bookkeeper.paid_amount) : '—')}</td>
                        <td className="py-2 pl-4 border-l border-rule font-semibold text-ink max-w-[180px]">
                          {d.ledger ? (
                            <span className="truncate block"><PayeeLink payee={d.ledger.payee} className="text-ink">{d.ledger.payee || '—'}</PayeeLink></span>
                          ) : <span className="text-ink-faint font-normal">not in the ledger</span>}
                          {d.ledger && <span className="block text-[10px] font-normal text-ink-faint">entry #{d.ledger.id}</span>}
                        </td>
                        <td className="py-2 text-ink-muted whitespace-nowrap">{d.ledger?.invoice_number || '—'}</td>
                        <td className="py-2 text-right tabular-nums text-ink whitespace-nowrap">
                          {d.ledger ? amt(d.ledger.family_amount ?? d.ledger.amount) : '—'}
                          {d.ledger?.currency && d.ledger.currency !== 'USD' && <span className="block text-[10px] font-normal text-ink-faint">{d.ledger.currency} · {money(d.ledger.usd)} eq.</span>}
                        </td>
                        <td className="py-2 whitespace-nowrap">
                          {d.ledger ? (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-brand-500/10 ${d.ledger.payment_status === 'Paid' ? 'text-success' : 'text-danger'}`}>
                              {d.ledger.payment_status || 'Unpaid'}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="py-2 text-ink-faint whitespace-nowrap">{d.ledger?.payment_date || '—'}</td>
                        <td className="py-2 pl-3"><MatchChip diff={d} /></td>
                        <td className="py-2 max-w-[220px]"><IssueTags issues={d.issues} /></td>
                        <td className="py-2 text-right">
                          {d.ledger && <Link to={`/ledger?focus=${d.ledger.id}`} className="text-ink-faint hover:text-ink text-[10px] font-semibold whitespace-nowrap">Open →</Link>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] text-ink-faint mt-3">{result.at_stake_note}</p>
          </div>

          <div className="card p-5 mt-6">
            <h2 className="text-sm font-bold text-ink">Send this to the bookkeeper</h2>
            <p className="text-[11px] text-ink-faint mt-0.5 mb-3">Both are built from the report on this page, so what they receive is what you are looking at.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!!busy}
                onClick={() => download('report', '/ledger-matching/report', diffBody(), `bookkeeper-reconciliation-${stamp}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
                className="btn-secondary text-xs">
                {busy === 'report' ? <Loader size={14} className="animate-spin" /> : <Download size={14} />} Full Excel report
              </button>
              <button type="button" disabled={!!busy}
                onClick={() => download('handoff', '/ledger-matching/handoff', diffBody(), `bookkeeper-handoff-${stamp}.zip`, 'application/zip')}
                className="btn-secondary text-xs">
                {busy === 'handoff' ? <Loader size={14} className="animate-spin" /> : <Package size={14} />} Handoff bundle (.zip)
              </button>
            </div>
            <p className="text-[11px] text-ink-faint mt-3">
              The bundle carries the report, a plain-English README, and every invoice, W9 and payment proof behind the ledger rows above —
              plus a chase list of vendors with no W9 on file. Rows only the bookkeeper has contribute no files: we hold no document for them.
            </p>
          </div>
        </>
      )}

      {!result && !running && (
        <p className="text-[11px] text-ink-faint mt-6 inline-flex items-center gap-1.5">
          <ArrowRight size={12} /> Nothing is saved. The report exists while this page is open, because a stored diff of a file you do not control goes stale the moment either side edits a row.
        </p>
      )}
    </div>
  )
}
