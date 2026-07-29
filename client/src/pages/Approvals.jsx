import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, X, Sparkles, Zap, Pencil, FileText, Paperclip, Tag, History, ShieldAlert, Split, Mail, Search, Flag } from 'lucide-react'
import api from '../api'
import Skeleton from '../components/Skeleton'
import EmailPreviewModal from '../components/EmailPreviewModal'
import { useToast } from '../context/ToastContext'
import { EXPENSE_CATEGORIES, CURRENCIES } from '../constants'

const SEV = { high: 'bg-red-100 text-red-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-gray-100 text-gray-600' }
const SCAN_FIELDS = ['payee', 'amount', 'currency', 'invoice_number', 'artist']
const money = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
const initial = (s) => (s || '?').trim().charAt(0).toUpperCase()

export default function Approvals() {
  const { toast } = useToast()
  const [list, setList] = useState([])
  const [reps, setReps] = useState([])
  const [loading, setLoading] = useState(true)
  const [focus, setFocus] = useState(0)
  const [emailItems, setEmailItems] = useState(null)
  const [editId, setEditId] = useState(null)
  const [draft, setDraft] = useState({})
  const [scanning, setScanning] = useState('')
  const [auditFor, setAuditFor] = useState(null)
  const [splitFor, setSplitFor] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [notifyMap, setNotifyMap] = useState({}) // id → notify override
  const [q, setQ] = useState('')
  const [repFilter, setRepFilter] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [sort, setSort] = useState('new')
  const cardRefs = useRef({})

  const load = () => {
    setLoading(true)
    api.get('/ledger/entries?status=pending').then(r => setList(r.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [])
  useEffect(() => { api.get('/reps').then(r => setReps((r.data.data || []).map(x => x.name).filter(Boolean))).catch(() => {}) }, [])

  const willNotify = (en) => !!en.vendor_email && (notifyMap[en.id] ?? true)
  const toggleNotify = (en) => setNotifyMap(m => ({ ...m, [en.id]: !(m[en.id] ?? true) }))

  const approve = async (en) => {
    try {
      const { data } = await api.post(`/ledger/entries/${en.id}/approve`, { notify: false })
      const parts = data?.data?.split_parts
      if (willNotify(en)) setEmailItems([{ kind: 'vendor_approved', label: en.payee, ctx: { to: en.vendor_email, vendorName: en.vendor_name || en.payee, invoiceNumber: en.invoice_number, amount: en.amount, currency: en.currency } }])
      else toast(parts ? `Approved & split across ${parts} artists` : 'Approved — now in the ledger')
      load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const reject = async (en) => {
    const reason = window.prompt('Reason for rejection (required):')?.trim()
    if (!reason) return
    try {
      await api.post(`/ledger/entries/${en.id}/reject`, { reason, notify: false })
      if (willNotify(en)) setEmailItems([{ kind: 'vendor_rejected', label: en.payee, ctx: { to: en.vendor_email, vendorName: en.vendor_name || en.payee, invoiceNumber: en.invoice_number, amount: en.amount, currency: en.currency, reason } }])
      else toast('Rejected')
      load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const approveMany = async (rows) => {
    const ids = rows.map(e => e.id)
    if (!ids.length) return
    if (!window.confirm(`Approve ${ids.length} submission${ids.length === 1 ? '' : 's'}? They'll appear in the ledger.`)) return
    try {
      const { data } = await api.post('/ledger/bulk-approve', { ids })
      const toEmail = (data.data.rows || []).filter(r => r.vendor_submitted && r.vendor_email && (notifyMap[r.id] ?? true))
      if (toEmail.length) setEmailItems(toEmail.map(r => ({ kind: 'vendor_approved', label: r.payee, ctx: { to: r.vendor_email, vendorName: r.vendor_name || r.payee, invoiceNumber: r.invoice_number, amount: r.amount, currency: r.currency } })))
      else toast(`Approved ${data.data.approved}`)
      setSelected(new Set()); load()
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
  const patchField = async (en, field, value) => {
    try { await api.patch(`/ledger/entries/${en.id}`, { [field]: value }); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const toggleRush = (en) => { en.rush ? api.delete(`/ledger/entries/${en.id}/rush`).then(load).catch(() => {}) : api.post(`/ledger/entries/${en.id}/rush`, {}).then(load).catch(() => {}) }

  const startEdit = (en) => { setEditId(en.id); setDraft({ payee: en.payee || '', amount: en.amount || '', currency: en.currency || 'USD', invoice_number: en.invoice_number || '', artist: en.artist || '', song: en.song || '', category: en.category || '', description: en.description || '' }) }
  const saveEdit = async (en) => {
    try {
      const changed = Object.keys(draft).filter(k => String(draft[k] ?? '') !== String(en[k] ?? ''))
      if (changed.length) await api.patch(`/ledger/entries/${en.id}`, Object.fromEntries(changed.map(k => [k, draft[k]])))
      if (changed.some(k => SCAN_FIELDS.includes(k)) && (en.invoice_r2_key || en.w9_r2_key)) await api.post(`/ledger/entries/${en.id}/rescan?type=both`).catch(() => {})
      setEditId(null); toast('Saved'); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const addAlias = async (en) => {
    const alias = window.prompt(`Add an alias that maps to "${en.payee}":`)?.trim()
    if (!alias) return
    try { await api.post(`/ledger/vendors/${encodeURIComponent(en.payee)}/aliases`, { alias }); toast('Alias added') }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const filtered = useMemo(() => {
    const lq = q.trim().toLowerCase()
    let out = list.filter(en => {
      if (repFilter && en.rep !== repFilter) return false
      if (catFilter && en.category !== catFilter) return false
      if (lq && !`${en.payee} ${en.vendor_name || ''} ${en.artist || ''} ${en.invoice_number || ''}`.toLowerCase().includes(lq)) return false
      return true
    })
    out = [...out].sort((a, b) => {
      if (sort === 'amount') return Number(b.amount || 0) - Number(a.amount || 0)
      const da = new Date(a.invoice_date || a.created_at), db = new Date(b.invoice_date || b.created_at)
      return sort === 'old' ? da - db : db - da
    })
    return out
  }, [list, q, repFilter, catFilter, sort])

  // Hotkeys over the filtered list.
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (e.key === 'A' && e.shiftKey) { e.preventDefault(); approveMany(filtered); return }
      if (e.key === 'j') setFocus(f => Math.min(f + 1, filtered.length - 1))
      else if (e.key === 'k') setFocus(f => Math.max(f - 1, 0))
      else if (e.key === 'a' && filtered[focus]) approve(filtered[focus])
      else if (e.key === 'r' && filtered[focus]) reject(filtered[focus])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line
  useEffect(() => { cardRefs.current[filtered[focus]?.id]?.scrollIntoView({ block: 'nearest' }) }, [focus]) // eslint-disable-line

  const nameMismatch = (en) => en.vendor_name && en.payee && en.vendor_name.trim().toLowerCase() !== en.payee.trim().toLowerCase()
  const toggleSel = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selectedRows = filtered.filter(e => selected.has(e.id))

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-2xl font-bold text-ink tracking-tight inline-flex items-center gap-2">
          Pending Approvals
          {list.length > 0 && <span className="text-sm font-bold bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5">{list.length}</span>}
        </h1>
      </div>
      <p className="text-sm text-gray-500 mb-5">Review vendor-submitted invoices before they appear in the ledger.</p>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search vendor, artist, invoice #…" className="input !pl-9" />
        </div>
        <select className="input !w-auto" value={repFilter} onChange={e => setRepFilter(e.target.value)}><option value="">All reps</option>{reps.map(r => <option key={r}>{r}</option>)}</select>
        <select className="input !w-auto" value={catFilter} onChange={e => setCatFilter(e.target.value)}><option value="">All categories</option>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
        <select className="input !w-auto" value={sort} onChange={e => setSort(e.target.value)}><option value="new">Newest first</option><option value="old">Oldest first</option><option value="amount">Largest amount</option></select>
        <span className="flex-1" />
        <span className="text-sm text-gray-400">{selected.size ? `${selected.size} selected` : `${filtered.length} pending`}</span>
        {filtered.length > 0 && (
          <button onClick={() => approveMany(selected.size ? selectedRows : filtered)} className="inline-flex items-center gap-1.5 text-sm font-semibold bg-emerald-600 text-white px-3.5 py-2 rounded-lg hover:bg-emerald-700 transition">
            <Check size={15} /> {selected.size ? `Approve selected (${selected.size})` : 'Approve All'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3"><Skeleton.Card /><Skeleton.Card /></div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center"><Check size={30} className="text-emerald-400 mx-auto mb-3" /><p className="text-sm text-gray-500">{list.length ? 'Nothing matches your filters.' : 'Nothing pending — the queue is clear. 🎉'}</p></div>
      ) : (
        <div className="space-y-4">
          {filtered.map((en, i) => {
            const editing = editId === en.id
            const breakdown = Array.isArray(en.artist_breakdown) ? en.artist_breakdown : null
            return (
              <div key={en.id} ref={el => (cardRefs.current[en.id] = el)} onMouseEnter={() => setFocus(i)}
                className={`card p-4 transition-shadow ${i === focus ? 'ring-2 ring-brand-400' : ''} ${en.rush ? 'border-l-4 border-l-amber-500' : ''}`}>
                {/* Top row */}
                <div className="flex items-start gap-3">
                  <input type="checkbox" checked={selected.has(en.id)} onChange={() => toggleSel(en.id)} className="mt-2 flex-shrink-0" />
                  <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0"><span className="text-sm font-bold text-brand-700">{initial(en.payee)}</span></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-ink truncate">{en.payee}</p>
                      {nameMismatch(en) && <span title={`Form name "${en.vendor_name}" differs`}><Flag size={13} className="text-amber-500" /></span>}
                      {en.rush && <span className="text-[10px] font-bold uppercase text-amber-700 bg-amber-100 rounded px-1.5 py-0.5 inline-flex items-center gap-0.5"><Zap size={10} /> Rush</span>}
                      {en.is_reimbursement && <span className="text-[10px] font-bold uppercase text-violet-700 bg-violet-100 rounded px-1.5 py-0.5">Reimb.</span>}
                    </div>
                    {en.vendor_email && <p className="text-xs text-gray-400 truncate">{en.vendor_email}</p>}
                    <p className="text-sm font-semibold text-brand-600 truncate mt-0.5">{en.artist || 'No artist'}{en.song ? ` — ${en.song}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => patchField(en, 'cobrand', !en.cobrand)} className={`text-[11px] font-bold uppercase rounded-full px-2.5 py-1 border transition ${en.cobrand ? 'bg-brand-600 border-brand-600 text-white' : 'border-brand-300 text-brand-600 hover:bg-brand-50'}`}>{en.cobrand ? '✓' : '?'} Cobrand</button>
                    <button onClick={() => patchField(en, 'is_bulk_deal', !en.is_bulk_deal)} className={`text-[11px] font-bold uppercase rounded-full px-2.5 py-1 border transition ${en.is_bulk_deal ? 'bg-teal-600 border-teal-600 text-white' : 'border-teal-300 text-teal-600 hover:bg-teal-50'}`}>{en.is_bulk_deal ? '✓' : '?'} Bulk deal</button>
                    <div className="text-right ml-1">
                      <p className="font-bold text-rose-500 whitespace-nowrap">{money(en.amount, en.currency)}</p>
                      <p className="text-[11px] text-gray-400">{en.invoice_date ? new Date(en.invoice_date).toISOString().slice(0, 10) : ''}</p>
                    </div>
                  </div>
                </div>

                {/* Scan banners */}
                <div className="mt-3 space-y-2">
                  {['invoice', 'w9'].map(kind => {
                    const hasFile = kind === 'invoice' ? en.invoice_r2_key : en.w9_r2_key
                    if (!hasFile) return null
                    const scan = kind === 'invoice' ? en.ai_scan : en.w9_scan
                    const disc = scan?.discrepancies || []
                    const clean = scan && disc.length === 0
                    const label = kind === 'invoice' ? 'Invoice' : 'W-9'
                    return (
                      <div key={kind} className={`rounded-lg border px-3 py-2.5 flex items-start gap-2.5 ${clean ? 'bg-emerald-500/10 border-emerald-500/30' : disc.length ? 'bg-amber-500/10 border-amber-500/30' : 'bg-page/50 border-divider'}`}>
                        {clean ? <Check size={15} className="text-emerald-600 mt-0.5 flex-shrink-0" /> : disc.length ? <ShieldAlert size={15} className="text-amber-600 mt-0.5 flex-shrink-0" /> : <Sparkles size={15} className="text-gray-400 mt-0.5 flex-shrink-0" />}
                        <div className="flex-1 min-w-0 text-[13px]">
                          {!scan ? <span className="text-gray-500">{label} not scanned yet.</span>
                            : clean ? <span className="text-emerald-800">{label}: all form fields match — no discrepancies detected.</span>
                            : <div className="space-y-0.5">{disc.map((d, j) => <div key={j} className="flex items-start gap-1.5 text-amber-900"><span className={`px-1 rounded text-[9px] font-bold uppercase ${SEV[d.severity] || SEV.low}`}>{d.severity}</span><span>{d.field}: "{d.form_value ?? '—'}" vs "{d.document_value ?? '—'}"</span></div>)}</div>}
                        </div>
                        <button onClick={() => rescan(en, kind)} disabled={!!scanning} className="text-[11px] font-semibold text-gray-500 border border-rule rounded-md px-2 py-1 hover:bg-gray-50 flex-shrink-0">{scanning === `${en.id}:${kind}` ? '…' : scan ? 'Re-scan' : 'Scan'}</button>
                      </div>
                    )
                  })}
                </div>

                {/* Meta row */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3 text-xs text-gray-500">
                  <span><span className="font-semibold text-gray-400 uppercase text-[10px] mr-1">Date</span>{en.invoice_date ? new Date(en.invoice_date).toISOString().slice(0, 10) : '—'}</span>
                  <span className="text-gray-300">·</span>
                  <span><span className="font-semibold text-gray-400 uppercase text-[10px] mr-1">#</span>{en.invoice_number || '—'}</span>
                  <span className="text-gray-300">·</span>
                  <span className="inline-flex items-center gap-1"><span className="font-semibold text-gray-400 uppercase text-[10px]">Cat</span>
                    <select value={en.category || ''} onChange={e => patchField(en, 'category', e.target.value)} className="text-xs bg-page/60 border border-rule rounded px-1.5 py-0.5 text-ink cursor-pointer"><option value="">—</option>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
                  </span>
                  <span className="text-gray-300">·</span>
                  <span><span className="font-semibold text-gray-400 uppercase text-[10px] mr-1">Rep</span>{en.rep || '—'}</span>
                </div>

                {en.description && <p className="mt-2 text-[13px] text-gray-500"><span className="font-semibold text-gray-400 uppercase text-[10px] mr-1.5">Desc</span>{en.description}</p>}

                {/* Files */}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {en.invoice_r2_key && <button onClick={() => openFile(en.id, 'invoice')} className="inline-flex items-center gap-1.5 text-xs bg-page/60 border border-rule rounded-lg px-2.5 py-1.5 text-gray-600 hover:text-brand-600"><FileText size={13} className="text-amber-500" /> Invoice</button>}
                  {en.w9_r2_key && <button onClick={() => openFile(en.id, 'w9')} className="inline-flex items-center gap-1.5 text-xs bg-page/60 border border-rule rounded-lg px-2.5 py-1.5 text-gray-600 hover:text-brand-600"><Paperclip size={13} /> W-9</button>}
                  {en.receipt_r2_key && <button onClick={() => openFile(en.id, 'receipt')} className="inline-flex items-center gap-1.5 text-xs bg-page/60 border border-rule rounded-lg px-2.5 py-1.5 text-gray-600 hover:text-brand-600"><Paperclip size={13} /> Receipt</button>}
                </div>

                {/* Vendor split (from the submission) */}
                {splitFor === en.id && (
                  <div className="mt-3 rounded-lg bg-page/60 border border-divider p-3">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Vendor allocation</p>
                    {breakdown ? (
                      <div className="space-y-1.5">
                        {breakdown.map((l, j) => (
                          <div key={j} className="text-sm">
                            <div className="flex justify-between"><span className="text-ink">{l.artist}{l.song ? ` — ${l.song}` : ''}</span><span className="font-medium text-ink">{money(l.amount, en.currency)}</span></div>
                            {(l.socials || []).length > 0 && <p className="text-[11px] text-gray-400 pl-3">{l.socials.map(s => `${s.handle}${s.amount ? ` (${money(s.amount, en.currency)})` : ''}`).join(' · ')}</p>}
                          </div>
                        ))}
                        {breakdown.length > 1 && <p className="text-[11px] text-emerald-600 mt-1.5 inline-flex items-center gap-1"><Check size={11} /> Created as ledger splits automatically when you approve.</p>}
                      </div>
                    ) : <p className="text-sm text-gray-400">No split was provided with this submission.</p>}
                  </div>
                )}

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
                    <div className="col-span-2 sm:col-span-4"><label className="label">Description</label><input className="input !py-1.5" value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} /></div>
                    <div className="col-span-2 sm:col-span-4 flex justify-end"><button onClick={() => saveEdit(en)} className="btn-primary !py-1.5 text-xs">Save</button></div>
                  </div>
                )}

                {auditFor === en.id && <AuditTrail id={en.id} />}

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-divider">
                  <button onClick={() => setSplitFor(splitFor === en.id ? null : en.id)} className="btn-secondary !py-1.5 text-xs"><Split size={13} /> Split</button>
                  <button onClick={() => (editing ? setEditId(null) : startEdit(en))} className="btn-secondary !py-1.5 text-xs"><Pencil size={13} /> {editing ? 'Close' : 'Edit'}</button>
                  <button onClick={() => addAlias(en)} className="btn-secondary !py-1.5 text-xs"><Tag size={13} /> Aliases</button>
                  <button onClick={() => setAuditFor(auditFor === en.id ? null : en.id)} className="btn-secondary !py-1.5 text-xs"><History size={13} /> Audit</button>
                  <button onClick={() => toggleRush(en)} className={`btn-secondary !py-1.5 text-xs ${en.rush ? 'text-amber-600' : ''}`}><Zap size={13} /> {en.rush ? 'Rush on' : 'Rush'}</button>
                  <span className="flex-1" />
                  {en.vendor_email && <button onClick={() => toggleNotify(en)} title="Toggle emailing the vendor on decision" className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border ${willNotify(en) ? 'border-brand-300 text-brand-600 bg-brand-50' : 'border-rule text-gray-400'}`}><Mail size={14} /> Notify vendor</button>}
                  <button onClick={() => reject(en)} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg border border-red-300 text-red-600 hover:bg-red-50"><X size={14} /> Reject</button>
                  <button onClick={() => approve(en)} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"><Check size={14} /> Approve</button>
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
