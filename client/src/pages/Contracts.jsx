import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Search, Upload, File, FileX, ArrowLeft, AlertTriangle, UserX, Clock, ChevronDown,
  ChevronUp, ChevronLeft, ChevronRight, X, Bell, Plus, Sparkles, CheckCircle2, Eye,
  Trash2, PiggyBank, Music2, DollarSign, BarChart3, TrendingUp, FileText, Loader2,
} from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { Badge, ConfirmDialog } from '../components/ui'
import useHotkeys from '../hooks/useHotkeys'
import useEscapeStack from '../hooks/useEscapeStack'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { formatDate } from '../utils/dates'
import { dropTarget } from '../utils/drop'
import { CONTRACT_TYPES, CONTRACT_STATUSES } from '../constants'

const CLAUSE_KINDS = [
  'Recording royalty', 'Advance & recoupment', 'Term & option periods', 'Delivery commitment',
  'Territory', 'Exclusivity', 'Mechanical royalties', 'Publishing split', 'Termination', 'Confidentiality',
]

const BLANK_CONTRACT = {
  artist_id: '', type: '', status: 'Active', date_signed: '', expiration_date: '',
  royalty_split: '', advance: '', territory: '', num_releases: '', notes: '', financial_terms: [],
}

// Active green, Expired/Terminated red, everything else amber (boom mapping).
const statusTone = (s) => (s === 'Active' ? 'success' : s === 'Expired' || s === 'Terminated' ? 'danger' : 'warning')

const usd0 = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n) || 0)

// Boom's smart obligation-amount formatting: numbers → $X,XXX; "15%" → as-is;
// digit-leading strings → $parsed; anything else verbatim ("statutory rate").
const fmtTermAmount = (amount) => {
  if (amount == null || amount === '') return '—'
  if (typeof amount === 'number') return `$${Number(amount).toLocaleString()}`
  const s = String(amount)
  if (s.includes('%')) return s
  if (/^\d/.test(s)) {
    const n = Number(s.replace(/,/g, ''))
    return Number.isFinite(n) ? `$${n.toLocaleString()}` : s
  }
  return s
}

const fmtAdvance = (advance) => {
  if (advance == null || advance === '') return '—'
  const n = Number(String(advance).replace(/[$,]/g, ''))
  return Number.isFinite(n) && n !== 0 ? `$${n.toLocaleString()}` : String(advance)
}

const fmtSize = (bytes) => {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return null
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

const clampPct = (v) => (v !== '' && v != null && !isNaN(Number(v)) ? Math.min(100, Math.max(0, Number(v))) : null)

// ── ConfChip ────────────────────────────────────────────────────────────────
// Small ⚠ pill next to AI-scanned fields. high → no chip; medium → amber
// "AI guess"; low → red "low confidence". Editing the field clears it.
function ConfChip({ level }) {
  if (!level || level === 'high') return null
  const low = level === 'low'
  return (
    <span
      className={`ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${low ? 'text-danger bg-[rgba(239,68,68,0.10)]' : 'text-warning bg-[rgba(245,158,11,0.12)]'}`}
      title={low ? 'AI was uncertain about this value — verify against the PDF.' : 'AI inferred this value from context — please double-check.'}
    >
      <AlertTriangle size={8} /> {low ? 'low confidence' : 'AI guess'}
    </span>
  )
}

// ── ArtistSelect ────────────────────────────────────────────────────────────
// Type-to-search artist picker (boom's SearchableSelect equivalent).
function ArtistSelect({ artists, value, onChange }) {
  const selected = artists.find(a => String(a.id) === String(value))
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const matches = artists.filter(a => a.name.toLowerCase().includes(q.toLowerCase())).slice(0, 40)
  return (
    <div className="relative">
      <input
        className="input w-full"
        placeholder="Type to search artists…"
        value={open ? q : (selected?.name || '')}
        onFocus={() => { setQ(''); setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto card p-1 shadow-elevated">
          {matches.length === 0 && <p className="px-2.5 py-2 text-[11px] text-ink-faint">No matching artists</p>}
          {matches.map(a => (
            <button
              key={a.id} type="button"
              onMouseDown={() => { onChange(String(a.id)); setOpen(false) }}
              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-sm hover:bg-elev ${String(a.id) === String(value) ? 'text-brand-ink font-medium' : 'text-ink'}`}
            >
              {a.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Royalty split widget ────────────────────────────────────────────────────
// Artist % box + computed label-share box + proportional split bar. Editable
// (create form) or read-only (detail). Label share renders in the workspace
// accent (RC-2 replaces boom red with the brand hue).
function SplitWidget({ value, onChange, labelName }) {
  const artistPct = clampPct(value)
  const labelPct = artistPct != null ? Math.round((100 - artistPct) * 100) / 100 : null
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-rule bg-elev px-3 py-2.5">
          <p className="text-[11px] text-ink-muted mb-1">Artist</p>
          <div className="flex items-baseline gap-1">
            {onChange ? (
              <input
                type="number" min="0" max="100" placeholder="—" value={value}
                onChange={e => onChange(e.target.value)}
                className="w-16 text-xl font-bold text-ink bg-transparent border-none outline-none p-0 focus:ring-0"
              />
            ) : (
              <span className="text-xl font-bold text-ink">{artistPct != null ? artistPct : '—'}</span>
            )}
            <span className="text-sm font-semibold text-ink-faint">%</span>
          </div>
        </div>
        <div className="rounded-lg border border-brand-200 bg-brand-500/10 px-3 py-2.5">
          <p className="text-[11px] text-brand-ink mb-1">{labelName || 'Label'}</p>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold text-brand-ink">{labelPct != null ? labelPct : '—'}</span>
            {labelPct != null && <span className="text-sm font-semibold text-brand-ink/70">%</span>}
          </div>
        </div>
      </div>
      {artistPct != null && (
        <div className="flex rounded-full overflow-hidden h-1.5 bg-elev">
          <div className="bg-gray-400 transition-all duration-200" style={{ width: `${artistPct}%` }} />
          <div className="bg-brand-500 transition-all duration-200" style={{ width: `${labelPct}%` }} />
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, sub, tone = 'default' }) {
  const tones = { default: 'text-ink', green: 'text-success', amber: 'text-warning' }
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide font-bold text-ink-muted">{label}</p>
      <p className={`text-base font-bold tabular-nums mt-0.5 ${tones[tone] || tones.default}`}>{value}</p>
      {sub && <p className="text-[10px] text-ink-faint mt-0.5">{sub}</p>}
    </div>
  )
}

// ── LinkedDataPanel ─────────────────────────────────────────────────────────
// Roll-up of everything the rest of the app knows about this contract's
// artist: recoupment progress, releases, income by type, spend by category.
function LinkedDataPanel({ loading, linked, contract }) {
  if (loading) {
    return (
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={14} className="text-brand-ink" />
          <h2 className="text-sm font-semibold text-ink">Linked data</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[0, 1, 2].map(i => <Skeleton.Block key={i} h="h-24" />)}
        </div>
      </div>
    )
  }
  if (!linked) return null

  const advance = Number(String(contract?.advance || '').replace(/[$,]/g, '')) || 0
  const { expenses, releases, income } = linked
  const pendingRecoup = Math.max(0, (expenses?.recoupable_total || 0) - (expenses?.ufr_total || 0))
  const totalExposure = advance + (expenses?.recoupable_total || 0)
  const recoupPct = totalExposure > 0 ? Math.min(100, Math.round(((expenses?.ufr_total || 0) / totalExposure) * 100)) : 0
  const incomeOffsetPct = totalExposure > 0 ? Math.min(100, Math.round(((income?.total || 0) / totalExposure) * 100)) : 0

  return (
    <div className="card p-5 space-y-5">
      <div className="flex items-center gap-2">
        <TrendingUp size={14} className="text-brand-ink" />
        <h2 className="text-sm font-semibold text-ink">Linked data</h2>
        <span className="text-[10px] text-ink-faint">artist-scoped · joined from the rest of the dashboard</span>
      </div>

      {(advance > 0 || expenses?.recoupable_total > 0) && (
        <div className="rounded-xl border border-rule p-4 bg-elev/50">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <PiggyBank size={13} className="text-brand-ink" />
              <span className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">Recoupment</span>
            </div>
            <span className="text-[10px] text-ink-faint">{recoupPct}% of {usd0(totalExposure)} exposure uploaded</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <Stat label="Advance" value={usd0(advance)} />
            <Stat label="Uploaded for recoupment" value={usd0(expenses?.ufr_total || 0)} sub={`${expenses?.ufr_count || 0} row${expenses?.ufr_count === 1 ? '' : 's'}`} tone="green" />
            <Stat label="Recoupable, pending" value={usd0(pendingRecoup)} sub={`${Math.max(0, (expenses?.recoupable_count || 0) - (expenses?.ufr_count || 0))} rows`} tone={pendingRecoup > 0 ? 'amber' : 'default'} />
            <Stat label="Income (lifetime)" value={usd0(income?.total || 0)} sub={(income?.during_term || 0) > 0 ? `${usd0(income.during_term)} in-term` : 'no in-term income'} tone={(income?.total || 0) > totalExposure ? 'green' : 'default'} />
          </div>
          {totalExposure > 0 && (
            <div className="space-y-1">
              <div className="flex rounded-full overflow-hidden h-2 bg-gray-200">
                <div className="bg-success" style={{ width: `${recoupPct}%` }} title={`Uploaded: ${usd0(expenses?.ufr_total || 0)}`} />
                <div className="bg-warning" style={{ width: `${Math.min(100 - recoupPct, (pendingRecoup / totalExposure) * 100)}%` }} title={`Pending: ${usd0(pendingRecoup)}`} />
              </div>
              {income?.total > 0 && (
                <div className="flex items-center gap-2 text-[10px] text-ink-muted">
                  <span>Income offset:</span>
                  <div className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden max-w-[180px]">
                    <div className="h-full bg-brand-500" style={{ width: `${incomeOffsetPct}%` }} />
                  </div>
                  <span className="tabular-nums font-semibold">{incomeOffsetPct}%</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-rule p-4">
          <div className="flex items-center gap-2 mb-2">
            <Music2 size={13} className="text-brand-ink" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">Releases</span>
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-2xl font-bold text-ink tabular-nums">{releases?.total || 0}</span>
            <span className="text-[11px] text-ink-faint">lifetime</span>
          </div>
          {(releases?.during_term || 0) > 0 && (
            <p className="text-[11px] text-ink-muted mb-3">
              <span className="font-semibold tabular-nums text-ink">{releases.during_term}</span> shipped during this contract's term
            </p>
          )}
          {(releases?.recent || []).length > 0 ? (
            <ul className="space-y-1.5 mt-2">
              {releases.recent.slice(0, 4).map(r => (
                <li key={r.id} className="text-[11px] text-ink-muted flex items-center gap-1.5 truncate">
                  <Link to={`/releases/${r.id}`} className="hover:text-brand-ink truncate font-medium">
                    {r.project_name || `Release #${r.id}`}
                  </Link>
                  {r.release_date && <span className="text-ink-faint flex-shrink-0">· {formatDate(r.release_date)}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-ink-faint mt-2">No releases on file.</p>
          )}
        </div>

        <div className="rounded-xl border border-rule p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign size={13} className="text-success" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">Income</span>
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-2xl font-bold text-ink tabular-nums">{usd0(income?.total || 0)}</span>
            <span className="text-[11px] text-ink-faint">lifetime</span>
          </div>
          {(income?.during_term || 0) > 0 && (
            <p className="text-[11px] text-ink-muted mb-3">
              <span className="font-semibold tabular-nums text-ink">{usd0(income.during_term)}</span> earned during this contract's term
            </p>
          )}
          {(income?.by_type || []).length > 0 ? (
            <ul className="space-y-1.5 mt-2">
              {income.by_type.slice(0, 4).map((t, i) => (
                <li key={i} className="text-[11px] flex items-center justify-between gap-2">
                  <span className="text-ink-muted truncate">{t.income_type}</span>
                  <span className="text-ink font-semibold tabular-nums">{usd0(t.total)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-ink-faint mt-2">No income on file.</p>
          )}
        </div>

        <div className="rounded-xl border border-rule p-4">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 size={13} className="text-danger" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">Spend by category</span>
          </div>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-2xl font-bold text-ink tabular-nums">{usd0(expenses?.total || 0)}</span>
            <span className="text-[11px] text-ink-faint">{expenses?.count || 0} row{expenses?.count === 1 ? '' : 's'}</span>
          </div>
          {(expenses?.by_category || []).length > 0 ? (
            (() => {
              const max = Math.max(...expenses.by_category.map(c => Number(c.total) || 0), 1)
              return (
                <ul className="space-y-2">
                  {expenses.by_category.slice(0, 5).map((c, i) => (
                    <li key={i}>
                      <div className="flex items-center justify-between text-[11px] mb-0.5">
                        <span className="text-ink-muted truncate">{c.category}</span>
                        <span className="text-ink font-semibold tabular-nums">{usd0(c.total)}</span>
                      </div>
                      <div className="h-1 rounded-full bg-gray-200 overflow-hidden">
                        <div className="h-full bg-danger/80" style={{ width: `${(Number(c.total) / max) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )
            })()
          ) : (
            <p className="text-[11px] text-ink-faint mt-2">No expenses on file.</p>
          )}
          {(expenses?.unpaid_count || 0) > 0 && (
            <p className="text-[10px] text-danger bg-[rgba(239,68,68,0.08)] rounded px-1.5 py-1 mt-3 inline-flex items-center gap-1 font-semibold">
              {expenses.unpaid_count} unpaid · {usd0(expenses.unpaid_total)}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── FilePreviewModal ────────────────────────────────────────────────────────
// Inline PDF preview overlay. Single mode ({url, filename}) or multi mode
// ({files:[{url, filename}]}) with a prev/next pager for revisions.
function FilePreviewModal({ preview, onClose }) {
  const [idx, setIdx] = useState(0)
  useEscapeStack(true, onClose)
  const files = preview.files
  const current = files ? files[Math.min(idx, files.length - 1)] : preview
  return (
    <div className="fixed inset-0 z-[70] bg-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-modal w-full max-w-4xl h-[88vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-rule flex-shrink-0">
          <span className="text-sm font-semibold text-ink truncate">{current.filename || 'Document'}</span>
          <div className="flex items-center gap-3 flex-shrink-0">
            {files && files.length > 1 && (
              <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0} className="p-1 rounded hover:bg-elev disabled:opacity-40" aria-label="Previous file"><ChevronLeft size={14} /></button>
                <span className="tabular-nums">{idx + 1} of {files.length}</span>
                <button onClick={() => setIdx(i => Math.min(files.length - 1, i + 1))} disabled={idx === files.length - 1} className="p-1 rounded hover:bg-elev disabled:opacity-40" aria-label="Next file"><ChevronRight size={14} /></button>
              </div>
            )}
            <a href={current.url} target="_blank" rel="noreferrer" className="text-[11px] text-brand-ink hover:underline">Open in new tab</a>
            <button onClick={onClose} className="text-ink-faint hover:text-ink" aria-label="Close"><X size={16} /></button>
          </div>
        </div>
        <iframe src={current.url} title="File preview" className="flex-1 w-full bg-elev" />
      </div>
    </div>
  )
}

// ── Contracts page ──────────────────────────────────────────────────────────
export default function Contracts() {
  const { toast } = useToast()
  const { label } = useAuth()
  const labelName = label?.name || 'Label'

  const [contracts, setContracts] = useState([])
  const [artists, setArtists] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [selected, setSelected] = useState(null)
  const [linked, setLinked] = useState(null)
  const [linkedLoading, setLinkedLoading] = useState(false)
  const [files, setFiles] = useState([])

  const [missing, setMissing] = useState(null)
  const [missingOpen, setMissingOpen] = useState(true)
  const [expiring, setExpiring] = useState([])
  const [expiringOpen, setExpiringOpen] = useState(true)

  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(null)

  const [confirmDelete, setConfirmDelete] = useState(null) // contract row
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [confirmFileDelete, setConfirmFileDelete] = useState(null) // file row
  const [fileDeleteBusy, setFileDeleteBusy] = useState(false)

  // New-contract form + AI scan
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(BLANK_CONTRACT)
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanApplied, setScanApplied] = useState(false)
  const [scanDetected, setScanDetected] = useState({})
  const [scanError, setScanError] = useState('')
  const [scanDragActive, setScanDragActive] = useState(false)
  const [scannedFile, setScannedFile] = useState(null)
  const [scanConfidence, setScanConfidence] = useState({})
  const scanInputRef = useRef(null)

  // Inline edit of an existing contract's financial_terms
  const [editingTerms, setEditingTerms] = useState(false)
  const [termsDraft, setTermsDraft] = useState([])
  const [savingTerms, setSavingTerms] = useState(false)

  // Quick-attach card
  const [dropContract, setDropContract] = useState('')
  const [dropUploading, setDropUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const dropFileInputRef = useRef(null)
  const docInputRef = useRef(null)
  const [docUploading, setDocUploading] = useState(false)

  // AI clause box (Cadence additive)
  const [aiKind, setAiKind] = useState(CLAUSE_KINDS[0])
  const [aiContext, setAiContext] = useState('')
  const [aiBusy, setAiBusy] = useState(false)

  useHotkeys({ n: () => { if (!selected) setShowForm(true) } }, [selected])

  const load = async () => {
    setLoading(true)
    try {
      const params = {}
      if (typeFilter) params.type = typeFilter
      if (statusFilter) params.status = statusFilter
      const res = await api.get('/contracts', { params })
      setContracts(res.data.data || [])
      setError('')
    } catch {
      setError('Failed to load contracts')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [typeFilter, statusFilter])

  const fetchMissing = () => api.get('/contracts/missing').then(r => setMissing(r.data.data)).catch(() => {})
  const fetchExpiring = () => api.get('/contracts/expiring').then(r => setExpiring(r.data.data || [])).catch(() => {})
  useEffect(() => {
    fetchMissing()
    fetchExpiring()
    api.get('/artists').then(r => setArtists(r.data.data || [])).catch(() => {})
  }, [])

  // Linked data + documents for the selected contract.
  useEffect(() => {
    setEditingTerms(false)
    setTermsDraft([])
    if (!selected?.id) { setLinked(null); setFiles([]); return }
    let cancelled = false
    setLinkedLoading(true)
    setLinked(null)
    api.get(`/contracts/${selected.id}/linked`)
      .then(r => { if (!cancelled) setLinked(r.data?.data || null) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLinkedLoading(false) })
    api.get(`/contracts/${selected.id}/files`)
      .then(r => { if (!cancelled) setFiles(r.data.data || []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selected?.id])

  const refreshFiles = (contractId) =>
    api.get(`/contracts/${contractId}/files`).then(r => setFiles(r.data.data || [])).catch(() => {})

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const clearScanConfidence = (field) =>
    setScanConfidence(prev => {
      if (!prev[field]) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })

  const setField = (k, v) => { setForm(f => ({ ...f, [k]: v })); clearScanConfidence(k) }

  const resetScanState = () => {
    setScanApplied(false)
    setScanDetected({})
    setScanError('')
    setScannedFile(null)
    setScanConfidence({})
  }

  // ── AI scan ──
  const handleScanFile = async (file) => {
    if (file.type !== 'application/pdf') { setScanError('Only PDF files can be scanned'); return }
    setScanning(true)
    setScanError('')
    setScanApplied(false)
    setScannedFile(file)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.post('/contracts/scan', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const d = res.data.data

      // Fuzzy-match artist name against the roster
      let artist_id = form.artist_id
      let artistMatchName = null
      let artistMatchFailed = false
      if (d.artist_name) {
        const needle = d.artist_name.toLowerCase().trim()
        const match = artists.find(a =>
          a.name.toLowerCase() === needle || a.name.toLowerCase().includes(needle) || needle.includes(a.name.toLowerCase()))
        if (match) { artist_id = String(match.id); artistMatchName = match.name }
        else artistMatchFailed = true
      }

      setForm(f => ({
        ...f,
        ...(artist_id && { artist_id }),
        ...(d.contract_type && { type: d.contract_type }),
        ...(d.royalty_split != null && { royalty_split: String(d.royalty_split) }),
        ...(d.advance != null && { advance: String(d.advance) }),
        ...(d.date_signed && { date_signed: d.date_signed }),
        ...(d.expiration_date && { expiration_date: d.expiration_date }),
        ...(d.territory && { territory: d.territory }),
        ...(d.notes && { notes: d.notes }),
        financial_terms: Array.isArray(d.financial_obligations) ? d.financial_obligations : [],
      }))
      setScanDetected({ ...d, _artistMatchName: artistMatchName, _artistMatchFailed: artistMatchFailed })
      const conf = d._confidence || {}
      const next = {}
      if (artist_id && conf.artist_name) next.artist_id = conf.artist_name
      if (d.contract_type && conf.contract_type) next.type = conf.contract_type
      if (d.royalty_split != null && conf.royalty_split) next.royalty_split = conf.royalty_split
      if (d.advance != null && conf.advance) next.advance = conf.advance
      if (d.date_signed && conf.date_signed) next.date_signed = conf.date_signed
      if (d.expiration_date && conf.expiration_date) next.expiration_date = conf.expiration_date
      if (d.territory && conf.territory) next.territory = conf.territory
      setScanConfidence(next)
      setScanApplied(true)
      if (artistMatchFailed) setScanError(`Couldn't auto-match artist "${d.artist_name}" — please select manually below.`)
    } catch (err) {
      const isSetup = err.response?.data?.setup_required
      setScanError(isSetup
        ? 'Scanning requires ANTHROPIC_API_KEY in your Railway environment variables.'
        : (err.response?.data?.error || 'Scan failed'))
    } finally {
      setScanning(false)
    }
  }

  // ── Create ──
  const saveNewContract = async () => {
    if (!form.artist_id || !form.type) return
    setSaving(true)
    try {
      const createRes = await api.post('/contracts', {
        artist_id: parseInt(form.artist_id, 10),
        type: form.type,
        status: form.status,
        date_signed: form.date_signed || null,
        expiration_date: form.expiration_date || null,
        royalty_split: form.royalty_split !== '' ? Number(form.royalty_split) : null,
        advance: form.advance || null,
        territory: form.territory || null,
        num_releases: form.num_releases || null,
        notes: form.notes || null,
        financial_terms: (form.financial_terms || []).map(({ _confidence, ...t }) => t),
      })
      const newId = createRes.data?.data?.id

      // Persist the scanned PDF on the new row — /scan only parses.
      let uploadFailed = null
      if (newId && scannedFile) {
        try {
          const fd = new FormData()
          fd.append('file', scannedFile)
          await api.post(`/contracts/${newId}/files`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
        } catch (err) {
          uploadFailed = err.response?.data?.error || err.message
        }
      }

      setForm(BLANK_CONTRACT)
      setShowForm(false)
      resetScanState()
      await load()
      fetchMissing()
      if (uploadFailed) {
        toast(`Contract created, but attaching the scanned PDF failed: ${uploadFailed} — re-attach the file from the contract's Documents panel.`, 'error')
      } else {
        toast('Contract created')
      }
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create contract', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── Uploads ──
  const uploadDoc = async (contractId, file, { fromDetail = false } = {}) => {
    if (!file) return
    if (file.type !== 'application/pdf') { toast('Only PDF files are allowed', 'error'); return }
    if (fromDetail) setDocUploading(true)
    else setDropUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      await api.post(`/contracts/${contractId}/files`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast('File uploaded')
      if (fromDetail) refreshFiles(contractId)
      setDropContract('')
      load()
      fetchMissing()
    } catch (err) {
      toast(err.response?.data?.error || 'Upload failed', 'error')
    } finally {
      setDocUploading(false)
      setDropUploading(false)
    }
  }

  // ── Preview ──
  const fileUrl = async (contractId, fileId) =>
    (await api.get(`/contracts/${contractId}/files/${fileId}`)).data.data.url

  const openPreview = async (contract) => {
    if (previewLoading) return
    setPreviewLoading(contract.id)
    try {
      const r = await api.get(`/contracts/${contract.id}/files`)
      const list = r.data?.data || []
      if (!list.length) { toast('No file attached', 'error'); return }
      const withUrls = await Promise.all(list.map(async f => ({ url: await fileUrl(contract.id, f.id), filename: f.original_name })))
      setPreview(withUrls.length > 1 ? { files: withUrls } : withUrls[0])
    } catch {
      toast('Could not open file', 'error')
    } finally {
      setPreviewLoading(null)
    }
  }

  const previewOne = async (contractId, f) => {
    try {
      setPreview({ url: await fileUrl(contractId, f.id), filename: f.original_name })
    } catch {
      toast('Could not open file', 'error')
    }
  }

  // ── Delete ──
  const doDeleteContract = async () => {
    const c = confirmDelete
    if (!c) return
    setDeleteBusy(true)
    try {
      await api.delete(`/contracts/${c.id}`)
      setContracts(prev => prev.filter(x => x.id !== c.id))
      if (selected?.id === c.id) setSelected(null)
      setConfirmDelete(null)
      fetchMissing()
      fetchExpiring()
      toast('Contract deleted')
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to delete contract', 'error')
    } finally {
      setDeleteBusy(false)
    }
  }

  const doDeleteFile = async () => {
    const f = confirmFileDelete
    if (!f || !selected) return
    setFileDeleteBusy(true)
    try {
      await api.delete(`/contracts/${selected.id}/files/${f.id}`)
      setConfirmFileDelete(null)
      refreshFiles(selected.id)
      load()
      fetchMissing()
    } catch {
      toast('Failed to delete file', 'error')
    } finally {
      setFileDeleteBusy(false)
    }
  }

  // ── Financial terms editing (detail) ──
  const beginEditTerms = () => {
    setTermsDraft(Array.isArray(selected?.financial_terms) ? selected.financial_terms.map(t => ({ ...t })) : [])
    setEditingTerms(true)
  }
  const saveTerms = async () => {
    if (!selected) return
    setSavingTerms(true)
    try {
      const cleaned = termsDraft
        .map(t => ({ label: (t.label || '').trim(), amount: t.amount, recoupable: !!t.recoupable, note: (t.note || '').trim() || null }))
        .filter(t => t.label || t.amount)
      await api.patch(`/contracts/${selected.id}`, { financial_terms: cleaned })
      setSelected(s => ({ ...s, financial_terms: cleaned }))
      setContracts(prev => prev.map(c => c.id === selected.id ? { ...c, financial_terms: cleaned } : c))
      setEditingTerms(false)
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save obligations', 'error')
    } finally {
      setSavingTerms(false)
    }
  }

  const draftClauseAi = async () => {
    setAiBusy(true)
    try {
      const { data } = await api.post('/contracts/draft-clause', { kind: aiKind, context: aiContext })
      const clause = data.data?.text?.trim()
      if (clause) {
        setForm(f => ({ ...f, notes: f.notes ? `${f.notes}\n\n${aiKind.toUpperCase()}\n${clause}` : `${aiKind.toUpperCase()}\n${clause}` }))
        setAiContext('')
        toast('Clause drafted — review and edit in Notes')
      }
    } catch (err) {
      toast(err.response?.data?.error || 'Drafting failed', 'error')
    } finally { setAiBusy(false) }
  }

  const getExpiryBucket = (days) => {
    if (days <= 30) return { label: '≤30 days', cls: 'text-danger bg-[rgba(239,68,68,0.08)] border-[rgba(239,68,68,0.25)]' }
    if (days <= 60) return { label: '31–60 days', cls: 'text-warning bg-[rgba(245,158,11,0.10)] border-[rgba(245,158,11,0.3)]' }
    return { label: '61–90 days', cls: 'text-ink-muted bg-elev border-rule' }
  }

  const filteredContracts = contracts.filter(c =>
    !searchTerm || c.artist_name?.toLowerCase().includes(searchTerm.toLowerCase()))

  const totalMissingCount = missing
    ? (missing.noContract?.length || 0) + (missing.noFile?.length || 0) + (missing.expiredUnreplaced?.length || 0)
    : 0

  const openDetailById = (contractId) => {
    const full = contracts.find(x => x.id === contractId)
    if (full) setSelected(full)
  }

  // Shared dialogs rendered in both page states.
  const dialogs = (
    <>
      {preview && <FilePreviewModal preview={preview} onClose={() => setPreview(null)} />}
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={doDeleteContract}
        busy={deleteBusy}
        title="Delete contract"
        message={confirmDelete
          ? `Delete the ${confirmDelete.type || 'contract'} contract for ${confirmDelete.artist_name || `#${confirmDelete.id}`}?`
            + ((confirmDelete.file_count || 0) > 0 ? ` This will also delete ${confirmDelete.file_count} attached file${confirmDelete.file_count === 1 ? '' : 's'}.` : '')
            + ' This cannot be undone.'
          : ''}
      />
      <ConfirmDialog
        open={!!confirmFileDelete}
        onClose={() => setConfirmFileDelete(null)}
        onConfirm={doDeleteFile}
        busy={fileDeleteBusy}
        title="Delete file"
        message={confirmFileDelete ? `Delete "${confirmFileDelete.original_name}"? This cannot be undone.` : ''}
      />
    </>
  )

  if (loading && contracts.length === 0 && !error) {
    return (
      <div className="space-y-6">
        <Skeleton.PageHeader />
        <Skeleton.Table rows={6} cols={6} />
      </div>
    )
  }

  // ── Detail view ──
  if (selected) {
    const rs = selected.royalty_split != null && selected.royalty_split !== '' ? clampPct(selected.royalty_split) : null
    return (
      <div className="space-y-6">
        {dialogs}
        <button
          onClick={() => setSelected(null)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink transition-colors"
        >
          <ArrowLeft size={14} /> Back to Contracts
        </button>

        <div>
          <h1 className="text-2xl font-semibold text-ink">{selected.artist_name || `${selected.type} contract`}</h1>
          <p className="text-sm text-ink-muted mt-1">{selected.type} Agreement</p>
        </div>

        {/* Contract Details */}
        <div className="card p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-y-5 gap-x-6">
            <div>
              <p className="text-[11px] font-medium text-ink-muted mb-1">Type</p>
              <p className="text-sm font-semibold text-ink">{selected.type}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-ink-muted mb-1">Status</p>
              <Badge tone={statusTone(selected.status)}>{selected.status}</Badge>
            </div>
            <div>
              <p className="text-[11px] font-medium text-ink-muted mb-1">Territory</p>
              <p className="text-sm font-semibold text-ink">{selected.territory || '—'}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-ink-muted mb-1">Releases</p>
              <p className="text-sm font-semibold text-ink">{selected.num_releases || '—'}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-ink-muted mb-1">Date Signed</p>
              <p className="text-sm font-semibold text-ink">{formatDate(selected.date_signed)}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-ink-muted mb-1">Expiration Date</p>
              <p className="text-sm font-semibold text-ink">{formatDate(selected.expiration_date)}</p>
            </div>
            <div className="col-span-2">
              <p className="text-[11px] font-medium text-ink-muted mb-2">Royalty Split</p>
              {rs != null ? <SplitWidget value={rs} labelName={labelName} /> : <p className="text-sm text-ink-faint">—</p>}
            </div>
            <div>
              <p className="text-[11px] font-medium text-ink-muted mb-1">Advance</p>
              <p className="text-sm font-semibold text-ink">{fmtAdvance(selected.advance)}</p>
            </div>
          </div>

          {selected.notes && (
            <div className="mt-5 pt-5 border-t border-divider">
              <p className="text-[11px] font-medium text-ink-muted mb-1.5">Notes</p>
              <p className="text-sm text-ink whitespace-pre-wrap">{selected.notes}</p>
            </div>
          )}
        </div>

        <LinkedDataPanel loading={linkedLoading} linked={linked} contract={selected} />

        {/* Financial Obligations — inline editable */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-ink">Financial Obligations</h2>
            {!editingTerms ? (
              <button onClick={beginEditTerms} className="text-[11px] text-brand-ink hover:underline font-medium">Edit</button>
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={() => { setEditingTerms(false); setTermsDraft([]) }} disabled={savingTerms} className="text-[11px] text-ink-muted hover:text-ink font-medium">Cancel</button>
                <button onClick={saveTerms} disabled={savingTerms} className="btn-primary !py-1 !px-3 text-xs">{savingTerms ? 'Saving…' : 'Save'}</button>
              </div>
            )}
          </div>

          {!editingTerms ? (
            Array.isArray(selected.financial_terms) && selected.financial_terms.length > 0 ? (
              <div className="divide-y divide-divider">
                {selected.financial_terms.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-brand-500 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-ink">{item.label}</p>
                        {item.note && <p className="text-[11px] text-ink-faint">{item.note}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {item.recoupable && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[rgba(245,158,11,0.12)] text-warning font-medium">recoupable</span>
                      )}
                      <p className="text-sm font-semibold text-ink tabular-nums">{fmtTermAmount(item.amount)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-ink-faint py-2">No deals on this contract yet. Click Edit to add one.</p>
            )
          ) : (
            <div className="space-y-2">
              {termsDraft.length === 0 && (
                <p className="text-[11px] text-ink-faint py-1">No deals yet — click "Add item" to add the first one.</p>
              )}
              {termsDraft.map((item, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
                  <input type="text" placeholder="e.g. Recording Fund" value={item.label || ''}
                    onChange={e => setTermsDraft(d => d.map((t, i) => i === idx ? { ...t, label: e.target.value } : t))}
                    className="input text-sm !py-1.5" />
                  <input type="text" placeholder="e.g. 50000 or 15%" value={item.amount ?? ''}
                    onChange={e => setTermsDraft(d => d.map((t, i) => i === idx ? { ...t, amount: e.target.value } : t))}
                    className="input text-sm !py-1.5" />
                  <label className="flex items-center gap-1.5 text-[11px] text-ink-muted whitespace-nowrap cursor-pointer select-none">
                    <input type="checkbox" checked={!!item.recoupable}
                      onChange={e => setTermsDraft(d => d.map((t, i) => i === idx ? { ...t, recoupable: e.target.checked } : t))}
                      className="rounded border-rule text-brand-600 focus:ring-brand-400" />
                    Recoupable
                  </label>
                  <button type="button" onClick={() => setTermsDraft(d => d.filter((_, i) => i !== idx))}
                    className="text-ink-faint hover:text-danger transition-colors" aria-label="Remove deal">
                    <X size={13} />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setTermsDraft(d => [...d, { label: '', amount: '', recoupable: false, note: '' }])}
                className="mt-2 text-[11px] text-brand-ink hover:underline font-medium flex items-center gap-1">
                <Plus size={11} /> Add item
              </button>
            </div>
          )}
        </div>

        {/* Documents */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-ink">Documents</h2>
            <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-brand-ink hover:underline cursor-pointer"
              {...dropTarget(f => uploadDoc(selected.id, f, { fromDetail: true }))}>
              {docUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              {docUploading ? 'Uploading…' : 'Upload PDF'}
              <input ref={docInputRef} type="file" accept=".pdf" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadDoc(selected.id, f, { fromDetail: true }); e.target.value = '' }} />
            </label>
          </div>
          {files.length === 0 ? (
            <p className="text-[11px] text-ink-faint py-2">No documents uploaded yet. Drop a PDF on "Upload PDF" or click it to browse.</p>
          ) : (
            <div className="divide-y divide-divider">
              {files.map(f => (
                <div key={f.id} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0 gap-3">
                  <button onClick={() => previewOne(selected.id, f)} className="flex items-center gap-2.5 min-w-0 text-left group">
                    <File size={14} className="text-brand-ink flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate group-hover:text-brand-ink">{f.original_name}</p>
                      <p className="text-[10px] text-ink-faint">
                        {formatDate(f.created_at)}
                        {f.uploaded_by_name ? ` · ${f.uploaded_by_name}` : ''}
                        {fmtSize(f.file_size) ? ` · ${fmtSize(f.file_size)}` : ''}
                      </p>
                    </div>
                    <Eye size={10} className="text-ink-faint opacity-60 flex-shrink-0" />
                  </button>
                  <button onClick={() => setConfirmFileDelete(f)} className="text-ink-faint hover:text-danger transition-colors p-1 flex-shrink-0" title="Delete file">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── List view ──
  return (
    <div className="space-y-6">
      {dialogs}
      <PageHeader
        title="Contracts"
        subtitle="Manage your artist contracts"
        action={
          <div className="flex items-center gap-2">
            <Link to="/contracts/create" className="btn-secondary">
              <Sparkles size={14} /> Draft with AI
            </Link>
            <button onClick={() => setShowForm(v => !v)} className="btn-primary">
              <Plus size={14} /> New Contract
            </button>
          </div>
        }
      />

      {/* New Contract form */}
      {showForm && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">New Contract</h2>
            <button onClick={() => { setShowForm(false); resetScanState() }} className="text-ink-faint hover:text-ink"><X size={14} /></button>
          </div>

          {/* Scan zone */}
          {scanApplied ? (
            <div className="flex items-start gap-3 px-4 py-3 bg-[rgba(16,185,129,0.08)] border border-[rgba(16,185,129,0.25)] rounded-xl">
              <CheckCircle2 size={14} className="text-success mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-success mb-0.5">
                  Contract scanned — fields auto-filled
                  {scannedFile && <span className="font-normal"> · PDF will be saved on Create</span>}
                  {(() => {
                    const flagged = Object.values(scanConfidence).filter(c => c === 'medium' || c === 'low').length
                    const flaggedTerms = (form.financial_terms || []).filter(t => t?._confidence === 'medium' || t?._confidence === 'low').length
                    const total = flagged + flaggedTerms
                    if (!total) return null
                    return (
                      <span className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide text-warning bg-[rgba(245,158,11,0.12)]">
                        <AlertTriangle size={9} /> {total} field{total === 1 ? '' : 's'} to review
                      </span>
                    )
                  })()}
                </p>
                {scanDetected._artistMatchFailed && (
                  <p className="text-[11px] font-medium text-warning bg-[rgba(245,158,11,0.10)] rounded px-2 py-1 mb-1.5">
                    ⚠ Couldn't match "{scanDetected.artist_name}" to an artist — select manually below
                  </p>
                )}
                {scanDetected._artistMatchName && (
                  <p className="text-[11px] text-success mb-1">Matched artist: <span className="font-semibold">{scanDetected._artistMatchName}</span></p>
                )}
                <p className="text-[11px] text-ink-muted leading-relaxed mb-1">
                  {[
                    scanDetected.contract_type && `Type: ${scanDetected.contract_type}`,
                    scanDetected.royalty_split != null && `Royalty: ${scanDetected.royalty_split}% / ${100 - scanDetected.royalty_split}%`,
                    scanDetected.advance != null && `Advance: $${Number(scanDetected.advance).toLocaleString()}`,
                    scanDetected.territory && `Territory: ${scanDetected.territory}`,
                  ].filter(Boolean).join('  ·  ')}
                </p>
                {Array.isArray(scanDetected.financial_obligations) && scanDetected.financial_obligations.length > 0 && (
                  <p className="text-[11px] text-ink-muted">
                    <span className="font-medium">Financial terms: </span>
                    {scanDetected.financial_obligations.map((o, i) => (
                      <span key={i}>
                        {o.label}{o.amount != null ? ` — ${fmtTermAmount(o.amount)}` : ''}{o.recoupable ? ' (recoupable)' : ''}
                        {i < scanDetected.financial_obligations.length - 1 ? '  ·  ' : ''}
                      </span>
                    ))}
                  </p>
                )}
              </div>
              <button onClick={resetScanState} title="Clear scan and re-scan" className="text-ink-faint hover:text-ink flex-shrink-0"><X size={13} /></button>
            </div>
          ) : (
            <div>
              <div
                onClick={() => !scanning && scanInputRef.current?.click()}
                onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setScanDragActive(true) }}
                onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setScanDragActive(false) }}
                onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
                onDrop={e => {
                  e.preventDefault(); e.stopPropagation(); setScanDragActive(false)
                  const file = e.dataTransfer?.files?.[0]
                  if (file) handleScanFile(file)
                }}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-dashed transition-all
                  ${scanning ? 'border-brand-300 bg-brand-500/10 cursor-not-allowed'
                    : scanDragActive ? 'border-brand-400 bg-brand-500/15 cursor-copy scale-[1.005]'
                    : 'border-rule hover:border-brand-400 hover:bg-brand-500/10 cursor-pointer'}`}
              >
                {scanning ? (
                  <>
                    <Loader2 size={15} className="text-brand-ink animate-spin flex-shrink-0" />
                    <p className="text-sm text-ink-muted">Reading contract…</p>
                  </>
                ) : (
                  <>
                    <div className="w-8 h-8 rounded-lg bg-elev flex items-center justify-center flex-shrink-0">
                      <Sparkles size={14} className={scanDragActive ? 'text-brand-ink' : 'text-ink-faint'} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-ink">{scanDragActive ? 'Drop to scan' : 'Scan contract PDF to auto-fill'}</p>
                      <p className="text-[11px] text-ink-faint">Drop a PDF here or click to browse · fields fill automatically</p>
                    </div>
                  </>
                )}
                <input ref={scanInputRef} type="file" accept=".pdf" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleScanFile(f); e.target.value = '' }} />
              </div>
              {scanError && (
                <p className="mt-2 text-[11px] text-danger flex items-center gap-1.5"><AlertTriangle size={11} /> {scanError}</p>
              )}
              <p className="mt-2 text-[11px] text-ink-faint">Or fill in manually below ↓</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label flex items-center">Artist *<ConfChip level={scanConfidence.artist_id} /></label>
              <ArtistSelect artists={artists} value={form.artist_id} onChange={v => setField('artist_id', v)} />
            </div>
            <div>
              <label className="label flex items-center">Type *<ConfChip level={scanConfidence.type} /></label>
              <select value={form.type} onChange={e => setField('type', e.target.value)} className="input w-full">
                <option value="">Select type…</option>
                {CONTRACT_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select value={form.status} onChange={set('status')} className="input w-full">
                {CONTRACT_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label"># Releases</label>
              <input className="input w-full" value={form.num_releases} onChange={set('num_releases')} placeholder="e.g. 3" />
            </div>
            <div className="sm:col-span-2">
              <label className="label flex items-center mb-2">Royalty Split<ConfChip level={scanConfidence.royalty_split} /></label>
              <SplitWidget value={form.royalty_split} onChange={v => setField('royalty_split', v)} labelName={labelName} />
            </div>
            <div>
              <label className="label flex items-center">Date Signed<ConfChip level={scanConfidence.date_signed} /></label>
              <input type="date" value={form.date_signed} onChange={e => setField('date_signed', e.target.value)} className="input w-full" />
            </div>
            <div>
              <label className="label flex items-center">Expiration Date<ConfChip level={scanConfidence.expiration_date} /></label>
              <input type="date" value={form.expiration_date} onChange={e => setField('expiration_date', e.target.value)} className="input w-full" />
            </div>
            <div>
              <label className="label flex items-center">Advance ($)<ConfChip level={scanConfidence.advance} /></label>
              <input type="number" placeholder="e.g. 5000" value={form.advance} onChange={e => setField('advance', e.target.value)} className="input w-full" />
            </div>
            <div>
              <label className="label flex items-center">Territory<ConfChip level={scanConfidence.territory} /></label>
              <input type="text" placeholder="e.g. Worldwide" value={form.territory} onChange={e => setField('territory', e.target.value)} className="input w-full" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Notes</label>
              <textarea rows={2} placeholder="Any additional notes…" value={form.notes} onChange={set('notes')} className="input w-full resize-none" />
            </div>
          </div>

          {/* Financial Obligations */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label !mb-0">Financial Obligations</label>
              <button type="button"
                onClick={() => setForm(f => ({ ...f, financial_terms: [...(f.financial_terms || []), { label: '', amount: '', recoupable: false, note: '' }] }))}
                className="text-[11px] text-brand-ink hover:underline font-medium flex items-center gap-1">
                <Plus size={11} /> Add item
              </button>
            </div>
            {(!form.financial_terms || form.financial_terms.length === 0) ? (
              <p className="text-[11px] text-ink-faint py-2">No financial terms yet — scan a contract PDF above or add manually.</p>
            ) : (
              <div className="space-y-2">
                {form.financial_terms.map((item, idx) => {
                  const rowConf = item?._confidence
                  const patchTerm = (patch) => setForm(f => {
                    const terms = [...f.financial_terms]
                    const { _confidence: _drop, ...rest } = terms[idx] || {}
                    terms[idx] = { ...rest, ...patch }
                    return { ...f, financial_terms: terms }
                  })
                  return (
                    <div key={idx}>
                      {rowConf && rowConf !== 'high' && <div className="mb-1"><ConfChip level={rowConf} /></div>}
                      <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
                        <input type="text" placeholder="e.g. Recording Fund" value={item.label || ''}
                          onChange={e => patchTerm({ label: e.target.value })} className="input text-sm !py-1.5" />
                        <input type="text" placeholder="e.g. 50000 or 15%" value={item.amount ?? ''}
                          onChange={e => patchTerm({ amount: e.target.value })} className="input text-sm !py-1.5" />
                        <label className="flex items-center gap-1.5 text-[11px] text-ink-muted whitespace-nowrap cursor-pointer select-none">
                          <input type="checkbox" checked={item.recoupable || false}
                            onChange={e => patchTerm({ recoupable: e.target.checked })}
                            className="rounded border-rule text-brand-600 focus:ring-brand-400" />
                          Recoupable
                        </label>
                        <button type="button"
                          onClick={() => setForm(f => ({ ...f, financial_terms: f.financial_terms.filter((_, i) => i !== idx) }))}
                          className="text-ink-faint hover:text-danger transition-colors" aria-label="Remove item">
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* AI clause box (Cadence additive) */}
          <div className="rounded-xl border border-dashed border-rule bg-page/40 p-3">
            <div className="flex items-center gap-1.5 mb-2"><Sparkles size={13} className="text-brand-ink" /><span className="text-xs font-semibold text-ink">Draft a clause with AI</span></div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-44"><label className="label">Clause</label><select className="input !py-1.5 text-sm" value={aiKind} onChange={e => setAiKind(e.target.value)}>{CLAUSE_KINDS.map(k => <option key={k}>{k}</option>)}</select></div>
              <div className="flex-1 min-w-[180px]"><label className="label">Terms / context (optional)</label><input className="input !py-1.5 text-sm" value={aiContext} onChange={e => setAiContext(e.target.value)} placeholder="e.g. 18% royalty, 2 albums, recoupable advance" /></div>
              <button type="button" onClick={draftClauseAi} disabled={aiBusy} className="btn-secondary !py-1.5">{aiBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {aiBusy ? 'Drafting…' : 'Generate'}</button>
            </div>
            <p className="text-[11px] text-ink-faint mt-1.5">Generated clauses are appended to Notes for review. AI features require a configured key.</p>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => { setShowForm(false); resetScanState() }} className="text-sm text-ink-muted hover:text-ink px-3 py-2">Cancel</button>
            <button onClick={saveNewContract} disabled={saving || !form.artist_id || !form.type} className="btn-primary disabled:opacity-40">
              {saving ? 'Saving…' : 'Create Contract'}
            </button>
          </div>
        </div>
      )}

      {/* Missing Contracts */}
      {totalMissingCount > 0 && (
        <div className="card overflow-hidden">
          <button onClick={() => setMissingOpen(!missingOpen)} className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-elev transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[rgba(245,158,11,0.12)] flex items-center justify-center">
                <AlertTriangle size={15} className="text-warning" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-ink">Missing Contracts</p>
                <p className="text-[11px] text-ink-muted">{totalMissingCount} issue{totalMissingCount !== 1 ? 's' : ''} need attention</p>
              </div>
            </div>
            {missingOpen ? <ChevronUp size={15} className="text-ink-faint" /> : <ChevronDown size={15} className="text-ink-faint" />}
          </button>

          {missingOpen && (
            <div className="border-t border-divider divide-y divide-divider">
              {missing?.noContract?.length > 0 && (
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-3">
                    <UserX size={13} className="text-danger" />
                    <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">No Contract on File</p>
                    <Badge tone="danger" className="!text-[10px] !px-2">{missing.noContract.length}</Badge>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {missing.noContract.map(artist => (
                      <div key={artist.id} className="flex items-center justify-between px-3 py-2 bg-[rgba(239,68,68,0.06)] rounded-lg border border-[rgba(239,68,68,0.2)]">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink truncate">{artist.name}</p>
                          <p className="text-[11px] text-ink-muted">{artist.release_count} release{artist.release_count !== 1 ? 's' : ''}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {missing?.noFile?.length > 0 && (
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-3">
                    <FileX size={13} className="text-warning" />
                    <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Missing Document Upload</p>
                    <Badge tone="warning" className="!text-[10px] !px-2">{missing.noFile.length}</Badge>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {missing.noFile.map(c => (
                      <button key={c.contract_id} onClick={() => openDetailById(c.contract_id)}
                        className="flex items-center justify-between px-3 py-2 bg-[rgba(245,158,11,0.07)] rounded-lg border border-[rgba(245,158,11,0.25)] text-left hover:border-warning transition-colors">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink truncate">{c.artist_name}</p>
                          <p className="text-[11px] text-ink-muted">{c.type} · {c.status}</p>
                        </div>
                        <Upload size={12} className="text-warning flex-shrink-0 ml-2" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {missing?.expiredUnreplaced?.length > 0 && (
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock size={13} className="text-ink-muted" />
                    <p className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Expired — No Active Replacement</p>
                    <Badge tone="neutral" className="!text-[10px] !px-2">{missing.expiredUnreplaced.length}</Badge>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {missing.expiredUnreplaced.map((c, idx) => (
                      <div key={idx} className="flex items-center justify-between px-3 py-2 bg-elev rounded-lg border border-rule">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink truncate">{c.name}</p>
                          <p className="text-[11px] text-ink-muted">{c.type} · expired {formatDate(c.expiration_date)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Expiring within 90 days */}
      {expiring.length > 0 && (
        <div className="card overflow-hidden">
          <button onClick={() => setExpiringOpen(!expiringOpen)} className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-elev transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[rgba(245,158,11,0.12)] flex items-center justify-center">
                <Bell size={15} className="text-warning" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-ink">Contracts Expiring Soon</p>
                <p className="text-[11px] text-ink-muted">{expiring.length} active contract{expiring.length !== 1 ? 's' : ''} expire within 90 days</p>
              </div>
            </div>
            {expiringOpen ? <ChevronUp size={15} className="text-ink-faint" /> : <ChevronDown size={15} className="text-ink-faint" />}
          </button>

          {expiringOpen && (
            <div className="border-t border-divider px-5 py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {expiring.map(c => {
                  const bucket = getExpiryBucket(c.days_until_expiry)
                  return (
                    <button key={c.id} onClick={() => setSelected(c)}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-lg border text-left hover:opacity-80 transition-opacity ${bucket.cls}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink truncate">{c.artist_name || '(unassigned)'}</p>
                        <p className="text-[11px] text-ink-muted">{c.type}</p>
                      </div>
                      <div className="flex-shrink-0 text-right ml-3">
                        <p className="text-[11px] font-bold tabular-nums">{c.days_until_expiry}d</p>
                        <p className="text-[10px] opacity-70">{formatDate(c.expiration_date)}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="card p-4 flex flex-col md:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" size={15} />
          <input type="text" placeholder="Search by artist name..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="input w-full !pl-9" />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input md:w-44">
          <option value="">All Types</option>
          {CONTRACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input md:w-44">
          <option value="">All Statuses</option>
          {CONTRACT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Quick-attach */}
      <div className="card p-4">
        <h2 className="text-sm font-semibold text-ink mb-3">Attach Document to Contract</h2>
        <div className="flex items-center gap-3">
          <select value={dropContract} onChange={e => setDropContract(e.target.value)} className="input flex-1">
            <option value="">Choose a contract…</option>
            {contracts.map(c => (
              <option key={c.id} value={c.id}>{c.artist_name || '(unassigned)'} — {c.type} ({c.status})</option>
            ))}
          </select>
          <div
            onDragEnter={e => { e.preventDefault(); setDragActive(true) }}
            onDragLeave={e => { e.preventDefault(); setDragActive(false) }}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault(); setDragActive(false)
              if (!dropContract) return
              const file = e.dataTransfer?.files?.[0]
              if (file) uploadDoc(parseInt(dropContract, 10), file)
            }}
            onClick={() => { if (dropContract) dropFileInputRef.current?.click() }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed transition-all flex-shrink-0
              ${!dropContract ? 'border-rule bg-elev opacity-50 cursor-not-allowed'
                : dragActive ? 'border-brand-400 bg-brand-500/15 cursor-pointer'
                : 'border-rule hover:border-brand-400 hover:bg-brand-500/10 cursor-pointer'}
              ${dropUploading ? 'pointer-events-none opacity-60' : ''}`}
          >
            {dropUploading
              ? <Loader2 size={14} className="text-brand-ink animate-spin" />
              : <Upload size={13} className={dragActive ? 'text-brand-ink' : 'text-ink-faint'} />}
            <span className="text-[11px] font-medium text-ink-muted whitespace-nowrap">
              {dropUploading ? 'Uploading…' : dragActive ? 'Drop here' : 'Drop or browse PDF'}
            </span>
            <input ref={dropFileInputRef} type="file" accept=".pdf" className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file && dropContract) uploadDoc(parseInt(dropContract, 10), file)
                e.target.value = ''
              }} />
          </div>
        </div>
      </div>

      {/* Error state — distinct from the empty state, with a retry */}
      {error && (
        <div className="card p-8 text-center">
          <p className="text-sm text-danger mb-3">{error}</p>
          <button onClick={load} className="btn-secondary">Retry</button>
        </div>
      )}

      {/* Table */}
      {!error && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-divider bg-page/50 text-left">
                  {['Artist', 'Type', 'Status', 'Signed', 'Expires', `Artist / ${labelName}`, 'Doc', ''].map((h, i) => (
                    <th key={i} className={`px-4 py-3 text-[10px] font-semibold text-ink-muted uppercase tracking-wide ${i >= 6 ? 'w-10' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {filteredContracts.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="px-4 py-12 text-center text-sm text-ink-faint">No contracts found</td>
                  </tr>
                ) : (
                  filteredContracts.map(contract => {
                    const rs = contract.royalty_split != null && contract.royalty_split !== '' ? clampPct(contract.royalty_split) : null
                    return (
                      <tr key={contract.id} onClick={() => setSelected(contract)} className="hover:bg-elev cursor-pointer transition-colors">
                        <td className="px-4 py-3 font-medium text-ink">{contract.artist_name || '—'}</td>
                        <td className="px-4 py-3 text-ink-muted">{contract.type}</td>
                        <td className="px-4 py-3"><Badge tone={statusTone(contract.status)}>{contract.status}</Badge></td>
                        <td className="px-4 py-3 text-ink-muted">{formatDate(contract.date_signed)}</td>
                        <td className="px-4 py-3 text-ink-muted">{formatDate(contract.expiration_date)}</td>
                        <td className="px-4 py-3">
                          {rs != null ? (
                            <span className="inline-flex items-center gap-1 text-sm">
                              <span className="font-medium text-ink">{rs}%</span>
                              <span className="text-ink-faint">/</span>
                              <span className="font-medium text-brand-ink">{Math.round((100 - rs) * 100) / 100}%</span>
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {(contract.file_count || 0) === 0 ? (
                            <FileX size={13} className="text-ink-faint" />
                          ) : (
                            <button
                              onClick={e => { e.stopPropagation(); openPreview(contract) }}
                              disabled={previewLoading === contract.id}
                              title={contract.file_count > 1 ? `View ${contract.file_count} uploaded PDFs` : 'View PDF'}
                              className="inline-flex items-center gap-1 text-brand-ink hover:opacity-70 transition-opacity disabled:opacity-60"
                            >
                              <File size={13} />
                              {contract.file_count > 1 && <span className="text-[10px] font-bold tabular-nums">{contract.file_count}</span>}
                              <Eye size={10} className="opacity-60" />
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={e => { e.stopPropagation(); setConfirmDelete(contract) }}
                            disabled={deleteBusy && confirmDelete?.id === contract.id}
                            className="text-ink-faint hover:text-danger transition-colors p-1 disabled:opacity-50"
                            title="Delete this contract (also removes attached files)"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
