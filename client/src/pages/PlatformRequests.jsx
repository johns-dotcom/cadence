import { useEffect, useMemo, useState } from 'react'
import { Bug, Lightbulb, HelpCircle, Check, RotateCcw, LogIn, Reply, Inbox } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useTheme } from '../context/ThemeContext'
import { useNavigate } from 'react-router-dom'
import { resolveColors, tagMap } from '../utils/workspaceColor'
import { formatDate } from '../utils/dates'

// The receiving end of tenant "report a bug / request a feature" submissions —
// which were written to internal_requests and, until now, read by nothing on
// the operator side. Scoped server-side to the workspaces this operator may
// enter. Support-desk shaped: triage by status, jump into the workspace to help,
// reply by email.
const KIND = {
  bug: { label: 'Bug', Icon: Bug, tone: 'text-danger', chip: 'bg-danger/10 text-danger' },
  feature: { label: 'Feature', Icon: Lightbulb, tone: 'text-warning', chip: 'bg-warning/15 text-warning' },
  question: { label: 'Question', Icon: HelpCircle, tone: 'text-info', chip: 'bg-info/15 text-info' },
}
const kindOf = (k) => KIND[k] || KIND.question

function timeOf(ts) {
  try { const d = new Date(ts); return `${formatDate(ts)} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` }
  catch { return formatDate(ts) }
}

export default function PlatformRequests() {
  const { enterWorkspace } = useAuth()
  const { toast } = useToast()
  const { theme } = useTheme()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [workspaces, setWorkspaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('open')
  const [kind, setKind] = useState('')
  const [labelId, setLabelId] = useState('')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState(null)
  const [busy, setBusy] = useState(null)

  const load = () => {
    setLoading(true)
    const params = {}
    if (status) params.status = status
    if (kind) params.kind = kind
    if (labelId) params.label_id = labelId
    if (q.trim()) params.q = q.trim()
    api.get('/platform/requests', { params }).then(r => setRows(r.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(() => { api.get('/platform/workspaces').then(r => setWorkspaces(r.data.data || [])).catch(() => {}) }, [])
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [status, kind, labelId, q]) // eslint-disable-line

  const colors = useMemo(() => resolveColors(workspaces, theme), [workspaces, theme])
  const tags = useMemo(() => tagMap(workspaces), [workspaces])
  const wsColor = (id) => colors.get(Number(id))?.color || 'var(--color-text-ink-faint)'

  const setStatusOf = async (row, next) => {
    setBusy(row.id)
    try {
      await api.post(`/platform/requests/${row.id}/status`, { status: next })
      setRows(rs => rs.map(r => r.id === row.id ? { ...r, status: next, resolved_at: next === 'resolved' ? new Date().toISOString() : null } : r))
      toast(next === 'resolved' ? 'Marked resolved' : 'Reopened')
      // If the current filter would now exclude it, drop it from view.
      if (status && status !== next) setRows(rs => rs.filter(r => r.id !== row.id))
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(null) }
  }

  const enterAndHelp = async (row) => {
    try { await enterWorkspace(row.label_id); navigate('/') }
    catch { toast('Could not enter that workspace', 'error') }
  }

  const reply = (row) => {
    if (!row.submitter_email) return toast('No email on file for the submitter', 'error')
    const subject = `Re: ${row.subject}`
    window.location.href = `mailto:${row.submitter_email}?subject=${encodeURIComponent(subject)}`
  }

  const STATUS_TABS = [['open', 'Open'], ['resolved', 'Resolved'], ['', 'All']]

  return (
    <div>
      <PageHeader title="Requests" subtitle="Bug reports and feature requests from your workspaces" />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="inline-flex rounded-lg border border-rule overflow-hidden">
          {STATUS_TABS.map(([val, lbl]) => (
            <button key={lbl} onClick={() => setStatus(val)}
              className={`px-3 py-1.5 text-xs font-semibold transition ${status === val ? 'bg-brand-500/10 text-brand-ink' : 'text-ink-muted hover:bg-elev'}`}>
              {lbl}
            </button>
          ))}
        </div>
        <select value={kind} onChange={e => setKind(e.target.value)} className="input !w-auto !py-1.5 text-sm">
          <option value="">All types</option>
          <option value="bug">Bugs</option>
          <option value="feature">Features</option>
          <option value="question">Questions</option>
        </select>
        <select value={labelId} onChange={e => setLabelId(e.target.value)} className="input !w-auto !py-1.5 text-sm">
          <option value="">All workspaces</option>
          {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search requests…" className="input flex-1 min-w-[12rem] !py-1.5 text-sm" />
      </div>

      {loading ? (
        <div className="card p-2"><Skeleton.Table rows={5} cols={3} /></div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <Inbox size={26} className="text-ink-faint mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm text-ink-muted">{status === 'open' ? 'No open requests — inbox zero.' : 'No requests match.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-ink-faint">{rows.length} request{rows.length === 1 ? '' : 's'}</p>
          {rows.map(row => {
            const k = kindOf(row.kind)
            const expanded = openId === row.id
            const resolved = row.status === 'resolved'
            return (
              <div key={row.id} className={`card overflow-hidden ${resolved ? 'opacity-75' : ''}`}>
                <button onClick={() => setOpenId(expanded ? null : row.id)}
                  className="w-full flex items-start gap-3 p-3.5 text-left hover:bg-elev transition">
                  <span className="flex-shrink-0 mt-0.5 w-6 rounded-sm self-stretch" style={{ background: wsColor(row.label_id), maxWidth: 4 }} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${k.chip}`}><k.Icon size={11} /> {k.label}</span>
                      <span className="text-sm font-semibold text-ink truncate">{row.subject}</span>
                      {resolved && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-success/15 text-success">Resolved</span>}
                    </span>
                    <span className="block text-[11px] text-ink-faint mt-1">
                      <span className="font-semibold text-ink-muted">{tags.get(Number(row.label_id)) || ''}</span> {row.workspace}
                      {' · '}{row.submitter_name || 'Unknown'}{' · '}{timeOf(row.created_at)}
                      {row.page_context ? ` · on ${row.page_context}` : ''}
                    </span>
                  </span>
                </button>
                {expanded && (
                  <div className="px-3.5 pb-3.5 pt-0 border-t border-divider">
                    {row.body && <p className="text-sm text-ink whitespace-pre-wrap mt-3">{row.body}</p>}
                    {resolved && row.resolved_by_name && <p className="text-[11px] text-ink-faint mt-2">Resolved by {row.resolved_by_name}{row.resolved_at ? ` · ${timeOf(row.resolved_at)}` : ''}</p>}
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <button onClick={() => enterAndHelp(row)} className="btn-secondary !py-1.5 text-xs inline-flex items-center gap-1.5"><LogIn size={13} /> Enter workspace</button>
                      <button onClick={() => reply(row)} className="btn-secondary !py-1.5 text-xs inline-flex items-center gap-1.5"><Reply size={13} /> Reply</button>
                      {resolved
                        ? <button disabled={busy === row.id} onClick={() => setStatusOf(row, 'open')} className="btn-secondary !py-1.5 text-xs inline-flex items-center gap-1.5"><RotateCcw size={13} /> Reopen</button>
                        : <button disabled={busy === row.id} onClick={() => setStatusOf(row, 'resolved')} className="btn-primary !py-1.5 text-xs inline-flex items-center gap-1.5"><Check size={13} /> Mark resolved</button>}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
