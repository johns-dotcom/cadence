import { useEffect, useMemo, useRef, useState } from 'react'
import { Image as ImageIcon, Upload, Download, Copy, Check, Trash2, Search, Palette } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { formatDate } from '../utils/dates'

const CATEGORIES = ['Logo', 'Icon', 'Cover art', 'Photo', 'Graphic', 'Other']
const fmtSize = (b) => {
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

export default function Brand() {
  const { user, label } = useAuth()
  const { toast } = useToast()
  const canManage = ['Superadmin', 'Admin', 'Approver'].includes(user?.role)
  const fileRef = useRef(null)

  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [pending, setPending] = useState(null) // { file, name, category }
  const [uploading, setUploading] = useState(false)
  const [copied, setCopied] = useState(null)

  const load = () => { setLoading(true); api.get('/brand-assets').then(r => setAssets(r.data.data || [])).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(load, [])

  const onPick = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPending({ file, name: file.name.replace(/\.[^.]+$/, ''), category: 'Logo' })
    e.target.value = ''
  }
  const upload = async () => {
    if (!pending) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', pending.file)
      fd.append('name', pending.name.trim() || pending.file.name)
      fd.append('category', pending.category)
      await api.post('/brand-assets', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast('Asset uploaded')
      setPending(null); load()
    } catch (err) { toast(err.response?.data?.error || 'Upload failed', 'error') }
    finally { setUploading(false) }
  }
  const remove = async (a) => {
    if (!window.confirm(`Delete "${a.name}"?`)) return
    try { await api.delete(`/brand-assets/${a.id}`); load() } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const recategorize = async (a, category) => {
    try { await api.patch(`/brand-assets/${a.id}`, { category }); setAssets(list => list.map(x => x.id === a.id ? { ...x, category } : x)) }
    catch { toast('Failed', 'error') }
  }
  const copyLink = (a) => { if (!a.url) return; navigator.clipboard.writeText(a.url).then(() => { setCopied(a.id); setTimeout(() => setCopied(null), 1500) }) }

  const shown = useMemo(() => {
    const lq = q.trim().toLowerCase()
    return assets.filter(a => (!cat || a.category === cat) && (!lq || a.name.toLowerCase().includes(lq)))
  }, [assets, q, cat])

  const canDelete = (a) => canManage || a.uploaded_by === user?.id

  return (
    <div>
      <PageHeader
        title="Brand"
        subtitle="Your team's logos and images — upload once, grab them anywhere"
        action={<button onClick={() => fileRef.current?.click()} className="btn-primary"><Upload size={16} /> Upload</button>}
      />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />

      {/* Workspace identity reference */}
      <div className="card p-4 mb-6 flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {label?.logo_url ? <img src={label.logo_url} alt="" className="w-full h-full object-contain p-1" /> : <span className="text-lg font-bold text-gray-400">{label?.name?.charAt(0)?.toUpperCase()}</span>}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink">{label?.name}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="w-3 h-3 rounded-full border border-rule" style={{ background: label?.accent_color || 'rgb(var(--color-brand-600))' }} />
            <span className="text-[11px] text-gray-400 font-mono">{label?.accent_color || 'default accent'}</span>
          </div>
        </div>
        <a href="/settings" className="text-xs font-semibold text-brand-600 hover:underline inline-flex items-center gap-1"><Palette size={13} /> Workspace branding</a>
      </div>

      {/* Pending upload form */}
      {pending && (
        <div className="card p-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden ring-1 ring-black/5">
              <img src={URL.createObjectURL(pending.file)} alt="" className="w-full h-full object-contain p-1" />
            </div>
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><label className="label">Name</label><input className="input !py-1.5 text-sm" value={pending.name} onChange={e => setPending(p => ({ ...p, name: e.target.value }))} /></div>
              <div><label className="label">Category</label><select className="input !py-1.5 text-sm" value={pending.category} onChange={e => setPending(p => ({ ...p, category: e.target.value }))}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
            </div>
            <div className="flex flex-col gap-1.5 flex-shrink-0">
              <button onClick={upload} disabled={uploading} className="btn-primary !py-1.5 text-xs">{uploading ? 'Uploading…' : 'Save'}</button>
              <button onClick={() => setPending(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search assets…" className="input !pl-9" />
        </div>
        <div className="flex items-center gap-0.5 bg-gray-100 rounded-xl p-0.5 flex-wrap">
          <button onClick={() => setCat('')} className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg ${cat === '' ? 'bg-card text-ink shadow-sm' : 'text-gray-500'}`}>All</button>
          {CATEGORIES.map(c => <button key={c} onClick={() => setCat(c)} className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg ${cat === c ? 'bg-card text-ink shadow-sm' : 'text-gray-500'}`}>{c}</button>)}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton.Block key={i} h="h-44" />)}</div>
      ) : shown.length === 0 ? (
        <div className="card p-12 text-center">
          <ImageIcon size={30} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">{assets.length ? 'No assets match.' : 'No brand assets yet.'}</p>
          {!assets.length && <button onClick={() => fileRef.current?.click()} className="btn-secondary mt-3"><Upload size={15} /> Upload your first</button>}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {shown.map(a => (
            <div key={a.id} className="card overflow-hidden group">
              <div className="aspect-square bg-gray-50 flex items-center justify-center relative border-b border-divider" style={{ backgroundImage: 'linear-gradient(45deg,#f3f4f6 25%,transparent 25%),linear-gradient(-45deg,#f3f4f6 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#f3f4f6 75%),linear-gradient(-45deg,transparent 75%,#f3f4f6 75%)', backgroundSize: '16px 16px', backgroundPosition: '0 0,0 8px,8px -8px,-8px 0' }}>
                {a.url ? <img src={a.url} alt={a.name} className="max-w-full max-h-full object-contain p-3" /> : <ImageIcon size={28} className="text-gray-300" />}
                <div className="absolute inset-x-0 bottom-0 p-2 flex justify-center gap-1 opacity-0 group-hover:opacity-100 transition bg-gradient-to-t from-black/40 to-transparent">
                  <a href={a.url || '#'} download={a.name} target="_blank" rel="noopener noreferrer" title="Download" className="p-1.5 rounded-lg bg-white/90 text-gray-700 hover:bg-white"><Download size={14} /></a>
                  <button onClick={() => copyLink(a)} title="Copy link" className="p-1.5 rounded-lg bg-white/90 text-gray-700 hover:bg-white">{copied === a.id ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}</button>
                  {canDelete(a) && <button onClick={() => remove(a)} title="Delete" className="p-1.5 rounded-lg bg-white/90 text-gray-700 hover:text-red-600 hover:bg-white"><Trash2 size={14} /></button>}
                </div>
              </div>
              <div className="p-2.5">
                <p className="text-sm font-medium text-ink truncate" title={a.name}>{a.name}</p>
                <div className="flex items-center justify-between mt-1">
                  {canManage ? (
                    <select value={a.category} onChange={e => recategorize(a, e.target.value)} className="text-[10px] font-semibold text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5 cursor-pointer border-0">
                      {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  ) : <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5">{a.category}</span>}
                  <span className="text-[10px] text-gray-400">{fmtSize(a.size_bytes)}</span>
                </div>
                <p className="text-[10px] text-gray-400 mt-1 truncate">{a.uploader || 'Someone'} · {formatDate(a.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
