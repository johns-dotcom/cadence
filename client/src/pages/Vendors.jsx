import { useEffect, useState } from 'react'
import { Building2, ShieldCheck, ShieldAlert, X, Upload, ExternalLink } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'

function VendorDrawer({ name, onClose, onChanged }) {
  const { toast } = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState({ email: '', address: '', bank: '', notes: '' })

  const load = () => {
    setLoading(true)
    api.get(`/ledger/vendors/${encodeURIComponent(name)}`).then(res => {
      setData(res.data.data)
      const v = res.data.data.vendor || {}
      setEdit({ email: v.email || '', address: v.address || '', bank: v.bank || '', notes: v.notes || '' })
    }).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [name])

  const save = async () => {
    try { await api.patch(`/ledger/vendors/${encodeURIComponent(name)}`, edit); toast('Saved'); onChanged?.() }
    catch { toast('Failed', 'error') }
  }
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
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  const load = () => {
    setLoading(true)
    api.get('/ledger/vendors').then(res => setVendors(res.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [])

  return (
    <div>
      <PageHeader title="Vendors" subtitle="Everyone you've paid, grouped by payee" />

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

      {selected && <VendorDrawer name={selected} onClose={() => setSelected(null)} onChanged={load} />}
    </div>
  )
}
