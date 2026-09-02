import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Lightbulb, Bug, HelpCircle, Send, Eye, ArrowLeft, CheckCircle2 } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { formatDate } from '../utils/dates'

const KINDS = [
  { key: 'feature', label: 'Feature request', icon: Lightbulb, blurb: 'Something you wish Cadence could do' },
  { key: 'bug', label: 'Report a bug', icon: Bug, blurb: 'Something that looks broken or wrong' },
  { key: 'question', label: 'Question', icon: HelpCircle, blurb: 'Ask the Cadence team anything' },
]
const KIND_LABEL = Object.fromEntries(KINDS.map(k => [k.key, k.label]))

export default function InternalRequests() {
  const { toast } = useToast()
  const { user, label } = useAuth()
  const [kind, setKind] = useState('feature')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [pageContext, setPageContext] = useState('')
  const [preview, setPreview] = useState(false)
  const [sending, setSending] = useState(false)
  const [mine, setMine] = useState([])

  // Where the user came from. `?from=` is authoritative — the header's
  // quick-compose button passes it — because document.referrer is EMPTY on a
  // client-side route change, which is every navigation inside the app. The
  // referrer is kept only as the fallback for a hard load or an external link.
  const [params] = useSearchParams()
  useEffect(() => {
    const from = params.get('from')
    if (from && from !== '/requests') { setPageContext(from); return }
    try { const r = document.referrer ? new URL(document.referrer).pathname : ''; if (r && r !== '/requests') setPageContext(r) } catch { /* ignore */ }
  }, [params])
  useEffect(() => {
    const k = params.get('kind')
    if (k && KINDS.some(x => x.key === k)) setKind(k)
  }, [params])
  const load = () => api.get('/internal-requests').then(r => setMine(r.data.data || [])).catch(() => {})
  useEffect(() => { load() }, [])

  const send = async () => {
    if (!subject.trim()) { toast('A subject is required', 'error'); return }
    setSending(true)
    try {
      const { data } = await api.post('/internal-requests', { kind, subject: subject.trim(), body, page_context: pageContext })
      toast(data.emailed ? 'Sent to the Cadence team' : 'Request logged (email not configured)')
      setSubject(''); setBody(''); setPreview(false); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed to send', 'error') }
    finally { setSending(false) }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Requests & feedback" subtitle="Send a feature idea, bug report, or question to the Cadence team" />

      <div className="card p-5 mb-6">
        {!preview ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
              {KINDS.map(k => {
                const Icon = k.icon
                return (
                  <button key={k.key} onClick={() => setKind(k.key)} className={`text-left p-3 rounded-xl border transition ${kind === k.key ? 'border-brand-400 bg-brand-500/10/40 ring-1 ring-brand-200' : 'border-rule hover:bg-gray-50'}`}>
                    <Icon size={16} className={kind === k.key ? 'text-brand-600' : 'text-gray-400'} />
                    <p className="text-sm font-semibold text-ink mt-1.5">{k.label}</p>
                    <p className="text-[11px] text-gray-400 leading-snug mt-0.5">{k.blurb}</p>
                  </button>
                )
              })}
            </div>
            <div className="space-y-3">
              <div><label className="label">Subject</label><input className="input" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Short summary" autoFocus /></div>
              <div><label className="label">Details</label><textarea className="input" rows={5} value={body} onChange={e => setBody(e.target.value)} placeholder="What happened, what you expected, steps to reproduce…" /></div>
              <div><label className="label">Related page (optional)</label><input className="input" value={pageContext} onChange={e => setPageContext(e.target.value)} placeholder="/releases/123" /></div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => { if (!subject.trim()) { toast('A subject is required', 'error'); return } setPreview(true) }} className="btn-secondary"><Eye size={15} /> Preview</button>
              <button onClick={send} disabled={sending} className="btn-primary"><Send size={15} /> {sending ? 'Sending…' : 'Send'}</button>
            </div>
          </>
        ) : (
          <>
            <button onClick={() => setPreview(false)} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-3"><ArrowLeft size={15} /> Edit</button>
            <div className="rounded-xl border border-rule overflow-hidden">
              <div className="bg-page/60 px-4 py-2 text-xs text-gray-500 border-b border-divider">
                <p><span className="text-gray-400">To:</span> Cadence team · <span className="text-gray-400">From:</span> {user?.name} ({user?.email})</p>
                <p className="mt-0.5"><span className="text-gray-400">Subject:</span> [{KIND_LABEL[kind]}] {subject} — {label?.name}</p>
              </div>
              <div className="p-4">
                <p className="text-sm text-ink whitespace-pre-line">{body || <span className="text-gray-400">No details provided.</span>}</p>
                {pageContext && <p className="text-[11px] text-gray-400 mt-3">From page: {pageContext}</p>}
              </div>
            </div>
            <div className="flex justify-end mt-4"><button onClick={send} disabled={sending} className="btn-primary"><Send size={15} /> {sending ? 'Sending…' : 'Send to Cadence team'}</button></div>
          </>
        )}
      </div>

      {mine.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-ink mb-3">Your recent requests</h2>
          <div className="space-y-2">
            {mine.map(r => (
              <div key={r.id} className="card p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{r.subject}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{KIND_LABEL[r.kind] || r.kind} · {formatDate(r.created_at)}{r.page_context ? ` · ${r.page_context}` : ''}</p>
                </div>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase text-gray-400 flex-shrink-0"><CheckCircle2 size={12} /> {r.status || 'open'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
