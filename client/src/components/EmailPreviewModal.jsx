import { useEffect, useState } from 'react'
import { X, Send, SkipForward, Paperclip } from 'lucide-react'
import api from '../api'
import CcChipInput from './CcChipInput'
import { useToast } from '../context/ToastContext'

// Review-before-send modal. Every outbound email flows through here: it fetches
// a rendered preview from /email/preview, lets the admin edit To / CC / Subject,
// shows the HTML in an iframe + attachment list, and sends via /email/send.
//
// Single send: pass { kind, ctx }.
// Queue (per-vendor bulk): pass items=[{ kind, ctx, label, onItemSent }] — the
// modal advances Send→next / Skip→next, and calls onDone when the queue drains.
export default function EmailPreviewModal({ open, kind, ctx, items, onClose, onSent, onDone }) {
  const { toast } = useToast()
  const queue = items && items.length ? items : (ctx ? [{ kind, ctx }] : [])
  const isQueue = !!(items && items.length)
  const [idx, setIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [to, setTo] = useState('')
  const [cc, setCc] = useState([])
  const [subject, setSubject] = useState('')
  const [html, setHtml] = useState('')
  const [attach, setAttach] = useState([])
  // Optional personal note (boom's confirmation note field) — rendered into the
  // template server-side. Only shown when the queue item asks for it.
  const [note, setNote] = useState('')

  const cur = queue[idx]

  useEffect(() => { if (open) { setIdx(0); api.get('/team').then(r => setSuggestions((r.data.data || []).map(u => ({ name: u.name, email: u.email })))).catch(() => {}) } }, [open])

  useEffect(() => {
    if (!open || !cur) return
    setLoading(true)
    setNote('')
    api.post('/email/preview', { kind: cur.kind, ctx: cur.ctx })
      .then(r => { const d = r.data.data; setTo(d.to || ''); setCc(d.cc || []); setSubject(d.subject || ''); setHtml(d.html || ''); setAttach(d.attachmentLabels || []) })
      .catch(() => toast('Could not build preview', 'error'))
      .finally(() => setLoading(false))
  }, [open, idx]) // eslint-disable-line

  if (!open || !cur) return null

  const advance = () => { if (idx + 1 < queue.length) setIdx(idx + 1); else { onDone?.(); onClose() } }

  const send = async () => {
    if (!to.trim()) { toast('A recipient is required', 'error'); return }
    setSending(true)
    try {
      // Custom sender (e.g. attachment-bearing Send-for-Approval) bypasses the
      // generic /email/send, which strips attachments as a security boundary.
      if (cur.onCustomSend) await cur.onCustomSend({ to: to.trim(), cc, subject, note: note.trim() || undefined })
      else await api.post('/email/send', { kind: cur.kind, ctx: note.trim() ? { ...cur.ctx, note: note.trim() } : cur.ctx, override: { to: to.trim(), cc, subject } })
      await cur.onItemSent?.()
      onSent?.(cur)
      toast('Email sent')
      advance()
    } catch (err) { toast(err.response?.data?.error || 'Send failed', 'error') }
    finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-overlay" onClick={onClose} />
      <div className="relative card w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-divider">
          <h3 className="text-sm font-bold text-ink">
            Review email{isQueue ? ` · ${idx + 1} of ${queue.length}` : ''}{cur.label ? ` — ${cur.label}` : ''}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div><label className="label">To</label><input className="input" value={to} onChange={e => setTo(e.target.value)} /></div>
          <div><label className="label">CC</label><CcChipInput value={cc} onChange={setCc} suggestions={suggestions} /></div>
          <div><label className="label">Subject</label><input className="input" value={subject} onChange={e => setSubject(e.target.value)} /></div>
          {cur.noteField && (
            <div><label className="label">Personal note <span className="text-ink-faint font-normal">— optional, added to the email</span></label>
              <textarea className="input" rows={2} value={note} onChange={e => setNote(e.target.value.slice(0, 500))} placeholder="Anything to add for the recipient…" /></div>
          )}
          {attach.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attach.map((a, i) => <span key={i} className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded px-2 py-0.5"><Paperclip size={11} /> {a}</span>)}
            </div>
          )}
          <div>
            <label className="label">Preview</label>
            {loading ? <div className="h-48 rounded-lg border border-rule skeleton-shimmer" />
              : <iframe title="preview" srcDoc={html} className="w-full h-64 rounded-lg border border-rule bg-white" />}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-divider">
          {isQueue && <button onClick={advance} className="btn-secondary"><SkipForward size={15} /> Skip</button>}
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={send} disabled={sending || loading} className="btn-primary"><Send size={15} /> {sending ? 'Sending…' : 'Send'}</button>
        </div>
      </div>
    </div>
  )
}
