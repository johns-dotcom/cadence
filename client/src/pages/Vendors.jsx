import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import {
  Building2, ShieldCheck, ShieldAlert, X, Upload, ExternalLink, Pencil, GitMerge, Tag,
  Plus, Sparkles, AlertTriangle, CreditCard, Search, Download, Undo2, History, Loader,
} from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { dropTarget } from '../utils/drop'
import { formatDate } from '../utils/dates'
import { money, moneyOrig } from '../utils/money'

const SEV = { high: 'bg-red-100 text-red-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-gray-100 text-gray-600' }
const W9_FILTERS = [['', 'All W9s'], ['on', 'W9 on file'], ['off', 'W9 missing'], ['mismatch', 'Name mismatch']]
const SORTS = [
  ['spend', 'Spend (high→low)'],
  ['name', 'Name (A→Z)'],
  ['invoices', 'Invoices'],
  ['recent', 'Most recent invoice'],
  ['outstanding', 'Outstanding'],
]

function VendorDrawer({ name, onClose, onChanged, onRenamed }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState({ email: '', address: '', notes: '' })
  const [aliases, setAliases] = useState([])
  const [newAlias, setNewAlias] = useState('')
  const [renameTo, setRenameTo] = useState('')
  const [mergeQ, setMergeQ] = useState('')
  const [mergeHits, setMergeHits] = useState([])
  const [mergeInto, setMergeInto] = useState('')
  const [merges, setMerges] = useState({ merges: [], logged_since: null })
  const [zipping, setZipping] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const [emails, setEmails] = useState([])
  const [newEmail, setNewEmail] = useState('')
  const [newEmailLabel, setNewEmailLabel] = useState('')
  // Payment-details vault: masked summary rides the detail payload; the full
  // reveal is a separate Admin-only call that writes an audit row PER READ.
  const [payDetails, setPayDetails] = useState(null)
  const [payLoading, setPayLoading] = useState(false)
  const [payErr, setPayErr] = useState('')
  const loadAliases = () => api.get(`/ledger/vendors/${encodeURIComponent(name)}/aliases`).then(r => setAliases(r.data.data || [])).catch(() => {})
  const loadEmails = () => api.get(`/ledger/vendors/${encodeURIComponent(name)}/emails`).then(r => setEmails(r.data.data || [])).catch(() => {})
  const loadMerges = () => api.get(`/ledger/vendors/${encodeURIComponent(name)}/merges`).then(r => setMerges(r.data.data || { merges: [] })).catch(() => {})
  const load = () => {
    setLoading(true)
    api.get(`/ledger/vendors/${encodeURIComponent(name)}`).then(res => {
      setData(res.data.data)
      const v = res.data.data.vendor || {}
      setEdit({ email: v.email || '', address: v.address || '', notes: v.notes || '' })
      setPayDetails(null); setPayErr('')
    }).catch(() => {}).finally(() => setLoading(false))
    loadAliases(); loadEmails(); loadMerges()
  }
  useEffect(() => { load() }, [name])

  // Debounced server typeahead. A bare <select> over every vendor name is
  // unusable at 400 vendors, which is exactly the scale this page is for.
  useEffect(() => {
    if (!mergeQ.trim()) { setMergeHits([]); return }
    const t = setTimeout(() => {
      api.get('/ledger/vendor-suggest', { params: { q: mergeQ.trim() } })
        .then(r => setMergeHits((r.data.data?.vendors || []).filter(v => v.name.toLowerCase() !== name.toLowerCase())))
        .catch(() => setMergeHits([]))
    }, 250)
    return () => clearTimeout(t)
  }, [mergeQ, name])

  const addEmail = async () => {
    if (!newEmail.trim()) return
    try {
      await api.post(`/ledger/vendors/${encodeURIComponent(name)}/emails`, { email: newEmail.trim(), label_text: newEmailLabel.trim() || null })
      setNewEmail(''); setNewEmailLabel(''); loadEmails()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const delEmail = async (id) => { try { await api.delete(`/ledger/vendor-emails/${id}`); loadEmails() } catch { toast('Failed', 'error') } }

  const revealPay = async () => {
    setPayLoading(true); setPayErr('')
    try {
      const r = await api.get(`/ledger/vendors/${encodeURIComponent(name)}/payment-details`)
      setPayDetails(r.data?.data || { on_file: false })
    } catch (err) { setPayErr(err.response?.data?.error || 'Could not load payment details') }
    finally { setPayLoading(false) }
  }

  const save = async () => {
    try { await api.patch(`/ledger/vendors/${encodeURIComponent(name)}`, edit); toast('Saved'); onChanged?.() }
    catch { toast('Failed', 'error') }
  }
  const doRename = async () => {
    if (!renameTo.trim()) return
    try {
      const r = await api.put('/ledger/vendors/rename', { from: name, to: renameTo.trim() })
      const d = r.data.data || {}
      toast(`Renamed — ${d.updated || 0} entries, ${d.emails_moved || 0} saved email${d.emails_moved === 1 ? '' : 's'} moved${d.emails_dropped ? `, ${d.emails_dropped} duplicate address dropped` : ''}`)
      onChanged?.(); onRenamed?.(renameTo.trim())
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const doMerge = async () => {
    if (!mergeInto) return
    if (!window.confirm(`Merge "${name}" into "${mergeInto}"? All of "${name}"'s entries are renamed, its saved emails and vendor record move over, and "${name}" becomes an alias. This is reversible from the merge history on "${mergeInto}".`)) return
    try {
      const r = await api.post('/ledger/vendors/merge', { from: name, into: mergeInto })
      const d = r.data.data || {}
      toast(`Merged into "${mergeInto}" — ${d.moved || 0} entries renamed, ${d.emails_moved || 0} saved email${d.emails_moved === 1 ? '' : 's'} moved`)
      onChanged?.(); onClose()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const doUnmerge = async (m) => {
    if (!window.confirm(`Undo the merge of "${m.from_name}" into "${m.into_name}"? Reverses BY ID, so rows that were always "${m.into_name}" stay put.`)) return
    try {
      const r = await api.post(`/ledger/vendors/unmerge/${m.id}`)
      toast(`Unmerged — ${r.data.data?.restored || 0} entries back under "${m.from_name}"`)
      load(); onChanged?.()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const addAlias = async () => {
    if (!newAlias.trim()) return
    try {
      const r = await api.post(`/ledger/vendors/${encodeURIComponent(name)}/aliases`, { alias: newAlias.trim() })
      const from = r.data.data?.reassigned_from
      toast(from ? `Alias moved here from "${from}"` : 'Alias added')
      setNewAlias(''); loadAliases()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const delAlias = async (id) => { try { await api.delete(`/ledger/vendors/aliases/${id}`); loadAliases() } catch { toast('Failed', 'error') } }
  const uploadW9 = async (file) => {
    if (!file) return
    setUploading(true); setDragOver(false)
    const fd = new FormData(); fd.append('file', file)
    try { await api.post(`/ledger/vendors/${encodeURIComponent(name)}/w9`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }); toast('W9 uploaded'); load(); onChanged?.() }
    catch (err) { toast(err.response?.data?.error || 'Upload failed', 'error') }
    finally { setUploading(false) }
  }

  const invoiceCount = (data?.entries || []).length
  const downloadZip = async () => {
    setZipping(true)
    try {
      const res = await api.get('/ledger/vendor-zip', { params: { payee: name }, responseType: 'blob' })
      const href = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a'); a.href = href; a.download = `${name}.zip`; a.click()
      URL.revokeObjectURL(href)
    } catch (err) {
      // A blob error body is still JSON — unwrap it rather than saying "failed".
      let msg = 'Download failed'
      try { msg = JSON.parse(await err.response?.data?.text())?.error || msg } catch { /* keep default */ }
      toast(msg, 'error')
    } finally { setZipping(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-overlay" onClick={onClose} />
      <div className="relative w-full max-w-md bg-card border-l border-rule h-full overflow-y-auto p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-ink truncate">{name}</h2>
            <p className="text-xs text-ink-faint">
              Vendor
              {data?.alias_names?.length ? <> · aka {data.alias_names.join(', ')}</> : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={downloadZip}
              disabled={zipping || !invoiceCount}
              title={invoiceCount ? 'Download every invoice, the W9 and an Excel ledger as a ZIP' : 'No invoices to bundle'}
              className="btn-secondary !py-1 text-xs"
            >{zipping ? <Loader size={13} className="animate-spin" /> : <Download size={13} />} Bundle</button>
            <button onClick={onClose} className="text-ink-faint hover:text-ink"><X size={18} /></button>
          </div>
        </div>

        {loading ? <div className="space-y-3"><Skeleton.Block /><Skeleton.Block /></div> : data && (
          <>
            {/* Per-currency stat strip. Total === Paid + Outstanding by
                construction — one pass over the same families listed below. */}
            {Object.keys(data.stats || {}).length > 0 && (
              <div className="card p-4 mb-4 space-y-2">
                {Object.entries(data.stats).map(([cur, st]) => (
                  <div key={cur}>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">{cur} · {st.count} invoice{st.count === 1 ? '' : 's'}</p>
                    <div className="grid grid-cols-3 gap-2 mt-0.5">
                      <div><p className="text-[10px] text-ink-faint">Total</p><p className="text-sm font-bold text-ink tabular-nums">{moneyOrig(st.total, cur)}</p></div>
                      <div><p className="text-[10px] text-ink-faint">Paid</p><p className="text-sm font-semibold text-success tabular-nums">{moneyOrig(st.paid, cur)}</p></div>
                      <div><p className="text-[10px] text-ink-faint">Outstanding</p><p className="text-sm font-semibold text-warning tabular-nums">{moneyOrig(st.outstanding, cur)}</p></div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* W9 */}
            <div
              className={`card p-4 mb-4 ${dragOver ? 'ring-2 ring-brand-500/50' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              {...dropTarget(uploadW9)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {data.vendor.w9_filename
                    ? <><ShieldCheck size={16} className="text-emerald-500" /><span className="text-sm text-ink truncate">W9 on file{data.vendor.w9_from_entry ? ' (from an invoice)' : ''}</span></>
                    : <><ShieldAlert size={16} className="text-amber-500" /><span className="text-sm text-ink-muted">No W9 on file</span></>}
                </div>
                <div className="flex items-center gap-2">
                  {data.vendor.w9_url && <a href={data.vendor.w9_url} target="_blank" rel="noopener noreferrer" className="text-brand-ink hover:opacity-70"><ExternalLink size={15} /></a>}
                  <label className={`btn-secondary cursor-pointer text-xs py-1.5 ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
                    {uploading ? <Loader size={13} className="animate-spin" /> : <Upload size={13} />} {uploading ? 'Uploading…' : data.vendor.w9_filename ? 'Replace' : 'Upload'}
                    <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg" onChange={e => uploadW9(e.target.files[0])} />
                  </label>
                </div>
              </div>
              <p className="text-[11px] text-ink-faint mt-1">Drop a PDF or image here, or use Upload. PDF/PNG/JPG.</p>
            </div>

            {/* Contact */}
            <div className="space-y-3 mb-4">
              <div><label className="label">Email</label><input className="input" value={edit.email} onChange={e => setEdit(s => ({ ...s, email: e.target.value }))} /></div>
              <div><label className="label">Address</label><input className="input" value={edit.address} onChange={e => setEdit(s => ({ ...s, address: e.target.value }))} /></div>
              <div><label className="label">Notes</label><textarea className="input" rows={2} value={edit.notes} onChange={e => setEdit(s => ({ ...s, notes: e.target.value }))} /></div>
              <button onClick={save} className="btn-primary">Save details</button>
            </div>

            {/* Payment details — the encrypted vault. Masked (method + last-4)
                for everyone; the full reveal is Admin-only and every reveal is
                written to the audit log. Bank details deliberately have no
                edit field here — they enter through the vendor form only. */}
            <div className="card p-4 mb-4">
              <div className="flex items-center gap-1.5 mb-1.5">
                <CreditCard size={13} className="text-ink-muted" />
                <p className="text-xs font-bold text-ink">Payment details</p>
                {isAdmin && data.vendor.payment_summary && !payDetails && (
                  <button onClick={revealPay} disabled={payLoading} className="ml-auto text-xs font-semibold text-brand-ink hover:underline">
                    {payLoading ? 'Loading…' : 'Show'}
                  </button>
                )}
              </div>
              {!data.vendor.payment_summary ? (
                <p className="text-xs text-ink-faint">Nothing on file — this vendor hasn't submitted payment details through the vendor form yet. Their invoice is still the source.</p>
              ) : (
                <>
                  <p className="text-sm text-ink">
                    <span className="font-semibold">{data.vendor.payment_summary.method || '—'}</span>
                    {data.vendor.payment_summary.last4 && <span className="font-semibold"> ••••{data.vendor.payment_summary.last4}</span>}
                    {data.vendor.payment_summary.updated_at && <span className="text-ink-faint"> · updated {formatDate(data.vendor.payment_summary.updated_at)}</span>}
                  </p>
                  {isAdmin
                    ? <p className="text-[11px] text-ink-faint mt-1">Full details are hidden — viewing them is recorded in the audit log.</p>
                    : <p className="text-[11px] text-ink-faint mt-1">Full details are visible to admins only.</p>}
                  {data.vendor.payment_summary.key_missing && (
                    <p className="text-[11px] text-warning mt-1">Vault key not configured (PAYMENT_DETAILS_KEY) — new submissions store the method and last four digits only.</p>
                  )}
                  {payErr && <p className="text-[11px] text-danger mt-1">{payErr}</p>}
                  {payDetails && !payDetails.on_file && <p className="text-xs text-ink-faint mt-2">Nothing stored for this vendor's email.</p>}
                  {payDetails?.on_file && (
                    <div className="mt-2 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs text-ink">
                      {[
                        ['Method', payDetails.method],
                        ['Name on account', payDetails.holder_name],
                        ['Account', payDetails.account_number],
                        ['Routing', payDetails.routing_number],
                        ['Account type', payDetails.account_type],
                        ['IBAN / SWIFT', payDetails.iban_swift],
                        ['PayPal', payDetails.paypal_handle],
                        ['Bank name', payDetails.bank_name],
                        ['Bank address', payDetails.bank_address],
                        ['Beneficiary address', payDetails.beneficiary_address],
                        ['Intermediary bank', payDetails.intermediary_bank],
                        ['Wire type', payDetails.wire_scope],
                        ['Updated', formatDate(payDetails.updated_at)],
                      ].filter(([, v]) => v).map(([k, v]) => (
                        <span key={k} className="contents">
                          <span className="text-ink-faint">{k}</span>
                          <span className="tabular-nums break-all">{v}</span>
                        </span>
                      ))}
                      {payDetails.encrypted === false && (
                        <p className="col-span-2 text-warning">Captured while the vault key was not configured — only the method and last four digits were kept (never full numbers).</p>
                      )}
                      {payDetails.encrypted !== false && payDetails.readable === false && (
                        <p className="col-span-2 text-warning">Stored, but not readable — the encryption key is missing or has changed. This is not the vendor failing to give details.</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Aliases */}
            <div className="card p-4 mb-4">
              <p className="text-xs font-bold text-ink mb-2 inline-flex items-center gap-1.5"><Tag size={13} /> Also known as</p>
              <p className="text-[11px] text-ink-faint mb-2">Alternate spellings that resolve to this vendor (used by dup-check, saved emails and W9 lookup).</p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {aliases.map(a => (
                  <span key={a.id} className="inline-flex items-center gap-1 text-xs bg-elev border border-rule rounded px-2 py-0.5">
                    {a.alias}<button onClick={() => delAlias(a.id)} className="text-ink-faint hover:text-danger"><X size={11} /></button>
                  </span>
                ))}
                {!aliases.length && <span className="text-xs text-ink-faint">No aliases</span>}
              </div>
              <div className="flex gap-2">
                <input className="input !py-1.5 text-sm" placeholder="Add an alias" value={newAlias} onChange={e => setNewAlias(e.target.value)} onKeyDown={e => e.key === 'Enter' && addAlias()} />
                <button onClick={addAlias} className="btn-secondary flex-shrink-0 !py-1.5"><Plus size={14} /></button>
              </div>
            </div>

            {/* Merge history — the only place a merge stays visible after the
                fact. Deleting the alias chip used to erase the sole trace. */}
            {isAdmin && (
              <div className="card p-4 mb-4">
                <p className="text-xs font-bold text-ink mb-2 inline-flex items-center gap-1.5"><History size={13} /> Merged into this vendor</p>
                {merges.merges?.length ? (
                  <div className="space-y-1.5">
                    {merges.merges.map(m => (
                      <div key={m.id} className={`flex items-center gap-2 text-xs ${m.undone_at ? 'opacity-50' : ''}`}>
                        <span className="flex-1 min-w-0 truncate">
                          <span className="font-medium text-ink">{m.from_name}</span>
                          <span className="text-ink-faint"> · {m.entry_count} entr{m.entry_count === 1 ? 'y' : 'ies'} · {m.kind} by {m.merged_by || '—'} {formatDate(m.merged_at)}</span>
                        </span>
                        {m.undone_at
                          ? <span className="text-[10px] uppercase text-ink-faint">undone</span>
                          : <button onClick={() => doUnmerge(m)} className="text-ink-faint hover:text-ink inline-flex items-center gap-1" title={`Reverses by id, so rows that were always "${m.into_name}" stay put.`}><Undo2 size={12} /> Unmerge</button>}
                      </div>
                    ))}
                  </div>
                ) : <p className="text-[11px] text-ink-faint">Nothing has been merged into this vendor.</p>}
                {merges.logged_since && (
                  <p className="text-[10px] text-ink-faint mt-1.5">Merges have been logged since {formatDate(merges.logged_since)} — anything folded in before that cannot be listed or reversed here.</p>
                )}
              </div>
            )}

            {/* Saved emails (auto-CC'd on payment confirmations) */}
            <div className="card p-4 mb-4">
              <p className="text-xs font-bold text-ink mb-2">Saved emails</p>
              <p className="text-[11px] text-ink-faint mb-2">Auto-CC'd when you send this vendor a payment confirmation. Label them (accounting, AP, manager…) so the right person is on the right email.</p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {emails.map(e => (
                  <span key={e.id} className="inline-flex items-center gap-1 text-xs bg-elev border border-rule rounded px-2 py-0.5">
                    {e.label_text && <span className="text-[9px] font-bold uppercase tracking-wide text-brand-ink">{e.label_text}</span>}
                    {e.email}
                    {e.via_alias && <span className="text-[9px] uppercase text-ink-faint" title={`Saved under "${e.vendor}", an alias of this vendor`}>alias</span>}
                    <button onClick={() => delEmail(e.id)} className="text-ink-faint hover:text-danger"><X size={11} /></button>
                  </span>
                ))}
                {!emails.length && <span className="text-xs text-ink-faint">None</span>}
              </div>
              <div className="flex gap-2">
                <input className="input !py-1.5 text-sm" placeholder="add@email.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && addEmail()} />
                <input className="input !py-1.5 text-sm !w-28" placeholder="label" value={newEmailLabel} onChange={e => setNewEmailLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && addEmail()} />
                <button onClick={addEmail} className="btn-secondary flex-shrink-0 !py-1.5"><Plus size={14} /></button>
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
                  <p className="text-[11px] text-ink-faint mt-1">Updates every invoice and vendor-form submission; the old name becomes an alias.</p>
                </div>
                <div className="relative">
                  <label className="label inline-flex items-center gap-1.5"><GitMerge size={12} /> Merge into</label>
                  <div className="flex gap-2">
                    <input className="input !py-1.5 text-sm" placeholder="Search a vendor…" value={mergeInto || mergeQ}
                      onChange={e => { setMergeQ(e.target.value); setMergeInto('') }} />
                    <button onClick={doMerge} disabled={!mergeInto} className="btn-secondary flex-shrink-0 !py-1.5">Merge</button>
                  </div>
                  {!mergeInto && mergeHits.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full rounded-lg border border-rule bg-card shadow-elevated max-h-52 overflow-y-auto">
                      {mergeHits.map(v => (
                        <button key={v.name} onClick={() => { setMergeInto(v.name); setMergeQ(''); setMergeHits([]) }}
                          className="w-full text-left px-3 py-1.5 text-sm text-ink-muted hover:bg-elev">
                          {v.name} <span className="text-[11px] text-ink-faint">· {v.invoices} invoice{v.invoices === 1 ? '' : 's'}{v.w9_on_file ? ' · W9' : ''}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Entries — families, with their split children nested */}
            <h3 className="text-xs font-bold text-ink-muted uppercase tracking-wide mb-2">Invoices ({data.entries.length})</h3>
            <div className="space-y-1.5">
              {data.entries.map(e => (
                <div key={e.id} className="border-b border-divider py-1.5">
                  <Link to={`/ledger?focus=${e.id}`} className="flex items-center justify-between text-sm hover:bg-elev rounded px-1 -mx-1">
                    <span className="text-ink-muted truncate">
                      {formatDate(e.invoice_date)} · {e.invoice_number || 'no #'}
                      {e.voided && <span className="ml-1 text-[10px] uppercase text-danger">voided</span>}
                    </span>
                    <span className="text-ink font-medium tabular-nums whitespace-nowrap">{moneyOrig(e.family_amount, e.currency)}</span>
                  </Link>
                  {e.children?.length > 0 && (
                    <div className="pl-4 mt-0.5 space-y-0.5">
                      {e.children.map(c => (
                        <Link key={c.id} to={`/ledger?focus=${c.id}`} className="flex items-center justify-between text-[11px] text-ink-faint hover:text-ink">
                          <span className="truncate">↳ {c.artist || 'split slice'}</span>
                          <span className="tabular-nums">{moneyOrig(c.amount, c.currency)}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {!data.entries.length && <p className="text-xs text-ink-faint">No invoices yet.</p>}
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
  const [error, setError] = useState(null)
  // ?vendor=<name> IS the per-vendor deep link — there is no /vendors/:name
  // route. `components/PayeeLink` opens it in a new tab from the review
  // surfaces, and keeping it in the URL means that tab can be shared or
  // reloaded onto the same drawer.
  const [params, setParams] = useSearchParams()
  const selected = params.get('vendor') || null
  const setSelected = (name) => setParams(
    (p) => { const n = new URLSearchParams(p); if (name) n.set('vendor', name); else n.delete('vendor'); return n },
    { replace: true }
  )
  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState(null)
  const [scanMeta, setScanMeta] = useState(null)
  const [q, setQ] = useState('')
  const [w9Filter, setW9Filter] = useState('')
  const [sort, setSort] = useState('spend')

  const load = () => {
    setLoading(true)
    api.get('/ledger/vendors')
      .then(res => { setVendors(res.data.data || []); setError(null) })
      .catch(err => setError(err.response?.data?.error || 'Could not load vendors'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const scanW9s = async () => {
    setScanning(true)
    try {
      const { data } = await api.post('/ledger/vendors/scan-w9s')
      setScanResults(data.data || []); setScanMeta(data.meta || null)
      load() // persisted scans feed the mismatch badges in the table
    } catch (err) { toast(err.response?.data?.error || 'Scan failed', 'error') }
    finally { setScanning(false) }
  }

  const mismatchCount = vendors.filter(v => v.w9_mismatch).length

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    let out = vendors.filter(v => {
      if (w9Filter === 'on' && !v.w9_on_file) return false
      if (w9Filter === 'off' && v.w9_on_file) return false
      if (w9Filter === 'mismatch' && !v.w9_mismatch) return false
      if (!s) return true
      // Aliases and merged spellings are searchable — looking up the name on
      // the invoice in front of you has to find the vendor it became.
      return [v.name, v.email, ...(v.spellings || [])].some(x => String(x || '').toLowerCase().includes(s))
    })
    const cmp = {
      spend: (a, b) => b.total_spent_usd - a.total_spent_usd,
      name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      invoices: (a, b) => b.invoice_count - a.invoice_count,
      recent: (a, b) => String(b.last_invoice || '').localeCompare(String(a.last_invoice || '')),
      outstanding: (a, b) => (b.total_spent - b.paid_amount) - (a.total_spent - a.paid_amount),
    }[sort]
    return [...out].sort(cmp)
  }, [vendors, q, w9Filter, sort])

  const filtering = q.trim() || w9Filter

  return (
    <div>
      <PageHeader
        title="Vendors"
        subtitle="Everyone you've paid, grouped by payee"
        action={isAdmin && vendors.some(v => v.w9_on_file) ? (
          <button onClick={scanW9s} disabled={scanning} className="btn-secondary"><Sparkles size={15} /> {scanning ? 'Scanning W9s…' : 'Scan W9s'}</button>
        ) : null}
      />

      {mismatchCount > 0 && (
        <button onClick={() => setW9Filter('mismatch')}
          className="card w-full text-left px-4 py-2.5 mb-4 bg-amber-500/10 text-sm text-ink flex items-center gap-2 hover:opacity-90">
          <AlertTriangle size={15} className="text-warning flex-shrink-0" />
          {mismatchCount} vendor{mismatchCount === 1 ? '' : 's'} {mismatchCount === 1 ? 'has' : 'have'} a W9 in a different name than the one you pay — the 1099 would go to the wrong entity. Review →
        </button>
      )}

      {scanResults && (
        <div className="card p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-ink">
              W9 scan results ({scanResults.length})
              {scanMeta?.remaining ? <span className="ml-2 text-xs font-normal text-ink-muted">{scanMeta.remaining} still unscanned — run it again</span> : null}
            </h2>
            <button onClick={() => setScanResults(null)} className="text-ink-faint hover:text-ink"><X size={16} /></button>
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {scanResults.map((r, i) => (
              <div key={i} className="text-sm border-b border-divider pb-2">
                <p className="font-medium text-ink flex items-center gap-2">
                  {r.flags?.length || r.name_mismatch ? <AlertTriangle size={14} className="text-warning" /> : <ShieldCheck size={14} className="text-emerald-500" />}
                  {r.vendor}
                </p>
                {!r.ok ? <p className="text-xs text-ink-faint">{r.reason}</p> : (
                  <>
                    {r.name_mismatch && <p className="text-xs text-warning">W9 is in the name “{r.w9_name}”</p>}
                    {r.summary && <p className="text-xs text-ink-muted">{r.summary}</p>}
                    {r.flags?.map((f, j) => (
                      <span key={j} className={`inline-flex mt-1 mr-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${SEV[f.severity] || SEV.low}`}>{f.field}</span>
                    ))}
                  </>
                )}
              </div>
            ))}
            {!scanResults.length && <p className="text-sm text-ink-muted">Every W9 on file has already been scanned.</p>}
          </div>
        </div>
      )}

      <div className="card px-4 py-3 flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input className="input !py-1.5 !pl-7 text-sm" placeholder="Search vendors, emails, alternate spellings…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <select className="input !py-1.5 text-sm !w-auto" value={w9Filter} onChange={e => setW9Filter(e.target.value)}>
          {W9_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="input !py-1.5 text-sm !w-auto" value={sort} onChange={e => setSort(e.target.value)}>
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="text-xs text-ink-muted">{rows.length} of {vendors.length}</span>
        {filtering && <button className="text-xs underline text-ink-muted" onClick={() => { setQ(''); setW9Filter('') }}>Clear</button>}
      </div>

      {loading ? (
        <div className="card p-2"><Skeleton.Table rows={8} cols={6} /></div>
      ) : error ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-danger mb-3">{error}</p>
          <button onClick={load} className="btn-secondary mx-auto">Retry</button>
        </div>
      ) : vendors.length === 0 ? (
        <div className="card p-10 text-center"><Building2 size={28} className="text-ink-faint mx-auto mb-3" /><p className="text-sm text-ink-muted">No vendors yet. They appear once you have approved ledger entries.</p></div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center"><p className="text-sm text-ink-muted">No vendors match your filters.</p></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left">
                {['Vendor', 'Invoices', 'Total spent', 'Paid', 'Last invoice', 'W9', '1099'].map(h => <th key={h} className="px-4 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wide">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {rows.map(v => (
                <tr key={v.name} onClick={() => setSelected(v.name)} className="hover:bg-elev cursor-pointer">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink flex items-center gap-1.5">
                      {v.name}
                      {v.w9_mismatch && <AlertTriangle size={13} className="text-warning" title={`W9 is in the name "${v.w9_name}"`} />}
                    </p>
                    {v.email && <p className="text-xs text-ink-faint">{v.email}</p>}
                    {v.alias_count > 0 && <p className="text-[11px] text-ink-faint">aka {v.alias_count} other spelling{v.alias_count === 1 ? '' : 's'}</p>}
                  </td>
                  <td className="px-4 py-3 text-ink-muted tabular-nums">{v.invoice_count}</td>
                  <td className="px-4 py-3 text-ink font-medium tabular-nums">
                    {money(v.total_spent_usd)}
                    {/* Mixed currencies netted into one "$" is a lie about the
                        figure; say the number is a USD equivalent and how many
                        currencies went into it. */}
                    {v.currency_count > 1 && <span className="block text-[10px] text-ink-faint">≈USD · {v.currency_count} currencies</span>}
                  </td>
                  <td className="px-4 py-3 text-ink-muted tabular-nums">{moneyOrig(v.paid_amount, 'USD')}</td>
                  <td className="px-4 py-3 text-ink-muted">{formatDate(v.last_invoice)}</td>
                  <td className="px-4 py-3">
                    {v.w9_on_file
                      ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><ShieldCheck size={13} /> On file</span>
                      : <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600"><ShieldAlert size={13} /> Missing</span>}
                  </td>
                  <td className="px-4 py-3">
                    {v.qualifies_1099
                      ? <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" title="Spend this calendar year is at or above the 1099 reporting threshold">Qualifies</span>
                      : <span className="text-xs text-ink-faint">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <VendorDrawer name={selected} onClose={() => setSelected(null)} onChanged={load} onRenamed={(to) => setSelected(to)} />}
    </div>
  )
}
