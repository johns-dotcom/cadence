import { useEffect, useState } from 'react'
import { Building2, ShieldCheck, ShieldAlert, X, Upload, ExternalLink, Pencil, GitMerge, Tag, Trash2, Plus, Sparkles, AlertTriangle } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'

const SEV = { high: 'bg-red-100 text-red-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-gray-100 text-gray-600' }

function VendorDrawer({ name, allNames, onClose, onChanged, onRenamed }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState({ email: '', address: '', bank: '', notes: '' })
  const [aliases, setAliases] = useState([])
  const [newAlias, setNewAlias] = useState('')
  const [renameTo, setRenameTo] = useState('')
  const [mergeInto, setMergeInto] = useState('')

  const loadAliases = () => api.get(`/ledger/vendors/${encodeURIComponent(name)}/aliases`).then(r => setAliases(r.data.data || [])).catch(() => {})
  const load = () => {
    setLoading(true)
    api.get(`/ledger/vendors/${encodeURIComponent(name)}`).then(res => {
      setData(res.data.data)
      const v = res.data.data.vendor || {}
      setEdit({ email: v.email || '', address: v.address || '', bank: v.bank || '', notes: v.notes || '' })
    }).catch(() => {}).finally(() => setLoading(false))
    loadAliases()
  }
  useEffect(load, [name])

  const save = async () => {
    try { await api.patch(`/ledger/vendors/${encodeURIComponent(name)}`, edit); toast('Saved'); onChanged?.() }
    catch { toast('Failed', 'error') }
  }
  const doRename = async () => {
    if (!renameTo.trim()) return
    try { await api.put('/ledger/vendors/rename', { from: name, to: renameTo.trim() }); toast('Vendor renamed'); onChanged?.(); onRenamed?.(renameTo.trim()) }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const doMerge = async () => {
    if (!mergeInto) return
    if (!window.confirm(`Merge "${name}" into "${mergeInto}"? All invoices move over and "${name}" becomes an alias.`)) return
    try { await api.post('/ledger/vendors/merge', { from: name, into: mergeInto }); toast('Vendors merged'); onChanged?.(); onClose() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const addAlias = async () => {
    if (!newAlias.trim()) return
    try { await api.post(`/ledger/vendors/${encodeURIComponent(name)}/aliases`, { alias: newAlias.trim() }); setNewAlias(''); loadAliases() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const delAlias = async (id) => { try { await api.delete(`/ledger/vendors/aliases/${id}`); loadAliases() } catch { toast('Failed', 'error') } }
  const uploadW9 = async (file) => {
    if (!file) return
    const fd = new FormData(); fd.append('file', file)
    try { await api.post(`/ledger/vendors/${encodeURIComponent(name)}/w9`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }); toast('W9 uploaded'); load(); onChanged?.() }
    catch (err) { toast(err.response?.data?.error || 'Upload failed', 'error') }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-overlay" onClick={onClose} />
      <div className="relative w-full max-w-md bg-card border-l border-rule h-full overflow-y-auto p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-ink">{name}</h2>
            <p className="text-xs text-gray-400">Vendor</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {loading ? <p className="text-sm text-gray-400">Loading…</p> : data && (
          <>
            {/* W9 */}
            <div className="card p-4 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {data.vendor.w9_filename
                    ? <><ShieldCheck size={16} className="text-emerald-500" /><span className="text-sm text-ink">W9 on file</span></>
                    : <><ShieldAlert size={16} className="text-amber-500" /><span className="text-sm text-gray-500">No W9 on file</span></>}
                </div>
                <div className="flex items-center gap-2">
                  {data.vendor.w9_url && <a href={data.vendor.w9_url} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:text-brand-700"><ExternalLink size={15} /></a>}
                  <label className="btn-secondary cursor-pointer text-xs py-1.5">
                    <Upload size={13} /> {data.vendor.w9_filename ? 'Replace' : 'Upload'}
                    <input type="file" className="hidden" onChange={e => uploadW9(e.target.files[0])} />
                  </label>
                </div>
              </div>
            </div>

            {/* Contact */}
            <div className="space-y-3 mb-4">
              <div><label className="label">Email</label><input className="input" value={edit.email} onChange={e => setEdit(s => ({ ...s, email: e.target.value }))} /></div>
              <div><label className="label">Address</label><input className="input" value={edit.address} onChange={e => setEdit(s => ({ ...s, address: e.target.value }))} /></div>
              <div><label className="label">Bank</label><input className="input" value={edit.bank} onChange={e => setEdit(s => ({ ...s, bank: e.target.value }))} /></div>
              <div><label className="label">Notes</label><textarea className="input" rows={2} value={edit.notes} onChange={e => setEdit(s => ({ ...s, notes: e.target.value }))} /></div>
              <button onClick={save} className="btn-primary">Save details</button>
            </div>

            {/* Aliases */}
            <div className="card p-4 mb-4">
              <p className="text-xs font-bold text-ink mb-2 inline-flex items-center gap-1.5"><Tag size={13} /> Aliases</p>
              <p className="text-[11px] text-gray-400 mb-2">Alternate spellings that resolve to this vendor (used by dup-check).</p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {aliases.map(a => (
                  <span key={a.id} className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded px-2 py-0.5">
                    {a.alias}<button onClick={() => delAlias(a.id)} className="text-gray-400 hover:text-red-600"><X size={11} /></button>
                  </span>
                ))}
                {!aliases.length && <span className="text-xs text-gray-300">No aliases</span>}
              </div>
              <div className="flex gap-2">
                <input className="input !py-1.5 text-sm" placeholder="Add an alias" value={newAlias} onChange={e => setNewAlias(e.target.value)} onKeyDown={e => e.key === 'Enter' && addAlias()} />
                <button onClick={addAlias} className="btn-secondary flex-shrink-0 !py-1.5"><Plus size={14} /></button>
              </div>
            </div>

            {/* Rename + merge (admin) */}
            {isAdmin && (
              <div className="card p-4 mb-4 space-y-3">
                <div>
                  <label className="label inline-flex items-center gap-1.5"><Pencil size={12} /> Rename vendor</label>
                  <div className="flex gap-2">
                    <input className="input !py-1.5 text-sm" placeholder={name} value={renameTo} onChange={e => setRenameTo(e.target.value)} />
                    <button onClick={doRename} className="btn-secondary flex-shrink-0 !py-1.5">Rename</button>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">Updates every invoice; the old name becomes an alias.</p>
                </div>
                <div>
                  <label className="label inline-flex items-center gap-1.5"><GitMerge size={12} /> Merge into</label>
                  <div className="flex gap-2">
                    <select className="input !py-1.5 text-sm" value={mergeInto} onChange={e => setMergeInto(e.target.value)}>
                      <option value="">— pick vendor —</option>
                      {(allNames || []).filter(n => n.toLowerCase() !== name.toLowerCase()).map(n => <option key={n}>{n}</option>)}
                    </select>
                    <button onClick={doMerge} disabled={!mergeInto} className="btn-secondary flex-shrink-0 !py-1.5">Merge</button>
                  </div>
                </div>
              </div>
            )}

            {/* Entries */}
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Invoices ({data.entries.length})</h3>
            <div className="space-y-1.5">
              {data.entries.map(e => (
                <div key={e.id} className="flex items-center justify-between text-sm border-b border-divider py-1.5">
                  <span className="text-gray-600">{e.invoice_date ? new Date(e.invoice_date).toLocaleDateString() : '—'} · {e.invoice_number || 'no #'}</span>
                  <span className="text-ink font-medium">{e.currency} {Number(e.amount).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function Vendors() {
  const { user } = useAuth()
  const { toast } = useToast()
  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState(null)

  const load = () => {
    setLoading(true)
    api.get('/ledger/vendors').then(res => setVendors(res.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const scanAllW9s = async () => {
    setScanning(true)
    try { const { data } = await api.post('/ledger/vendors/scan-w9s'); setScanResults(data.data || []) }
    catch (err) { toast(err.response?.data?.error || 'Scan failed', 'error') }
    finally { setScanning(false) }
  }

  const allNames = vendors.map(v => v.name)

  return (
    <div>
      <PageHeader
        title="Vendors"
        subtitle="Everyone you've paid, grouped by payee"
        action={isAdmin && vendors.some(v => v.w9_on_file) ? (
          <button onClick={scanAllW9s} disabled={scanning} className="btn-secondary"><Sparkles size={15} /> {scanning ? 'Scanning W9s…' : 'Scan all W9s'}</button>
        ) : null}
      />

      {scanResults && (
        <div className="card p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-ink">W9 scan results ({scanResults.length})</h2>
            <button onClick={() => setScanResults(null)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {scanResults.map((r, i) => (
              <div key={i} className="text-sm border-b border-divider pb-2">
                <p className="font-medium text-ink flex items-center gap-2">
                  {r.flags?.length ? <AlertTriangle size={14} className="text-amber-500" /> : <ShieldCheck size={14} className="text-emerald-500" />}
                  {r.vendor}
                </p>
                {!r.ok ? <p className="text-xs text-gray-400">{r.reason}</p> : (
                  <>
                    {r.summary && <p className="text-xs text-gray-500">{r.summary}</p>}
                    {r.flags?.map((f, j) => (
                      <span key={j} className={`inline-flex mt-1 mr-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${SEV[f.severity] || SEV.low}`}>{f.field}</span>
                    ))}
                  </>
                )}
              </div>
            ))}
            {!scanResults.length && <p className="text-sm text-gray-400">No vendors with a W9 on file.</p>}
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : vendors.length === 0 ? (
        <div className="card p-10 text-center"><Building2 size={28} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">No vendors yet. They appear once you have approved ledger entries.</p></div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left">
                {['Vendor', 'Invoices', 'Total spent', 'Paid', 'Last invoice', 'W9'].map(h => <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {vendors.map(v => (
                <tr key={v.name} onClick={() => setSelected(v.name)} className="hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{v.name}</p>
                    {v.email && <p className="text-xs text-gray-400">{v.email}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{v.invoice_count}</td>
                  <td className="px-4 py-3 text-ink font-medium">${Number(v.total_spent).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-500">${Number(v.paid_amount).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-500">{v.last_invoice ? new Date(v.last_invoice).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3">
                    {v.w9_on_file
                      ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><ShieldCheck size={13} /> On file</span>
                      : <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600"><ShieldAlert size={13} /> Missing</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <VendorDrawer name={selected} allNames={allNames} onClose={() => setSelected(null)} onChanged={load} onRenamed={(to) => setSelected(to)} />}
    </div>
  )
}
