// Invoice Search — the browse/search-all-invoices index (boom's /bk/invoices).
// One row per invoice FAMILY (splits fold into their parent's total), searched
// from any angle: payee / invoice # (normalized — "INV-0042" finds "#42") /
// description / artist, date ranges on three bases, and two weekly charts
// (intake by created_at, outflow by payment_date) whose bars are click-to-
// filter controls. Distinct from /invoices, the OUTBOUND invoice creator.
import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, FileText, LayoutList, LayoutGrid, AlertCircle, Upload, RotateCw, ChevronRight, X } from 'lucide-react'
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import Badge from '../components/ui/Badge'
import Input from '../components/ui/Input'
import { useToast } from '../context/ToastContext'
import useIsMobile from '../hooks/useIsMobile'
import { formatDate, localDateStr } from '../utils/dates'
import { moneyOrig, moneyCompact } from '../utils/money'
import { AXIS_TICK_SM } from '../utils/chartTheme'

const STATUS_TONE = { approved: 'success', pending: 'warning', rejected: 'danger' }
const StatusBadge = ({ status }) => (
  <Badge tone={STATUS_TONE[String(status || '').toLowerCase()] || 'neutral'}>
    {status ? status[0].toUpperCase() + status.slice(1) : '—'}
  </Badge>
)

// ── File chip — view via signed URL, replace (↻), or upload-when-missing ────
function FileChip({ entryId, type, label, hasFile, onUploaded, stop = true }) {
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  const { toast } = useToast()

  const view = async (e) => {
    if (stop) e.stopPropagation()
    try {
      const { data } = await api.get(`/ledger/entries/${entryId}/file/${type}`)
      if (data?.data?.url) window.open(data.data.url, '_blank', 'noopener')
    } catch { toast('Could not open the file', 'error') }
  }
  const upload = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      await api.post(`/ledger/entries/${entryId}/file/${type}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      onUploaded?.(entryId, type)
      toast(`${label} ${hasFile ? 'replaced' : 'uploaded'}`)
    } catch (err) {
      toast(err.response?.data?.error || `Could not upload the ${label}`, 'error')
    } finally { setBusy(false) }
  }

  return (
    <span className="inline-flex items-center gap-1" onClick={stop ? (e) => e.stopPropagation() : undefined}>
      {busy ? (
        <span className="text-[11px] text-ink-faint">…</span>
      ) : hasFile ? (
        <>
          <button type="button" onClick={view}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline">
            <FileText size={13} /> {label}
          </button>
          <button type="button" title={`Replace ${label}`} onClick={(e) => { if (stop) e.stopPropagation(); inputRef.current?.click() }}
            className="text-ink-faint hover:text-ink-muted">
            <RotateCw size={11} />
          </button>
        </>
      ) : (
        <button type="button" onClick={(e) => { if (stop) e.stopPropagation(); inputRef.current?.click() }}
          className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink-muted">
          <Upload size={12} /> {label}
        </button>
      )}
      <input ref={inputRef} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic"
        onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
    </span>
  )
}

// ── Weekly chart — stacked vendor/admin bars, click-a-bar filters the list ──
function WeeklyChart({ title, subtitle, headlineLabel, series, selectedWeekStart, onWeekClick, storageKey }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(storageKey) === '1' } catch { return false }
  })
  const toggle = () => {
    setCollapsed(c => { try { localStorage.setItem(storageKey, c ? '0' : '1') } catch { /* ignore */ } return !c })
  }
  const data = useMemo(() => (series || []).map(s => ({
    ...s,
    label: String(s.week).slice(5),
    vendor: Number(s.vendor || 0), admin: Number(s.admin || 0),
    count: Number(s.count || 0), amount: Number(s.amount || 0),
    vendor_amount: Number(s.vendor_amount || 0), admin_amount: Number(s.admin_amount || 0),
  })), [series])
  const thisWeek = data[data.length - 1]
  const interval = data.length > 30 ? 3 : data.length > 16 ? 1 : 0
  const click = (d) => { const w = d?.payload || d; if (w?.week) onWeekClick({ week_start: w.week, week_end: w.week_end }) }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={toggle} className="flex items-center gap-2 text-left min-w-0">
          <ChevronRight size={14} className={`text-ink-faint flex-shrink-0 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
          <span className="text-[11px] font-semibold text-ink-faint uppercase tracking-wide truncate">{title}</span>
        </button>
        <span className="text-xs text-ink-muted whitespace-nowrap">
          {thisWeek ? <><span className="font-semibold text-ink">{thisWeek.count}</span> {headlineLabel} · {moneyCompact(thisWeek.amount)}</> : '—'}
        </span>
      </div>
      {!collapsed && (
        <>
          <p className="text-[11px] text-ink-faint mt-1 mb-2">{subtitle} · click a bar to filter the list</p>
          <div style={{ height: 130 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <XAxis dataKey="label" tick={AXIS_TICK_SM} interval={interval} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                  content={({ active, payload }) => {
                    const w = active && payload?.[0]?.payload
                    if (!w) return null
                    return (
                      <div className="card px-3 py-2 text-xs shadow-modal">
                        <p className="font-semibold text-ink">Week of {formatDate(w.week)}</p>
                        <p className="text-ink-muted mt-0.5">{w.count} invoice{w.count === 1 ? '' : 's'} · {moneyCompact(w.amount)} USD-equiv</p>
                        <p className="text-ink-faint mt-0.5">{w.vendor} vendor portal ({moneyCompact(w.vendor_amount)}) · {w.admin} staff-entered ({moneyCompact(w.admin_amount)})</p>
                        <p className="text-ink-faint mt-0.5 italic">Click to filter the list to this week</p>
                      </div>
                    )
                  }}
                />
                {/* Stacked: staff-entered base + vendor-portal top. Selection
                    dims the other weeks rather than recoloring the bar, so the
                    vendor/admin split stays readable while filtered. */}
                <Bar dataKey="admin" stackId="wk" fill="#6366f1" onClick={click} cursor="pointer">
                  {data.map(d => (
                    <Cell key={d.week} fillOpacity={selectedWeekStart && d.week !== selectedWeekStart ? 0.25 : 1} />
                  ))}
                </Bar>
                <Bar dataKey="vendor" stackId="wk" fill="#10b981" radius={[3, 3, 0, 0]} onClick={click} cursor="pointer">
                  {data.map(d => (
                    <Cell key={d.week} fillOpacity={selectedWeekStart && d.week !== selectedWeekStart ? 0.25 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-4 mt-1 text-[10px] text-ink-faint">
            <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: '#6366f1' }} /> Staff-entered</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: '#10b981' }} /> Vendor portal</span>
          </div>
        </>
      )}
    </div>
  )
}

// Chart range presets — server generate_series is inclusive and snaps both
// ends to Monday, so N weeks = today's week + (N-1) previous (12w renders 12
// bars, not 13).
const CHART_RANGE_KEY = 'invoice_search_chart_range_v1'
const CHART_PRESETS = [
  { key: '4w', label: '4w', weeks: 4 },
  { key: '12w', label: '12w', weeks: 12 },
  { key: '26w', label: '26w', weeks: 26 },
  { key: '52w', label: '52w', weeks: 52 },
]

export default function InvoiceSearch() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  // Which date column the from/to range filters on server-side:
  // invoice_date (toolbar default) · created_at (submissions-chart click) ·
  // payment_date (paid-chart click).
  const [basis, setBasis] = useState('invoice_date')
  const [view, setView] = useState(() => (isMobile ? 'cards' : 'table'))

  const [analytics, setAnalytics] = useState(null)
  const [rejected, setRejected] = useState([])
  const [rejectedLoading, setRejectedLoading] = useState(true)
  const [rejectedCollapsed, setRejectedCollapsed] = useState(true)

  // Chart range picker, persisted so the range survives refresh.
  const [chartRange, setChartRangeRaw] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(CHART_RANGE_KEY) || 'null')
      if (stored && typeof stored === 'object' && stored.preset) return stored
    } catch { /* ignore */ }
    return { preset: '12w', customFrom: '', customTo: '' }
  })
  const setChartRange = (next) => {
    setChartRangeRaw(next)
    try { localStorage.setItem(CHART_RANGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }
  const chartFromTo = useMemo(() => {
    if (chartRange.preset === 'custom') {
      return { from: chartRange.customFrom || null, to: chartRange.customTo || null }
    }
    const preset = CHART_PRESETS.find(p => p.key === chartRange.preset) || CHART_PRESETS[1]
    const [y, m, d] = localDateStr().split('-').map(Number)
    const back = new Date(y, m - 1, d - (preset.weeks - 1) * 7)
    return { from: localDateStr(back), to: localDateStr() }
  }, [chartRange])

  // One analytics fetch drives both charts (intake + outflow stay
  // apples-to-apples on the same window).
  useEffect(() => {
    const params = new URLSearchParams()
    if (chartFromTo.from) params.append('from', chartFromTo.from)
    if (chartFromTo.to) params.append('to', chartFromTo.to)
    api.get(`/ledger/payment-analytics?${params}`).then(r => setAnalytics(r.data.data)).catch(() => {})
  }, [chartFromTo.from, chartFromTo.to])

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // Race guard: late responses whose generation doesn't match the latest are
  // dropped. Full skeleton only before the FIRST load — refetches (every
  // debounced keystroke / chart click) must not unmount the focused input.
  const fetchGen = useRef(0)
  const hasLoaded = useRef(false)
  const fetchInvoices = async () => {
    const gen = ++fetchGen.current
    try {
      if (!hasLoaded.current) setLoading(true)
      setError('')
      const params = new URLSearchParams()
      if (debounced) params.append('search', debounced)
      if (fromDate) params.append('from', fromDate)
      if (toDate) params.append('to', toDate)
      if ((fromDate || toDate) && basis !== 'invoice_date') params.append('basis', basis)
      const res = await api.get(`/ledger/invoices?${params}`)
      if (gen !== fetchGen.current) return
      hasLoaded.current = true
      setEntries(res.data.data || [])
    } catch (err) {
      if (gen !== fetchGen.current) return
      setError(err.response?.data?.error || 'Failed to load invoices')
    } finally {
      if (gen === fetchGen.current) setLoading(false)
    }
  }
  useEffect(() => { fetchInvoices() }, [debounced, fromDate, toDate, basis]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchRejected = async () => {
    try {
      setRejectedLoading(true)
      const res = await api.get('/ledger/invoices?status=rejected')
      setRejected(res.data.data || [])
    } catch {
      setRejected([])
    } finally { setRejectedLoading(false) }
  }
  useEffect(() => { fetchRejected() }, [])

  // Chart-click dispatch: filter the list to that Mon–Sun window on the same
  // column the chart bucketed by; same-bar second click toggles the filter off.
  const handleWeekClick = (clickBasis) => (week) => {
    if (!week?.week_start || !week?.week_end) return
    const same = basis === clickBasis && fromDate === week.week_start && toDate === week.week_end
    if (same) { setFromDate(''); setToDate(''); setBasis('invoice_date'); return }
    setFromDate(week.week_start)
    setToDate(week.week_end)
    setBasis(clickBasis)
  }
  // Only highlight when the active filter came from that chart's basis, so a
  // manual date edit (which resets basis) never leaves a stale highlight.
  const submittedSelected = basis === 'created_at' ? fromDate : null
  const paidSelected = basis === 'payment_date' ? fromDate : null

  const clearFilters = () => { setSearch(''); setFromDate(''); setToDate(''); setBasis('invoice_date') }
  const markUploaded = (setter) => (id, type) =>
    setter(prev => prev.map(e => (e.id === id ? { ...e, [`has_${type}`]: true } : e)))
  const openInLedger = (entry) => navigate(`/ledger?focus=${entry.id}`)

  // Filter summary phrasing — "the week of Jun 22" for an exact Mon–Sun span.
  const filterSummary = useMemo(() => {
    if (!fromDate && !toDate) return null
    const verb = basis === 'payment_date' ? 'invoices paid'
      : basis === 'created_at' ? 'invoices submitted'
      : 'invoices dated'
    let phrase
    if (fromDate && toDate) {
      const spanDays = Math.round((new Date(toDate + 'T00:00:00') - new Date(fromDate + 'T00:00:00')) / 86400000)
      const startDay = new Date(fromDate + 'T00:00:00').getDay() // 1 = Monday
      phrase = spanDays === 6 && startDay === 1
        ? `the week of ${formatDate(fromDate)}`
        : `between ${formatDate(fromDate)} and ${formatDate(toDate)}`
    } else if (fromDate) phrase = `on or after ${formatDate(fromDate)}`
    else phrase = `on or before ${formatDate(toDate)}`
    return { verb, phrase }
  }, [fromDate, toDate, basis])

  const hasFilters = !!(search || fromDate || toDate)

  if (loading && !hasLoaded.current) {
    return (
      <div>
        <PageHeader title="Invoice Search" subtitle="Browse and search every invoice — splits shown as one family total" />
        <div className="grid gap-3 mb-4 lg:grid-cols-2"><Skeleton.Block h="h-40" /><Skeleton.Block h="h-40" /></div>
        <Skeleton.Table rows={8} cols={6} />
      </div>
    )
  }

  const fileCells = (entry, setter) => (
    <div className="flex items-center gap-3">
      <FileChip entryId={entry.id} type="invoice" label="Invoice" hasFile={entry.has_invoice} onUploaded={markUploaded(setter)} />
      {/* W9 follows the canonical cross-entry rule: view from the row that
          HOLDS the vendor's W9 (w9_entry_id), upload onto this row. */}
      <FileChip entryId={entry.w9_entry_id || entry.id} type="w9" label="W9"
        hasFile={entry.has_w9 || !!entry.w9_entry_id} onUploaded={markUploaded(setter)} />
      {entry.has_proof && <FileChip entryId={entry.id} type="proof" label="Proof" hasFile onUploaded={markUploaded(setter)} />}
    </div>
  )

  return (
    <div>
      <PageHeader title="Invoice Search" subtitle="Browse and search every invoice — splits shown as one family total. Click a row to open it in the Ledger." />

      {/* Range picker — one control drives both charts */}
      <div className="card px-3 py-2 mb-3 flex items-center flex-wrap gap-2 text-xs">
        <span className="text-[10px] font-semibold text-ink-faint uppercase tracking-wide mr-1">Time range</span>
        {CHART_PRESETS.map(p => (
          <button key={p.key} type="button"
            onClick={() => setChartRange({ ...chartRange, preset: p.key })}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
              chartRange.preset === p.key
                ? 'border-brand-500 bg-brand-500/10 text-brand-ink'
                : 'border-rule text-ink-muted hover:bg-gray-50'}`}>
            {p.label}
          </button>
        ))}
        <button type="button"
          onClick={() => setChartRange({ ...chartRange, preset: 'custom' })}
          className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
            chartRange.preset === 'custom'
              ? 'border-brand-500 bg-brand-500/10 text-brand-ink'
              : 'border-rule text-ink-muted hover:bg-gray-50'}`}>
          Custom…
        </button>
        {chartRange.preset === 'custom' && (
          <>
            <span className="text-ink-faint ml-1">From</span>
            <input type="date" value={chartRange.customFrom}
              onChange={e => setChartRange({ ...chartRange, customFrom: e.target.value })}
              className="input !w-auto !h-7 !py-0 text-xs" />
            <span className="text-ink-faint">To</span>
            <input type="date" value={chartRange.customTo}
              onChange={e => setChartRange({ ...chartRange, customTo: e.target.value })}
              className="input !w-auto !h-7 !py-0 text-xs" />
          </>
        )}
      </div>

      {/* Weekly charts — intake (created_at) vs outflow (payment_date) */}
      {analytics && (
        <div className="grid gap-3 mb-4 lg:grid-cols-2">
          <WeeklyChart
            title="Invoices submitted per week"
            subtitle="Bucketed by submission date · Mon–Sun, label time · USD-equivalent family totals"
            headlineLabel="submitted this week"
            series={analytics.submissions}
            selectedWeekStart={submittedSelected}
            onWeekClick={handleWeekClick('created_at')}
            storageKey="invoice_search_submitted_chart_collapsed_v1"
          />
          <WeeklyChart
            title="Invoices paid per week"
            subtitle="Bucketed by payment date · Mon–Sun, label time · USD-equivalent family totals"
            headlineLabel="paid this week"
            series={analytics.paid}
            selectedWeekStart={paidSelected}
            onWeekClick={handleWeekClick('payment_date')}
            storageKey="invoice_search_paid_chart_collapsed_v1"
          />
        </div>
      )}

      {/* Toolbar */}
      <div className="card px-3 py-2.5 mb-3 flex items-center flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
          <Input placeholder="Payee, invoice #, description, artist…" value={search}
            onChange={e => setSearch(e.target.value)} className="!pl-8" />
        </div>
        {/* Manual date edits filter on invoice_date (and clear any chart pick) */}
        <input type="date" value={fromDate} title="From date"
          onChange={e => { setFromDate(e.target.value); setBasis('invoice_date') }}
          className="input !w-auto" />
        <input type="date" value={toDate} title="To date"
          onChange={e => { setToDate(e.target.value); setBasis('invoice_date') }}
          className="input !w-auto" />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-ink-faint whitespace-nowrap">{entries.length} invoice{entries.length === 1 ? '' : 's'}</span>
          <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
            <button type="button" onClick={() => setView('table')} title="Table view"
              className={`p-1.5 rounded-md ${view === 'table' ? 'bg-card text-ink shadow-sm' : 'text-ink-faint hover:text-ink-muted'}`}>
              <LayoutList size={14} />
            </button>
            <button type="button" onClick={() => setView('cards')} title="Cards view"
              className={`p-1.5 rounded-md ${view === 'cards' ? 'bg-card text-ink shadow-sm' : 'text-ink-faint hover:text-ink-muted'}`}>
              <LayoutGrid size={14} />
            </button>
          </div>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="btn-secondary !py-1.5 !px-3 text-xs">Clear</button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="card border-danger px-4 py-3 mb-3 flex items-center gap-2 text-sm text-danger">
          <AlertCircle size={16} className="flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={fetchInvoices} className="btn-secondary !py-1 !px-3 text-xs">Retry</button>
        </div>
      )}

      {/* Filter summary banner */}
      {filterSummary && (
        <div className="card bg-brand-500/10 border-brand-500/30 px-4 py-2.5 mb-3 flex items-center gap-3">
          <FileText size={15} className="text-brand-ink flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">Showing {filterSummary.verb} {filterSummary.phrase}</p>
            <p className="text-[11px] text-ink-muted mt-0.5">
              {entries.length} invoice{entries.length === 1 ? '' : 's'} match{entries.length === 1 ? 'es' : ''} this filter
              {basis !== 'invoice_date' && <span className="opacity-75"> · selected from chart</span>}
            </p>
          </div>
          <button type="button" onClick={() => { setFromDate(''); setToDate(''); setBasis('invoice_date') }}
            className="btn-secondary !py-1 !px-3 text-xs whitespace-nowrap inline-flex items-center gap-1">
            <X size={12} /> Clear filter
          </button>
        </div>
      )}

      {/* Results */}
      {entries.length === 0 ? (
        <div className="card px-4 py-14 text-center text-sm text-ink-muted">
          {hasFilters ? (
            <>
              No invoices match this filter.
              <button type="button" onClick={clearFilters} className="ml-2 text-brand-ink font-semibold hover:underline">Clear filters</button>
            </>
          ) : 'No approved invoices yet.'}
        </div>
      ) : view === 'cards' ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))' }}>
          {entries.map(entry => (
            <div key={entry.id} className="card p-4 cursor-pointer hover:border-brand-500/50" onClick={() => openInLedger(entry)}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="font-semibold text-sm text-ink truncate">{entry.payee}</p>
                <StatusBadge status={entry.status} />
              </div>
              <p className="text-xl font-bold text-ink mb-1">
                {moneyOrig(entry.amount, entry.currency)}
                {entry.split_count > 0 && <span className="ml-2 text-[10px] font-semibold text-ink-faint align-middle">{entry.split_count + 1}-way split</span>}
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-muted mb-3">
                <span>{formatDate(entry.invoice_date)}</span>
                {entry.invoice_number && <span>#{entry.invoice_number}</span>}
                {entry.category && <span>{entry.category}</span>}
                {entry.artist && <span className="text-ink-faint">{entry.artist}</span>}
              </div>
              <div className="border-t border-divider pt-2.5">{fileCells(entry, setEntries)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="bg-page/50 border-b border-divider text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              {['Date', 'Payee', 'Invoice #', 'Amount', 'Category', 'Artist', 'Status', 'Files'].map(h => (
                <th key={h} className={`px-3 py-2.5 whitespace-nowrap ${h === 'Amount' ? 'text-right' : ''}`}>{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-divider">
              {entries.map(entry => (
                <tr key={entry.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openInLedger(entry)}>
                  <td className="px-3 py-2.5 whitespace-nowrap text-ink-muted">{formatDate(entry.invoice_date)}</td>
                  <td className="px-3 py-2.5 font-semibold text-ink">{entry.payee}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{entry.invoice_number || '—'}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap font-bold text-ink">
                    {moneyOrig(entry.amount, entry.currency)}
                    {entry.split_count > 0 && <span className="ml-1.5 text-[10px] font-semibold text-ink-faint">×{entry.split_count + 1}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">{entry.category || '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{entry.artist || '—'}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={entry.status} /></td>
                  <td className="px-3 py-2.5">{fileCells(entry, setEntries)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Rejected invoices — collapsed audit tail. Not tied to the filters
          above: the trail is looked up by vendor or reason, not date range. */}
      <div className="card mt-6 mb-8 overflow-hidden">
        <button type="button"
          onClick={() => { const next = !rejectedCollapsed; setRejectedCollapsed(next); if (!next) fetchRejected() }}
          className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-gray-50">
          <ChevronRight size={14} className={`text-ink-faint transition-transform ${rejectedCollapsed ? '' : 'rotate-90'}`} />
          <span className="text-sm font-semibold text-ink">Rejected invoices</span>
          <Badge tone="danger">{rejectedLoading ? '…' : rejected.length}</Badge>
          <span className="text-xs text-ink-faint">rejected via the Approvals page</span>
        </button>
        {!rejectedCollapsed && (
          rejectedLoading ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">Loading rejected invoices…</p>
          ) : rejected.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">No rejected invoices on file.</p>
          ) : (
            <div className="overflow-x-auto border-t border-divider">
              <table className="w-full min-w-[760px] text-sm">
                <thead><tr className="bg-page/50 border-b border-divider text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                  {['Date', 'Payee', 'Invoice #', 'Amount', 'Artist', 'Rejected', 'Reason', 'Invoice'].map(h => (
                    <th key={h} className={`px-3 py-2.5 whitespace-nowrap ${h === 'Amount' ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-divider">
                  {rejected.map(entry => (
                    <tr key={entry.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openInLedger(entry)}>
                      <td className="px-3 py-2.5 whitespace-nowrap text-ink-muted">{formatDate(entry.invoice_date)}</td>
                      <td className="px-3 py-2.5 font-semibold text-ink">{entry.payee}</td>
                      <td className="px-3 py-2.5 text-ink-muted">{entry.invoice_number || '—'}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap font-semibold text-ink-muted">{moneyOrig(entry.amount, entry.currency)}</td>
                      <td className="px-3 py-2.5 text-ink-muted">{entry.artist || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-ink-muted">
                        {entry.rejected_at ? formatDate(entry.rejected_at) : '—'}
                        {entry.rejected_by && <span className="block text-[10px] text-ink-faint mt-0.5">by {entry.rejected_by}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-ink-muted max-w-[320px]">
                        {entry.rejected_reason || <span className="italic text-ink-faint">no reason recorded</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <FileChip entryId={entry.id} type="invoice" label="Invoice" hasFile={entry.has_invoice} onUploaded={markUploaded(setRejected)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  )
}
