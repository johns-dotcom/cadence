import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, X, Sparkles, AlertTriangle, Zap, Pencil, Paperclip, History, Tag, FileText, ShieldAlert } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import EmailPreviewModal from '../components/EmailPreviewModal'
import { useToast } from '../context/ToastContext'
import { EXPENSE_CATEGORIES, CURRENCIES } from '../constants'

const SEV = { high: 'bg-red-100 text-red-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-gray-100 text-gray-600' }
const SCAN_FIELDS = ['payee', 'amount', 'currency', 'invoice_number', 'artist']
const money = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`

export default function Approvals() {
  const { toast } = useToast()
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [focus, setFocus] = useState(0)
  const [notifyDefault, setNotifyDefault] = useState(true)
  const [emailItems, setEmailItems] = useState(null)
  const [editId, setEditId] = useState(null)
  const [draft, setDraft] = useState({})
  const [scanning, setScanning] = useState('')
  const [auditFor, setAuditFor] = useState(null)
  const cardRefs = useRef({})

  const load = () => {
    setLoading(true)
    api.get('/ledger/entries?status=pending').then(r => setList(r.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const approve = async (en, notify) => {
    try {
      await api.post(`/ledger/entries/${en.id}/approve`, { notify: false })
      if (notify && en.vendor_email) setEmailItems([{ kind: 'vendor_approved', label: en.payee, ctx: { to: en.vendor_email, vendorName: en.vendor_name || en.payee, invoiceNumber: en.invoice_number, amount: en.amount, currency: en.currency } }])
      else toast('Approved')
      load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const reject = async (en, notify) => {
    const reason = window.prompt('Reason for rejection (required):')?.trim()
    if (!reason) return
    try {
      await api.post(`/ledger/entries/${en.id}/reject`, { reason, notify: false })
      if (notify && en.vendor_email) setEmailItems([{ kind: 'vendor_rejected', label: en.payee, ctx: { to: en.vendor_email, vendorName: en.vendor_name || en.payee, invoiceNumber: en.invoice_number, amount: en.amount, currency: en.currency, reason } }])
      else toast('Rejected')
      load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const approveAll = async () => {
    const ids = list.map(e => e.id)
    if (!ids.length) return
    if (!window.confirm(`Approve all ${ids.length} pending submissions?`)) return
    try {
      const { data } = await api.post('/ledger/bulk-approve', { ids })
      const toEmail = (data.data.rows || []).filter(r => r.vendor_submitted && r.vendor_email)
      if (notifyDefault && toEmail.length) {
        setEmailItems(toEmail.map(r => ({ kind: 'vendor_approved', label: r.payee, ctx: { to: r.vendor_email, vendorName: r.vendor_name || r.payee, invoiceNumber: r.invoice_number, amount: r.amount, currency: r.currency } })))
      } else toast(`Approved ${data.data.approved}`)
      load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const openFile = async (id, type) => {
    try { const { data } = await api.get(`/ledger/entries/${id}/file/${type}`); window.open(data.data.url, '_blank', 'noopener') }
    catch { toast('No file', 'error') }
  }
  const rescan = async (en, type) => {
    setScanning(`${en.id}:${type}`)
    try { await api.post(`/ledger/entries/${en.id}/rescan?type=${type}`); toast('Scan complete'); load() }
    catch (err) { toast(err.response?.data?.error || 'Scan failed', 'error') }
    finally { setScanning('') }
  }
  const dismiss = async (en, type) => { try { await api.post(`/ledger/entries/${en.id}/dismiss-scan?type=${type}`); load() } catch { toast('Failed', 'error') } }
  const toggleRush = async (en) => {
    try { en.rush ? await api.delete(`/ledger/entries/${en.id}/rush`) : await api.post(`/ledger/entries/${en.id}/rush`, {}); load() }
    catch { toast('Failed', 'error') }
  }

  const startEdit = (en) => { setEditId(en.id); setDraft({ payee: en.payee || '', amount: en.amount || '', currency: en.currency || 'USD', invoice_number: en.invoice_number || '', artist: en.artist || '', song: en.song || '', category: en.category || '', notes: en.notes || '' }) }
  const saveEdit = async (en) => {
    try {
      const changed = Object.keys(draft).filter(k => String(draft[k] ?? '') !== String(en[k] ?? ''))
      if (changed.length) await api.patch(`/ledger/entries/${en.id}`, Object.fromEntries(changed.map(k => [k, draft[k]])))
      const rescanNeeded = changed.some(k => SCAN_FIELDS.includes(k)) && (en.invoice_r2_key || en.w9_r2_key)
      if (rescanNeeded) await api.post(`/ledger/entries/${en.id}/rescan?type=both`).catch(() => {})
      setEditId(null); toast('Saved'); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const addAlias = async (en) => {
    const alias = window.prompt(`Add an alias that maps to "${en.payee}":`)?.trim()
    if (!alias) return
    try { await api.post(`/ledger/vendors/${encodeURIComponent(en.payee)}/aliases`, { alias }); toast('Alias added') }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  // Hotkeys: j/k navigate, a approve, r reject, Shift+A approve all.
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (e.key === 'A' && e.shiftKey) { e.preventDefault(); approveAll(); return }
      if (e.key === 'j') { setFocus(f => Math.min(f + 1, list.length - 1)) }
      else if (e.key === 'k') { setFocus(f => Math.max(f - 1, 0)) }
      else if (e.key === 'a' && list[focus]) approve(list[focus], notifyDefault)
      else if (e.key === 'r' && list[focus]) reject(list[focus], notifyDefault)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line
  useEffect(() => { cardRefs.current[list[focus]?.id]?.scrollIntoView({ block: 'nearest' }) }, [focus]) // eslint-disable-line

  const nameMismatch = (en) => en.vendor_name && en.payee && en.vendor_name.trim().toLowerCase() !== en.payee.trim().toLowerCase()

  return (
    <div>
      <PageHeader
        title="Approvals"
        subtitle="Pending vendor submissions — review, scan, approve or reject"
        action={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
              <input type="checkbox" checked={notifyDefault} onChange={e => setNotifyDefault(e.target.checked)} /> Notify vendor
            </label>
            {list.length > 0 && <button onClick={approveAll} className="btn-primary"><Check size={16} /> Approve all ({list.length})</button>}
          </div>
        }
      />

      {loading ? (
        <div className="space-y-3"><Skeleton.Card /><Skeleton.Card /></div>
      ) : list.length === 0 ? (
        <div className="card p-10 text-center"><Check size={28} className="text-emerald-400 mx-auto mb-3" /><p className="text-sm text-gray-500">Nothing pending — the queue is clear. 🎉</p></div>
      ) : (
        <div className="space-y-3">
          {list.map((en, i) => {
            const editing = editId === en.id
            const aiD = en.ai_scan?.discrepancies || []
            const w9D = en.w9_scan?.discrepancies || []
            return (
              <div key={en.id} ref={el => (cardRefs.current[en.id] = el)}
                onMouseEnter={() => setFocus(i)}
                className={`card p-4 transition-shadow ${i === focus ? 'ring-2 ring-brand-400' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink flex items-center gap-2">
                      {en.payee}
                      {en.vendor_submitted && <span className="text-[10px] text-brand-600 font-semibold uppercase">Vendor</span>}
                      {en.rush && <span className="text-[10px] text-amber-600 font-semibold uppercase inline-flex items-center gap-0.5"><Zap size={10} /> Rush</span>}
                      {en.is_reimbursement && <span className="text-[10px] text-violet-600 font-semibold uppercase">Reimbursement</span>}
                    </p>
                    <p className="text-xs text-gray-400">{en.invoice_number ? `#${en.invoice_number} · ` : ''}{en.artist || 'no artist'}{en.song ? ` — ${en.song}` : ''}{en.category ? ` · ${en.category}` : ''}</p>
                  </div>
                  <div className="text-right flex-shrink-0"><p className="font-bold text-ink">{money(en.amount, en.currency)}</p><p className="text-[11px] text-gray-400">{en.invoice_date ? new Date(en.invoice_date).toLocaleDateString() : ''}</p></div>
                </div>

                {/* Files + actions row */}
                <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
                  {en.invoice_r2_key && <button onClick={() => openFile(en.id, 'invoice')} className="inline-flex items-center gap-1 text-gray-500 hover:text-brand-600"><FileText size={13} /> Invoice</button>}
                  {en.w9_r2_key && <button onClick={() => openFile(en.id, 'w9')} className="inline-flex items-center gap-1 text-gray-500 hover:text-brand-600"><Paperclip size={13} /> W9</button>}
                  {en.receipt_r2_key && <button onClick={() => openFile(en.id, 'receipt')} className="inline-flex items-center gap-1 text-gray-500 hover:text-brand-600"><Paperclip size={13} /> Receipt</button>}
                  <span className="flex-1" />
                  <button onClick={() => toggleRush(en)} className={`inline-flex items-center gap-1 ${en.rush ? 'text-amber-600' : 'text-gray-400 hover:text-amber-600'}`}><Zap size={13} /> {en.rush ? 'Rush on' : 'Rush'}</button>
                  <button onClick={() => (editing ? setEditId(null) : startEdit(en))} className="inline-flex items-center gap-1 text-gray-400 hover:text-brand-600"><Pencil size={13} /> {editing ? 'Close' : 'Edit'}</button>
                  <button onClick={() => addAlias(en)} className="inline-flex items-center gap-1 text-gray-400 hover:text-brand-600"><Tag size={13} /> Alias</button>
                  <button onClick={() => setAuditFor(auditFor === en.id ? null : en.id)} className="inline-flex items-center gap-1 text-gray-400 hover:text-brand-600"><History size={13} /> Audit</button>
                </div>

                {nameMismatch(en) && (
                  <p className="mt-2 text-xs text-amber-700 inline-flex items-center gap-1"><ShieldAlert size={13} /> Form name “{en.vendor_name}” differs from payee “{en.payee}”.</p>
                )}

                {/* AI scan banners */}
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {['invoice', 'w9'].map(kind => {
                    const scan = kind === 'invoice' ? en.ai_scan : en.w9_scan
                    const disc = kind === 'invoice' ? aiD : w9D
                    const hasFile = kind === 'invoice' ? en.invoice_r2_key : en.w9_r2_key
                    if (!hasFile) return null
                    return (
                      <div key={kind} className="rounded-lg border border-divider p-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-ink uppercase">{kind === 'invoice' ? 'Invoice scan' : 'W9 scan'}</span>
                          <span className="flex items-center gap-2">
                            <button onClick={() => rescan(en, kind)} disabled={!!scanning} className="text-[11px] font-semibold text-brand-600 hover:underline inline-flex items-center gap-0.5"><Sparkles size={11} /> {scanning === `${en.id}:${kind}` ? '…' : scan ? 'Rescan' : 'Run scan'}</button>
                            {scan && <button onClick={() => dismiss(en, kind)} className="text-[11px] text-gray-400 hover:text-gray-600">Dismiss</button>}
                          </span>
                        </div>
                        {!scan ? <p className="text-[11px] text-gray-400 mt-1">Not scanned.</p>
                          : disc.length === 0 ? <p className="text-[11px] text-emerald-600 mt-1 inline-flex items-center gap-1"><Check size={11} /> No discrepancies</p>
                          : <div className="mt-1 space-y-1">{disc.map((d, j) => (
                              <div key={j} className="flex items-start gap-1.5 text-[11px]"><span className={`px-1 rounded text-[9px] font-bold uppercase ${SEV[d.severity] || SEV.low}`}>{d.severity}</span><span className="text-gray-600">{d.field}: “{d.form_value ?? '—'}” vs “{d.document_value ?? '—'}”</span></div>
                            ))}</div>}
                      </div>
                    )
                  })}
                </div>

                {/* Edit-in-place */}
                {editing && (
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-divider pt-3">
                    <div><label className="label">Payee</label><input className="input !py-1.5" value={draft.payee} onChange={e => setDraft(d => ({ ...d, payee: e.target.value }))} /></div>
                    <div><label className="label">Amount</label><input type="number" step="0.01" className="input !py-1.5" value={draft.amount} onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))} /></div>
                    <div><label className="label">Currency</label><select className="input !py-1.5" value={draft.currency} onChange={e => setDraft(d => ({ ...d, currency: e.target.value }))}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
                    <div><label className="label">Invoice #</label><input className="input !py-1.5" value={draft.invoice_number} onChange={e => setDraft(d => ({ ...d, invoice_number: e.target.value }))} /></div>
                    <div><label className="label">Artist</label><input className="input !py-1.5" value={draft.artist} onChange={e => setDraft(d => ({ ...d, artist: e.target.value }))} /></div>
                    <div><label className="label">Song</label><input className="input !py-1.5" value={draft.song} onChange={e => setDraft(d => ({ ...d, song: e.target.value }))} /></div>
                    <div><label className="label">Category</label><select className="input !py-1.5" value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}><option value="">—</option>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
                    <div className="col-span-2 sm:col-span-4"><label className="label">Notes</label><input className="input !py-1.5" value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} /></div>
                    <div className="col-span-2 sm:col-span-4 flex justify-end"><button onClick={() => saveEdit(en)} className="btn-primary !py-1.5 text-xs">Save {SCAN_FIELDS.some(f => String(draft[f] ?? '') !== String(en[f] ?? '')) && (en.invoice_r2_key || en.w9_r2_key) ? '& rescan' : ''}</button></div>
                  </div>
                )}

                {auditFor === en.id && <AuditTrail id={en.id} />}

                {/* Decision */}
                <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-divider">
                  <button onClick={() => reject(en, notifyDefault)} className="btn-secondary !py-1.5 text-xs text-red-600"><X size={14} /> Reject</button>
                  <button onClick={() => approve(en, notifyDefault)} className="btn-primary !py-1.5 text-xs"><Check size={14} /> Approve</button>
                </div>
              </div>
            )
          })}
          <p className="text-[11px] text-gray-400 text-center pt-1">Shortcuts: <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>a</kbd> approve · <kbd>r</kbd> reject · <kbd>⇧A</kbd> approve all</p>
        </div>
      )}

      {emailItems && <EmailPreviewModal items={emailItems} onClose={() => setEmailItems(null)} onDone={() => { setEmailItems(null); load() }} />}
    </div>
  )
}

function AuditTrail({ id }) {
  const [rows, setRows] = useState(null)
  useEffect(() => { api.get(`/ledger/entries/${id}/bk-audit`).then(r => setRows(r.data.data || [])).catch(() => setRows([])) }, [id])
  return (
    <div className="mt-2 rounded-lg bg-page/60 border border-divider p-2 text-xs">
      {rows === null ? <p className="text-gray-400">Loading…</p>
        : rows.length === 0 ? <p className="text-gray-400">No audit history yet.</p>
        : rows.map((r, i) => <p key={i} className="text-gray-600"><span className="font-semibold text-ink capitalize">{r.action}</span> {r.detail ? `· ${r.detail}` : ''} <span className="text-gray-400">— {r.actor} · {new Date(r.created_at).toLocaleString()}</span></p>)}
    </div>
  )
}
