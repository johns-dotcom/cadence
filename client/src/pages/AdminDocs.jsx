import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, Plus, ArrowLeft, AlertTriangle, X, FileText, ShieldCheck, Lock, Upload,
  Download, Trash2, Loader2,
} from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { ConfirmDialog } from '../components/ui'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { formatDate } from '../utils/dates'

const CATEGORIES = ['Legal', 'NDAs', 'Compliance', 'HR / People', 'Financial', 'IP / Brand', 'Internal Policies', 'Templates']
const STATUSES = ['Active', 'Draft', 'Expired', 'Archived']
const CONFIDENTIALITY = ['Internal', 'Restricted']
const TABS = ['All', ...CATEGORIES]

// Active reads green, Draft is the in-progress amber, Expired is the alarm.
// (An earlier build had Draft grey and Expired amber — the inversion made an
// expired legal document look calmer than an unfinished one.)
const STATUS_STYLE = {
  Active:   'bg-[rgba(16,185,129,0.12)] text-success',
  Draft:    'bg-[rgba(245,158,11,0.12)] text-warning',
  Expired:  'bg-[rgba(239,68,68,0.10)] text-danger',
  Archived: 'bg-gray-100 text-ink-faint',
}

const BLANK = {
  title: '', category: '', counterparty: '', status: 'Active', confidentiality: 'Internal',
  signed_date: '', expiration_date: '', tags: [], notes: '', is_template: false,
}

const asTags = (v) => (Array.isArray(v) ? v : String(v || '').split(',').map(t => t.trim()).filter(Boolean))
const dateInput = (v) => (v ? String(v).slice(0, 10) : '')
const stripExt = (name) => name.replace(/\.[^.]+$/, '') || name

// Secure document vault — Admin/Superadmin only (server enforces the same).
// Restricted-confidentiality documents are Superadmin-only end to end.
export default function AdminDocs() {
  const { toast } = useToast()
  const { user } = useAuth()
  const isSuperadmin = user?.role === 'Superadmin'

  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('All')
  const [statusFilter, setStatusFilter] = useState('')
  const [confFilter, setConfFilter] = useState('')

  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const [creating, setCreating] = useState(false)
  const [newDraft, setNewDraft] = useState(BLANK)
  const [createSaving, setCreateSaving] = useState(false)

  const [expiring, setExpiring] = useState([])
  const [expiringOpen, setExpiringOpen] = useState(true)

  const quickInputRef = useRef(null)
  const [quick, setQuick] = useState({ done: 0, total: 0 })
  const [dragActive, setDragActive] = useState(false)

  const loadDocs = async () => {
    setLoading(true)
    try {
      const res = await api.get('/admin-docs')
      setDocs(res.data?.data || [])
      setError('')
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load admin documents')
    } finally { setLoading(false) }
  }
  const loadExpiring = async () => {
    try { setExpiring((await api.get('/admin-docs/expiring')).data?.data || []) } catch { /* non-critical */ }
  }
  useEffect(() => { loadDocs(); loadExpiring() }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return docs.filter(d => {
      if (tab === 'Templates') { if (!d.is_template && d.category !== 'Templates') return false }
      else if (tab !== 'All') { if (d.category !== tab) return false }
      if (statusFilter && d.status !== statusFilter) return false
      if (confFilter && d.confidentiality !== confFilter) return false
      if (q) {
        const blob = `${d.title || ''} ${d.counterparty || ''} ${asTags(d.tags).join(' ')}`.toLowerCase()
        if (!blob.includes(q)) return false
      }
      return true
    })
  }, [docs, search, tab, statusFilter, confFilter])

  const countFor = (t) => (t === 'Templates'
    ? docs.filter(d => d.is_template || d.category === 'Templates').length
    : docs.filter(d => d.category === t).length)

  const openDoc = (d) => { setSelected(d); setEditing(false); setDraft(BLANK); setError('') }

  const beginEdit = () => {
    if (!selected) return
    setDraft({
      title: selected.title || '', category: selected.category || '',
      counterparty: selected.counterparty || '', status: selected.status || 'Active',
      confidentiality: selected.confidentiality || 'Internal',
      signed_date: dateInput(selected.signed_date), expiration_date: dateInput(selected.expiration_date),
      tags: asTags(selected.tags), notes: selected.notes || '', is_template: !!selected.is_template,
    })
    setEditing(true)
  }

  const saveEdit = async () => {
    if (!selected) return
    if (!draft.title.trim()) { setError('Title is required'); return }
    setSaving(true)
    try {
      const updated = (await api.patch(`/admin-docs/${selected.id}`, draft)).data?.data
      if (updated) {
        setSelected(s => ({ ...s, ...updated }))
        setDocs(prev => prev.map(d => (d.id === updated.id ? { ...d, ...updated } : d)))
        loadExpiring()
      }
      setEditing(false); setError('')
      toast('Document saved')
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed')
    } finally { setSaving(false) }
  }

  // Quick status change straight from the list — the one edit that shouldn't
  // cost a round trip through the detail view.
  const setStatus = async (doc, status) => {
    const prev = doc.status
    setDocs(list => list.map(d => (d.id === doc.id ? { ...d, status } : d)))
    try { await api.patch(`/admin-docs/${doc.id}`, { status }) }
    catch (err) {
      setDocs(list => list.map(d => (d.id === doc.id ? { ...d, status: prev } : d)))
      toast(err.response?.data?.error || 'Failed to change status', 'error')
    }
  }

  const doDelete = async () => {
    const doc = confirmDelete
    if (!doc) return
    try {
      await api.delete(`/admin-docs/${doc.id}`)
      setDocs(prev => prev.filter(d => d.id !== doc.id))
      if (selected?.id === doc.id) setSelected(null)
      setConfirmDelete(null)
      loadExpiring()
      toast('Document deleted')
    } catch (err) {
      setConfirmDelete(null)
      toast(err.response?.data?.error || 'Delete failed', 'error')
    }
  }

  const submitNew = async () => {
    if (!newDraft.title.trim() || !newDraft.category) { setError('Title and category are required'); return }
    setCreateSaving(true)
    try {
      const created = (await api.post('/admin-docs', newDraft)).data?.data
      if (created) {
        setDocs(prev => [created, ...prev])
        setCreating(false); setNewDraft(BLANK); setError('')
        setSelected(created)
        loadExpiring()
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Create failed')
    } finally { setCreateSaving(false) }
  }

  // Quick upload: every dropped file becomes its own document, titled from the
  // filename with the extension stripped. Category is left blank on purpose —
  // filing it is a decision, and it can be made from the detail view.
  const quickUpload = async (fileList) => {
    const files = Array.from(fileList || []).filter(Boolean)
    if (!files.length) return
    setError('')
    setQuick({ done: 0, total: files.length })
    const created = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      try {
        const doc = (await api.post('/admin-docs', { title: stripExt(file.name) })).data?.data
        if (!doc?.id) throw new Error('Create failed')
        const fd = new FormData()
        fd.append('file', file)
        await api.post(`/admin-docs/${doc.id}/files`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
        created.push({ ...doc, file_count: 1 })
      } catch (err) {
        setError(err.response?.data?.error || `Upload failed for ${file.name}`)
      }
      setQuick(s => ({ ...s, done: i + 1 }))
    }
    if (created.length) setDocs(prev => [...created, ...prev])
    setQuick({ done: 0, total: 0 })
    if (quickInputRef.current) quickInputRef.current.value = ''
  }

  const onPageDrag = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault(); e.stopPropagation()
    setDragActive(e.type === 'dragenter' || e.type === 'dragover')
  }
  const onPageDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(false)
    if (e.dataTransfer?.files?.length) quickUpload(e.dataTransfer.files)
  }

  // ── Detail view ───────────────────────────────────────────────────────
  if (selected) {
    return (
      <div className="max-w-4xl space-y-5">
        <button onClick={() => { setSelected(null); setEditing(false); setError('') }}
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
          <ArrowLeft size={14} /> Back to documents
        </button>

        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink tracking-tight">{selected.title}</h1>
            <p className="text-sm text-ink-muted mt-1 flex items-center gap-2 flex-wrap">
              <span>{selected.category || 'Uncategorised'}</span>
              {selected.confidentiality === 'Restricted' && (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-[rgba(239,68,68,0.10)] text-danger font-medium">
                  <Lock size={11} /> Restricted
                </span>
              )}
              {selected.is_template && (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-ink font-medium">
                  <ShieldCheck size={11} /> Template
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {!editing ? (
              <>
                <button onClick={beginEdit} className="btn-secondary text-xs">Edit</button>
                <button onClick={() => setConfirmDelete(selected)} className="btn-secondary text-xs text-danger">Delete</button>
              </>
            ) : (
              <>
                <button onClick={() => { setEditing(false); setError('') }} disabled={saving} className="btn-secondary text-xs">Cancel</button>
                <button onClick={saveEdit} disabled={saving} className="btn-primary text-xs">{saving ? 'Saving…' : 'Save'}</button>
              </>
            )}
          </div>
        </div>

        {error && <ErrorStrip error={error} onDismiss={() => setError('')} />}

        <div className="card p-5">
          {!editing ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <Field label="Status" value={selected.status || '—'} />
              <Field label="Confidentiality" value={selected.confidentiality || '—'} />
              <Field label="Counterparty" value={selected.counterparty || '—'} />
              <Field label="Date Signed" value={formatDate(selected.signed_date)} />
              <Field label="Expires" value={formatDate(selected.expiration_date)} />
              <Field label="Created By" value={selected.created_by_name || '—'} />
              {asTags(selected.tags).length > 0 && (
                <div className="col-span-2">
                  <p className="text-xs font-medium text-ink-muted mb-1.5">Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {asTags(selected.tags).map((t, i) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-ink-muted">{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {selected.notes && (
                <div className="col-span-2">
                  <p className="text-xs font-medium text-ink-muted mb-1.5">Notes</p>
                  <p className="text-sm text-ink whitespace-pre-wrap">{selected.notes}</p>
                </div>
              )}
            </div>
          ) : (
            <DocForm draft={draft} setDraft={setDraft} isSuperadmin={isSuperadmin} />
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="px-5 pt-4 pb-1"><h2 className="text-sm font-semibold text-ink">Files</h2></div>
          <FilesPanel docId={selected.id} onCountChange={(n) => setDocs(prev => prev.map(d => (d.id === selected.id ? { ...d, file_count: n } : d)))} />
        </div>

        <ConfirmDialog
          open={!!confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={doDelete}
          title="Delete document"
          message={`Delete "${confirmDelete?.title}"? This also removes any attached files.`}
        />
      </div>
    )
  }

  // ── List view ─────────────────────────────────────────────────────────
  const uploading = quick.total > 0
  return (
    <div className="relative" onDragEnter={onPageDrag} onDragLeave={onPageDrag} onDragOver={onPageDrag} onDrop={onPageDrop}>
      <input ref={quickInputRef} type="file" multiple className="hidden" onChange={e => quickUpload(e.target.files)} />

      {dragActive && (
        <div className="fixed inset-0 z-40 bg-brand-500/10 border-4 border-dashed border-brand-400 rounded-lg flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-brand-ink">
            <Upload size={32} />
            <p className="text-lg font-semibold">Drop to upload</p>
            <p className="text-sm">Each file becomes a new document</p>
          </div>
        </div>
      )}

      <PageHeader
        title="Admin Docs"
        subtitle="Legal, NDAs, compliance, HR, IP, internal policies & templates"
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => quickInputRef.current?.click()} disabled={uploading} className="btn-secondary"
              title="Upload a file as a new document (title from filename)">
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {uploading ? `Uploading ${quick.done}/${quick.total}…` : 'Upload File'}
            </button>
            <button onClick={() => { setCreating(v => !v); setNewDraft(BLANK) }} className="btn-primary">
              <Plus size={15} /> New Document
            </button>
          </div>
        }
      />

      {error && <div className="mb-4"><ErrorStrip error={error} onDismiss={() => setError('')} /></div>}

      {expiring.length > 0 && expiringOpen && (
        <div className="card p-4 mb-6 border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)]">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2 text-warning font-semibold text-sm">
              <AlertTriangle size={16} />
              {expiring.length} document{expiring.length !== 1 ? 's' : ''} expiring within 60 days
            </div>
            <button onClick={() => setExpiringOpen(false)} title="Dismiss" className="text-warning hover:text-ink"><X size={14} /></button>
          </div>
          <div className="space-y-1">
            {expiring.slice(0, 5).map(d => (
              <button key={d.id} onClick={() => { const full = docs.find(x => x.id === d.id); if (full) openDoc(full) }}
                className="block w-full text-left text-sm text-ink hover:underline">
                {d.title} — {d.category || 'Uncategorised'}{d.counterparty ? ` (${d.counterparty})` : ''} —
                <span className={`ml-1 font-semibold ${d.days_left <= 14 ? 'text-danger' : 'text-warning'}`}>
                  {d.days_left} day{d.days_left !== 1 ? 's' : ''}
                </span>
              </button>
            ))}
            {expiring.length > 5 && <p className="text-xs text-warning">+{expiring.length - 5} more</p>}
          </div>
        </div>
      )}

      {creating && (
        <div className="card p-5 mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">New Document</h2>
            <button onClick={() => setCreating(false)} className="text-ink-faint hover:text-ink"><X size={15} /></button>
          </div>
          <DocForm draft={newDraft} setDraft={setNewDraft} isSuperadmin={isSuperadmin} />
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setCreating(false)} disabled={createSaving} className="btn-secondary text-xs">Cancel</button>
            <button onClick={submitNew} disabled={createSaving} className="btn-primary text-xs">{createSaving ? 'Creating…' : 'Create'}</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input type="text" placeholder="Search title, counterparty, tag…" value={search}
            onChange={e => setSearch(e.target.value)} className="input pl-8" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input w-auto">
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={confFilter} onChange={e => setConfFilter(e.target.value)} className="input w-auto">
          <option value="">All Levels</option>
          {CONFIDENTIALITY.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="border-b border-rule mb-4 overflow-x-auto">
        <div className="flex gap-4 min-w-max">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`pb-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === t ? 'border-brand-500 text-brand-ink' : 'border-transparent text-ink-muted hover:text-ink'
              }`}>
              {t}
              {t !== 'All' && <span className="ml-1.5 text-xs text-ink-faint">{countFor(t)}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Skeleton.Table rows={5} cols={6} />
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <FileText size={28} className="mx-auto text-ink-faint mb-2" />
            <p className="text-sm text-ink-muted">
              {docs.length === 0 ? 'No documents in the vault yet.' : 'No documents match your filters.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] text-ink-muted uppercase tracking-wide border-b border-divider bg-elev">
                  <th className="px-4 py-2.5 font-semibold">Title</th>
                  <th className="px-4 py-2.5 font-semibold">Category</th>
                  <th className="px-4 py-2.5 font-semibold">Counterparty</th>
                  <th className="px-4 py-2.5 font-semibold">Signed</th>
                  <th className="px-4 py-2.5 font-semibold">Expires</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold">Confidentiality</th>
                  <th className="px-4 py-2.5 font-semibold">Files</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {filtered.map(d => (
                  <tr key={d.id} onClick={() => openDoc(d)} className="hover:bg-gray-50 cursor-pointer transition-colors">
                    <td className="px-4 py-3 font-medium text-ink">
                      <span className="flex items-center gap-2">
                        {d.confidentiality === 'Restricted' && <Lock size={12} className="text-danger flex-shrink-0" />}
                        {d.is_template && <ShieldCheck size={12} className="text-brand-ink flex-shrink-0" />}
                        {d.title}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{d.category || '—'}</td>
                    <td className="px-4 py-3 text-ink-muted">{d.counterparty || '—'}</td>
                    <td className="px-4 py-3 text-ink-muted">{formatDate(d.signed_date)}</td>
                    <td className="px-4 py-3 text-ink-muted">{formatDate(d.expiration_date)}</td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <select value={d.status || 'Active'} onChange={e => setStatus(d, e.target.value)}
                        title="Change status"
                        className={`text-[10px] font-semibold rounded-full px-2 py-1 border-0 cursor-pointer ${STATUS_STYLE[d.status] || STATUS_STYLE.Active}`}>
                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{d.confidentiality || '—'}</td>
                    <td className="px-4 py-3 text-ink-muted tabular-nums">{d.file_count || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={doDelete}
        title="Delete document"
        message={`Delete "${confirmDelete?.title}"? This also removes any attached files.`}
      />
    </div>
  )
}

function ErrorStrip({ error, onDismiss }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3 rounded-lg bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)] text-danger text-sm">
      <span>{error}</span>
      <button onClick={onDismiss} title="Dismiss"><X size={14} /></button>
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-xs font-medium text-ink-muted mb-1.5">{label}</p>
      <p className="text-sm font-semibold text-ink">{value}</p>
    </div>
  )
}

// Multi-file panel — every upload is kept as its own revision, with the
// uploader and date, so filing an amendment never overwrites the original.
function FilesPanel({ docId, onCountChange }) {
  const { toast } = useToast()
  const inputRef = useRef(null)
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const rows = (await api.get(`/admin-docs/${docId}/files`)).data?.data || []
      setFiles(rows); onCountChange?.(rows.length)
    } catch { /* keep the panel quiet — the page already has an error strip */ }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [docId])

  const upload = async (fileList) => {
    const list = Array.from(fileList || []).filter(Boolean)
    if (!list.length) return
    setBusy(true)
    try {
      for (const file of list) {
        const fd = new FormData()
        fd.append('file', file)
        await api.post(`/admin-docs/${docId}/files`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      }
      toast(list.length === 1 ? 'File uploaded' : `${list.length} files uploaded`)
      await load()
    } catch (err) {
      toast(err.response?.data?.error || 'Upload failed', 'error')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const open = async (f) => {
    try {
      const { data } = await api.get(`/admin-docs/${docId}/files/${f.id}`)
      window.open(data.data.url, '_blank', 'noopener')
    } catch { toast('File is not available', 'error') }
  }
  const remove = async (f) => {
    if (!window.confirm(`Remove "${f.original_name}"?`)) return
    try { await api.delete(`/admin-docs/${docId}/files/${f.id}`); await load() }
    catch (err) { toast(err.response?.data?.error || 'Delete failed', 'error') }
  }

  const kb = (n) => (n == null ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

  return (
    <div className="px-5 pb-5"
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); upload(e.dataTransfer?.files) }}>
      {loading ? (
        <div className="py-3 space-y-2"><Skeleton.Line w="w-1/2" /><Skeleton.Line w="w-1/3" /></div>
      ) : files.length === 0 ? (
        <p className="text-sm text-ink-faint py-3">No files attached yet — upload or drop one here.</p>
      ) : (
        <ul className="divide-y divide-divider mb-3">
          {files.map(f => (
            <li key={f.id} className="flex items-center justify-between gap-3 py-2.5">
              <button onClick={() => open(f)} className="flex items-center gap-2 min-w-0 text-sm text-brand-ink hover:underline">
                <Download size={13} className="flex-shrink-0" />
                <span className="truncate">{f.original_name}</span>
              </button>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-[11px] text-ink-faint">
                  {formatDate(f.created_at)}{f.uploaded_by_name ? ` · ${f.uploaded_by_name}` : ''}{f.file_size ? ` · ${kb(f.file_size)}` : ''}
                </span>
                <button onClick={() => remove(f)} title="Remove file" className="text-ink-faint hover:text-danger"><Trash2 size={13} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <button onClick={() => inputRef.current?.click()} disabled={busy} className="btn-secondary text-xs">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Add file
      </button>
      <input ref={inputRef} type="file" multiple className="hidden" onChange={e => upload(e.target.files)} />
    </div>
  )
}

function DocForm({ draft, setDraft, isSuperadmin }) {
  const [tagDraft, setTagDraft] = useState('')
  const tags = asTags(draft.tags)
  const addTag = () => {
    const t = tagDraft.trim()
    if (!t || tags.includes(t)) { setTagDraft(''); return }
    setDraft(d => ({ ...d, tags: [...asTags(d.tags), t] }))
    setTagDraft('')
  }
  const removeTag = (i) => setDraft(d => ({ ...d, tags: asTags(d.tags).filter((_, idx) => idx !== i) }))
  const set = (k) => (e) => setDraft(d => ({ ...d, [k]: e.target.value }))

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="sm:col-span-2">
        <label className="label">Title *</label>
        <input className="input" value={draft.title} onChange={set('title')} />
      </div>
      <div>
        <label className="label">Category *</label>
        <select className="input" value={draft.category} onChange={set('category')}>
          <option value="">— Select —</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Counterparty</label>
        <input className="input" value={draft.counterparty} onChange={set('counterparty')} />
      </div>
      <div>
        <label className="label">Status</label>
        <select className="input" value={draft.status} onChange={set('status')}>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div>
        <label className="label">
          Confidentiality
          {!isSuperadmin && <span className="text-ink-faint font-normal ml-1">(Superadmin sets Restricted)</span>}
        </label>
        <select className="input" value={draft.confidentiality} onChange={set('confidentiality')}>
          {CONFIDENTIALITY.filter(c => isSuperadmin || c !== 'Restricted').map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Date Signed</label>
        <input type="date" className="input" value={draft.signed_date} onChange={set('signed_date')} />
      </div>
      <div>
        <label className="label">Expiration Date</label>
        <input type="date" className="input" value={draft.expiration_date} onChange={set('expiration_date')} />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Tags</label>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {tags.map((t, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-ink-muted">
                {t}
                <button type="button" onClick={() => removeTag(i)} className="text-ink-faint hover:text-danger"><X size={10} /></button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="Add a tag and press Enter" value={tagDraft}
            onChange={e => setTagDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }} />
          <button type="button" onClick={addTag} className="btn-secondary text-xs">Add</button>
        </div>
      </div>
      <div className="sm:col-span-2">
        <label className="label">Notes</label>
        <textarea rows={3} className="input" value={draft.notes} onChange={set('notes')} />
      </div>
      <label className="sm:col-span-2 inline-flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
        <input type="checkbox" className="accent-brand-600" checked={!!draft.is_template}
          onChange={e => setDraft(d => ({ ...d, is_template: e.target.checked }))} />
        Treat as a reusable template (shows in the Templates tab)
      </label>
    </div>
  )
}
