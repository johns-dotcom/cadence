import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Pencil, Printer, X, FileSignature } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'

const RELEASE_FORMATS = ['single', 'EP', 'album']

const formatLongDate = (d) => {
  if (!d) return ''
  const dt = new Date(`${String(d).slice(0, 10)}T00:00:00`)
  if (isNaN(dt)) return ''
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

// Build the waiver body. The workspace's own label name is the granting party
// (this is multi-tenant — never hardcode a specific label). Editable after.
function buildBodyText(form, labelName) {
  const lbl = labelName || 'This label'
  const artist = (form.artist_name || 'ARTIST').trim()
  const co = (form.releasing_label || 'RELEASING LABEL').trim()
  const otherArtist = (form.other_label_artist || 'OTHER LABEL ARTIST').trim()
  const song = (form.song_title || 'SONG').trim()
  const releaseDate = formatLongDate(form.release_date) || 'DATE'
  const format = (form.release_format || 'single').trim()
  const royalty = (form.royalty_percent ?? 'X').toString().trim()
  const contact = (form.contact_email || '____________').trim()
  const sigName = (form.signatory_name || '____________').trim()
  const sigTitle = (form.signatory_title || '').trim()

  const paragraphs = [
    `This correspondence shall confirm that ${lbl} agrees to waive its exclusivity in relation to "${artist}" ("Co-Primary Artist") performance on "${co}" ("Label") & "${otherArtist}" ("Artist") recording entitled "${song}" (the "Master"). ${lbl} has no objection to the release of the recording on one (1) ${format} on ${releaseDate} provided that you agree and accept the following terms.`,
    `• "${co}" shall account to ${lbl} for ${royalty}% royalties due half-yearly within 90 days of 30th June and 31st December in each year following the release of the Master and shall provide ${lbl} with detailed statements. Copies of statements shall be sent to ${contact}.`,
    `• Upon not less than four weeks' notice and no more than once per calendar year, ${lbl} may inspect ${co}'s books and records to verify payments. Inspection may commence no later than three years after each statement.`,
    `• A courtesy credit shall be provided as follows: "${artist} appears courtesy of ${lbl}."`,
    `• ${co} shall have the right to use the Artist's professional name and approved likeness solely to promote and exploit the Master, and to credit the Artist as a "primary artist" on digital streaming platforms.`,
    `• ${co} shall have the right to third-party licensing with mutual written approval from ${lbl}.`,
    `• ${co} shall have the right to include the recording in any "greatest hits / compilations" with mutual approval from ${lbl}.`,
    `• ${co} shall not have the right to exploit the Master via synchronisation, sample licences, compilations or any other form of licensing without ${lbl}'s prior written approval.`,
    `• ${co} shall not have the right to exploit the Master in any manner except those granted above.`,
    `Please note the rights granted above are subject to the Artist's approval regarding the use of their performance(s), name and/or likeness.`,
    `In the event of a conflict between the terms of this letter and any other agreement(s) with the Artist, the terms of this agreement shall control.`,
    `Best,`,
    `${sigName}${sigTitle ? `, ${sigTitle}` : ''}\n${contact}`,
    `LABEL WAIVER REQUEST:`,
    `Artist: ${artist}\nFormat: ${format.toUpperCase()} RELEASE\nRelease date: ${releaseDate}\nPlatforms: all commercial platforms\nTagging/Crediting: Primary Artist, use of name & likeness\nArtist Royalty: ${royalty}% net profits, reporting bi-annual (within 90 days of July 1)\nLabel: ${co}`,
  ]
  return paragraphs.join('\n\n')
}

const isHeader = (p) => /^LABEL WAIVER REQUEST:?$/i.test((p || '').trim())

export default function CreateLabelWaiver() {
  const { toast } = useToast()
  const { label, user } = useAuth()

  const blankForm = useMemo(() => ({
    effective_date: '', artist_name: '', releasing_label: '', other_label_artist: '',
    song_title: '', release_date: '', release_format: 'single', royalty_percent: '',
    contact_email: user?.email || '', signatory_name: user?.name || '', signatory_title: '',
    custom_body: '',
  }), [user])

  const [waivers, setWaivers] = useState([])
  const [form, setForm] = useState(blankForm)
  const [editing, setEditing] = useState(null)
  const [bodyDirty, setBodyDirty] = useState(false)
  const [showEditor, setShowEditor] = useState(false)
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(null)

  const load = () => api.get('/label-waivers').then(r => setWaivers(r.data.data || [])).catch(() => {})
  useEffect(() => { load() }, [])

  // Keep the body synced to form fields until the user edits it by hand.
  const bodyText = bodyDirty ? form.custom_body : buildBodyText(form, label?.name)

  const setField = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const startNew = () => { setForm(blankForm); setEditing(null); setBodyDirty(false); setShowEditor(true) }
  const startEdit = (w) => {
    setForm({
      effective_date: w.effective_date?.slice(0, 10) || '', artist_name: w.artist_name || '',
      releasing_label: w.releasing_label || '', other_label_artist: w.other_label_artist || '',
      song_title: w.song_title || '', release_date: w.release_date?.slice(0, 10) || '',
      release_format: w.release_format || 'single', royalty_percent: w.royalty_percent ?? '',
      contact_email: w.contact_email || '', signatory_name: w.signatory_name || '',
      signatory_title: w.signatory_title || '', custom_body: w.custom_body || '',
    })
    setEditing(w); setBodyDirty(!!w.custom_body); setShowEditor(true)
  }
  const resetBody = () => { setBodyDirty(false); setForm(f => ({ ...f, custom_body: '' })) }

  const save = async () => {
    if (!form.artist_name.trim() || !form.releasing_label.trim() || !form.song_title.trim()) {
      toast('Artist, releasing label and song are required', 'error'); return
    }
    setSaving(true)
    try {
      const payload = { ...form, custom_body: bodyText }
      if (editing) await api.put(`/label-waivers/${editing.id}`, payload)
      else await api.post('/label-waivers', payload)
      toast(editing ? 'Waiver updated' : 'Waiver created')
      setShowEditor(false); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed to save', 'error') }
    finally { setSaving(false) }
  }
  const remove = async (id) => {
    if (!window.confirm('Delete this waiver?')) return
    try { await api.delete(`/label-waivers/${id}`); load() } catch { toast('Failed', 'error') }
  }

  // Print-to-PDF: render the document into a clean print window.
  const printWaiver = (w) => {
    const body = w.custom_body || buildBodyText({
      ...w, release_date: w.release_date, effective_date: w.effective_date,
    }, label?.name)
    const paras = body.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Label Waiver — ${esc(w.artist_name || '')}</title>
      <style>
        @page { margin: 1in; }
        body { font: 12px/1.6 Georgia, 'Times New Roman', serif; color: #111; max-width: 7in; margin: 0 auto; padding: 24px; }
        .date { color: #555; margin-bottom: 24px; }
        .hdr { font-weight: 700; margin-top: 18px; }
        p { margin: 0 0 12px; white-space: pre-line; }
        h1 { font-size: 15px; margin-bottom: 4px; }
      </style></head><body onload="window.print()">
      <h1>${esc(label?.name || 'Label')} — Label Waiver</h1>
      <p class="date">${formatLongDate(w.effective_date) || ''}</p>
      ${paras.map(p => `<p class="${isHeader(p) ? 'hdr' : ''}">${esc(p)}</p>`).join('')}
      </body></html>`
    const win = window.open('', '_blank')
    if (!win) { toast('Allow pop-ups to print/download the PDF', 'error'); return }
    win.document.write(html); win.document.close()
  }

  return (
    <div>
      <PageHeader
        title="Label Waivers"
        subtitle="Exclusivity waivers for co-primary releases on other labels"
        action={<button onClick={startNew} className="btn-primary"><Plus size={16} /> New waiver</button>}
      />

      {waivers.length === 0 ? (
        <div className="card p-10 text-center"><FileSignature size={26} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">No waivers yet.</p></div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] text-gray-400 uppercase tracking-wide border-b border-divider bg-page/50">
                <th className="px-4 py-2.5 font-semibold">Artist</th>
                <th className="px-4 py-2.5 font-semibold">Releasing label</th>
                <th className="px-4 py-2.5 font-semibold">Song</th>
                <th className="px-4 py-2.5 font-semibold">Effective</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {waivers.map(w => (
                <tr key={w.id} className="border-b border-divider last:border-0 hover:bg-gray-50 group">
                  <td className="px-4 py-3 font-medium text-ink">{w.artist_name}</td>
                  <td className="px-4 py-3 text-gray-500">{w.releasing_label}</td>
                  <td className="px-4 py-3 text-gray-500">{w.song_title}</td>
                  <td className="px-4 py-3 text-gray-500">{w.effective_date ? new Date(w.effective_date).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setPreviewing(w)} title="Preview" className="text-gray-400 hover:text-gray-700 px-1.5"><FileSignature size={14} /></button>
                    <button onClick={() => printWaiver(w)} title="Print / PDF" className="text-gray-400 hover:text-gray-700 px-1.5"><Printer size={14} /></button>
                    <button onClick={() => startEdit(w)} title="Edit" className="text-gray-400 hover:text-brand-600 px-1.5"><Pencil size={14} /></button>
                    <button onClick={() => remove(w.id)} title="Delete" className="text-gray-300 hover:text-red-600 px-1.5"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Editor with live preview */}
      {showEditor && (
        <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-overlay" onClick={() => setShowEditor(false)}>
          <div className="w-full max-w-5xl bg-card my-4 mx-4 rounded-2xl border border-rule shadow-modal flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-divider flex-shrink-0">
              <h2 className="text-base font-semibold text-ink">{editing ? 'Edit waiver' : 'New label waiver'}</h2>
              <button onClick={() => setShowEditor(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 flex-1 overflow-hidden">
              {/* Form */}
              <div className="p-5 overflow-y-auto space-y-3 border-r border-divider">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label">Effective date</label><input type="date" className="input" value={form.effective_date} onChange={setField('effective_date')} /></div>
                  <div><label className="label">Release date</label><input type="date" className="input" value={form.release_date} onChange={setField('release_date')} /></div>
                  <div className="col-span-2"><label className="label">Artist (yours)</label><input className="input" value={form.artist_name} onChange={setField('artist_name')} /></div>
                  <div className="col-span-2"><label className="label">Releasing label</label><input className="input" value={form.releasing_label} onChange={setField('releasing_label')} /></div>
                  <div className="col-span-2"><label className="label">Other label's artist</label><input className="input" value={form.other_label_artist} onChange={setField('other_label_artist')} /></div>
                  <div className="col-span-2"><label className="label">Song title</label><input className="input" value={form.song_title} onChange={setField('song_title')} /></div>
                  <div><label className="label">Format</label><select className="input" value={form.release_format} onChange={setField('release_format')}>{RELEASE_FORMATS.map(f => <option key={f}>{f}</option>)}</select></div>
                  <div><label className="label">Royalty %</label><input type="number" step="0.01" className="input" value={form.royalty_percent} onChange={setField('royalty_percent')} /></div>
                  <div className="col-span-2"><label className="label">Contact email</label><input className="input" value={form.contact_email} onChange={setField('contact_email')} /></div>
                  <div><label className="label">Signatory</label><input className="input" value={form.signatory_name} onChange={setField('signatory_name')} /></div>
                  <div><label className="label">Title</label><input className="input" value={form.signatory_title} onChange={setField('signatory_title')} /></div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="label !mb-0">Body</label>
                    {bodyDirty && <button onClick={resetBody} className="text-[11px] text-brand-600 hover:underline">Reset to template</button>}
                  </div>
                  <textarea className="input font-mono text-xs leading-relaxed" rows={8}
                    value={bodyText}
                    onChange={(e) => { setBodyDirty(true); setForm(f => ({ ...f, custom_body: e.target.value })) }} />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setShowEditor(false)} className="btn-secondary">Cancel</button>
                  <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : (editing ? 'Save changes' : 'Create waiver')}</button>
                </div>
              </div>
              {/* Live preview */}
              <div className="p-6 overflow-y-auto bg-page/40">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Live preview</p>
                <p className="text-[12px] text-gray-500 mb-3">{formatLongDate(form.effective_date) || '____________'}</p>
                {bodyText.split(/\n{2,}/).map((p, i) => p.trim()).filter(Boolean).map((p, i) => (
                  <p key={i} className={`text-[13px] mb-3 whitespace-pre-line ${isHeader(p) ? 'font-bold text-ink pt-2' : 'text-gray-700'}`}>{p}</p>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Read-only preview modal */}
      {previewing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8 bg-overlay overflow-y-auto" onClick={() => setPreviewing(null)}>
          <div className="w-full max-w-2xl bg-card rounded-2xl border border-rule shadow-modal my-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-divider">
              <h2 className="text-base font-semibold text-ink">Waiver preview</h2>
              <div className="flex items-center gap-2">
                <button onClick={() => printWaiver(previewing)} className="btn-secondary !py-1.5"><Printer size={14} /> PDF</button>
                <button onClick={() => setPreviewing(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
              </div>
            </div>
            <div className="p-7 max-h-[70vh] overflow-y-auto">
              <p className="text-[12px] text-gray-500 mb-3">{formatLongDate(previewing.effective_date) || ''}</p>
              {(previewing.custom_body || buildBodyText(previewing, label?.name)).split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map((p, i) => (
                <p key={i} className={`text-[13px] mb-3 whitespace-pre-line ${isHeader(p) ? 'font-bold text-ink pt-2' : 'text-gray-700'}`}>{p}</p>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
