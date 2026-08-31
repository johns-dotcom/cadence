import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { ArrowLeft, FileText, Download, FileType2, Save, Trash2, Plus, ShieldCheck } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { NDA_TEMPLATES, buildNdaBody, clauseDef, mandatoryHeadings } from '../constants/ndaTemplates'
import { formatDate } from '../utils/dates'

const isHeadingLine = (p) => /^\d+\.\s+[A-Z]/.test((p || '').trim())

export default function CreateNda() {
  const { template } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { toast } = useToast()
  const { label, user } = useAuth()

  const tpl = template && NDA_TEMPLATES[template] ? NDA_TEMPLATES[template] : null
  const [saved, setSaved] = useState([])
  const [form, setForm] = useState({})
  const [enabled, setEnabled] = useState({})
  const [title, setTitle] = useState('')
  const [bodyDirty, setBodyDirty] = useState(false)
  const [customBody, setCustomBody] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)

  const loadSaved = () => api.get('/nda-documents').then(r => setSaved(r.data.data || [])).catch(() => {})
  useEffect(() => { loadSaved() }, [])

  // Deep-link from the picker: open a specific saved NDA once it's loaded.
  useEffect(() => {
    const openId = location.state?.open
    if (!openId || !tpl || !saved.length || editingId) return
    const doc = saved.find(d => d.id === openId)
    if (doc) startEdit(doc)
  }, [location.state, tpl, saved])

  // Seed defaults whenever the chosen template changes (and we're not editing).
  useEffect(() => {
    if (!tpl || editingId) return
    setForm({ disclosing_party: label?.name || '', signatory_name: user?.name || '', term_years: '2' })
    setEnabled({ exclusions_note: true, return_materials: true, injunctive_relief: true })
    setTitle(''); setBodyDirty(false); setCustomBody('')
  }, [tpl?.key, editingId])

  const generated = useMemo(() => tpl ? buildNdaBody(tpl.key, form, enabled, label?.name) : '', [tpl, form, enabled, label])
  const body = bodyDirty ? customBody : generated

  const setField = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const toggleClause = (k) => { setEnabled(en => ({ ...en, [k]: !en[k] })); if (bodyDirty) toast('Toggle affects the template — reset to apply', 'error') }

  const startEdit = (doc) => {
    const t = NDA_TEMPLATES[doc.template] ? doc.template : 'standard'
    if (t !== template) navigate(`/create-nda/${t}`)
    setEditingId(doc.id)
    setForm((doc.data && doc.data.form) || {})
    setEnabled((doc.data && doc.data.enabled) || {})
    setTitle(doc.title || '')
    setCustomBody(doc.custom_body || ''); setBodyDirty(true)
  }
  const startNew = () => { setEditingId(null); setBodyDirty(false); setCustomBody(''); setTitle('') }

  const save = async () => {
    // Mandatory-section validation on the final (possibly edited) body.
    const missing = mandatoryHeadings().filter(h => !body.includes(h))
    if (missing.length) { toast(`Missing required section(s): ${missing.join(', ')}`, 'error'); return }
    setSaving(true)
    try {
      const payload = { template: tpl.key, title: title || `${tpl.name} NDA`, data: { form, enabled }, custom_body: body }
      if (editingId) await api.put(`/nda-documents/${editingId}`, payload)
      else await api.post('/nda-documents', payload)
      toast(editingId ? 'NDA updated' : 'NDA saved')
      startNew(); loadSaved()
    } catch (err) { toast(err.response?.data?.error || 'Failed to save', 'error') }
    finally { setSaving(false) }
  }

  const remove = async (id) => {
    if (!window.confirm('Delete this NDA?')) return
    try { await api.delete(`/nda-documents/${id}`); if (editingId === id) startNew(); loadSaved() } catch { toast('Failed', 'error') }
  }

  const docTitle = () => (title || `${tpl?.name || 'NDA'}`).replace(/[^\w\- ]+/g, '').trim() || 'NDA'
  const paras = (b) => b.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)

  // Export to PDF via jsPDF (letter, Times, wrapped + paginated).
  const exportPdf = async () => {
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    const margin = 64, width = doc.internal.pageSize.getWidth() - margin * 2, bottom = doc.internal.pageSize.getHeight() - margin
    let y = margin
    doc.setFont('times', 'bold'); doc.setFontSize(14)
    doc.text(docTitle(), margin, y); y += 24
    doc.setFontSize(11)
    for (const p of paras(body)) {
      const heading = isHeadingLine(p)
      doc.setFont('times', heading ? 'bold' : 'normal')
      const lines = doc.splitTextToSize(p, width)
      for (const line of lines) {
        if (y > bottom) { doc.addPage(); y = margin }
        doc.text(line, margin, y); y += 15
      }
      y += 8
    }
    doc.save(`${docTitle()}.pdf`)
  }

  // Export to Word (.docx) — docx is heavy, so it's dynamically imported.
  const exportDocx = async () => {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx')
    const children = [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: docTitle(), bold: true })] })]
    for (const p of paras(body)) {
      children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: p, bold: isHeadingLine(p) })] }))
    }
    const blob = await Packer.toBlob(new Document({ sections: [{ children }] }))
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${docTitle()}.docx`; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Template picker (no/invalid :template) ──
  if (!tpl) {
    return (
      <div>
        <PageHeader title="Create NDA" subtitle="Pick a template to start drafting" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {Object.values(NDA_TEMPLATES).map(t => (
            <Link key={t.key} to={`/create-nda/${t.key}`} className="card p-5 hover:border-brand-300 transition group">
              <div className="w-10 h-10 rounded-xl bg-brand-500/15 flex items-center justify-center mb-3"><FileText size={18} className="text-brand-700" /></div>
              <h3 className="text-sm font-bold text-ink group-hover:text-brand-700">{t.name}</h3>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">{t.description}</p>
            </Link>
          ))}
        </div>
        <SavedList saved={saved} onOpen={(d) => navigate(`/create-nda/${NDA_TEMPLATES[d.template] ? d.template : 'standard'}`, { state: { open: d.id } })} onDelete={remove} />
      </div>
    )
  }

  const optionalDefs = (tpl.optional || []).map(k => ({ key: k, ...clauseDef(k) })).filter(c => c.label)

  return (
    <div>
      <button onClick={() => navigate('/create-nda')} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4"><ArrowLeft size={15} /> Templates</button>
      <PageHeader
        title={`${tpl.name} NDA`}
        subtitle={editingId ? 'Editing a saved NDA' : tpl.description}
        action={editingId ? <button onClick={startNew} className="btn-secondary"><Plus size={15} /> New</button> : null}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form + clauses */}
        <div className="space-y-4">
          <div className="card p-5">
            <label className="label">Document title</label>
            <input className="input mb-3" value={title} onChange={e => setTitle(e.target.value)} placeholder={`${tpl.name} NDA`} />
            <div className="grid grid-cols-2 gap-3">
              {tpl.fields.map(f => (
                <div key={f.key} className={f.type === 'date' || ['term_years', 'signatory_title', 'recipient_signatory'].includes(f.key) ? '' : 'col-span-2'}>
                  <label className="label">{f.label}{f.required && <span className="text-red-500"> *</span>}</label>
                  <input type={f.type || 'text'} className="input" value={form[f.key] || ''} onChange={setField(f.key)} />
                </div>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-3 inline-flex items-center gap-1.5"><ShieldCheck size={15} /> Optional clauses</h2>
            <div className="space-y-2">
              {optionalDefs.map(c => (
                <label key={c.key} className={`flex items-start gap-2.5 p-2 rounded-lg cursor-pointer hover:bg-gray-50 ${bodyDirty ? 'opacity-50' : ''}`}>
                  <input type="checkbox" checked={!!enabled[c.key]} onChange={() => toggleClause(c.key)} disabled={bodyDirty} className="mt-0.5" />
                  <span className="text-sm text-gray-700">{c.label}</span>
                </label>
              ))}
            </div>
            {bodyDirty && <p className="text-[11px] text-amber-600 mt-2">Body was hand-edited — <button onClick={() => setBodyDirty(false)} className="underline">reset to template</button> to change clauses.</p>}
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between mb-1">
              <label className="label !mb-0">Document body</label>
              {bodyDirty && <button onClick={() => setBodyDirty(false)} className="text-[11px] text-brand-600 hover:underline">Reset to template</button>}
            </div>
            <textarea className="input font-mono text-xs leading-relaxed" rows={12} value={body} onChange={e => { setBodyDirty(true); setCustomBody(e.target.value) }} />
          </div>

          <div className="flex items-center gap-2">
            <button onClick={save} disabled={saving} className="btn-primary"><Save size={15} /> {saving ? 'Saving…' : (editingId ? 'Save changes' : 'Save NDA')}</button>
            <button onClick={exportPdf} className="btn-secondary"><Download size={15} /> PDF</button>
            <button onClick={exportDocx} className="btn-secondary"><FileType2 size={15} /> Word</button>
          </div>
        </div>

        {/* Live preview */}
        <div>
          <div className="card p-7 sticky top-4 max-h-[calc(100vh-3rem)] overflow-y-auto">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Live preview</p>
            <h1 className="text-base font-bold text-ink mb-4">{title || `${tpl.name} NDA`}</h1>
            {paras(body).map((p, i) => (
              <p key={i} className={`text-[13px] mb-3 whitespace-pre-line ${isHeadingLine(p) ? 'font-bold text-ink pt-1' : 'text-gray-700'}`}>{p}</p>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8"><SavedList saved={saved} onOpen={startEdit} onDelete={remove} /></div>
    </div>
  )
}

function SavedList({ saved, onOpen, onDelete }) {
  if (!saved.length) return null
  return (
    <div>
      <h2 className="text-sm font-bold text-ink mb-3">Saved NDAs</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] text-gray-400 uppercase tracking-wide border-b border-divider bg-page/50">
              <th className="px-4 py-2.5 font-semibold">Title</th>
              <th className="px-4 py-2.5 font-semibold">Template</th>
              <th className="px-4 py-2.5 font-semibold">Created</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {saved.map(d => (
              <tr key={d.id} className="border-b border-divider last:border-0 hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-ink">{d.title || 'Untitled'}</td>
                <td className="px-4 py-3 text-gray-500 capitalize">{NDA_TEMPLATES[d.template]?.name || d.template}</td>
                <td className="px-4 py-3 text-gray-500">{formatDate(d.created_at)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => onOpen(d)} className="text-brand-600 hover:underline text-xs font-semibold px-2">Open</button>
                  <button onClick={() => onDelete(d.id)} className="text-gray-300 hover:text-red-600 px-1.5"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
