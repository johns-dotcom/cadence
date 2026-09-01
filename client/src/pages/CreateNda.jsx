import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation, Link, Navigate } from 'react-router-dom'
import { ArrowLeft, FileText, Download, FileType2, Save, Trash2, Plus, ShieldCheck, AlertCircle, Eye, Pencil, X } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import {
  NDA_TEMPLATES, NDA_TEMPLATE_LIST, getTemplate, buildNdaBody, blankFormFor, defaultEnabledFor,
  deriveEnabledFromBody, missingMandatorySections, renderSignatureFor,
  formatEffectiveDate, escapeRegex, getHeadingLevel, bodyParagraphs, stripLegacyClosing,
} from '../constants/ndaTemplates'
import { formatDate } from '../utils/dates'

// ── Document helpers shared by the preview, the PDF path and the docx path ──
// Every renderer classifies paragraphs with the same getHeadingLevel pass and
// appends the same structured signature block, so what you see in the preview
// is what lands in the file.

// The body a row should render: its own saved text, or — for a row saved before
// the body column existed, or one whose body was emptied — a rebuild from that
// row's OWN template and stored form (never the template on screen).
export function bodyForDoc(doc) {
  const form = (doc.data && doc.data.form) || {}
  const enabled = (doc.data && doc.data.enabled) || {}
  const raw = doc.custom_body || buildNdaBody(doc.template, form, enabled)
  return stripLegacyClosing(raw)
}
const formForDoc = (doc) => ((doc.data && doc.data.form) || {})

const partyOwner = (f) => f.owner_name || f.disclosing_party || ''
const partyRecipient = (f) => f.recipient_name || f.recipient_company || f.receiving_party || ''

// Canonical filename: workspace name, the template's prefix, the recipient and
// the effective date — so a downloaded file is identifiable without opening it.
function docFilename(doc, labelName, ext) {
  const f = formForDoc(doc)
  const safe = (s, fb) => (String(s || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || fb)
  const prefix = getTemplate(doc.template).filenamePrefix || 'NDA'
  const date = (f.effective_date || new Date().toISOString().slice(0, 10)).slice(0, 10)
  return `${safe(labelName, 'Workspace')}-${prefix}-${safe(partyRecipient(f), 'NDA')}-${date}.${ext}`
}

// Render to a multi-page PDF via jsPDF — selectable text, helvetica, 1in
// margins, 16pt centered title, 11pt body, bold section headers, and single
// newlines preserved so bullet blocks keep one item per line.
async function exportPdf(doc, labelName) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = pdf.internal.pageSize.getWidth()
  const H = pdf.internal.pageSize.getHeight()
  const MX = 72, MY = 72, lineH = 14, bodyW = W - MX * 2
  let y = MY
  const ensureSpace = (need = lineH) => { if (y + need > H - MY) { pdf.addPage(); y = MY } }

  for (const para of bodyParagraphs(bodyForDoc(doc))) {
    const level = getHeadingLevel(para)
    if (level === 2) {
      ensureSpace(40)
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(17, 17, 17)
      pdf.text(para, (W - pdf.getTextWidth(para)) / 2, y + 20)
      y += 44
    } else if (level === 1) {
      ensureSpace(lineH + 8)
      y += 6
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(17, 17, 17)
      for (const line of pdf.splitTextToSize(para, bodyW)) { ensureSpace(lineH); pdf.text(line, MX, y); y += lineH }
      y += 4
    } else {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11); pdf.setTextColor(51, 51, 51)
      for (const line of para.split('\n').flatMap(l => pdf.splitTextToSize(l, bodyW))) { ensureSpace(lineH); pdf.text(line, MX, y); y += lineH }
      y += 6
    }
  }

  // Keep both signature blocks on one page — force a break if they don't fit.
  if (y + 240 > H - MY) { pdf.addPage(); y = MY }
  const sig = renderSignatureFor(doc.template, formForDoc(doc))
  for (const side of [sig.owner, sig.recipient]) {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(17, 17, 17)
    pdf.text(side.party, MX, y); y += lineH + 6
    pdf.setFont('helvetica', 'normal')
    for (const line of side.lines) { pdf.text(line, MX, y); y += lineH + 4 }
    y += 14
  }
  pdf.save(docFilename(doc, labelName, 'pdf'))
}

// Render to a real .docx — mirrors the PDF: 1in margins (1440 twips), 16pt
// centered title and 11pt body (docx sizes are half-points), Helvetica default
// (Word substitutes Arial), bullet newlines as line breaks inside one run set.
async function exportDocx(doc, labelName) {
  const { Document, Packer, Paragraph, TextRun, AlignmentType } = await import('docx')
  const children = []
  for (const para of bodyParagraphs(bodyForDoc(doc))) {
    const level = getHeadingLevel(para)
    if (level === 2) {
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 320 }, children: [new TextRun({ text: para, bold: true, size: 32 })] }))
    } else if (level === 1) {
      children.push(new Paragraph({ spacing: { before: 160, after: 100 }, children: [new TextRun({ text: para, bold: true, size: 22 })] }))
    } else {
      const lines = para.split('\n')
      children.push(new Paragraph({ spacing: { after: 140 }, children: lines.map((l, i) => new TextRun({ text: l, size: 22, break: i === 0 ? 0 : 1 })) }))
    }
  }
  const sig = renderSignatureFor(doc.template, formForDoc(doc))
  for (const [side, before] of [[sig.owner, 480], [sig.recipient, 320]]) {
    children.push(new Paragraph({ spacing: { before, after: 120 }, children: [new TextRun({ text: side.party, bold: true, size: 22 })] }))
    for (const line of side.lines) children.push(new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: line, size: 22 })] }))
  }
  const blob = await Packer.toBlob(new Document({
    styles: { default: { document: { run: { font: 'Helvetica' } } } },
    sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children }],
  }))
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = docFilename(doc, labelName, 'docx'); a.click()
  URL.revokeObjectURL(url)
}

// On-screen preview. Signature blocks render statically at the bottom — they
// are not part of the body text the user edits.
function NdaPreview({ body, form, templateKey, title }) {
  const sig = renderSignatureFor(templateKey, form || {})
  return (
    <>
      {title && <p className="text-[11px] font-semibold text-ink-faint uppercase tracking-widest mb-3">{title}</p>}
      {bodyParagraphs(body).map((para, i) => {
        const level = getHeadingLevel(para)
        if (level === 2) return <h1 key={i} className="text-2xl font-black tracking-tight text-ink text-center mb-4">{para}</h1>
        if (level === 1) return <p key={i} className="text-[13px] font-bold text-ink mb-3 pt-1">{para}</p>
        return <p key={i} className="text-[13px] text-ink-muted leading-relaxed mb-3 whitespace-pre-line">{para}</p>
      })}
      <div className="text-[13px] text-ink-muted space-y-1.5 pt-4">
        <p className="font-bold text-ink">{sig.owner.party}</p>
        {sig.owner.lines.map((l, i) => <p key={`o${i}`}>{l}</p>)}
        <p className="font-bold text-ink pt-3">{sig.recipient.party}</p>
        {sig.recipient.lines.map((l, i) => <p key={`r${i}`}>{l}</p>)}
      </div>
    </>
  )
}

export default function CreateNda() {
  const { template } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { toast } = useToast()
  const { label, user } = useAuth()

  const known = template && NDA_TEMPLATES[template]
  const tpl = known ? NDA_TEMPLATES[template] : null

  const [saved, setSaved] = useState([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [form, setForm] = useState({})
  const [enabled, setEnabled] = useState({})
  const [title, setTitle] = useState('')
  const [bodyDirty, setBodyDirty] = useState(false)
  const [customBody, setCustomBody] = useState('')
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [previewItem, setPreviewItem] = useState(null)

  // Snapshot of the form values currently substituted into customBody, so the
  // dirty-mode diff knows what strings to find when replacing.
  const prevFormRef = useRef({})
  // Debounce handle for the dirty-mode sync. Without it, typing a name
  // letter-by-letter would replace on every keystroke and cascade into
  // gibberish (see computeBodyDiff for the word-boundary guard).
  const syncTimerRef = useRef(null)
  // The body the debounced sync should diff against. A ref, not the state
  // closure: the timer fires long after the effect that armed it, by which
  // point the user may have typed more into the textarea — and a setState
  // updater is not an option either, since React can invoke an updater twice
  // and the second pass would discard the substitution.
  const bodyRef = useRef('')

  const loadSaved = () => api.get('/nda-documents')
    .then(r => { setSaved(r.data.data || []); setListError('') })
    .catch(err => setListError(err?.response?.data?.error || 'Could not load saved NDAs'))
  useEffect(() => { loadSaved().finally(() => setLoading(false)) }, [])

  // Seed defaults whenever the chosen template changes (and we're not editing).
  useEffect(() => {
    if (!tpl || editing) return
    const seed = blankFormFor(tpl, {
      owner_name: label?.name || '',
      disclosing_party: label?.name || '',
      signatory_name: user?.name || '',
      term_years: '2',
    })
    setForm(seed)
    setEnabled(defaultEnabledFor(tpl))
    setTitle(''); setBodyDirty(false); setCustomBody(''); setSaveError('')
    prevFormRef.current = seed
  }, [tpl?.key, editing])

  // Deep-link from the picker: open a specific saved NDA once it's loaded.
  useEffect(() => {
    const openId = location.state?.open
    if (!openId || !tpl || !saved.length || editing) return
    const doc = saved.find(d => d.id === openId)
    if (doc) startEdit(doc)
  }, [location.state, tpl, saved])

  const generated = tpl ? buildNdaBody(tpl.key, form, enabled) : ''
  const body = bodyDirty ? customBody : generated
  bodyRef.current = body

  // Compute the substitutions to push into a hand-edited body. Uses a
  // word-boundary regex, NOT a raw substring replace: if the user pauses
  // mid-typing a short value (say "T" before "Tyler Henry"), a raw replace
  // would turn every literal T in the document into "Tyler Henry". \b bounds
  // the match so a single-letter previous value only matches a standalone one.
  const computeBodyDiff = (nextForm, prev, currentBody) => {
    const fields = tpl.bodyFields || []
    const replacements = []
    for (const k of fields) {
      const oldV = prev[k], newV = nextForm[k]
      if (oldV && newV && oldV !== newV) replacements.push([oldV, newV, k])
    }
    const oldDate = formatEffectiveDate(prev.effective_date)
    const newDate = formatEffectiveDate(nextForm.effective_date)
    if (oldDate && newDate && oldDate !== newDate) replacements.push([oldDate, newDate, 'effective_date'])
    if (!replacements.length) return null
    let out = currentBody || ''
    for (const [from, to] of replacements) out = out.replace(new RegExp(`\\b${escapeRegex(from)}\\b`, 'g'), to)
    const nextPrev = { ...prev }
    for (const [, , k] of replacements) nextPrev[k] = nextForm[k]
    return { body: out, nextPrev }
  }

  // Signature of every watched field, so the effect below can depend on "any
  // of these changed" with a static dep array.
  const watchedSig = tpl
    ? [...(tpl.bodyFields || []), 'effective_date'].map(k => `${k}=${form[k] || ''}`).join('|')
    : ''

  // Auto-sync the body with the form. Clean body → nothing to do (the body is
  // derived). Dirty body → debounced find/replace of the changed values, so
  // hand edits survive while a renamed party still propagates everywhere it
  // appears. Flushed again in save() so a click before the timer fires still
  // persists the up-to-date text.
  useEffect(() => {
    if (!tpl || !bodyDirty) { prevFormRef.current = form; return }
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null
      const diff = computeBodyDiff(form, prevFormRef.current, bodyRef.current)
      if (!diff) return
      prevFormRef.current = diff.nextPrev
      setCustomBody(diff.body)
    }, 400)
    return () => { if (syncTimerRef.current) { clearTimeout(syncTimerRef.current); syncTimerRef.current = null } }
  }, [watchedSig, bodyDirty, tpl?.key])

  const setField = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  // A toggle is meaningless against a hand-edited body — the section it would
  // add or remove is no longer under template control. Offer the rebuild
  // explicitly and apply the toggle in the same step.
  const toggleClause = (k) => {
    if (bodyDirty) {
      if (!window.confirm('Toggling this clause rebuilds the body from the template, replacing your manual edits. Continue?')) return
      setEnabled(en => ({ ...en, [k]: !en[k] }))
      setBodyDirty(false); setCustomBody('')
      return
    }
    setEnabled(en => ({ ...en, [k]: !en[k] }))
  }

  const startEdit = (doc) => {
    const t = NDA_TEMPLATES[doc.template] ? doc.template : NDA_TEMPLATE_LIST[0].key
    if (t !== template) navigate(`/create-nda/${t}`)
    const savedForm = (doc.data && doc.data.form) || {}
    const savedBody = doc.custom_body || buildNdaBody(t, savedForm, (doc.data && doc.data.enabled) || {})
    setEditing(doc)
    setForm(savedForm)
    // Toggles come from the BODY, not the stored map — a clause deleted by
    // hand must show as unchecked.
    setEnabled(deriveEnabledFromBody(t, doc.custom_body, (doc.data && doc.data.enabled) || {}))
    setTitle(doc.title || '')
    setCustomBody(savedBody)
    // A loaded body is treated as dirty so the sync diffs into it instead of
    // clobbering the prior edits on the next field change.
    setBodyDirty(true)
    prevFormRef.current = savedForm
    setSaveError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const startNew = () => { setEditing(null); setBodyDirty(false); setCustomBody(''); setTitle(''); setSaveError('') }
  const resetBody = () => { setBodyDirty(false); setCustomBody('') }

  // Non-blocking: a saved body missing a mandatory section is worth flagging
  // (it was probably saved against an older template, or hand-trimmed), but
  // blocking the save would strand the document.
  const missing = tpl ? missingMandatorySections(tpl.key, body) : []

  const requiredFields = (tpl?.fields || []).filter(f => f.required)

  const save = async () => {
    setSaveError('')
    const blank = requiredFields.filter(f => !String(form[f.key] || '').trim())
    if (blank.length) { setSaveError(`${blank.map(f => f.label).join(', ')} ${blank.length > 1 ? 'are' : 'is'} required.`); return }
    // Flush a pending dirty-mode sync so a save that lands before the debounce
    // still writes the up-to-date body.
    let finalBody = body
    if (bodyDirty) {
      if (syncTimerRef.current) { clearTimeout(syncTimerRef.current); syncTimerRef.current = null }
      const diff = computeBodyDiff(form, prevFormRef.current, customBody)
      if (diff) { finalBody = diff.body; setCustomBody(diff.body); prevFormRef.current = diff.nextPrev }
    }
    setSaving(true)
    try {
      const payload = { template: tpl.key, title: title || `${tpl.name} NDA`, data: { form, enabled }, custom_body: finalBody }
      if (editing) await api.put(`/nda-documents/${editing.id}`, payload)
      else await api.post('/nda-documents', payload)
      toast(editing ? 'NDA updated' : 'NDA saved')
      startNew(); loadSaved()
    } catch (err) { setSaveError(err.response?.data?.error || 'Failed to save') }
    finally { setSaving(false) }
  }

  const remove = async (id) => {
    if (!window.confirm('Delete this NDA record? This does not revoke any already-issued copies.')) return
    try { await api.delete(`/nda-documents/${id}`); if (editing?.id === id) startNew(); loadSaved() } catch { toast('Failed', 'error') }
  }

  const download = (doc) => exportPdf(doc, label?.name).catch(() => toast('PDF export failed', 'error'))
  const downloadWord = (doc) => exportDocx(doc, label?.name).catch(() => toast('Word export failed', 'error'))
  // Exports from the editor act on the live (unsaved) state.
  const liveDoc = () => ({ id: editing?.id, template: tpl.key, title, custom_body: body, data: { form, enabled } })

  // Unknown :template — land on the first registered template rather than a
  // blank state (a typo'd or retired id shouldn't dead-end).
  if (template && !known) return <Navigate to={`/create-nda/${NDA_TEMPLATE_LIST[0].key}`} replace />

  if (loading) return <div className="space-y-6"><Skeleton.Block h="h-24" /><Skeleton.Block h="h-64" /></div>

  const savedList = (
    <SavedList
      saved={saved} error={listError}
      onOpen={tpl ? startEdit : (d) => navigate(`/create-nda/${NDA_TEMPLATES[d.template] ? d.template : NDA_TEMPLATE_LIST[0].key}`, { state: { open: d.id } })}
      onPreview={setPreviewItem} onPdf={download} onWord={downloadWord} onDelete={remove}
    />
  )

  // ── Template picker (/create-nda with no id) ──
  if (!tpl) {
    return (
      <div>
        <PageHeader title="Create NDA" subtitle="Pick a template to start drafting" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {NDA_TEMPLATE_LIST.map(t => (
            <Link key={t.key} to={`/create-nda/${t.key}`} className="card p-5 hover:border-brand-300 transition group">
              <div className="w-10 h-10 rounded-xl bg-brand-500/15 flex items-center justify-center mb-3"><FileText size={18} className="text-brand-ink" /></div>
              <h3 className="text-sm font-bold text-ink group-hover:text-brand-ink">{t.name}</h3>
              <p className="text-xs text-ink-muted mt-1 leading-relaxed">{t.description}</p>
            </Link>
          ))}
        </div>
        {savedList}
        <PreviewModal item={previewItem} onClose={() => setPreviewItem(null)} onPdf={download} onWord={downloadWord} />
      </div>
    )
  }

  // Leaving the builder with unsaved work should not be silent.
  const leave = (to) => {
    if ((bodyDirty || editing) && !window.confirm('Leave this template? Unsaved changes to the document will be lost.')) return
    startNew(); navigate(to)
  }

  return (
    <div>
      <button onClick={() => leave('/create-nda')} className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink mb-4"><ArrowLeft size={15} /> Templates</button>
      <PageHeader
        title={editing ? `Edit NDA #${editing.id}` : `${tpl.name} NDA`}
        subtitle={editing ? `Editing the saved NDA for ${partyRecipient(form) || 'this counterparty'}` : tpl.description}
        action={editing ? <button onClick={startNew} className="btn-secondary"><Plus size={15} /> New</button> : null}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form + clauses */}
        <div className="space-y-4">
          <div className="card p-5">
            <label className="label">Document title</label>
            <input className="input mb-3" value={title} onChange={e => setTitle(e.target.value)} placeholder={`${tpl.name} NDA`} />
            <div className="grid grid-cols-2 gap-3">
              {tpl.fields.map(f => (
                <div key={f.key} className={f.half ? '' : 'col-span-2'}>
                  <label className="label">{f.label}{f.required && <span className="text-danger"> *</span>}</label>
                  <input
                    type={f.type || 'text'} className="input" required={!!f.required}
                    placeholder={f.placeholder || ''}
                    value={form[f.key] || ''} onChange={setField(f.key)}
                  />
                  {f.description && <p className="text-[11px] text-ink-faint mt-1">{f.description}</p>}
                </div>
              ))}
            </div>
          </div>

          {tpl.optionalClauses.length > 0 && (
            <div className="card p-5">
              <h2 className="text-sm font-bold text-ink mb-3 inline-flex items-center gap-1.5"><ShieldCheck size={15} /> Optional clauses</h2>
              <div className="space-y-1">
                {tpl.optionalClauses.map(c => (
                  <label key={c.key} className="flex items-start gap-2.5 p-2 rounded-lg cursor-pointer hover:bg-brand-500/10">
                    <input type="checkbox" checked={!!enabled[c.key]} onChange={() => toggleClause(c.key)} className="mt-0.5" />
                    <span>
                      <span className="block text-sm text-ink">{c.label}</span>
                      {c.description && <span className="block text-[11px] text-ink-muted">{c.description}</span>}
                    </span>
                  </label>
                ))}
              </div>
              {tpl.optionalClauses.every(c => !enabled[c.key]) && (
                <p className="text-[11px] text-ink-faint italic pl-8 mt-1">No optional clauses included — {tpl.name} covers the mandatory sections only.</p>
              )}
            </div>
          )}

          {missing.length > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-[12px] text-ink flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-warning" />
              <div>
                <div className="font-semibold mb-0.5">Body is missing standard sections.</div>
                <div>
                  Not present: {missing.join(', ')}. This document may have been saved against an older template.
                  Click <button onClick={resetBody} className="underline font-medium">Reset to template</button> to rebuild
                  from the current template (form values are kept; manual body edits are replaced).
                </div>
              </div>
            </div>
          )}

          <div className="card p-5">
            <div className="flex items-center justify-between mb-1">
              <label className="label !mb-0">
                Document body {bodyDirty && <span className="normal-case tracking-normal text-[11px] font-normal text-warning ml-1">· customized</span>}
              </label>
              <button
                onClick={resetBody}
                title="Replace the body with a fresh template build using the current form values and clause toggles. Use this to upgrade an older saved body or start over."
                className="text-[11px] font-medium text-ink-muted hover:text-ink"
              >
                Reset to template
              </button>
            </div>
            <textarea
              className="input font-mono text-xs leading-relaxed" rows={18} spellCheck={false}
              value={body} onChange={e => { setBodyDirty(true); setCustomBody(e.target.value) }}
            />
            <p className="text-[11px] text-ink-faint mt-1">
              Edit any section freely. Section headers (lines starting with <code>I.</code> / <code>II.</code> / <code>A.</code> / <code>1.</code>,
              or an all-uppercase title) render bold in the PDF. The signature block is added automatically at the end — don't include it here.
            </p>
          </div>

          {saveError && <div className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{saveError}</div>}

          <div className="flex items-center gap-2">
            <button onClick={save} disabled={saving} className="btn-primary"><Save size={15} /> {saving ? 'Saving…' : (editing ? 'Save changes' : 'Save NDA')}</button>
            <button onClick={() => download(liveDoc())} className="btn-secondary"><Download size={15} /> PDF</button>
            <button onClick={() => downloadWord(liveDoc())} className="btn-secondary"><FileType2 size={15} /> Word</button>
          </div>
          <p className="text-[11px] text-ink-faint">Saving stores the form values and the final body; download the PDF or Word file to issue the agreement.</p>
        </div>

        {/* Live preview */}
        <div>
          <div className="card p-7 sticky top-4 max-h-[calc(100vh-3rem)] overflow-y-auto">
            <NdaPreview body={body} form={form} templateKey={tpl.key} title="Live preview" />
          </div>
        </div>
      </div>

      <div className="mt-8">{savedList}</div>
      <PreviewModal item={previewItem} onClose={() => setPreviewItem(null)} onPdf={download} onWord={downloadWord} />
    </div>
  )
}

// Read-only preview of a SAVED row, rendered from that row's own template +
// stored form — with both exports available without loading it into the editor.
function PreviewModal({ item, onClose, onPdf, onWord }) {
  if (!item) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-8 pb-8 overflow-y-auto bg-overlay" onClick={onClose}>
      <div className="relative w-full max-w-3xl mx-4" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-2 -right-2 z-10 p-1.5 bg-card rounded-full shadow-modal text-ink-muted hover:text-ink"><X size={16} /></button>
        <div className="card p-8 max-h-[70vh] overflow-y-auto">
          <NdaPreview body={bodyForDoc(item)} form={(item.data && item.data.form) || {}} templateKey={item.template} />
        </div>
        <div className="flex justify-center gap-3 mt-4">
          <button onClick={() => onPdf(item)} className="btn-secondary"><Download size={14} /> Download PDF</button>
          <button onClick={() => onWord(item)} className="btn-secondary"><FileType2 size={14} /> Download Word</button>
          <button onClick={onClose} className="btn-primary">Close</button>
        </div>
      </div>
    </div>
  )
}

function SavedList({ saved, error, onOpen, onPreview, onPdf, onWord, onDelete }) {
  if (error) return <p className="text-sm text-danger">{error}</p>
  if (!saved.length) return null
  return (
    <div>
      <h2 className="text-sm font-bold text-ink mb-3">Saved NDAs ({saved.length})</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] text-ink-faint uppercase tracking-wide border-b border-divider bg-elev">
              <th className="px-4 py-2.5 font-semibold">Effective</th>
              <th className="px-4 py-2.5 font-semibold">Owner</th>
              <th className="px-4 py-2.5 font-semibold">Recipient</th>
              <th className="px-4 py-2.5 font-semibold">Template</th>
              <th className="px-4 py-2.5 font-semibold">Created</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {saved.map(d => {
              const f = (d.data && d.data.form) || {}
              return (
                <tr key={d.id} className="border-b border-divider last:border-0 hover:bg-brand-500/10">
                  <td className="px-4 py-3 font-medium text-ink">{formatEffectiveDate(f.effective_date) || d.title || 'Untitled'}</td>
                  <td className="px-4 py-3 text-ink-muted">{partyOwner(f) || '—'}</td>
                  <td className="px-4 py-3 text-ink-muted">{partyRecipient(f) || '—'}</td>
                  <td className="px-4 py-3 text-ink-muted">{getTemplate(d.template).name}</td>
                  <td className="px-4 py-3 text-ink-faint text-xs">{formatDate(d.created_at)}{d.created_by_name ? ` · ${d.created_by_name}` : ''}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => onOpen(d)} title="Edit" className="text-ink-faint hover:text-ink px-1.5"><Pencil size={14} /></button>
                    <button onClick={() => onPreview(d)} title="Preview" className="text-ink-faint hover:text-ink px-1.5"><Eye size={14} /></button>
                    <button onClick={() => onPdf(d)} title="Download PDF" className="text-ink-faint hover:text-ink px-1.5"><Download size={14} /></button>
                    <button onClick={() => onWord(d)} title="Download Word (.docx)" className="text-ink-faint hover:text-brand-ink px-1.5"><FileType2 size={14} /></button>
                    <button onClick={() => onDelete(d.id)} title="Delete" className="text-ink-faint hover:text-danger px-1.5"><Trash2 size={14} /></button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
