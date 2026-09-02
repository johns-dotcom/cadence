import { useMemo, useState } from 'react'
import { X, Search, ChevronDown, ChevronRight, Sparkles, Loader2, BookOpen, Compass, Printer } from 'lucide-react'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { buildManual } from '../constants/manual'

const slug = (p) => 'man-' + p.replace(/\W+/g, '-')

export default function UserManual({ open, onClose }) {
  const { user, canView } = useAuth()
  const [expanded, setExpanded] = useState(() => new Set())
  const [q, setQ] = useState('')

  // AI ask
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState(null)
  const [asking, setAsking] = useState(false)
  const [askErr, setAskErr] = useState('')

  const manual = useMemo(
    () => buildManual({ role: user?.role, department: user?.department, canView }),
    [user?.role, user?.department, canView]
  )

  const query = q.trim().toLowerCase()
  const matches = query
    ? manual.accessible.filter(s =>
        `${s.title} ${s.summary} ${(s.steps || []).join(' ')}`.toLowerCase().includes(query))
    : null

  const toggle = (path) => setExpanded(s => { const n = new Set(s); n.has(path) ? n.delete(path) : n.add(path); return n })
  const openSection = (path) => {
    setExpanded(s => new Set(s).add(path))
    setQ('')
    setTimeout(() => document.getElementById(slug(path))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  // Print / Save-as-PDF. Collapsed sections are not in the DOM, so print CSS
  // alone would emit a document of headings — expand everything first, clear
  // any search narrowing, then let the browser paint.
  const printAll = () => {
    setQ('')
    setExpanded(new Set(manual.accessible.map(s => s.path)))
    setTimeout(() => window.print(), 80)
  }

  const ask = async () => {
    const question_ = question.trim()
    if (!question_) return
    setAsking(true); setAnswer(null); setAskErr('')
    try {
      const { data } = await api.post('/manual/ask', {
        question: question_,
        role: user?.role, department: user?.department,
        pages: manual.accessible.map(s => s.title),
      })
      setAnswer(data.data?.answer || '')
    } catch (err) {
      setAskErr(err.response?.data?.error || 'Could not get an answer right now.')
    } finally { setAsking(false) }
  }

  if (!open) return null

  const Section = ({ s }) => {
    const isOpen = expanded.has(s.path)
    return (
      <div id={slug(s.path)} className="border border-rule rounded-xl overflow-hidden scroll-mt-2">
        <button onClick={() => toggle(s.path)} className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-gray-50">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{s.title}</p>
            {!isOpen && <p className="text-[11px] text-gray-400 truncate">{s.summary}</p>}
          </div>
          {isOpen ? <ChevronDown size={15} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={15} className="text-gray-400 flex-shrink-0" />}
        </button>
        {isOpen && (
          <div className="px-3 pb-3 pt-1 border-t border-divider">
            <p className="text-[13px] text-gray-600 mb-2">{s.summary}</p>
            {s.steps?.length > 0 && (
              <ol className="space-y-1.5 mb-2">
                {s.steps.map((st, i) => (
                  <li key={i} className="flex gap-2 text-[13px] text-ink">
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-brand-500/15 text-brand-700 text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                    <span>{st}</span>
                  </li>
                ))}
              </ol>
            )}
            {s.tips?.map((t, i) => (
              <p key={i} className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-1.5">💡 {t.text}</p>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="manual-drawer fixed inset-0 z-[70] flex justify-end bg-overlay" onClick={onClose}>
      <div className="manual-panel w-full max-w-md h-full bg-card border-l border-rule shadow-modal flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-divider flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-ink inline-flex items-center gap-1.5"><BookOpen size={17} /> Your manual</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Tailored for {user?.name?.split(' ')[0]}
              {user?.role ? ` · ${user.role}` : ''}{user?.department ? ` · ${user.department}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1 no-print">
            <button onClick={printAll} title="Print or save as PDF" aria-label="Print or save as PDF"
              className="text-ink-faint hover:text-ink p-1"><Printer size={17} /></button>
            <button onClick={onClose} aria-label="Close manual" className="text-ink-faint hover:text-ink p-1"><X size={18} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Ask */}
          <div className="card p-3 bg-page/40 no-print">
            <p className="text-xs font-semibold text-ink mb-2 inline-flex items-center gap-1.5"><Sparkles size={13} className="text-brand-ink" /> Ask about your workspace</p>
            <div className="flex gap-2">
              <input
                value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask()}
                placeholder="e.g. How do I split an invoice across artists?"
                className="input !py-1.5 text-sm"
              />
              <button onClick={ask} disabled={asking || !question.trim()} className="btn-primary !py-1.5 text-xs flex-shrink-0">
                {asking ? <Loader2 size={14} className="animate-spin" /> : 'Ask'}
              </button>
            </div>
            {askErr && <p className="text-[12px] text-gray-500 mt-2">{askErr}</p>}
            {answer && <p className="text-[13px] text-ink whitespace-pre-line mt-2 border-t border-divider pt-2">{answer}</p>}
          </div>

          {/* Search */}
          <div className="relative no-print">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the manual…" className="input !pl-9 !py-2 text-sm" />
          </div>

          {matches ? (
            <div className="space-y-2">
              {matches.length ? matches.map(s => <Section key={s.path} s={s} />)
                : <p className="text-sm text-gray-400 text-center py-6">No help topics match "{q}".</p>}
            </div>
          ) : (
            <>
              {/* Start here */}
              {manual.recommended.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2 inline-flex items-center gap-1.5"><Compass size={12} /> Start here{user?.department ? ` for ${user.department}` : ''}</p>
                  <div className="grid grid-cols-1 gap-2">
                    {manual.recommended.map(s => (
                      <button key={s.path} onClick={() => openSection(s.path)} className="text-left card p-3 hover:border-brand-300 transition">
                        <p className="text-sm font-semibold text-ink">{s.title}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{s.summary}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Full index, grouped */}
              {manual.groups.map(g => (
                <div key={g.name}>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">{g.name}</p>
                  <div className="space-y-2">{g.sections.map(s => <Section key={s.path} s={s} />)}</div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-divider text-[11px] text-gray-400">
          Showing the {manual.accessible.length} area{manual.accessible.length === 1 ? '' : 's'} you can access. Press <kbd className="px-1 rounded bg-gray-100">?</kbd> for keyboard shortcuts.
        </div>
      </div>
    </div>
  )
}
