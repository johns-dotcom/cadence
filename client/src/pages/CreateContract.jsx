import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, Sparkles, Plus, Trash2, Download, Copy, Check, Loader2, FileType2, AlertTriangle,
} from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import useUnsavedWarning from '../hooks/useUnsavedWarning'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { CONTRACT_TYPES, CONTRACT_TERRITORIES } from '../constants'
import { getHeadingLevel, bodyParagraphs } from '../constants/ndaTemplates'

const BLANK = {
  artist_name: '',
  type: 'Recording',
  royalty_split: '80',
  advance: '',
  territory: 'Worldwide',
  num_releases: '',
  duration_years: '1',
  notes: '',
  financial_terms: [],
}

// Filename shared by all three export paths — workspace, type, artist, date —
// so a downloaded draft is identifiable without opening it.
function draftFilename(form, labelName, ext) {
  const safe = (s, fb) => (String(s || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || fb)
  const date = new Date().toISOString().slice(0, 10)
  return `${safe(labelName, 'Workspace')}-${safe(form.type, 'Contract')}_Contract-${safe(form.artist_name, 'Draft')}-${date}.${ext}`
}

// PDF export — same renderer contract as the NDA builder: helvetica, letter,
// 1in margins, 16pt centered title, 11pt body, bold section headers, single
// newlines preserved. jsPDF MUST be pulled off the module by NAMED export;
// `const { default: jsPDF }` resolves to the namespace, not the class.
async function exportPdf(text, form, labelName) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = pdf.internal.pageSize.getWidth()
  const H = pdf.internal.pageSize.getHeight()
  const MX = 72, MY = 72, lineH = 14, bodyW = W - MX * 2
  let y = MY
  const ensureSpace = (need = lineH) => { if (y + need > H - MY) { pdf.addPage(); y = MY } }

  for (const para of bodyParagraphs(text)) {
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
  pdf.save(draftFilename(form, labelName, 'pdf'))
}

// Word export — mirrors the PDF (1440-twip margins, 32/22 half-point sizes).
async function exportDocx(text, form, labelName) {
  const { Document, Packer, Paragraph, TextRun, AlignmentType } = await import('docx')
  const children = []
  for (const para of bodyParagraphs(text)) {
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
  const blob = await Packer.toBlob(new Document({
    styles: { default: { document: { run: { font: 'Helvetica' } } } },
    sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children }],
  }))
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = draftFilename(form, labelName, 'docx'); a.click()
  URL.revokeObjectURL(url)
}

// AI full-contract generator. Stateless by design — the draft is never saved;
// it is copied or exported and then filed as a real contract on /contracts.
export default function CreateContract() {
  const { toast } = useToast()
  const { label } = useAuth()
  const [artists, setArtists] = useState([])
  const [generating, setGenerating] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [refCount, setRefCount] = useState(null)
  const [copied, setCopied] = useState(false)
  const [form, setForm] = useState(BLANK)

  const dirty = !!form.artist_name || !!form.advance || !!form.notes || form.financial_terms.length > 0
  useUnsavedWarning(dirty && !text)

  useEffect(() => {
    api.get('/artists').then(r => setArtists(r.data.data || [])).catch(() => {})
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const addTerm = () => set('financial_terms', [...form.financial_terms, { label: '', amount: '', recoupable: true, note: '' }])
  const updateTerm = (i, field, val) => set('financial_terms', form.financial_terms.map((t, idx) => idx === i ? { ...t, [field]: val } : t))
  const removeTerm = (i) => set('financial_terms', form.financial_terms.filter((_, idx) => idx !== i))

  const canGenerate = !!form.artist_name.trim() && !!form.type

  const generate = async () => {
    if (!canGenerate) return
    setGenerating(true); setText(''); setError(''); setRefCount(null)
    try {
      const { data } = await api.post('/contracts/generate', form)
      setText(data.data?.text || '')
      setRefCount(data.data?.reference_count ?? null)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate contract.')
    } finally {
      setGenerating(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch { toast('Copy failed', 'error') }
  }

  const downloadTxt = () => {
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = draftFilename(form, label?.name, 'txt'); a.click()
    URL.revokeObjectURL(url)
  }
  const guarded = (fn) => async () => {
    try { await fn() } catch { toast('Export module failed to load', 'error') }
  }

  const preview = useMemo(() => bodyParagraphs(text), [text])

  return (
    <div className="space-y-6">
      <Link to="/contracts" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft size={14} /> Back to contracts
      </Link>

      <PageHeader
        title="Create Contract"
        subtitle="AI drafts a contract using this workspace's existing contracts as reference"
      />

      <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-[rgba(245,158,11,0.10)] border border-[rgba(245,158,11,0.3)] text-warning text-sm">
        <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
        <span>This produces an unreviewed first draft. It is not legal advice — have counsel review before anything is signed. Nothing here is saved; export the draft and file it on Contracts.</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Terms form ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-ink">Contract Details</h2>

            <div>
              <label className="label">Artist</label>
              <input type="text" list="cc-artist-list" className="input" value={form.artist_name}
                onChange={e => set('artist_name', e.target.value)} placeholder="Type or select artist…" />
              <datalist id="cc-artist-list">
                {artists.map(a => <option key={a.id} value={a.name} />)}
              </datalist>
            </div>

            <div>
              <label className="label">Contract Type</label>
              <select className="input" value={form.type} onChange={e => set('type', e.target.value)}>
                {CONTRACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Artist Royalty %</label>
                <input type="number" className="input" value={form.royalty_split}
                  onChange={e => set('royalty_split', e.target.value)} placeholder="80" />
              </div>
              <div>
                <label className="label">Advance ($)</label>
                <input type="number" className="input" value={form.advance}
                  onChange={e => set('advance', e.target.value)} placeholder="0" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Territory</label>
                <select className="input" value={form.territory} onChange={e => set('territory', e.target.value)}>
                  {CONTRACT_TERRITORIES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Duration (years)</label>
                <input type="number" className="input" value={form.duration_years}
                  onChange={e => set('duration_years', e.target.value)} placeholder="1" />
              </div>
            </div>

            <div>
              <label className="label">Number of Releases</label>
              <input type="text" className="input" value={form.num_releases}
                onChange={e => set('num_releases', e.target.value)} placeholder="e.g. 3 singles + 1 album" />
            </div>

            <div>
              <label className="label">Additional Notes / Requirements</label>
              <textarea rows={3} className="input" value={form.notes}
                onChange={e => set('notes', e.target.value)} placeholder="Any specific clauses, requirements, or context…" />
            </div>
          </div>

          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Financial Obligations</h2>
              <button onClick={addTerm} className="text-xs font-semibold text-brand-ink hover:underline inline-flex items-center gap-1">
                <Plus size={12} /> Add
              </button>
            </div>
            {form.financial_terms.length === 0 && (
              <p className="text-xs text-ink-faint py-2">No financial terms added. The draft will use standard terms for this contract type.</p>
            )}
            {form.financial_terms.map((term, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input type="text" className="input flex-1" value={term.label}
                  onChange={e => updateTerm(i, 'label', e.target.value)} placeholder="e.g. Recording Fund" />
                <input type="text" className="input w-32" value={term.amount ?? ''}
                  onChange={e => updateTerm(i, 'amount', e.target.value)} placeholder="$50,000 or 15%" />
                <label className="flex items-center gap-1.5 text-xs text-ink-muted whitespace-nowrap cursor-pointer">
                  <input type="checkbox" className="accent-brand-600" checked={!!term.recoupable}
                    onChange={e => updateTerm(i, 'recoupable', e.target.checked)} />
                  Recoup
                </label>
                <button onClick={() => removeTerm(i)} title="Remove term"
                  className="text-ink-faint hover:text-danger flex-shrink-0"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>

          <button onClick={generate} disabled={generating || !canGenerate}
            className="btn-primary w-full py-3 text-base">
            {generating
              ? <><Loader2 size={18} className="animate-spin" /> Generating contract…</>
              : <><Sparkles size={18} /> Generate Contract with AI</>}
          </button>
          {!canGenerate && <p className="text-xs text-ink-faint text-center">Artist and contract type are required.</p>}
        </div>

        {/* ── Generated draft ────────────────────────────────────────── */}
        <div className="card p-5 flex flex-col min-h-[600px]">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-ink">Generated Contract</h2>
              {refCount != null && (
                <p className="text-[11px] text-ink-faint mt-0.5">
                  {refCount === 0 ? 'No existing contracts to reference' : `Referenced ${refCount} existing contract${refCount === 1 ? '' : 's'}`}
                </p>
              )}
            </div>
            {text && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button onClick={copy} className="btn-secondary text-xs">
                  {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                </button>
                <button onClick={downloadTxt} title="Download plain text" className="btn-secondary text-xs">
                  <Download size={12} /> .txt
                </button>
                <button onClick={guarded(() => exportPdf(text, form, label?.name))} title="Download PDF" className="btn-secondary text-xs">
                  <Download size={12} /> PDF
                </button>
                <button onClick={guarded(() => exportDocx(text, form, label?.name))} title="Download Word (.docx)" className="btn-secondary text-xs">
                  <FileType2 size={12} /> Word
                </button>
              </div>
            )}
          </div>

          {generating ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <Loader2 size={28} className="animate-spin text-brand-ink" />
              <p className="text-sm text-ink-muted">AI is drafting your contract…</p>
              <p className="text-xs text-ink-faint">Reading existing contracts for reference</p>
            </div>
          ) : error ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6">
              <AlertTriangle size={26} className="text-danger" />
              <p className="text-sm text-danger text-center">{error}</p>
              <button onClick={generate} disabled={!canGenerate} className="btn-secondary text-xs">Try again</button>
            </div>
          ) : text ? (
            <div className="flex-1 overflow-auto">
              {preview.map((para, i) => {
                const level = getHeadingLevel(para)
                if (level === 2) return <p key={i} className="text-center text-base font-bold text-ink mt-4 mb-4">{para}</p>
                if (level === 1) return <p key={i} className="text-sm font-bold text-ink mt-4 mb-1.5">{para}</p>
                return <p key={i} className="text-sm text-ink-muted leading-relaxed whitespace-pre-wrap mb-3">{para}</p>
              })}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center px-6">
              <Sparkles size={32} className="text-ink-faint mb-3" />
              <p className="text-sm text-ink-muted text-center">Fill in the details and click Generate.</p>
              <p className="text-xs text-ink-faint text-center mt-1">The draft matches the style and terms of your existing contracts.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
