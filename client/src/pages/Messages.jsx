import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Hash, Lock, Plus, Send, Smile, MessageSquare, X, Search, Users, Trash2, Pencil, ChevronLeft, Paperclip, FileText, Zap, Bell, BellOff } from 'lucide-react'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { useSocket } from '../context/SocketContext'
import { useToast } from '../context/ToastContext'

const QUICK_EMOJI = ['👍', '❤️', '😂', '🎉', '🔥', '👀', '✅', '🙏']
// Attachments are served via a file-scoped, expiring signed URL that the server
// puts on each attachment (a.url) — no session token in the image URL.
const fmtSize = (b) => b == null ? '' : b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`

// Post a message with optional file attachments (multipart when files present).
export async function postMessage(channelId, body, files, threadRootId) {
  if (files && files.length) {
    const fd = new FormData()
    fd.append('body', body || '')
    if (threadRootId) fd.append('thread_root_id', threadRootId)
    files.forEach(f => fd.append('files', f))
    const { data } = await api.post(`/chat/channels/${channelId}/messages`, fd)
    return data.data
  }
  const { data } = await api.post(`/chat/channels/${channelId}/messages`, { body, thread_root_id: threadRootId })
  return data.data
}

export function FileChips({ files, onRemove }) {
  if (!files.length) return null
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {files.map((f, i) => (
        <div key={i} className="flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-lg bg-page border border-rule text-xs">
          {f.type?.startsWith('image/') ? <img src={URL.createObjectURL(f)} alt="" className="w-6 h-6 rounded object-cover" /> : <FileText size={14} className="text-brand-600" />}
          <span className="max-w-[140px] truncate text-ink">{f.name}</span>
          <button onClick={() => onRemove(i)} className="text-gray-400 hover:text-danger"><X size={13} /></button>
        </div>
      ))}
    </div>
  )
}

function Attachments({ items }) {
  if (!items?.length) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {items.map(a => a.mime_type?.startsWith('image/') ? (
        <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="block">
          <img src={a.url} alt={a.name} className="max-h-56 max-w-xs rounded-lg border border-rule object-cover" />
        </a>
      ) : (
        <a key={a.id} href={a.url} target="_blank" rel="noreferrer"
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-rule bg-page hover:border-brand-300 max-w-xs">
          <FileText size={18} className="text-brand-600 flex-shrink-0" />
          <span className="min-w-0"><span className="block text-sm text-ink truncate">{a.name}</span><span className="text-[11px] text-gray-400">{fmtSize(a.size)}</span></span>
        </a>
      ))}
    </div>
  )
}

const pad = n => String(n).padStart(2, '0')
function fmtTime(ts) { const d = new Date(ts); return `${((d.getHours() + 11) % 12) + 1}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}` }
function dayLabel(ts) {
  const d = new Date(ts), now = new Date()
  const same = (a, b) => a.toDateString() === b.toDateString()
  const yst = new Date(now); yst.setDate(now.getDate() - 1)
  if (same(d, now)) return 'Today'
  if (same(d, yst)) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
const initials = name => (name || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()
const MENTION_ALL = new Set(['channel', 'here', 'everyone'])

// Render body text with @mentions highlighted; a mention of the current user
// (or @channel/@here) gets a stronger highlight.
function renderMentions(text, myHandles) {
  const re = /@([\w][\w.'-]*)/g
  const out = []; let last = 0, m, i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const h = m[1].toLowerCase()
    const me = myHandles?.has(h) || MENTION_ALL.has(h)
    out.push(<span key={i++} className={me ? 'bg-brand-100 text-brand-700 font-semibold rounded px-0.5' : 'text-brand-600 font-medium'}>{m[0]}</span>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

// System (bot) messages use lightweight *bold* markers.
function renderSystemText(text) {
  return String(text).split(/(\*[^*]+\*)/g).map((p, i) =>
    p.startsWith('*') && p.endsWith('*') && p.length > 2
      ? <strong key={i} className="font-semibold text-ink">{p.slice(1, -1)}</strong>
      : p)
}

export function Avatar({ name, online, size = 36 }) {
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <div className="w-full h-full rounded-lg bg-brand-600 text-white flex items-center justify-center font-semibold" style={{ fontSize: size * 0.36 }}>
        {initials(name)}
      </div>
      {online != null && (
        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card ${online ? 'bg-emerald-500' : 'bg-gray-300'}`} />
      )}
    </div>
  )
}

function ReactionChips({ reactions, myId, onToggle }) {
  if (!reactions?.length) return null
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {reactions.map(r => {
        const mine = (r.users || []).map(Number).includes(Number(myId))
        return (
          <button key={r.emoji} onClick={() => onToggle(r.emoji)}
            className={`text-xs px-1.5 py-0.5 rounded-full border ${mine ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-card border-rule text-gray-600'} hover:border-brand-300`}>
            {r.emoji} {r.count}
          </button>
        )
      })}
    </div>
  )
}

function MessageRow({ m, prev, myId, myHandles, highlight, onReact, onReply, onEdit, onDelete, showThread = true }) {
  const [hover, setHover] = useState(false)
  const [picker, setPicker] = useState(false)
  const isSystem = m.is_system
  const grouped = prev && prev.user_id === m.user_id && (new Date(m.created_at) - new Date(prev.created_at) < 5 * 60 * 1000) && !m.thread_root_id && !isSystem
  const mine = Number(m.user_id) === Number(myId)
  return (
    <div id={`msg-${m.id}`} className={`relative group px-3 transition-colors ${highlight ? 'bg-amber-50 ring-1 ring-amber-300 rounded-lg' : 'hover:bg-page/60'}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); setPicker(false) }}>
      <div className="flex gap-3">
        {grouped ? <div className="w-9 flex-shrink-0 text-[10px] text-transparent group-hover:text-gray-400 text-right pt-1">{fmtTime(m.created_at).replace(/ ?[AP]M/, '')}</div>
          : isSystem ? <div className="w-9 h-9 rounded-lg bg-violet-100 text-violet-600 flex items-center justify-center flex-shrink-0"><Zap size={18} /></div>
          : <Avatar name={m.author_name} />}
        <div className="min-w-0 flex-1">
          {!grouped && (
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-ink text-sm">{isSystem ? 'Cadence' : (m.author_name || 'Unknown')}</span>
              {isSystem && <span className="text-[9px] font-bold uppercase tracking-wide bg-violet-100 text-violet-600 px-1 py-0.5 rounded">Bot</span>}
              <span className="text-[11px] text-gray-400">{fmtTime(m.created_at)}</span>
            </div>
          )}
          {m.deleted
            ? <p className="text-sm text-gray-400 italic">message deleted</p>
            : isSystem
            ? <p className="text-sm text-ink break-words">
                {renderSystemText(m.body)}
                {m.meta?.link && <Link to={m.meta.link} className="ml-2 text-brand-600 font-medium hover:underline whitespace-nowrap">View →</Link>}
              </p>
            : <>
                {m.body && <p className="text-sm text-ink whitespace-pre-wrap break-words">{renderMentions(m.body, myHandles)}{m.edited_at && <span className="text-[10px] text-gray-400 ml-1">(edited)</span>}</p>}
                <Attachments items={m.attachments} />
              </>}
          <ReactionChips reactions={m.reactions} myId={myId} onToggle={e => onReact(m.id, e)} />
          {showThread && m.reply_count > 0 && (
            <button onClick={() => onReply(m)} className="mt-1 text-xs text-brand-600 font-medium hover:underline flex items-center gap-1">
              <MessageSquare size={12} /> {m.reply_count} {m.reply_count === 1 ? 'reply' : 'replies'}
            </button>
          )}
        </div>
      </div>

      {hover && !m.deleted && (
        <div className="absolute -top-3 right-3 flex items-center gap-0.5 bg-card border border-rule rounded-lg shadow-sm px-1 py-0.5">
          <div className="relative">
            <button onClick={() => setPicker(p => !p)} className="p-1 text-gray-500 hover:text-brand-600" title="React"><Smile size={15} /></button>
            {picker && (
              <div className="absolute right-0 top-7 z-10 bg-card border border-rule rounded-lg shadow-lg p-1 flex gap-0.5">
                {QUICK_EMOJI.map(e => <button key={e} onClick={() => { onReact(m.id, e); setPicker(false) }} className="text-lg hover:scale-125 transition-transform">{e}</button>)}
              </div>
            )}
          </div>
          {showThread && <button onClick={() => onReply(m)} className="p-1 text-gray-500 hover:text-brand-600" title="Reply in thread"><MessageSquare size={15} /></button>}
          {mine && <button onClick={() => onEdit(m)} className="p-1 text-gray-500 hover:text-brand-600" title="Edit"><Pencil size={14} /></button>}
          {mine && <button onClick={() => onDelete(m)} className="p-1 text-gray-500 hover:text-danger" title="Delete"><Trash2 size={14} /></button>}
        </div>
      )}
    </div>
  )
}

// Renders a list of messages with day separators.
export function MessageList({ messages, myId, myHandles, highlightId, onReact, onReply, onEdit, onDelete, showThread }) {
  const out = []
  let lastDay = null
  messages.forEach((m, i) => {
    const day = dayLabel(m.created_at)
    if (day !== lastDay) {
      out.push(<div key={`d-${m.id}`} className="flex items-center gap-3 px-4 my-3"><div className="flex-1 h-px bg-rule" /><span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{day}</span><div className="flex-1 h-px bg-rule" /></div>)
      lastDay = day
    }
    out.push(<MessageRow key={m.id} m={m} prev={i > 0 ? messages[i - 1] : null} myId={myId} myHandles={myHandles} highlight={m.id === highlightId} onReact={onReact} onReply={onReply} onEdit={onEdit} onDelete={onDelete} showThread={showThread} />)
  })
  return <div className="py-2">{out}</div>
}

export default function Messages() {
  const { user } = useAuth()
  const { on, emit, online } = useSocket()
  const { toast } = useToast()
  const { channelId } = useParams()
  const navigate = useNavigate()

  const [channels, setChannels] = useState([])
  const [activeId, setActiveId] = useState(channelId ? Number(channelId) : null)
  const [messages, setMessages] = useState([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [text, setText] = useState('')
  const [typing, setTyping] = useState({})   // { userId: name }
  const [editing, setEditing] = useState(null)
  const [thread, setThread] = useState(null) // root message
  const [threadMsgs, setThreadMsgs] = useState([])
  const [threadText, setThreadText] = useState('')
  const [mainFiles, setMainFiles] = useState([])
  const [threadFiles, setThreadFiles] = useState([])
  const [dragOver, setDragOver] = useState(false)
  const [newModal, setNewModal] = useState(null) // 'channel' | 'dm' | 'browse'
  const fileInputRef = useRef(null)
  const threadFileRef = useRef(null)
  const mainTextRef = useRef(null)
  const [roster, setRoster] = useState([])
  const [mention, setMention] = useState(null) // { query, start } for @-autocomplete
  const [focusId, setFocusId] = useState(null)     // jump-to-message from search
  const [highlightId, setHighlightId] = useState(null)
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState(null) // null = not searching

  // Open a channel, optionally jumping to a specific message (from search).
  const openChannel = (id, focus = null) => { setFocusId(focus); setActiveId(id) }

  // The current user's own handles — used to highlight mentions of "you".
  const myHandles = useMemo(() => {
    const n = (user.name || '').toLowerCase()
    return new Set([n.replace(/\s+/g, ''), n.split(/\s+/)[0], (user.email || '').split('@')[0].toLowerCase()].filter(Boolean))
  }, [user])

  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const scrollRef = useRef(null)
  const typingTimers = useRef({})

  const active = channels.find(c => c.id === activeId) || null

  const loadChannels = useCallback(async () => {
    try { const { data } = await api.get('/chat/channels'); setChannels(data.data || []) }
    catch { /* keep prior */ }
  }, [])

  useEffect(() => { loadChannels() }, [loadChannels])
  useEffect(() => { api.get('/chat/users').then(({ data }) => setRoster(data.data || [])).catch(() => {}) }, [])

  // Pick an initial channel once loaded.
  useEffect(() => {
    if (activeId || !channels.length) return
    const first = channels.find(c => c.type === 'channel') || channels[0]
    if (first) setActiveId(first.id)
  }, [channels, activeId])

  // Keep the URL in sync.
  useEffect(() => { if (activeId && String(activeId) !== channelId) navigate(`/messages/${activeId}`, { replace: true }) }, [activeId]) // eslint-disable-line
  // Follow deep-links (e.g. clicking a @mention in the notification bell while
  // already on the Messages page) — the URL param drives the active channel.
  useEffect(() => { if (channelId && Number(channelId) !== activeId) setActiveId(Number(channelId)) }, [channelId]) // eslint-disable-line

  // Load messages + mark read when the active channel changes. When jumping to
  // a searched message, load the window ending at it (so it's the newest shown
  // and lands at the bottom) and briefly highlight it.
  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    setLoadingMsgs(true); setThread(null)
    emit('channel:subscribe', { channelId: activeId })
    const url = focusId ? `/chat/channels/${activeId}/messages?before=${focusId + 1}` : `/chat/channels/${activeId}/messages`
    api.get(url).then(({ data }) => {
      if (cancelled) return
      setMessages(data.data || [])
      setLoadingMsgs(false)
      if (focusId) {
        setHighlightId(focusId)
        setTimeout(() => { document.getElementById(`msg-${focusId}`)?.scrollIntoView({ block: 'center' }) }, 80)
        setTimeout(() => setHighlightId(null), 2800)
      }
    }).catch(() => { if (!cancelled) setLoadingMsgs(false) })
    api.post(`/chat/channels/${activeId}/read`).then(() => {
      setChannels(cs => cs.map(c => c.id === activeId ? { ...c, unread: 0 } : c))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [activeId, focusId, emit])

  // Auto-scroll to the newest message (skip while highlighting a jumped-to one).
  useEffect(() => { if (highlightId) return; const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight }, [messages, loadingMsgs, highlightId])

  // Debounced message search across all the caller's channels.
  useEffect(() => {
    const q = searchQ.trim()
    if (q.length < 2) { setSearchResults(null); return }
    const t = setTimeout(() => {
      api.get(`/chat/search?q=${encodeURIComponent(q)}`).then(({ data }) => setSearchResults(data.data || [])).catch(() => setSearchResults([]))
    }, 250)
    return () => clearTimeout(t)
  }, [searchQ])

  // ── Socket wiring ─────────────────────────────────────────────────────────
  useEffect(() => {
    const offs = [
      on('message:new', (m) => {
        if (m.thread_root_id) {
          setThread(t => { if (t && t.id === m.thread_root_id) setThreadMsgs(tm => tm.some(x => x.id === m.id) ? tm : [...tm, m]); return t })
          setMessages(ms => ms.map(x => x.id === m.thread_root_id ? { ...x, reply_count: (x.reply_count || 0) + 1 } : x))
          return
        }
        if (m.channel_id === activeIdRef.current) {
          setMessages(ms => ms.some(x => x.id === m.id) ? ms : [...ms, m])
          api.post(`/chat/channels/${m.channel_id}/read`).catch(() => {})
        } else {
          setChannels(cs => cs.map(c => c.id === m.channel_id
            ? { ...c, unread: (c.unread || 0) + 1, last_message: { body: m.body, created_at: m.created_at, author_name: m.author_name } }
            : c))
        }
        // Bump last_message preview + reorder for the active channel too.
        setChannels(cs => {
          const idx = cs.findIndex(c => c.id === m.channel_id)
          if (idx < 0) return cs
          const c = { ...cs[idx], last_message: { body: m.body, created_at: m.created_at, author_name: m.author_name } }
          const rest = cs.filter((_, i) => i !== idx)
          return [c, ...rest]
        })
      }),
      on('message:update', (m) => {
        setMessages(ms => ms.map(x => x.id === m.id ? m : x))
        setThreadMsgs(tm => tm.map(x => x.id === m.id ? m : x))
      }),
      on('message:delete', ({ id }) => {
        setMessages(ms => ms.map(x => x.id === id ? { ...x, deleted: true } : x))
        setThreadMsgs(tm => tm.map(x => x.id === id ? { ...x, deleted: true } : x))
      }),
      on('reaction:update', ({ id, reactions }) => {
        setMessages(ms => ms.map(x => x.id === id ? { ...x, reactions } : x))
        setThreadMsgs(tm => tm.map(x => x.id === id ? { ...x, reactions } : x))
      }),
      on('channel:new', () => loadChannels()),
      on('typing', ({ channelId, userId, name }) => {
        if (channelId !== activeIdRef.current || Number(userId) === Number(user.id)) return
        setTyping(t => ({ ...t, [userId]: name }))
        clearTimeout(typingTimers.current[userId])
        typingTimers.current[userId] = setTimeout(() => setTyping(t => { const n = { ...t }; delete n[userId]; return n }), 4000)
      }),
      on('typing:stop', ({ userId }) => setTyping(t => { const n = { ...t }; delete n[userId]; return n })),
    ]
    return () => offs.forEach(off => off())
  }, [on, loadChannels, user.id])

  // ── Actions ─────────────────────────────────────────────────────────────
  const lastTyping = useRef(0)
  const onType = (e) => {
    const val = e.target.value
    setText(val)
    const now = Date.now()
    if (now - lastTyping.current > 2000) { emit('typing', { channelId: activeId }); lastTyping.current = now }
    // @-autocomplete: an @token at the caret, at word start.
    const upto = val.slice(0, e.target.selectionStart)
    const mm = upto.match(/(?:^|\s)@([\w.'-]*)$/)
    setMention(mm ? { query: mm[1].toLowerCase(), start: e.target.selectionStart - mm[1].length - 1 } : null)
  }

  // Unique first-name handle if unambiguous, else the flattened full name (both
  // match server-side mention resolution).
  const handleFor = (u) => {
    const first = (u.name || '').split(/\s+/)[0]
    const dupe = roster.filter(x => (x.name || '').split(/\s+/)[0].toLowerCase() === first.toLowerCase()).length > 1
    return dupe ? (u.name || '').replace(/\s+/g, '') : first
  }
  const mentionOptions = mention ? [
    ...['channel', 'here'].filter(s => s.startsWith(mention.query)).map(s => ({ key: '@' + s, label: '@' + s, sub: 'Notify everyone in this channel', handle: s })),
    ...roster.filter(u => u.name?.toLowerCase().includes(mention.query) || u.email?.toLowerCase().includes(mention.query)).slice(0, 6)
      .map(u => ({ key: u.id, label: u.name, sub: u.role, handle: handleFor(u), name: u.name })),
  ] : []
  const insertMention = (handle) => {
    const before = text.slice(0, mention.start)
    const after = text.slice(mention.start + 1 + mention.query.length)
    const next = `${before}@${handle} ${after}`
    setText(next); setMention(null)
    setTimeout(() => { const ta = mainTextRef.current; if (ta) { ta.focus(); const pos = before.length + handle.length + 2; ta.setSelectionRange(pos, pos) } }, 0)
  }

  const send = async () => {
    const body = text.trim()
    if ((!body && !mainFiles.length) || !activeId) return
    emit('typing:stop', { channelId: activeId })
    if (editing) {   // editing is text-only
      const id = editing.id; setEditing(null); setText('')
      try { const { data } = await api.patch(`/chat/messages/${id}`, { body }); setMessages(ms => ms.map(x => x.id === id ? data.data : x)) }
      catch { toast('Edit failed', 'error') }
      return
    }
    const files = mainFiles
    setText(''); setMainFiles([])
    try { const msg = await postMessage(activeId, body, files); setMessages(ms => ms.some(x => x.id === msg.id) ? ms : [...ms, msg]) }
    catch { toast('Send failed', 'error'); setText(body); setMainFiles(files) }
  }

  const sendThread = async () => {
    const body = threadText.trim()
    if ((!body && !threadFiles.length) || !thread) return
    const files = threadFiles
    setThreadText(''); setThreadFiles([])
    try { const msg = await postMessage(activeId, body, files, thread.id); setThreadMsgs(tm => tm.some(x => x.id === msg.id) ? tm : [...tm, msg]) }
    catch { toast('Reply failed', 'error'); setThreadText(body); setThreadFiles(files) }
  }

  const addFiles = (setter) => (list) => { const arr = Array.from(list || []).slice(0, 10); if (arr.length) setter(prev => [...prev, ...arr].slice(0, 10)) }

  const react = async (id, emoji) => {
    try { await api.post(`/chat/messages/${id}/react`, { emoji }) } catch { toast('Failed', 'error') }
  }
  const toggleMute = async () => {
    if (!active) return
    const muted = !active.muted
    setChannels(cs => cs.map(c => c.id === active.id ? { ...c, muted } : c))
    try { await api.post(`/chat/channels/${active.id}/mute`, { muted }) } catch { toast('Failed', 'error') }
  }
  const openThread = async (m) => {
    setThread(m); setThreadMsgs([])
    try { const { data } = await api.get(`/chat/channels/${activeId}/messages?thread=${m.id}`); setThreadMsgs(data.data || []) } catch { /* */ }
  }
  const startEdit = (m) => { setEditing(m); setText(m.body) }
  const del = async (m) => {
    if (!confirm('Delete this message?')) return
    try { await api.delete(`/chat/messages/${m.id}`) } catch { toast('Failed', 'error') }
  }

  const typingNames = Object.values(typing)

  return (
    <div className="flex h-[calc(100vh-9rem)] rounded-xl border border-rule overflow-hidden bg-card">
      {/* ── Sidebar ── */}
      <aside className={`w-64 border-r border-rule flex flex-col bg-page/40 ${active && 'hidden md:flex'}`}>
        <div className="p-3 border-b border-rule">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-ink">Messages</h2>
            <div className="flex gap-1">
              <button onClick={() => setNewModal('browse')} className="p-1.5 text-gray-500 hover:text-brand-600" title="Browse channels to join"><Hash size={16} /></button>
              <button onClick={() => setNewModal('channel')} className="p-1.5 text-gray-500 hover:text-brand-600" title="New channel"><Plus size={18} /></button>
            </div>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search messages…"
              className="w-full text-sm pl-8 pr-7 py-1.5 rounded-lg bg-card border border-rule outline-none focus:border-brand-400 text-ink" />
            {searchQ && <button onClick={() => setSearchQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-ink"><X size={14} /></button>}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-4">
          {searchResults !== null ? (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-2 mb-1">
                {searchResults.length ? `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}` : 'No matches'}
              </p>
              {searchResults.map(r => {
                const label = r.channel_type === 'dm' ? (r.dm_peer || 'Direct message')
                  : r.channel_type === 'object' ? (r.channel_name || 'Thread')
                  : `#${r.channel_name}`
                return (
                  <button key={r.id} onClick={() => { openChannel(r.channel_id, r.id); setSearchQ('') }}
                    className="w-full text-left px-2 py-2 rounded-lg hover:bg-page">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-brand-600 truncate">{label}</span>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">{new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    </div>
                    <p className="text-xs text-gray-600 truncate">{r.is_system ? '' : `${r.author_name || 'Unknown'}: `}{r.body}</p>
                  </button>
                )
              })}
            </div>
          ) : (
            <>
              <ChannelGroup title="Channels" items={channels.filter(c => c.type === 'channel')} activeId={activeId} onPick={openChannel} online={online} />
              <div>
                <div className="flex items-center justify-between px-2 mb-1">
                  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Direct Messages</span>
                  <button onClick={() => setNewModal('dm')} className="text-gray-400 hover:text-brand-600" title="New DM"><Plus size={14} /></button>
                </div>
                {channels.filter(c => c.type === 'dm').map(c => (
                  <ChannelButton key={c.id} c={c} active={c.id === activeId} onPick={openChannel} online={online} />
                ))}
              </div>
              {channels.some(c => c.type === 'object') && (
                <div>
                  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-2">Threads</span>
                  <p className="text-[10px] text-gray-400 px-2 mb-1">Discussions on records you follow</p>
                  {channels.filter(c => c.type === 'object').map(c => (
                    <ChannelButton key={c.id} c={c} active={c.id === activeId} onPick={openChannel} online={online} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      {/* ── Main pane ── */}
      <main className={`flex-1 flex flex-col min-w-0 ${!active && 'hidden md:flex'}`}>
        {!active ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Select a conversation</div>
        ) : (
          <>
            <header className="h-14 px-4 border-b border-rule flex items-center gap-2 flex-shrink-0">
              <button onClick={() => setActiveId(null)} className="md:hidden p-1 text-gray-500"><ChevronLeft size={20} /></button>
              {active.type === 'dm' ? <Avatar name={active.display_name} online={active.peer ? online.has(Number(active.peer.id)) : null} size={28} />
                : active.type === 'object' ? <MessageSquare size={18} className="text-brand-600" />
                : (active.is_private ? <Lock size={16} className="text-gray-400" /> : <Hash size={18} className="text-gray-400" />)}
              <div className="min-w-0">
                <p className="font-bold text-ink truncate leading-tight">{active.display_name || active.name || 'Thread'}</p>
                {active.topic ? <p className="text-xs text-gray-400 truncate">{active.topic}</p>
                  : active.type === 'object' && <p className="text-xs text-gray-400 truncate">Record discussion</p>}
              </div>
              <div className="ml-auto flex items-center gap-3">
                {active.type === 'channel' && <span className="text-xs text-gray-400 flex items-center gap-1"><Users size={13} /> {active.members?.length || 0}</span>}
                <button onClick={toggleMute} title={active.muted ? 'Unmute (count in badge again)' : 'Mute (hide from unread badge)'} className={`${active.muted ? 'text-amber-500' : 'text-gray-400'} hover:text-brand-600`}>
                  {active.muted ? <BellOff size={16} /> : <Bell size={16} />}
                </button>
              </div>
            </header>

            <div ref={scrollRef} className={`flex-1 overflow-y-auto relative ${dragOver ? 'ring-2 ring-brand-400 ring-inset' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(setMainFiles)(e.dataTransfer.files) }}>
              {dragOver && <div className="absolute inset-0 z-10 flex items-center justify-center bg-brand-50/80 text-brand-700 font-medium text-sm pointer-events-none">Drop files to attach</div>}
              {loadingMsgs ? <div className="p-6 text-sm text-gray-400">Loading…</div>
                : messages.length === 0 ? <div className="p-6 text-sm text-gray-400">This is the beginning of {active.display_name ? `your conversation with ${active.display_name}` : `#${active.name}`}.</div>
                : <MessageList messages={messages} myId={user.id} myHandles={myHandles} highlightId={highlightId} onReact={react} onReply={openThread} onEdit={startEdit} onDelete={del} showThread />}
            </div>

            <div className="px-4 pb-3 flex-shrink-0">
              {typingNames.length > 0 && <p className="text-xs text-gray-400 mb-1 h-4">{typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing…</p>}
              {editing && <div className="text-xs text-amber-600 mb-1 flex items-center gap-2">Editing message <button onClick={() => { setEditing(null); setText('') }} className="underline">cancel</button></div>}
              <div className="relative border border-rule rounded-xl bg-card p-2">
                {mention && mentionOptions.length > 0 && (
                  <div className="absolute bottom-full left-2 mb-2 w-64 bg-card border border-rule rounded-lg shadow-modal overflow-hidden z-20">
                    {mentionOptions.map((o, i) => (
                      <button key={o.key} onMouseDown={e => { e.preventDefault(); insertMention(o.handle) }}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-page ${i === 0 ? 'bg-page/60' : ''}`}>
                        {o.name ? <Avatar name={o.name} size={22} /> : <span className="w-[22px] text-center text-brand-600 font-bold">@</span>}
                        <span className="min-w-0"><span className="block text-sm text-ink truncate">{o.label}</span><span className="block text-[11px] text-gray-400 truncate">{o.sub}</span></span>
                      </button>
                    ))}
                  </div>
                )}
                <FileChips files={mainFiles} onRemove={i => setMainFiles(fs => fs.filter((_, idx) => idx !== i))} />
                <div className="flex items-end gap-1">
                  <input ref={fileInputRef} type="file" multiple hidden onChange={e => { addFiles(setMainFiles)(e.target.files); e.target.value = '' }} />
                  <button onClick={() => fileInputRef.current?.click()} className="p-2 text-gray-400 hover:text-brand-600" title="Attach files"><Paperclip size={17} /></button>
                  <textarea
                    ref={mainTextRef} value={text} onChange={onType} rows={1}
                    onKeyDown={e => {
                      if (mention && mentionOptions.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); insertMention(mentionOptions[0].handle); return }
                      if (e.key === 'Escape' && mention) { setMention(null); return }
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                    }}
                    onPaste={e => { const fs = [...e.clipboardData.files]; if (fs.length) { e.preventDefault(); addFiles(setMainFiles)(fs) } }}
                    placeholder={active.type === 'dm' ? `Message ${active.display_name}` : active.type === 'object' ? 'Message this thread' : `Message #${active.name}`}
                    className="flex-1 resize-none bg-transparent outline-none text-sm text-ink max-h-40 py-1.5 px-1"
                  />
                  <button onClick={send} disabled={!text.trim() && !mainFiles.length} className="p-2 rounded-lg bg-brand-600 text-white disabled:opacity-40 hover:bg-brand-700"><Send size={16} /></button>
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* ── Thread panel ── */}
      {thread && (
        <aside className="w-96 border-l border-rule flex flex-col bg-card hidden lg:flex">
          <header className="h-14 px-4 border-b border-rule flex items-center justify-between flex-shrink-0">
            <span className="font-bold text-ink">Thread</span>
            <button onClick={() => setThread(null)} className="text-gray-400 hover:text-ink"><X size={18} /></button>
          </header>
          <div className="flex-1 overflow-y-auto">
            <div className="border-b border-rule pb-2">
              <MessageRow m={thread} myId={user.id} myHandles={myHandles} onReact={react} onReply={() => {}} onEdit={startEdit} onDelete={del} showThread={false} />
            </div>
            <MessageList messages={threadMsgs} myId={user.id} myHandles={myHandles} onReact={react} onReply={() => {}} onEdit={startEdit} onDelete={del} showThread={false} />
          </div>
          <div className="p-3 flex-shrink-0">
            <div className="border border-rule rounded-xl bg-card p-2">
              <FileChips files={threadFiles} onRemove={i => setThreadFiles(fs => fs.filter((_, idx) => idx !== i))} />
              <div className="flex items-end gap-1">
                <input ref={threadFileRef} type="file" multiple hidden onChange={e => { addFiles(setThreadFiles)(e.target.files); e.target.value = '' }} />
                <button onClick={() => threadFileRef.current?.click()} className="p-2 text-gray-400 hover:text-brand-600" title="Attach files"><Paperclip size={17} /></button>
                <textarea value={threadText} onChange={e => setThreadText(e.target.value)} rows={1}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendThread() } }}
                  onPaste={e => { const fs = [...e.clipboardData.files]; if (fs.length) { e.preventDefault(); addFiles(setThreadFiles)(fs) } }}
                  placeholder="Reply…" className="flex-1 resize-none bg-transparent outline-none text-sm text-ink max-h-40 py-1.5 px-1" />
                <button onClick={sendThread} disabled={!threadText.trim() && !threadFiles.length} className="p-2 rounded-lg bg-brand-600 text-white disabled:opacity-40 hover:bg-brand-700"><Send size={16} /></button>
              </div>
            </div>
          </div>
        </aside>
      )}

      {newModal && <NewConversationModal mode={newModal} onClose={() => setNewModal(null)} onDone={(id) => { setNewModal(null); loadChannels().then(() => id && setActiveId(id)) }} toast={toast} />}
    </div>
  )
}

function ChannelGroup({ title, items, activeId, onPick, online }) {
  return (
    <div>
      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-2">{title}</span>
      <div className="mt-1">
        {items.map(c => <ChannelButton key={c.id} c={c} active={c.id === activeId} onPick={onPick} online={online} />)}
      </div>
    </div>
  )
}

function ChannelButton({ c, active, onPick, online }) {
  const peerOnline = c.type === 'dm' && c.peer ? online.has(Number(c.peer.id)) : null
  return (
    <button onClick={() => onPick(c.id)}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm ${active ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-page'}`}>
      {c.type === 'dm'
        ? <span className={`w-2 h-2 rounded-full flex-shrink-0 ${peerOnline ? 'bg-emerald-500' : 'bg-gray-300'}`} />
        : c.type === 'object'
        ? <MessageSquare size={14} className="flex-shrink-0" />
        : (c.is_private ? <Lock size={14} className="flex-shrink-0" /> : <Hash size={15} className="flex-shrink-0" />)}
      <span className={`truncate flex-1 text-left ${c.unread ? 'font-bold text-ink' : ''} ${active && c.unread ? 'text-white' : ''}`}>{c.display_name || c.name || 'Thread'}</span>
      {c.unread > 0 && <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 ${active ? 'bg-white text-brand-700' : 'bg-brand-600 text-white'}`}>{c.unread}</span>}
    </button>
  )
}

function NewConversationModal({ mode, onClose, onDone, toast }) {
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [priv, setPriv] = useState(false)
  const [users, setUsers] = useState([])
  const [publics, setPublics] = useState([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (mode === 'dm' || mode === 'channel') api.get('/chat/users').then(({ data }) => setUsers(data.data || [])).catch(() => {})
    if (mode === 'browse') api.get('/chat/channels/public').then(({ data }) => setPublics(data.data || [])).catch(() => {})
  }, [mode])

  const createChannel = async () => {
    if (!name.trim()) return
    setBusy(true)
    try { const { data } = await api.post('/chat/channels', { name, topic, is_private: priv }); onDone(data.data.id) }
    catch (e) { toast(e.response?.data?.error || 'Failed', 'error'); setBusy(false) }
  }
  const startDm = async (uid) => {
    setBusy(true)
    try { const { data } = await api.post('/chat/dm', { user_id: uid }); onDone(data.data.id) }
    catch { toast('Failed', 'error'); setBusy(false) }
  }
  const join = async (id) => {
    setBusy(true)
    try { await api.post(`/chat/channels/${id}/join`); onDone(id) }
    catch { toast('Failed', 'error'); setBusy(false) }
  }

  const filtered = users.filter(u => u.name?.toLowerCase().includes(q.toLowerCase()) || u.email?.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="fixed inset-0 z-50 bg-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-ink">{mode === 'channel' ? 'Create a channel' : mode === 'dm' ? 'Start a direct message' : 'Browse channels'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-ink"><X size={18} /></button>
        </div>

        {mode === 'channel' && (
          <div className="space-y-3">
            <div><label className="label">Name</label>
              <div className="flex items-center gap-1"><Hash size={16} className="text-gray-400" /><input autoFocus value={name} onChange={e => setName(e.target.value)} className="input" placeholder="marketing" /></div></div>
            <div><label className="label">Topic (optional)</label><input value={topic} onChange={e => setTopic(e.target.value)} className="input" placeholder="What's this channel about?" /></div>
            <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={priv} onChange={e => setPriv(e.target.checked)} /> Private — only invited members</label>
            <button onClick={createChannel} disabled={busy || !name.trim()} className="btn-primary w-full">Create channel</button>
          </div>
        )}

        {mode === 'dm' && (
          <div>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} className="input mb-2" placeholder="Search people…" />
            <div className="max-h-72 overflow-y-auto space-y-1">
              {filtered.map(u => (
                <button key={u.id} onClick={() => startDm(u.id)} disabled={busy} className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-page text-left">
                  <Avatar name={u.name} size={30} /><div className="min-w-0"><p className="text-sm font-medium text-ink truncate">{u.name}</p><p className="text-xs text-gray-400 truncate">{u.role}</p></div>
                </button>
              ))}
              {filtered.length === 0 && <p className="text-sm text-gray-400 p-2">No people found.</p>}
            </div>
          </div>
        )}

        {mode === 'browse' && (
          <div className="max-h-80 overflow-y-auto space-y-1">
            {publics.map(c => (
              <div key={c.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-page">
                <Hash size={15} className="text-gray-400" />
                <div className="min-w-0 flex-1"><p className="text-sm font-medium text-ink truncate">{c.name}</p>{c.topic && <p className="text-xs text-gray-400 truncate">{c.topic}</p>}</div>
                <button onClick={() => join(c.id)} disabled={busy} className="btn-secondary !py-1 !px-3 text-xs">Join</button>
              </div>
            ))}
            {publics.length === 0 && <p className="text-sm text-gray-400 p-2">No channels to join — create one instead.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
