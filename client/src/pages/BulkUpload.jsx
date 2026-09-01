import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, CheckCircle2, FileText, Loader2, Trash2, XCircle } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Dropzone from '../components/Dropzone'
import CategoryOptions from '../components/CategoryOptions'
import { Badge, Button } from '../components/ui'
import { moneyByCurrency, totalsByCurrency } from '../utils/money'

// Bulk Upload — boom's /bk/bulk-upload port. Drop N invoices + M proofs of
// payment; every file is AI-parsed (POST /ledger/parse-invoice|parse-proof,
// one at a time — sequential keeps a 40-file batch clear of the server's
// concurrent-multipart guard), proofs are auto-matched to invoices (payee AND
// amount must both agree), the results land in an editable review grid, and
// one batch call per CHUNK creates the entries (POST /ledger/entries/batch).
//
// Divergences from boom (deliberate):
// - Entries are created PENDING → they route through the Approvals deck and
//   its checklist, instead of boom's born-approved rows (RC-7).
// - Files are never base64'd: the File objects ride a multipart submit, in
//   chunks of CHUNK entries so no single request buffers the whole batch.
// - "One payment" letters resolve onto the existing settlement-groups
//   endpoint with the created ids — cadence's one grouping mechanism.
// - The review grid adds a live duplicate check per row (GET /ledger/check-dup,
//   exact + similar tiers) with a per-row "Add anyway" override.
//
// Degrades gracefully: without an AI key the parses return empty and every
// row arrives blank for manual completion; without R2 each entry fails
// cleanly server-side (no row without its viewable invoice) and is reported
// on the done screen.

const ACCEPT = '.pdf,.jpg,.jpeg,.png'
const CHUNK = 8
const LETTERS = ['A', 'B', 'C', 'D', 'E']
const MP = { headers: { 'Content-Type': 'multipart/form-data' } }

// Fuzzy payee equality — normalized equality-or-substring (boom's rule).
function payeesMatch(a, b) {
  if (!a || !b) return false
  const na = String(a).toLowerCase().replace(/[^a-z0-9]/g, '')
  const nb = String(b).toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}
const amountsMatch = (a, b) => !!a && !!b && Math.abs(Number(a) - Number(b)) < 0.02

const cellInput = 'w-full text-xs border border-rule rounded-md px-2 py-1 bg-card text-ink focus:outline-none focus:ring-1 focus:ring-brand-400'
const th = 'px-2.5 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-ink-muted whitespace-nowrap'

function FileList({ files, onRemove, tone }) {
  if (!files.length) return null
  return (
    <div className="mt-2">
      {files.map((f, i) => (
        <div key={i} className="flex items-center gap-2 py-1.5 border-b border-divider last:border-0">
          <FileText size={14} className={tone === 'proof' ? 'text-success flex-shrink-0' : 'text-warning flex-shrink-0'} />
          <span className="text-xs text-ink flex-1 truncate">{f.name}</span>
          <button type="button" onClick={() => onRemove(i)} className="text-ink-faint hover:text-danger" title="Remove">
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}

export default function BulkUpload() {
  const [invoiceFiles, setInvoiceFiles] = useState([]) // [{ file, name, status, parsed }]
  const [proofFiles, setProofFiles] = useState([])
  const [phase, setPhase] = useState('upload') // upload | parsing | review | submitting | done
  const [progress, setProgress] = useState({ current: 0, total: 0, label: '' })
  const [entries, setEntries] = useState([])
  const [aiDisabled, setAiDisabled] = useState(false)
  const [submitResult, setSubmitResult] = useState(null)
  const [error, setError] = useState('')

  const addFiles = (list, type) => {
    const wrapped = (Array.isArray(list) ? list : [list]).filter(Boolean)
      .map((f) => ({ file: f, name: f.name, status: 'pending', parsed: null }))
    if (!wrapped.length) return
    if (type === 'invoice') setInvoiceFiles((prev) => [...prev, ...wrapped])
    else setProofFiles((prev) => [...prev, ...wrapped])
  }
  const removeFile = (type, idx) => {
    if (type === 'invoice') setInvoiceFiles((prev) => prev.filter((_, i) => i !== idx))
    else setProofFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  // ── Parse everything, then auto-match proofs → invoices ─────────────────
  const startParsing = async () => {
    if (!invoiceFiles.length) return
    setPhase('parsing')
    setError('')
    const total = invoiceFiles.length + proofFiles.length
    let current = 0
    let disabled = false

    // Sequential on purpose: one multipart request in flight at a time. An AI
    // failure keeps the FILE — the row still uploads, fields get typed by hand.
    const invs = [...invoiceFiles]
    for (let i = 0; i < invs.length; i++) {
      current++
      setProgress({ current, total, label: `Parsing invoice: ${invs[i].name}` })
      let parsed = {}
      try {
        const fd = new FormData()
        fd.append('file', invs[i].file)
        const res = await api.post('/ledger/parse-invoice', fd, MP)
        parsed = res.data.data || {}
        if (res.data.ai_status === 'disabled') disabled = true
      } catch { /* keep the file — blank row, manual completion */ }
      invs[i] = { ...invs[i], status: 'done', parsed }
    }
    setInvoiceFiles(invs)

    const proofs = [...proofFiles]
    for (let i = 0; i < proofs.length; i++) {
      current++
      setProgress({ current, total, label: `Parsing proof: ${proofs[i].name}` })
      let parsed = {}
      try {
        const fd = new FormData()
        fd.append('file', proofs[i].file)
        const res = await api.post('/ledger/parse-proof', fd, MP)
        parsed = res.data.data || {}
      } catch { /* same posture */ }
      proofs[i] = { ...proofs[i], status: 'done', parsed }
    }
    setProofFiles(proofs)
    setAiDisabled(disabled)

    // First proof whose payee AND amount both agree claims the invoice (1:1).
    const used = new Set()
    const rows = invs.map((inv, idx) => {
      const p = inv.parsed || {}
      let matched = -1
      for (let j = 0; j < proofs.length; j++) {
        if (used.has(j)) continue
        const pp = proofs[j].parsed || {}
        if (payeesMatch(p.payee, pp.payee) && amountsMatch(p.amount, pp.amount)) { matched = j; used.add(j); break }
      }
      const proofParsed = matched >= 0 ? (proofs[matched].parsed || {}) : {}
      return {
        ref: `r${idx}`,
        invoiceFileIdx: idx,
        payee: p.payee || '',
        amount: p.amount ?? '',
        invoice_date: p.invoice_date || '',
        invoice_number: p.invoice_number || '',
        category: p.category || '',
        artist: p.artist || '',
        song: p.song || '',
        description: p.description || '',
        currency: p.currency || 'USD',
        payment_method: p.payment_method || '',
        matchedProofIdx: matched,
        payment_status: matched >= 0 ? 'Paid' : 'Unpaid',
        payment_date: matched >= 0 ? (proofParsed.payment_date || '') : '',
        payment_ref: matched >= 0 ? (proofParsed.reference_number || '') : '',
        settlement_label: '',
        include: true,
        force_duplicate: false,
        dup: null,
      }
    })

    // Duplicate chips — best-effort, exact + similar tiers off check-dup.
    for (const row of rows) {
      if (!row.payee || !row.invoice_number) continue
      try {
        const { data } = await api.get('/ledger/check-dup', { params: { payee: row.payee, invoice_number: row.invoice_number } })
        const d = data.data || {}
        if (d.duplicate || d.similar?.length) row.dup = d
      } catch { /* chip absent ≠ no duplicate — the server gate still stands */ }
    }

    setEntries(rows)
    setPhase('review')
  }

  const updateEntry = (idx, field, value) => {
    setEntries((prev) => prev.map((e, i) => {
      if (i !== idx) return e
      const next = { ...e, [field]: value }
      // Editing the identity a dup was computed against stales the chip.
      if (field === 'payee' || field === 'invoice_number') { next.dup = null; next.force_duplicate = false }
      return next
    }))
  }

  const recheckDup = async (idx) => {
    const e = entries[idx]
    if (!e || !e.payee || !e.invoice_number) return
    try {
      const { data } = await api.get('/ledger/check-dup', { params: { payee: e.payee, invoice_number: e.invoice_number } })
      const d = data.data || {}
      setEntries((prev) => prev.map((x, i) => (i === idx ? { ...x, dup: (d.duplicate || d.similar?.length) ? d : null } : x)))
    } catch { /* leave as-is */ }
  }

  const matchProof = (entryIdx, proofIdx) => {
    const proof = proofFiles[proofIdx]
    if (!proof || proof.status !== 'done') return
    setEntries((prev) => prev.map((e, i) => (i !== entryIdx ? e : {
      ...e,
      matchedProofIdx: proofIdx,
      payment_status: 'Paid',
      payment_date: proof.parsed?.payment_date || e.payment_date,
      payment_ref: proof.parsed?.reference_number || e.payment_ref,
    })))
  }
  const unmatchProof = (entryIdx) => {
    setEntries((prev) => prev.map((e, i) => (i !== entryIdx ? e : {
      ...e, matchedProofIdx: -1, payment_status: 'Unpaid', payment_date: '', payment_ref: '',
    })))
  }

  // ── Submit in chunks, then resolve the "one payment" letters ────────────
  const submitAll = async () => {
    const toSubmit = entries.filter((e) => e.include && String(e.payee).trim() && Number(e.amount) > 0)
    if (!toSubmit.length) return
    setPhase('submitting')
    setError('')
    setProgress({ current: 0, total: toSubmit.length, label: '' })
    const createdAll = []
    const failedAll = []
    let done = 0
    for (let i = 0; i < toSubmit.length; i += CHUNK) {
      const chunk = toSubmit.slice(i, i + CHUNK)
      const fd = new FormData()
      const payload = []
      let fi = 0
      for (const e of chunk) {
        const invFile = invoiceFiles[e.invoiceFileIdx]?.file || null
        const proofFile = e.matchedProofIdx >= 0 ? (proofFiles[e.matchedProofIdx]?.file || null) : null
        let invoice_file_index = null
        let proof_file_index = null
        if (invFile) { fd.append('files', invFile); invoice_file_index = fi++ }
        if (proofFile) { fd.append('files', proofFile); proof_file_index = fi++ }
        payload.push({
          ref: e.ref,
          payee: String(e.payee).trim(),
          amount: Number(e.amount),
          currency: e.currency || 'USD',
          invoice_date: e.invoice_date || null,
          invoice_number: e.invoice_number || null,
          category: e.category || null,
          artist: e.artist || null,
          song: e.song || null,
          description: e.description || null,
          payment_method: e.payment_method || null,
          payment_status: e.payment_status,
          payment_date: e.payment_date || null,
          payment_ref: e.payment_ref || null,
          force_duplicate: !!e.force_duplicate,
          invoice_file_index,
          proof_file_index,
        })
      }
      fd.append('entries', JSON.stringify(payload))
      let res = null
      let lastErr = null
      // One retry on 503 — that's the server's concurrent-upload guard asking
      // us to wait, not a failure.
      for (let attempt = 0; attempt < 2 && !res; attempt++) {
        try {
          res = await api.post('/ledger/entries/batch', fd, MP)
        } catch (err) {
          lastErr = err
          if (err.response?.status !== 503) break
          await new Promise((r) => setTimeout(r, 2000))
        }
      }
      if (res) {
        createdAll.push(...(res.data.data || []))
        failedAll.push(...(res.data.failed || []))
      } else {
        const msg = lastErr?.response?.data?.error || lastErr?.message || 'Request failed'
        for (const e of chunk) failedAll.push({ ref: e.ref, payee: e.payee, filename: invoiceFiles[e.invoiceFileIdx]?.name, error: msg })
      }
      done += chunk.length
      setProgress({ current: done, total: toSubmit.length, label: '' })
    }

    // Letters → settlement groups, with the ids that actually got created.
    // Reported both ways: a group that took is what settles the bank line
    // later, and a refused group left invoices that will NOT match — silence
    // there would read as success (boom's rule).
    const idByRef = new Map(createdAll.map((c) => [c.ref, c.id]))
    const byLetter = {}
    for (const e of toSubmit) {
      if (e.settlement_label) (byLetter[e.settlement_label] = byLetter[e.settlement_label] || []).push(e)
    }
    const groups = []
    const groupErrors = []
    for (const label of Object.keys(byLetter).sort()) {
      const members = byLetter[label]
      const ids = members.map((m) => idByRef.get(m.ref)).filter(Boolean)
      if (members.length < 2) { groupErrors.push({ label, error: 'a payment group needs at least two invoices — the letter was ignored' }); continue }
      if (ids.length < 2) { groupErrors.push({ label, error: 'fewer than two of its invoices were created' }); continue }
      try {
        await api.post('/ledger/settlement-groups', { ids })
        groups.push({ label, size: ids.length })
      } catch (err) {
        groupErrors.push({ label, error: err.response?.data?.error || err.message })
      }
    }

    setSubmitResult({
      count: createdAll.length,
      failed: failedAll,
      groups,
      groupErrors,
      matchedCount: toSubmit.filter((e) => e.matchedProofIdx >= 0).length,
    })
    setPhase('done')
  }

  const resetAll = () => {
    setPhase('upload')
    setInvoiceFiles([])
    setProofFiles([])
    setEntries([])
    setSubmitResult(null)
    setAiDisabled(false)
    setError('')
  }

  const usedProofIdxs = new Set(entries.filter((e) => e.matchedProofIdx >= 0).map((e) => e.matchedProofIdx))
  const unmatchedProofs = proofFiles.map((p, i) => ({ ...p, _idx: i })).filter((p) => p.status === 'done' && !usedProofIdxs.has(p._idx))
  const included = entries.filter((e) => e.include)
  const submittable = included.filter((e) => String(e.payee).trim() && Number(e.amount) > 0)
  const pct = progress.total ? Math.round((progress.current / progress.total) * 100) : 0

  return (
    <div>
      <PageHeader
        title="Bulk Upload"
        subtitle="Drop a stack of invoices and proofs of payment — AI-parsed, auto-matched, reviewed in a grid, then added to Approvals in one batch"
      />

      {error && (
        <div className="card px-4 py-2.5 mb-4 flex items-center gap-2 text-sm text-danger">
          <AlertCircle size={15} className="flex-shrink-0" /> {error}
          <button type="button" onClick={() => setError('')} className="ml-auto text-ink-faint hover:text-ink">✕</button>
        </div>
      )}

      {/* ── UPLOAD ── */}
      {phase === 'upload' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            <div>
              <div className="text-xs font-bold text-ink mb-2">Invoices</div>
              <Dropzone multiple accept={ACCEPT} value={null} onChange={(fs) => addFiles(fs, 'invoice')}
                label={<><span className="font-semibold text-brand-600">Drop invoices here</span> or click to pick</>}
                hint="PDF, JPG or PNG" />
              <FileList files={invoiceFiles} onRemove={(i) => removeFile('invoice', i)} tone="invoice" />
            </div>
            <div>
              <div className="text-xs font-bold text-ink mb-2">Proofs of Payment</div>
              <Dropzone multiple accept={ACCEPT} value={null} onChange={(fs) => addFiles(fs, 'proof')}
                label={<><span className="font-semibold text-brand-600">Drop proofs here</span> or click to pick</>}
                hint="PDF, JPG or PNG · optional" />
              <FileList files={proofFiles} onRemove={(i) => removeFile('proof', i)} tone="proof" />
            </div>
          </div>
          <div className="flex items-center justify-end gap-3">
            <span className="text-xs text-ink-muted">
              {invoiceFiles.length} invoice{invoiceFiles.length === 1 ? '' : 's'}
              {proofFiles.length > 0 && `, ${proofFiles.length} proof${proofFiles.length === 1 ? '' : 's'}`}
            </span>
            <Button onClick={startParsing} disabled={!invoiceFiles.length}>Parse &amp; Match</Button>
          </div>
        </>
      )}

      {/* ── PARSING / SUBMITTING ── */}
      {(phase === 'parsing' || phase === 'submitting') && (
        <div className="card px-10 py-16 text-center">
          <Loader2 size={32} className="mx-auto mb-4 text-brand-600 animate-spin" />
          <div className="text-base font-bold text-ink mb-2">
            {phase === 'parsing'
              ? <>Parsing files… {progress.current} of {progress.total}</>
              : <>Adding entries… {progress.current} of {progress.total}</>}
          </div>
          {progress.label && <div className="text-sm text-ink-muted mb-4">{progress.label}</div>}
          <div className="w-72 h-1.5 mx-auto rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full bg-brand-600 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* ── REVIEW ── */}
      {phase === 'review' && (
        <>
          {aiDisabled && (
            <div className="card px-4 py-2.5 mb-4 text-sm text-warning">
              AI parsing is not configured on this server — the rows below arrived blank. Fill in the fields by hand; the files still upload with each entry.
            </div>
          )}
          <div className="text-[13px] font-semibold text-ink mb-3">
            {included.length} invoice{included.length === 1 ? '' : 's'} ready
            {entries.filter((e) => e.matchedProofIdx >= 0).length > 0 && <> · {entries.filter((e) => e.matchedProofIdx >= 0).length} matched with proofs</>}
            {unmatchedProofs.length > 0 && <> · {unmatchedProofs.length} unmatched proof{unmatchedProofs.length === 1 ? '' : 's'}</>}
          </div>
          <div className="card overflow-x-auto mb-4">
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr className="bg-page border-b border-rule">
                  <th className={`${th} text-center`}></th>
                  <th className={th}>Payee</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={th}>Date</th>
                  <th className={th}>Invoice #</th>
                  <th className={th}>Duplicate</th>
                  {/* Same letter = the vendor settles these with ONE bank
                      transfer. Resolved into a settlement group after create. */}
                  <th className={th} title="Invoices sent in ONE payment. Give them the same letter and a bank line totalling them exactly will settle all of them.">One payment</th>
                  <th className={th}>Category</th>
                  <th className={th}>Artist</th>
                  <th className={th}>Song</th>
                  <th className={`${th} text-center`}>Proof</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, idx) => (
                  <tr key={e.ref} className={`border-b border-divider ${e.include ? '' : 'opacity-45'}`}>
                    <td className="px-2.5 py-1.5 text-center">
                      <input type="checkbox" checked={e.include} onChange={(ev) => updateEntry(idx, 'include', ev.target.checked)} className="cursor-pointer" aria-label={`Include ${e.payee || 'row'}`} />
                    </td>
                    <td className="px-2 py-1.5 min-w-[150px]">
                      <input value={e.payee} onChange={(ev) => updateEntry(idx, 'payee', ev.target.value)} onBlur={() => recheckDup(idx)} className={`${cellInput} font-semibold`} />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1 justify-end">
                        <input type="number" step="0.01" value={e.amount} onChange={(ev) => updateEntry(idx, 'amount', ev.target.value)} className={`${cellInput} text-right font-semibold`} style={{ width: 92 }} />
                        {e.currency && e.currency !== 'USD' && <span className="text-[10px] font-semibold text-ink-muted">{e.currency}</span>}
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="date" value={e.invoice_date} onChange={(ev) => updateEntry(idx, 'invoice_date', ev.target.value)} className={cellInput} style={{ width: 128 }} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={e.invoice_number} onChange={(ev) => updateEntry(idx, 'invoice_number', ev.target.value)} onBlur={() => recheckDup(idx)} className={cellInput} style={{ width: 96 }} />
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {e.dup?.duplicate ? (
                        <div className="flex flex-col gap-0.5">
                          <Badge tone="danger">dup of #{e.dup.match?.id}</Badge>
                          <label className="flex items-center gap-1 text-[10px] text-ink-muted cursor-pointer">
                            <input type="checkbox" checked={e.force_duplicate} onChange={(ev) => updateEntry(idx, 'force_duplicate', ev.target.checked)} /> Add anyway
                          </label>
                        </div>
                      ) : e.dup?.similar?.length ? (
                        <Badge tone="warning">similar: #{e.dup.similar[0]?.invoice_number}</Badge>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <select value={e.settlement_label} onChange={(ev) => updateEntry(idx, 'settlement_label', ev.target.value)} title="Same letter = one payment"
                        className={`${cellInput} cursor-pointer ${e.settlement_label ? 'font-extrabold' : ''}`} style={{ width: 64 }}>
                        <option value="">—</option>
                        {LETTERS.map((L) => <option key={L} value={L}>{L}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <select value={e.category} onChange={(ev) => updateEntry(idx, 'category', ev.target.value)} className={`${cellInput} cursor-pointer`} style={{ width: 136 }}>
                        <option value="">—</option>
                        <CategoryOptions grouped />
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={e.artist} onChange={(ev) => updateEntry(idx, 'artist', ev.target.value)} className={cellInput} style={{ width: 110 }} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={e.song} onChange={(ev) => updateEntry(idx, 'song', ev.target.value)} className={cellInput} style={{ width: 110 }} />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {e.matchedProofIdx >= 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle2 size={14} className="text-success" />
                          <span className="text-[10px] font-bold text-success max-w-[90px] truncate">{proofFiles[e.matchedProofIdx]?.name}</span>
                          <button type="button" onClick={() => unmatchProof(idx)} className="text-ink-faint hover:text-danger" title="Unmatch proof">
                            <XCircle size={12} />
                          </button>
                        </span>
                      ) : unmatchedProofs.length > 0 ? (
                        <select value="" onChange={(ev) => { if (ev.target.value !== '') matchProof(idx, parseInt(ev.target.value, 10)) }} className={`${cellInput} cursor-pointer`} style={{ width: 120 }}>
                          <option value="">Match proof…</option>
                          {unmatchedProofs.map((p) => <option key={p._idx} value={p._idx}>{p.name}</option>)}
                        </select>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <Badge tone={e.payment_status === 'Paid' ? 'success' : 'warning'}>{e.payment_status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Button variant="secondary" onClick={() => {
              setPhase('upload'); setEntries([])
              setInvoiceFiles((prev) => prev.map((f) => ({ ...f, status: 'pending', parsed: null })))
              setProofFiles((prev) => prev.map((f) => ({ ...f, status: 'pending', parsed: null })))
            }}>Back</Button>
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-ink-muted">
                {included.length} of {entries.length} selected · {moneyByCurrency(totalsByCurrency(included, (e) => Number(e.amount) || 0)) || '$0.00'} total
              </span>
              <Button onClick={submitAll} disabled={!submittable.length}>
                Add {included.length} to Approvals
              </Button>
            </div>
          </div>
        </>
      )}

      {/* ── DONE ── */}
      {phase === 'done' && submitResult && (
        <div className="card px-10 py-14 text-center">
          <CheckCircle2 size={44} className="mx-auto mb-4 text-success" />
          <div className="text-xl font-extrabold text-ink mb-2">
            {submitResult.count} {submitResult.count === 1 ? 'entry' : 'entries'} added
          </div>
          <p className="text-sm text-ink-muted mb-6">
            Created as <span className="font-semibold text-ink">Pending</span> — they'll go through the Approvals deck like any submission.
            {submitResult.matchedCount > 0 && <> {submitResult.matchedCount} arrived with proofs of payment and are already marked Paid.</>}
          </p>
          {submitResult.failed.length > 0 && (
            <div className="max-w-md mx-auto mb-6 text-left card px-4 py-3 text-[13px] text-danger">
              <div className="font-bold mb-1.5">
                {submitResult.failed.length} {submitResult.failed.length === 1 ? 'invoice' : 'invoices'} couldn't be saved
              </div>
              <ul className="list-disc pl-4 text-xs space-y-0.5">
                {submitResult.failed.slice(0, 10).map((f, i) => (
                  <li key={i}>
                    <span className="font-semibold">{f.payee || '—'}</span>
                    {f.filename ? ` (${f.filename})` : ''}
                    {f.error ? ` — ${f.error}` : ''}
                  </li>
                ))}
                {submitResult.failed.length > 10 && <li className="italic">…and {submitResult.failed.length - 10} more</li>}
              </ul>
              <div className="mt-2 text-xs text-ink-muted">
                No ledger entries were created for these — retry by re-uploading the same files.
              </div>
            </div>
          )}
          {(submitResult.groups.length > 0 || submitResult.groupErrors.length > 0) && (
            <div className="max-w-md mx-auto mb-6 text-left card px-4 py-3 text-[13px] text-ink">
              {submitResult.groups.map((g) => (
                <div key={g.label} className="mb-1.5">
                  <span className="font-bold">{g.label}</span>: {g.size} invoices marked as one payment
                  <div className="text-[11.5px] text-ink-muted">A bank line totalling them exactly will settle all of them.</div>
                </div>
              ))}
              {submitResult.groupErrors.map((g, i) => (
                <div key={i} className="mt-1.5 text-warning">
                  <span className="font-bold">{g.label}</span> was not grouped — {g.error}
                  <div className="text-[11.5px]">The invoices were still added. Group them from the Ledger with One payment.</div>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-center gap-3">
            <Button variant="secondary" onClick={resetAll}>Upload More</Button>
            <Link to="/approvals" className="btn-primary">View Approvals</Link>
            <Link to="/ledger" className="btn-secondary">View Ledger</Link>
          </div>
        </div>
      )}
    </div>
  )
}
