import { useEffect, useState } from 'react'
import { X, Plus, Trash2, Check, History, Layers, CreditCard, Ban, RotateCcw, Sparkles, AlertTriangle, Paperclip, Zap, MessageSquare } from 'lucide-react'
import ObjectDiscussion from './ObjectDiscussion'
import { dropTarget } from '../utils/drop'
import api from '../api'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'

const SEV = { high: 'bg-red-100 text-red-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-gray-100 text-gray-600' }

// Slide-over for one ledger entry: change history, payment installments,
// bulk-deal deliverables, and void/unvoid. All endpoints are label-scoped.
export default function LedgerEntryDrawer({ entry, onClose, onChanged }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)
  const [tab, setTab] = useState('history')
  const [history, setHistory] = useState([])
  const [installments, setInstallments] = useState([])
  const [paidTotal, setPaidTotal] = useState(0)
  const [items, setItems] = useState([])
  const [inst, setInst] = useState({ amount: '', method: '', reference: '', paid_date: '' })
  const [proofFile, setProofFile] = useState(null)
  const [itemTitle, setItemTitle] = useState('')
  const [scans, setScans] = useState({ invoice: entry?.ai_scan || null, w9: entry?.w9_scan || null })
  const [scanning, setScanning] = useState('')

  const [campaigns, setCampaigns] = useState([])
  const [campaignId, setCampaignId] = useState(entry?.campaign_id || '')

  const id = entry?.id
  const load = () => {
    if (!id) return
    api.get(`/ledger/entries/${id}/history`).then(r => setHistory(r.data.data || [])).catch(() => {})
    api.get(`/ledger/entries/${id}/installments`).then(r => { setInstallments(r.data.data.installments || []); setPaidTotal(r.data.data.total || 0) }).catch(() => {})
    api.get(`/ledger/entries/${id}/bulk-items`).then(r => setItems(r.data.data || [])).catch(() => {})
    // The list payload no longer carries the scan JSONB (LED-28) — fetch the
    // full row for the AI-scan tab.
    api.get(`/ledger/entries/${id}`).then(r => setScans({ invoice: r.data.data.ai_scan || null, w9: r.data.data.w9_scan || null })).catch(() => {})
  }
  useEffect(() => { load() }, [id])
  useEffect(() => { setCampaignId(entry?.campaign_id || ''); setScans({ invoice: entry?.ai_scan || null, w9: entry?.w9_scan || null }); api.get('/campaigns').then(r => setCampaigns(r.data.data || [])).catch(() => {}) }, [id])

  const rescan = async (type) => {
    setScanning(type)
    try {
      const { data } = await api.post(`/ledger/entries/${id}/rescan?type=${type}`)
      const r = data.data
      setScans(s => ({
        invoice: r.invoice?.ok ? r.invoice.scan : s.invoice,
        w9: r.w9?.ok ? r.w9.scan : s.w9,
      }))
      const fail = [r.invoice, r.w9].find(x => x && !x.ok)
      toast(fail ? fail.reason : 'Scan complete', fail ? 'error' : 'success')
      onChanged?.()
    } catch (err) { toast(err.response?.data?.error || 'Scan failed', 'error') }
    finally { setScanning('') }
  }
  const dismissScan = async (type) => {
    try {
      await api.post(`/ledger/entries/${id}/dismiss-scan?type=${type}`)
      setScans(s => ({ ...s, [type]: null })); onChanged?.()
    } catch { toast('Failed', 'error') }
  }

  const assignCampaign = async (newId) => {
    const prev = campaignId
    setCampaignId(newId)
    try {
      if (prev) await api.post(`/campaigns/${prev}/unlink`, { expense_id: id })
      if (newId) await api.post(`/campaigns/${newId}/link`, { expense_id: id })
      onChanged?.()
    } catch { setCampaignId(prev); toast('Failed to update campaign', 'error') }
  }

  if (!entry) return null

  const addInstallment = async () => {
    if (!inst.amount) { toast('Amount is required', 'error'); return }
    try {
      const fd = new FormData()
      Object.entries(inst).forEach(([k, v]) => { if (v) fd.append(k, v) })
      if (proofFile) fd.append('proof', proofFile)
      await api.post(`/ledger/entries/${id}/installments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setInst({ amount: '', method: '', reference: '', paid_date: '' }); setProofFile(null); load(); onChanged?.()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const openProof = async (iid) => {
    try { const { data } = await api.get(`/ledger/installments/${iid}/proof`); window.open(data.data.url, '_blank', 'noopener') }
    catch { toast('No proof on file', 'error') }
  }
  const delInstallment = async (iid) => { try { await api.delete(`/ledger/installments/${iid}`); load(); onChanged?.() } catch { toast('Failed', 'error') } }
  const addItem = async () => {
    if (!itemTitle.trim()) return
    try { await api.post(`/ledger/entries/${id}/bulk-items`, { title: itemTitle.trim() }); setItemTitle(''); load(); onChanged?.() }
    catch { toast('Failed', 'error') }
  }
  const toggleItem = async (it) => { try { await api.patch(`/ledger/bulk-items/${it.id}`, { completed: !it.completed }); load() } catch { toast('Failed', 'error') } }
  const delItem = async (iid) => { try { await api.delete(`/ledger/bulk-items/${iid}`); load() } catch { toast('Failed', 'error') } }
  const voidEntry = async () => {
    const msg = entry.voided
      ? `Restore ${entry.payee}? The entry (and any split slices) returns to payable/spend totals with its payment state intact.`
      : `Void ${entry.payee} — ${entry.currency || 'USD'} ${Number(entry.amount).toLocaleString()}? The entry stays on the ledger for the audit trail but drops out of payable and spend totals. Split slices are voided with it.`
    if (!window.confirm(msg)) return
    try { await api.post(`/ledger/entries/${id}/${entry.voided ? 'unvoid' : 'void'}`); toast(entry.voided ? 'Restored' : 'Voided'); onChanged?.(); onClose() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const scanFlags = (scans.invoice?.discrepancies?.length || 0) + (scans.w9?.discrepancies?.length || 0)
  const TABS = [
    { key: 'history', label: 'History', icon: History },
    { key: 'installments', label: 'Installments', icon: CreditCard },
    { key: 'items', label: 'Bulk items', icon: Layers },
    { key: 'scan', label: 'AI scan', icon: Sparkles, badge: scanFlags },
    { key: 'discussion', label: 'Discussion', icon: MessageSquare },
  ]

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-overlay" onClick={onClose}>
      <div className="w-full max-w-md bg-card h-full shadow-modal flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-divider">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink truncate">{entry.payee}</p>
            <p className="text-xs text-gray-400">{entry.currency} {Number(entry.amount).toLocaleString()} · {entry.category || 'Uncategorized'}{entry.voided ? ' · VOIDED' : ''}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {/* Campaign reconciliation */}
        <div className="flex items-center gap-2 px-5 py-2.5 border-b border-divider">
          <span className="text-xs text-gray-400">Campaign</span>
          <select value={campaignId} onChange={e => assignCampaign(e.target.value)} className="input !py-1 text-xs flex-1">
            <option value="">— none —</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}{c.artist_name ? ` · ${c.artist_name}` : ''}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-1 px-4 py-2 border-b border-divider">
          {TABS.map(t => {
            const Icon = t.icon
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg ${tab === t.key ? 'bg-brand-500/10 text-brand-700' : 'text-gray-500 hover:bg-gray-50'}`}>
                <Icon size={13} /> {t.label}
                {t.badge > 0 && <span className="bg-red-500 text-white text-[9px] font-bold rounded-full px-1 leading-tight">{t.badge}</span>}
              </button>
            )
          })}
          {isAdmin && (
            <button onClick={voidEntry} className={`ml-auto inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg ${entry.voided ? 'text-emerald-600 hover:bg-emerald-50' : 'text-red-600 hover:bg-red-50'}`}>
              {entry.voided ? <><RotateCcw size={13} /> Unvoid</> : <><Ban size={13} /> Void</>}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'discussion' && (
            <ObjectDiscussion entityType="expense" entityId={entry.id} title={`Invoice · ${entry.payee}`} />
          )}

          {tab === 'history' && (
            history.length ? (
              <div className="space-y-2">
                {history.map((h, i) => (
                  <div key={i} className="text-xs border-b border-divider pb-2">
                    <p className="text-ink"><span className="font-semibold">{h.field}</span>: <span className="text-gray-400 line-through">{h.old_value || '∅'}</span> → <span className="text-gray-700">{h.new_value || '∅'}</span></p>
                    <p className="text-[10px] text-gray-400">{h.changed_by} · {new Date(h.changed_at).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-gray-400">No changes recorded yet.</p>
          )}

          {tab === 'installments' && (
            <div>
              <div className="card p-3 mb-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" step="0.01" placeholder="Amount" className="input !py-1.5 text-sm" value={inst.amount} onChange={e => setInst(s => ({ ...s, amount: e.target.value }))} />
                  <input type="date" className="input !py-1.5 text-sm" value={inst.paid_date} onChange={e => setInst(s => ({ ...s, paid_date: e.target.value }))} />
                  <input placeholder="Method" className="input !py-1.5 text-sm" value={inst.method} onChange={e => setInst(s => ({ ...s, method: e.target.value }))} />
                  <input placeholder="Reference" className="input !py-1.5 text-sm" value={inst.reference} onChange={e => setInst(s => ({ ...s, reference: e.target.value }))} />
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer" {...dropTarget(f => setProofFile(f))}>
                  <Paperclip size={13} /> {proofFile ? proofFile.name : 'Attach proof of payment (optional)'}
                  <input type="file" className="hidden" onChange={e => setProofFile(e.target.files?.[0] || null)} />
                </label>
                <button onClick={addInstallment} className="btn-primary !py-1.5 text-xs w-full"><Plus size={13} /> Record installment</button>
              </div>
              <p className="text-xs text-gray-500 mb-2">Paid {entry.currency} {paidTotal.toLocaleString()} of {Number(entry.amount).toLocaleString()}</p>
              {installments.map(it => (
                <div key={it.id} className="flex items-center justify-between text-sm py-1.5 border-b border-divider group">
                  <span>{entry.currency} {Number(it.amount).toLocaleString()} <span className="text-[11px] text-gray-400">{it.method || ''} {it.paid_date ? new Date(it.paid_date).toLocaleDateString() : ''}</span></span>
                  <span className="flex items-center gap-1.5">
                    {it.proof_filename && <button onClick={() => openProof(it.id)} title="View proof" className="text-gray-400 hover:text-brand-600"><Paperclip size={13} /></button>}
                    <button onClick={() => delInstallment(it.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-600"><Trash2 size={13} /></button>
                  </span>
                </div>
              ))}
              {!installments.length && <p className="text-sm text-gray-400">No installments yet.</p>}
            </div>
          )}

          {tab === 'items' && (
            <div>
              <div className="flex gap-2 mb-3">
                <input placeholder="Deliverable title" className="input !py-1.5 text-sm" value={itemTitle} onChange={e => setItemTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && addItem()} />
                <button onClick={addItem} className="btn-primary !py-1.5 text-xs flex-shrink-0"><Plus size={13} /></button>
              </div>
              {items.map(it => (
                <div key={it.id} className="flex items-center gap-2 py-1.5 border-b border-divider group">
                  <button onClick={() => toggleItem(it)} className={`w-4 h-4 rounded flex items-center justify-center border flex-shrink-0 ${it.completed ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300'}`}>{it.completed && <Check size={11} className="text-white" />}</button>
                  <span className={`flex-1 text-sm ${it.completed ? 'text-gray-400 line-through' : 'text-ink'}`}>{it.title}</span>
                  <button onClick={() => delItem(it.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-600"><Trash2 size={13} /></button>
                </div>
              ))}
              {!items.length && <p className="text-sm text-gray-400">No deliverables yet.</p>}
            </div>
          )}

          {tab === 'scan' && (
            <div className="space-y-4">
              {['invoice', 'w9'].map(kind => {
                const scan = scans[kind]
                const label = kind === 'invoice' ? 'Invoice' : 'W9 / W8'
                const disc = scan?.discrepancies || []
                return (
                  <div key={kind} className="card p-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-bold text-ink">{label}</p>
                      <div className="flex items-center gap-2">
                        <button onClick={() => rescan(kind)} disabled={!!scanning} className="text-[11px] font-semibold text-brand-600 hover:underline inline-flex items-center gap-1">
                          <Sparkles size={11} /> {scanning === kind ? 'Scanning…' : 'Rescan'}
                        </button>
                        {scan && <button onClick={() => dismissScan(kind)} className="text-[11px] text-gray-400 hover:text-gray-600">Dismiss</button>}
                      </div>
                    </div>
                    {!scan ? (
                      <p className="text-xs text-gray-400">Not scanned yet.</p>
                    ) : (
                      <>
                        {scan.summary && <p className="text-xs text-gray-500 mb-2">{scan.summary}</p>}
                        {disc.length === 0 ? (
                          <p className="text-xs text-emerald-600 inline-flex items-center gap-1"><Check size={12} /> No discrepancies found</p>
                        ) : (
                          <div className="space-y-1.5">
                            {disc.map((d, i) => (
                              <div key={i} className="flex items-start gap-2 text-xs">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase flex-shrink-0 ${SEV[d.severity] || SEV.low}`}>{d.severity}</span>
                                <span className="text-gray-600"><span className="font-semibold text-ink">{d.field}</span>: form “{d.form_value ?? '—'}” vs doc “{d.document_value ?? '—'}”</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {scan.scanned_at && <p className="text-[10px] text-gray-400 mt-2">Scanned {new Date(scan.scanned_at).toLocaleString()}</p>}
                      </>
                    )}
                  </div>
                )
              })}
              <p className="text-[11px] text-gray-400 inline-flex items-center gap-1"><AlertTriangle size={11} /> AI scans compare the uploaded files against the entered values.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
