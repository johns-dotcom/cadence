import { useEffect, useRef, useState, useMemo } from 'react'
import { Paperclip, Send, MessageSquare } from 'lucide-react'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { useSocket } from '../context/SocketContext'
import { useToast } from '../context/ToastContext'
import { MessageList, FileChips, postMessage } from '../pages/Messages'

// A discussion thread anchored to a record (release, deal, invoice, artist,
// campaign, task). It's a real chat channel behind the scenes, so messages here
// also appear in Messages under "Threads", @mentions notify, and it's fully live.
//
// Props: entityType ('release'|'deal'|'expense'|'artist'|'campaign'|'task'),
// entityId, title (used to name the thread the first time it's opened).
// Keep the union in sync with OBJECT_TABLES in server/routes/chat.js.
//
// NOTE: `title` only takes effect on first creation, so for records whose name can
// change (a task's description) the thread keeps the name it was born with.
export default function ObjectDiscussion({ entityType, entityId, title, className = '' }) {
  const { user } = useAuth()
  const { on, emit } = useSocket()
  const { toast } = useToast()
  const [channelId, setChannelId] = useState(null)
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [files, setFiles] = useState([])
  const [editing, setEditing] = useState(null)
  const scrollRef = useRef(null)
  const fileRef = useRef(null)
  const channelRef = useRef(null)
  channelRef.current = channelId

  const myHandles = useMemo(() => {
    const n = (user.name || '').toLowerCase()
    return new Set([n.replace(/\s+/g, ''), n.split(/\s+/)[0], (user.email || '').split('@')[0].toLowerCase()].filter(Boolean))
  }, [user])

  // Resolve (or create) the thread for this record, then load its messages.
  useEffect(() => {
    let cancelled = false
    setLoading(true); setMessages([]); setChannelId(null)
    ;(async () => {
      try {
        const { data } = await api.post('/chat/object-thread', { entity_type: entityType, entity_id: entityId, title })
        const id = data.data.id
        if (cancelled) return
        setChannelId(id)
        emit('channel:subscribe', { channelId: id })
        const r = await api.get(`/chat/channels/${id}/messages`)
        if (cancelled) return
        setMessages(r.data.data || [])
        setLoading(false)
        api.post(`/chat/channels/${id}/read`).catch(() => {})
      } catch { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [entityType, entityId]) // eslint-disable-line

  // Live updates for this thread only.
  useEffect(() => {
    if (!channelId) return
    const offs = [
      on('message:new', m => { if (m.channel_id === channelRef.current && !m.thread_root_id) setMessages(ms => ms.some(x => x.id === m.id) ? ms : [...ms, m]) }),
      on('message:update', m => setMessages(ms => ms.map(x => x.id === m.id ? m : x))),
      on('message:delete', ({ id }) => setMessages(ms => ms.map(x => x.id === id ? { ...x, deleted: true } : x))),
      on('reaction:update', ({ id, reactions }) => setMessages(ms => ms.map(x => x.id === id ? { ...x, reactions } : x))),
    ]
    return () => offs.forEach(o => o())
  }, [on, channelId])

  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight }, [messages, loading])

  const addFiles = (list) => { const arr = Array.from(list || []).slice(0, 10); if (arr.length) setFiles(f => [...f, ...arr].slice(0, 10)) }

  const send = async () => {
    const body = text.trim()
    if ((!body && !files.length) || !channelId) return
    if (editing) {
      const id = editing.id; setEditing(null); setText('')
      try { const { data } = await api.patch(`/chat/messages/${id}`, { body }); setMessages(ms => ms.map(x => x.id === id ? data.data : x)) }
      catch { toast('Edit failed', 'error') }
      return
    }
    const f = files; setText(''); setFiles([])
    try { const msg = await postMessage(channelId, body, f); setMessages(ms => ms.some(x => x.id === msg.id) ? ms : [...ms, msg]) }
    catch { toast('Send failed', 'error'); setText(body); setFiles(f) }
  }
  const react = (id, emoji) => api.post(`/chat/messages/${id}/react`, { emoji }).catch(() => toast('Failed', 'error'))
  const del = async (m) => { if (confirm('Delete this message?')) api.delete(`/chat/messages/${m.id}`).catch(() => toast('Failed', 'error')) }
  const startEdit = (m) => { setEditing(m); setText(m.body) }

  return (
    <div className={`border border-rule rounded-xl bg-card flex flex-col overflow-hidden ${className}`} style={{ maxHeight: 460 }}>
      <div className="px-4 py-2.5 border-b border-rule flex items-center gap-2 flex-shrink-0">
        <MessageSquare size={15} className="text-brand-600" />
        <span className="text-sm font-semibold text-ink">Discussion</span>
        <span className="text-[11px] text-gray-400 ml-auto">Also in Messages · Threads</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-[140px]">
        {loading ? <p className="p-4 text-sm text-gray-400">Loading…</p>
          : messages.length === 0 ? <p className="p-4 text-sm text-gray-400">No messages yet. Start the discussion — <span className="text-brand-600">@mention</span> a teammate to loop them in.</p>
          : <MessageList messages={messages} myId={user.id} myHandles={myHandles} onReact={react} onReply={() => {}} onEdit={startEdit} onDelete={del} showThread={false} />}
      </div>
      <div className="p-2 border-t border-rule flex-shrink-0" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}>
        {editing && <div className="text-xs text-amber-600 mb-1 flex items-center gap-2">Editing message <button onClick={() => { setEditing(null); setText('') }} className="underline">cancel</button></div>}
        <FileChips files={files} onRemove={i => setFiles(fs => fs.filter((_, idx) => idx !== i))} />
        <div className="flex items-end gap-1">
          <input ref={fileRef} type="file" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} className="p-2 text-gray-400 hover:text-brand-600" title="Attach files"><Paperclip size={16} /></button>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={1}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            onPaste={e => { const fs = [...e.clipboardData.files]; if (fs.length) { e.preventDefault(); addFiles(fs) } }}
            placeholder="Write a message…  @ to mention"
            className="flex-1 resize-none bg-transparent outline-none text-sm text-ink max-h-32 py-1.5 px-1" />
          <button onClick={send} disabled={!text.trim() && !files.length} className="p-2 rounded-lg bg-brand-600 text-white disabled:opacity-40 hover:bg-brand-700"><Send size={15} /></button>
        </div>
      </div>
    </div>
  )
}
