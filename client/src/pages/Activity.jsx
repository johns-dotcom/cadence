import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity as ActivityIcon, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Clock,
  DollarSign, FileText, Filter, LogIn, Music, RefreshCw, Search,
  TrendingUp, UserCheck, Users, X,
} from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import useHotkeys from '../hooks/useHotkeys'
import { DEPARTMENTS } from '../constants'

// ─── Time helpers ───────────────────────────────────────────────────────────

function formatDateTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (isNaN(d)) return '—'
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return formatDateTime(ts)
}

// ─── Categories ─────────────────────────────────────────────────────────────
// `value` must match the server's CATEGORY_PATTERNS keys (routes/activity.js).
// Tints are token-based `/10` alphas — a plain `bg-*-50` goes near-white in
// dark and takes the label with it.

const CATEGORIES = [
  { value: 'all',        label: 'All activity', icon: ActivityIcon,    color: 'text-ink-muted',  bg: 'bg-gray-500/10' },
  { value: 'auth',       label: 'Sign-ins',     icon: LogIn,           color: 'text-blue-500',   bg: 'bg-blue-500/10' },
  { value: 'releases',   label: 'Releases',     icon: Music,           color: 'text-purple-500', bg: 'bg-purple-500/10' },
  { value: 'artists',    label: 'Artists',      icon: Users,           color: 'text-amber-500',  bg: 'bg-amber-500/10' },
  { value: 'contracts',  label: 'Legal',        icon: FileText,        color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  { value: 'deals',      label: 'Deals',        icon: TrendingUp,      color: 'text-rose-500',   bg: 'bg-rose-500/10' },
  { value: 'team',       label: 'Team',         icon: UserCheck,       color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
  { value: 'financials', label: 'Finance',      icon: DollarSign,      color: 'text-teal-500',   bg: 'bg-teal-500/10' },
]

// Per-ROW classification. A row wears one chip, so this is precedence-ordered
// and deliberately narrower than the server's inclusive filter: "Set artist
// budget" filters under both Artists and Finance, but reads as Finance here.
function categoryOf(action) {
  const a = (action || '').toLowerCase()
  if (!a) return CATEGORIES[0]
  const hit = (v) => CATEGORIES.find(c => c.value === v) || CATEGORIES[0]
  if (/sign|invite|password|impersonat/.test(a)) return hit('auth')
  if (/invoice|ledger|payment|paid|vendor|expense|bank|statement|budget|recoup|income|report|creator|w9|approv|reject|categor|spend|export|import|salary|fx/.test(a)) return hit('financials')
  if (/contract|nda|waiver|clearance|admin document/.test(a)) return hit('contracts')
  if (/release|dsp|catalog|checklist/.test(a)) return hit('releases')
  if (/deal/.test(a)) return hit('deals')
  if (/team member|task|employee|permission|department|\brep\b/.test(a)) return hit('team')
  if (/artist|campaign|roster/.test(a)) return hit('artists')
  return CATEGORIES[0]
}

// ─── Action / detail humanizing ─────────────────────────────────────────────
// Cadence's logActivity phrases are already past-tense English ("Approved
// ledger entry"), unlike boom's mixed bag. So the pass-through list is the
// PRIMARY path and the endpoint map is the fallback for anything that slipped
// through as a raw method string.

const VERB_RE = /^(viewed|signed|created|updated|deleted|assigned|added|approved|rejected|uploaded|removed|merged|renamed|restored|split|bulk|sent|exported|imported|downloaded|ai|ran|submitted|performed|registered|invited|marked|paid|batch|booked|attached|allocated|applied|archived|carved|claimed|cleared|closed|converted|corrected|declared|dismissed|excluded|flagged|generated|moved|paired|put|reassigned|recategorized|reclassified|reconciled|recorded|rematched|reopened|repaired|reparsed|repointed|retyped|reviewed|rotated|set|statement|undid|unpaired|unsplit|voided|full)\b/i

const ENDPOINT_RULES = [
  [/^POST$/, /\/file\/invoice/, 'Uploaded invoice document'],
  [/^POST$/, /\/file\/w9/, 'Uploaded W9'],
  [/^POST$/, /\/file\/proof/, 'Uploaded proof of payment'],
  [/^POST$/, /\/file\/receipt/, 'Uploaded receipt'],
  [/^DELETE$/, /\/file\//, 'Removed a document'],
  [/^POST$/, /\/approve/, 'Approved invoice'],
  [/^POST$/, /\/reject/, 'Rejected invoice'],
  [/^POST$/, /\/split/, 'Split invoice between artists'],
  [/^POST$/, /\/restore/, 'Restored deleted entry'],
  [/^POST$/, /\/send-confirmation/, 'Sent payment confirmation'],
  [/^(PUT|PATCH)$/, /\/ledger\/\d+/, 'Updated ledger entry'],
  [/^POST$/, /\/ledger/, 'Added invoice to ledger'],
  [/^DELETE$/, /\/ledger\/\d+/, 'Deleted ledger entry'],
  [/^(PUT|PATCH)$/, /\/vendors\//, 'Updated vendor'],
  [/^POST$/, /\/tasks/, 'Created task'],
  [/^(PUT|PATCH)$/, /\/tasks\//, 'Updated task'],
  [/^DELETE$/, /\/tasks\//, 'Deleted task'],
  [/^POST$/, /\/deals/, 'Added deal'],
  [/^(PUT|PATCH)$/, /\/deals\//, 'Updated deal'],
  [/^POST$/, /\/releases/, 'Added release'],
  [/^(PUT|PATCH)$/, /\/releases\//, 'Updated release'],
  [/^POST$/, /\/team\b/, 'Invited team member'],
  [/^(PUT|PATCH)$/, /\/team\/\d+/, 'Updated team member'],
  [/^DELETE$/, /\/team\/\d+/, 'Removed team member'],
  [/^PUT$/, /\/settings\/permissions/, 'Updated permissions'],
  [/^POST$/, /\/auth\/impersonate/, 'Viewing as another user'],
  [/^GET$/, /\/full-export/, 'Exported the workspace'],
]

function humanizeAction(row) {
  const action = row.action || ''
  if (action && VERB_RE.test(action)) return action
  const method = (row.method || '').toUpperCase()
  const endpoint = row.endpoint || ''
  for (const [m, e, text] of ENDPOINT_RULES) {
    if (m.test(method) && e.test(endpoint)) return text
  }
  // Not a raw "GET /api/…" string? Then it's a phrase we simply don't have a
  // verb for — showing it beats showing "Activity".
  if (action && !/^(GET|POST|PUT|PATCH|DELETE)\s/.test(action)) return action
  return 'Activity'
}

const FIELD_LABELS = {
  payment_status: 'Status', payment_date: 'Date paid', paid_by: 'Paid by',
  payment_method: 'Method', payment_terms: 'Terms', scheduled_payment_date: 'Due date',
  payee: 'Payee', vendor_email: 'Email', vendor_name: 'Vendor name',
  vendor_address: 'Address', category: 'Category', artist: 'Artist', song: 'Song',
  amount: 'Amount', currency: 'Currency', invoice_number: 'Invoice #',
  invoice_date: 'Date', description: 'Description', notes: 'Notes',
  rep: 'Rep', in_quickbooks: 'QuickBooks', uploaded_to_stem: 'Stem',
  cobrand: 'Cobrand', is_bulk_deal: 'Bulk deal', is_reimbursement: 'Reimbursement',
  recoupable: 'Recoupable', confirmation_sent: 'Confirmation sent',
  status: 'Status', priority: 'Priority', due_date: 'Due date', role: 'Role',
  department: 'Department', assigned_to: 'Assigned to', release_id: 'Release',
}

function formatVal(v) {
  if (v === true) return 'Yes'
  if (v === false) return 'No'
  if (v == null || v === '') return '(empty)'
  return String(v)
}

function actionDetail(row) {
  const entryRef = row.entry_id ? `#${row.entry_id}` : null
  if (row.detail) {
    try {
      const parsed = JSON.parse(row.detail)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const entries = Object.entries(parsed)
        const first = entries[0]?.[1]
        // Before/after diff shape: { field: { from, to } }
        if (first && typeof first === 'object' && 'from' in first) {
          return entries
            .map(([k, { from, to }]) => `Changed ${(FIELD_LABELS[k] || k).toLowerCase()} from “${formatVal(from)}” to “${formatVal(to)}”`)
            .join('. ')
        }
        if (entries.length) {
          return entries.map(([k, v]) => `${FIELD_LABELS[k] || k}: ${formatVal(v)}`).join(', ')
        }
      }
    } catch {
      // Plain text — show it, unless it's unparsed JSON-ish noise.
      const text = String(row.detail)
      if (!text.startsWith('{') && !text.startsWith('[')) return text
    }
  }
  return entryRef ? `Entry ${entryRef}` : null
}

const DEPT_TINTS = {
  Operations: 'bg-blue-500/10 text-blue-500',
  Executive: 'bg-purple-500/10 text-purple-500',
  'A&R': 'bg-amber-500/10 text-amber-500',
  Marketing: 'bg-emerald-500/10 text-emerald-500',
  Finance: 'bg-rose-500/10 text-rose-500',
  Legal: 'bg-teal-500/10 text-teal-500',
}

const METHOD_TINTS = {
  GET: 'bg-sky-500/10 text-sky-500',
  POST: 'bg-emerald-500/10 text-emerald-500',
  PUT: 'bg-amber-500/10 text-amber-500',
  PATCH: 'bg-amber-500/10 text-amber-500',
  DELETE: 'bg-red-500/10 text-danger',
}
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

const DATE_PRESETS = [
  { label: 'Today', days: 0 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: 'All', days: null },
]
const DEFAULT_PRESET = '7d'
const PAGE_SIZE = 100

// Local calendar day, not `toISOString()` — a UTC conversion after 5pm PT
// asks the server for tomorrow and silently drops today's events.
function localDayStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Activity() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [userId, setUserId] = useState('all')
  const [category, setCategory] = useState('all')
  const [methods, setMethods] = useState([])
  const [department, setDepartment] = useState('all')
  const [sort, setSort] = useState('desc')
  const [preset, setPreset] = useState(DEFAULT_PRESET)
  const [customDates, setCustomDates] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)

  useHotkeys({ s: () => setSort(s => (s === 'desc' ? 'asc' : 'desc')) }, [])

  const dateRange = useCallback(() => {
    if (customDates) return { from: from || undefined, to: to || undefined }
    const p = DATE_PRESETS.find(x => x.label === preset)
    if (!p || p.days === null) return {}
    const d = new Date()
    d.setDate(d.getDate() - p.days)
    return { from: localDayStr(d) }
  }, [customDates, from, to, preset])

  const fetchActivity = useCallback(async (silent = false, atPage = null) => {
    if (silent) setRefreshing(true); else setLoading(true)
    setError('')
    try {
      const range = dateRange()
      const params = {
        user_id: userId,
        category,
        department: department !== 'all' ? department : undefined,
        methods: methods.length ? methods.join(',') : undefined,
        sort,
        search: search.trim() || undefined,
        from: range.from,
        to: range.to,
        page: atPage ?? page,
        limit: PAGE_SIZE,
      }
      Object.keys(params).forEach(k => params[k] === undefined && delete params[k])
      const res = await api.get('/activity', { params })
      setRows(res.data.data || [])
      setTotal(res.data.total || 0)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load activity')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [userId, category, department, methods, sort, search, page, dateRange])

  useEffect(() => {
    api.get('/activity/users').then(r => setUsers(r.data.data || [])).catch(() => {})
  }, [])

  // Search is debounced; every other filter refetches immediately. Both reset
  // to page 1 and pass it explicitly — `setPage(1)` doesn't land before the
  // fetch reads it, which would ask for page 4 of a one-page result.
  const first = useRef(true)
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); fetchActivity(!first.current, 1); first.current = false }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  useEffect(() => {
    if (first.current) return
    setPage(1)
    fetchActivity(true, 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, category, department, methods, sort, preset, customDates, from, to])

  useEffect(() => {
    if (first.current) return
    fetchActivity(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const toggleMethod = (m) => setMethods(ms => (ms.includes(m) ? ms.filter(x => x !== m) : [...ms, m]))

  const hasFilters = userId !== 'all' || category !== 'all' || methods.length > 0 ||
    department !== 'all' || sort !== 'desc' || search.trim() || customDates || preset !== DEFAULT_PRESET

  const clearFilters = () => {
    setUserId('all'); setCategory('all'); setMethods([]); setDepartment('all')
    setSort('desc'); setSearch(''); setPreset(DEFAULT_PRESET)
    setCustomDates(false); setFrom(''); setTo(''); setPage(1)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Activity History"
        subtitle={loading ? 'Loading…' : `${total.toLocaleString()} event${total === 1 ? '' : 's'} matching filters`}
        action={
          <button
            onClick={() => fetchActivity(true)}
            disabled={refreshing}
            className="btn-secondary !py-1.5 !text-xs disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      {/* Category pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {CATEGORIES.map(cat => {
          const Icon = cat.icon
          const active = category === cat.value
          return (
            <button
              key={cat.value}
              onClick={() => setCategory(cat.value)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
                active
                  ? `${cat.bg} ${cat.color} border-current`
                  : 'bg-card text-ink-muted border-rule hover:border-gray-300 hover:text-ink'
              }`}
            >
              <Icon size={12} /> {cat.label}
            </button>
          )
        })}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
          <input
            type="search"
            placeholder="Search action, detail or person…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input !py-2 !pl-9 !w-60"
            aria-label="Search activity"
          />
        </div>

        <select className="input !py-2 !w-40" value={userId} onChange={e => setUserId(e.target.value)} aria-label="Filter by user">
          <option value="all">All users</option>
          {users.map(u => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
        </select>

        <select className="input !py-2 !w-44" value={department} onChange={e => setDepartment(e.target.value)} aria-label="Filter by department">
          <option value="all">All departments</option>
          {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>

        {!customDates && (
          <div className="flex items-center rounded-lg border border-rule overflow-hidden">
            {DATE_PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => setPreset(p.label)}
                className={`text-xs font-medium px-3 py-2 transition ${preset === p.label ? 'bg-brand-600 text-white' : 'text-ink-muted hover:bg-brand-500/10'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => { setCustomDates(v => !v); setPreset(customDates ? DEFAULT_PRESET : '') }}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border transition ${
            customDates ? 'bg-brand-600 text-white border-brand-600' : 'border-rule text-ink-muted hover:border-gray-300'
          }`}
        >
          <Filter size={12} /> Custom
        </button>

        {customDates && (
          <>
            <input type="date" className="input !py-2 !w-40" value={from} onChange={e => setFrom(e.target.value)} aria-label="From date" />
            <span className="text-xs text-ink-faint">to</span>
            <input type="date" className="input !py-2 !w-40" value={to} onChange={e => setTo(e.target.value)} aria-label="To date" />
          </>
        )}

        <button
          onClick={() => setSort(s => (s === 'desc' ? 'asc' : 'desc'))}
          title={sort === 'desc' ? 'Newest first — click for oldest first (s)' : 'Oldest first — click for newest first (s)'}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border transition ${
            sort === 'asc' ? 'bg-brand-600 text-white border-brand-600' : 'border-rule text-ink-muted hover:border-gray-300'
          }`}
        >
          {sort === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
          {sort === 'desc' ? 'Newest' : 'Oldest'}
        </button>

        {/* Method filter — technical, so it sits behind the rest visually but is
            reachable by keyboard like everything else. */}
        <div className="flex items-center gap-1">
          {METHODS.map(m => (
            <button
              key={m}
              onClick={() => toggleMethod(m)}
              className={`text-[11px] font-mono font-semibold px-2 py-1 rounded-md border transition ${
                methods.includes(m) ? `${METHOD_TINTS[m]} border-current` : 'border-transparent text-ink-faint hover:text-ink-muted'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {hasFilters && (
          <button onClick={clearFilters} className="inline-flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline">
            <X size={12} /> Clear all
          </button>
        )}
      </div>

      {(methods.length > 0 || department !== 'all') && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-ink-faint">Filtering by:</span>
          {methods.map(m => (
            <span key={m} className={`inline-flex items-center gap-1 text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md ${METHOD_TINTS[m]}`}>
              {m}
              <button onClick={() => toggleMethod(m)} aria-label={`Remove ${m} filter`} className="opacity-60 hover:opacity-100"><X size={10} /></button>
            </span>
          ))}
          {department !== 'all' && (
            <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md ${DEPT_TINTS[department] || 'bg-gray-500/10 text-ink-muted'}`}>
              {department}
              <button onClick={() => setDepartment('all')} aria-label="Remove department filter" className="opacity-60 hover:opacity-100"><X size={10} /></button>
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-danger bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
          {error}
          <button onClick={() => fetchActivity()} className="ml-auto text-xs font-semibold hover:underline">Retry</button>
        </div>
      )}

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-4"><Skeleton.Table rows={8} cols={4} /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-ink-faint">
            <ActivityIcon size={28} strokeWidth={1.5} />
            <p className="text-sm">{hasFilters ? 'No activity matches your filters' : 'No activity recorded yet.'}</p>
            {hasFilters && <button onClick={clearFilters} className="text-xs font-semibold text-brand-ink hover:underline">Clear filters</button>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-sm">
              <thead>
                <tr className="border-b border-divider bg-page text-left">
                  <th className="px-5 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wide">User</th>
                  <th className="px-5 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wide">Action</th>
                  <th className="px-5 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wide">Details</th>
                  <th className="px-5 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wide">
                    <button onClick={() => setSort(s => (s === 'desc' ? 'asc' : 'desc'))} className="inline-flex items-center gap-1 hover:text-ink transition-colors">
                      Time {sort === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} />}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {rows.map(row => {
                  const cat = categoryOf(row.action)
                  const CatIcon = cat.icon
                  const detail = actionDetail(row)
                  const dept = row.department
                  return (
                    <tr key={row.id} className="hover:bg-brand-500/5 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-brand-500/15 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-bold text-brand-ink">{row.user_name?.charAt(0)?.toUpperCase() || '?'}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-ink whitespace-nowrap">{row.user_name || 'Removed user'}</p>
                            {dept ? (
                              <button
                                onClick={() => setDepartment(dept)}
                                title={`Filter by ${dept}`}
                                className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full hover:opacity-80 transition-opacity ${DEPT_TINTS[dept] || 'bg-gray-500/10 text-ink-muted'}`}
                              >
                                {dept}
                              </button>
                            ) : (
                              <span className="text-[10px] text-ink-faint">{row.role || '—'}</span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${cat.bg}`}>
                            <CatIcon size={12} className={cat.color} />
                          </div>
                          <div className="min-w-0">
                            <span className="text-ink font-medium">{humanizeAction(row)}</span>
                            {row.entry_payee && (
                              <span className="block text-[11px] text-ink-muted mt-0.5 truncate max-w-[220px]">{row.entry_payee}</span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-3 max-w-xs">
                        {detail
                          ? <span className="text-xs text-ink-muted break-words">{detail}</span>
                          : <span className="text-ink-faint">—</span>}
                      </td>

                      <td className="px-5 py-3 whitespace-nowrap">
                        <p className="text-ink">{formatDateTime(row.created_at)}</p>
                        <p className="text-xs text-ink-faint flex items-center gap-1 mt-0.5">
                          <Clock size={10} /> {timeAgo(row.created_at)}
                        </p>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-ink-muted">Page {page} of {totalPages} · {total.toLocaleString()} total events</p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} aria-label="Previous page"
              className="p-1.5 rounded-lg border border-rule text-ink-muted hover:bg-brand-500/10 disabled:opacity-40 transition-colors">
              <ChevronLeft size={14} />
            </button>
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let p
              if (totalPages <= 7) p = i + 1
              else if (page <= 4) p = i + 1
              else if (page >= totalPages - 3) p = totalPages - 6 + i
              else p = page - 3 + i
              return (
                <button key={p} onClick={() => setPage(p)}
                  aria-current={p === page ? 'page' : undefined}
                  className={`w-8 h-8 text-xs rounded-lg border transition-colors ${
                    p === page ? 'bg-brand-600 text-white border-brand-600' : 'border-rule text-ink-muted hover:bg-brand-500/10'
                  }`}>
                  {p}
                </button>
              )
            })}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} aria-label="Next page"
              className="p-1.5 rounded-lg border border-rule text-ink-muted hover:bg-brand-500/10 disabled:opacity-40 transition-colors">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
