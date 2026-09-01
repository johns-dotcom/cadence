import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Pencil, Download, X, FileSignature } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { formatDate } from '../utils/dates'

const RELEASE_FORMATS = ['single', 'EP', 'album', 'mixtape']

// en-US on purpose: the waiver is a legal document, so the same saved form has
// to produce the same text on every machine.
const formatLongDate = (d) => {
  if (!d) return ''
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number)
  if (!y || !m || !day) return ''
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
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
  // `||` not `??` — an empty string must fall through to the "X%" placeholder,
  // otherwise the issued document reads "shall account … for % royalties".
  const royalty = (form.royalty_percent || 'X').toString().trim()
  const contact = (form.contact_email || '____________').trim()
  const sigName = (form.signatory_name || '____________').trim()
  const sigTitle = (form.signatory_title || '').trim()

  const paragraphs = [
    `This correspondence shall confirm that ${lbl} agrees to waive its exclusivity in relation to "${artist}" ("Co-Primary Artist") performance on "${co}" ("Label") & "${otherArtist}" ("Artist") recording entitled "${song}" (the "Master"). ${lbl} has no objection to the release of the recording on one (1) ${format} on ${releaseDate} provided that you agree and accept the following terms.`,
    `• "${co}" shall account to ${lbl} for ${royalty}% royalties due half-yearly within 90 days of 30th June and 31st December in each year following the release of the Master and shall provide ${lbl} with detailed statements and calculations. Copies of statements shall be sent to ${contact}.`,
    `• Upon giving not less than four weeks prior notice and no more than once in each calendar year ${lbl} shall be entitled to inspect ${co}'s books and records of account and to copy relevant extracts to verify the accuracy of payments made to ${lbl}. Such inspection may be commenced no later than three years after the date of each statement.`,
    `• A courtesy credit shall be provided as follows: "${artist} appears courtesy of ${lbl}."`,
    `• ${co} shall have the right to use the Artist's professional name and approved likeness solely to promote and exploit the Master, and to credit the Artist as a "primary artist" on digital streaming platforms.`,
    `• ${co} shall have the right to third-party licensing with mutual written approval from ${lbl}.`,
    `• ${co} shall have the right to include the recording in any "greatest hits / compilations" with mutual approval from ${lbl}.`,
    `• ${co} shall have the right to digital exploitation (including ringtone & mastertones) of the recording with mutual written approval from ${lbl}.`,
    `• ${co} shall have the right to remixes of the recording with mutual approval from ${lbl}.`,
    `• ${co} shall not have the right to exploit the Master via synchronisation, sample licences, compilations or any other form of licensing without ${lbl}'s prior written approval.`,
    `• ${co} shall not have the right to exploit the Master in any manner except those granted above.`,
    `Please note the rights granted above are subject to the Artist's approval regarding the use of their performance(s), name and/or likeness.`,
    `In the event of a conflict between the terms of this letter and any other agreement(s) with the Artist, the terms of this agreement shall control.`,
    `Best,`,
    `${sigName}${sigTitle ? `, ${sigTitle}` : ''}\n${contact}`,
    `LABEL WAIVER REQUEST:`,
    `Artist: ${artist}\nFormat: ${format.toUpperCase()} RELEASE\nRelease date: ${releaseDate}\nPlatforms: all commercial platforms\nTagging/Crediting: Primary Artist, use of name & likeness\nArtist Royalty: ${royalty}% net profits, reporting bi-annual (within 90 days of July 1) via LOD\nLabel: ${co}`,
  ]
  return paragraphs.join('\n\n')
}

// The waiver has one special block: the trailing request header. 1 = bold
// heading, 0 = body. Shared by the preview and the PDF renderer.
const isHeader = (p) => /^LABEL WAIVER REQUEST:?$/i.test((p || '').trim())
const paras = (body) => (body || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)

// Canonical filename — used by the direct download AND by the copy filed on
// the artist's Documents tab, so both read the same.
function waiverFilename(w, labelName) {
  const safe = (s) => String(s || 'untitled').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)
  const dateTag = (w.effective_date || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
  return `${safe(labelName || 'Workspace')}-LabelWaiver-${safe(w.artist_name)}-${safe(w.song_title)}-${dateTag}.pdf`
}

// Render the waiver with jsPDF — selectable text, helvetica, 1in margins, a
// grey header date, and a heading-aware bold pass. Returns the jsPDF doc so
// the save path can ship the same bytes to the server.
async function buildWaiverPDF(w, labelName) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const MX = 72, MY = 72, lineH = 14, bodyW = W - MX * 2
  let y = MY
  const ensureSpace = (need = lineH) => { if (y + need > H - MY) { doc.addPage(); y = MY } }

  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(120, 120, 120)
  doc.text(formatLongDate(w.effective_date) || '____________', MX, y)
  y += lineH + 8

  for (const para of paras(w.custom_body || buildBodyText(w, labelName))) {
    if (isHeader(para)) {
      ensureSpace(lineH + 8)
      y += 6
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(17, 17, 17)
      for (const line of doc.splitTextToSize(para, bodyW)) { ensureSpace(lineH); doc.text(line, MX, y); y += lineH }
      y += 4
    } else {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(51, 51, 51)
      for (const line of para.split('\n').flatMap(l => doc.splitTextToSize(l, bodyW))) { ensureSpace(lineH); doc.text(line, MX, y); y += lineH }
      y += 6
    }
  }
  return doc
}

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
  const [roster, setRoster] = useState([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [form, setForm] = useState(blankForm)
  const [editing, setEditing] = useState(null)
  const [bodyDirty, setBodyDirty] = useState(false)
  const [showEditor, setShowEditor] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [previewing, setPreviewing] = useState(null)

  const load = () => api.get('/label-waivers')
    .then(r => { setWaivers(r.data.data || []); setListError('') })
    .catch(err => setListError(err?.response?.data?.error || 'Could not load saved waivers'))
  useEffect(() => {
    load().finally(() => setLoading(false))
    // Roster powers the artist datalist — picking a roster name is what lets
    // the server file the PDF on that artist's Documents tab.
    api.get('/artists').then(r => setRoster(r.data.data || [])).catch(() => {})
  }, [])

  // Keep the body synced to form fields until the user edits it by hand.
  const bodyText = bodyDirty ? form.custom_body : buildBodyText(form, label?.name)

  const setField = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const startNew = () => { setForm(blankForm); setEditing(null); setBodyDirty(false); setSaveError(''); setShowEditor(true) }
  const startEdit = (w) => {
    setForm({
      effective_date: w.effective_date?.slice(0, 10) || '', artist_name: w.artist_name || '',
      releasing_label: w.releasing_label || '', other_label_artist: w.other_label_artist || '',
      song_title: w.song_title || '', release_date: w.release_date?.slice(0, 10) || '',
      release_format: w.release_format || 'single', royalty_percent: w.royalty_percent ?? '',
      contact_email: w.contact_email || '', signatory_name: w.signatory_name || '',
      signatory_title: w.signatory_title || '', custom_body: w.custom_body || '',
    })
    setEditing(w); setBodyDirty(!!w.custom_body); setSaveError(''); setShowEditor(true)
  }
  const resetBody = () => { setBodyDirty(false); setForm(f => ({ ...f, custom_body: '' })) }

  // Closing the editor discards an in-progress waiver — confirm first. Also
  // what the backdrop click routes through, so a stray click can't wipe it.
  const closeEditor = () => {
    if (!window.confirm('Discard this waiver? Unsaved changes will be lost.')) return
    setShowEditor(false)
  }

  const save = async () => {
    setSaveError('')
    if (!form.effective_date || !form.artist_name.trim() || !form.releasing_label.trim() || !form.song_title.trim()) {
      setSaveError('Effective date, artist, releasing label, and song title are required.'); return
    }
    setSaving(true)
    try {
      const payload = { ...form, custom_body: bodyText }
      // Render the PDF up-front so the server can file it on the artist's
      // Documents tab without a second round-trip.
      const fd = new FormData()
      fd.append('payload', JSON.stringify(payload))
      try {
        const doc = await buildWaiverPDF(payload, label?.name)
        fd.append('file', doc.output('blob'), waiverFilename(payload, label?.name))
      } catch (e) {
        // A PDF failure must not block saving the record itself.
        console.warn('Waiver PDF render failed; saving without the attachment:', e)
      }
      const headers = { 'Content-Type': 'multipart/form-data' }
      if (editing) await api.put(`/label-waivers/${editing.id}`, fd, { headers })
      else await api.post('/label-waivers', fd, { headers })
      toast(editing ? 'Waiver updated' : 'Waiver created')
      setShowEditor(false); load()
    } catch (err) { setSaveError(err.response?.data?.error || 'Failed to save') }
    finally { setSaving(false) }
  }

  const remove = async (id) => {
    if (!window.confirm('Delete this label waiver record? This does not revoke any already-issued copies.')) return
    try { await api.delete(`/label-waivers/${id}`); load() } catch { toast('Failed', 'error') }
  }

  const download = async (w) => {
    try {
      const doc = await buildWaiverPDF(w, label?.name)
      doc.save(waiverFilename(w, label?.name))
    } catch { toast('Could not build the PDF', 'error') }
  }

  if (loading) return <div className="space-y-6"><Skeleton.Block h="h-24" /><Skeleton.Block h="h-64" /></div>

  return (
    <div>
      <PageHeader
        title="Label Waivers"
        subtitle="Exclusivity waivers for co-primary releases on other labels"
        action={<button onClick={startNew} className="btn-primary"><Plus size={16} /> New waiver</button>}
      />

      {listError && <p className="text-sm text-danger mb-4">{listError}</p>}

      {waivers.length === 0 ? (
        <div className="card p-10 text-center"><FileSignature size={26} className="text-ink-faint mx-auto mb-3" /><p className="text-sm text-ink-muted">No waivers yet.</p></div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] text-ink-faint uppercase tracking-wide border-b border-divider bg-elev">
                <th className="px-4 py-2.5 font-semibold">Artist</th>
                <th className="px-4 py-2.5 font-semibold">Releasing label</th>
                <th className="px-4 py-2.5 font-semibold">Song</th>
                <th className="px-4 py-2.5 font-semibold">Effective</th>
                <th className="px-4 py-2.5 font-semibold">Created</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {waivers.map(w => (
                <tr key={w.id} className="border-b border-divider last:border-0 hover:bg-brand-500/10">
                  <td className="px-4 py-3 font-medium text-ink">{w.artist_name}</td>
                  <td className="px-4 py-3 text-ink-muted">{w.releasing_label}</td>
                  <td className="px-4 py-3 text-ink-muted">{w.song_title}</td>
                  <td className="px-4 py-3 text-ink-muted">{formatLongDate(w.effective_date) || '—'}</td>
                  <td className="px-4 py-3 text-ink-faint text-xs">{formatDate(w.created_at)}{w.created_by_name ? ` · ${w.created_by_name}` : ''}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setPreviewing(w)} title="Preview" className="text-ink-faint hover:text-ink px-1.5"><FileSignature size={14} /></button>
                    <button onClick={() => download(w)} title="Download PDF" className="text-ink-faint hover:text-ink px-1.5"><Download size={14} /></button>
                    <button onClick={() => startEdit(w)} title="Edit" className="text-ink-faint hover:text-brand-ink px-1.5"><Pencil size={14} /></button>
                    <button onClick={() => remove(w.id)} title="Delete" className="text-ink-faint hover:text-danger px-1.5"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Editor with live preview */}
      {showEditor && (
        <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-overlay" onClick={closeEditor}>
          <div className="w-full max-w-5xl bg-card my-4 mx-4 rounded-2xl border border-rule shadow-modal flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-divider flex-shrink-0">
              <h2 className="text-base font-semibold text-ink">{editing ? `Edit waiver #${editing.id}` : 'New label waiver'}</h2>
              <button onClick={closeEditor} className="text-ink-faint hover:text-ink"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 flex-1 overflow-hidden">
              {/* Form */}
              <div className="p-5 overflow-y-auto space-y-3 border-r border-divider">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label">Effective date *</label><input type="date" required className="input" value={form.effective_date} onChange={setField('effective_date')} /></div>
                  <div><label className="label">Release date</label><input type="date" className="input" value={form.release_date} onChange={setField('release_date')} /></div>
                  <div className="col-span-2">
                    <label className="label">Artist (yours) *</label>
                    <input className="input" list="waiver-roster" required placeholder="The artist you have signed" value={form.artist_name} onChange={setField('artist_name')} />
                    <datalist id="waiver-roster">{roster.map(a => <option key={a.id} value={a.name} />)}</datalist>
                    <p className="text-[11px] text-ink-faint mt-1">Pick a name from the roster so the saved PDF is filed on the artist's Documents tab.</p>
                  </div>
                  <div className="col-span-2"><label className="label">Releasing label *</label><input className="input" required value={form.releasing_label} onChange={setField('releasing_label')} /></div>
                  <div className="col-span-2"><label className="label">Other label's artist</label><input className="input" value={form.other_label_artist} onChange={setField('other_label_artist')} /></div>
                  <div className="col-span-2"><label className="label">Song title *</label><input className="input" required value={form.song_title} onChange={setField('song_title')} /></div>
                  <div><label className="label">Format</label><select className="input" value={form.release_format} onChange={setField('release_format')}>{RELEASE_FORMATS.map(f => <option key={f}>{f}</option>)}</select></div>
                  <div><label className="label">Royalty %</label><input className="input" placeholder="e.g. 25" value={form.royalty_percent} onChange={setField('royalty_percent')} /></div>
                  <div className="col-span-2"><label className="label">Contact email</label><input type="email" className="input" value={form.contact_email} onChange={setField('contact_email')} /></div>
                  <div><label className="label">Signatory</label><input className="input" value={form.signatory_name} onChange={setField('signatory_name')} /></div>
                  <div><label className="label">Title</label><input className="input" value={form.signatory_title} onChange={setField('signatory_title')} /></div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="label !mb-0">
                      Body {bodyDirty && <span className="normal-case tracking-normal text-[11px] font-normal text-warning ml-1">· customized</span>}
                    </label>
                    <button onClick={resetBody} title="Rebuild the body from the template using the current form values, discarding manual edits." className="text-[11px] text-ink-muted hover:text-ink">Reset to template</button>
                  </div>
                  <textarea className="input font-mono text-xs leading-relaxed" rows={10}
                    value={bodyText}
                    onChange={(e) => { setBodyDirty(true); setForm(f => ({ ...f, custom_body: e.target.value })) }} />
                  <p className="text-[11px] text-ink-faint mt-1">Form-field changes auto-update the body until you start typing here; after that the text is yours until you reset it.</p>
                </div>
                {saveError && <div className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">{saveError}</div>}
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={closeEditor} className="btn-secondary">Cancel</button>
                  <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : (editing ? 'Save changes' : 'Create waiver')}</button>
                </div>
                <p className="text-[11px] text-ink-faint">Saving stores the form values and files the PDF on the artist's Documents tab; download it from the list to issue the waiver.</p>
              </div>
              {/* Live preview */}
              <div className="p-6 overflow-y-auto bg-elev">
                <p className="text-[11px] font-semibold text-ink-faint uppercase tracking-widest mb-3">Live preview</p>
                <p className="text-[12px] text-ink-muted mb-3">{formatLongDate(form.effective_date) || '____________'}</p>
                {paras(bodyText).map((p, i) => (
                  <p key={i} className={`text-[13px] mb-3 whitespace-pre-line ${isHeader(p) ? 'font-bold text-ink pt-2' : 'text-ink-muted'}`}>{p}</p>
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
                <button onClick={() => download(previewing)} className="btn-secondary !py-1.5"><Download size={14} /> PDF</button>
                <button onClick={() => setPreviewing(null)} className="text-ink-faint hover:text-ink"><X size={18} /></button>
              </div>
            </div>
            <div className="p-7 max-h-[70vh] overflow-y-auto">
              <p className="text-[12px] text-ink-muted mb-3">{formatLongDate(previewing.effective_date) || ''}</p>
              {paras(previewing.custom_body || buildBodyText(previewing, label?.name)).map((p, i) => (
                <p key={i} className={`text-[13px] mb-3 whitespace-pre-line ${isHeader(p) ? 'font-bold text-ink pt-2' : 'text-ink-muted'}`}>{p}</p>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
