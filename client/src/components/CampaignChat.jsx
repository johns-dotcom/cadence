import { useEffect, useRef, useState } from 'react'
import { MessageSquare, X, Send, Pencil, Trash2, Check } from 'lucide-react'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

const fmt = (ts) => { const d = new Date(ts); return `${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}` }

// Per-page campaign chat: a floating opener (bottom-right, above the FAB) that
// slides over a room keyed by `room`. Polls every 8s (full refresh each 4th
// tick so edits/deletes propagate). Edit/delete your own messages.
export default function CampaignChat({ room }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState([])
  const [body, setBody] = useState('')
  const [editing, setEditing] = useState(null)
  const [hasNew, setHasNew] = useState(false)
  const busy = useRef(false)
  const scrollRef = useRef(null)
  const tick = useRef(0)
  const seenKey = `campaignChatSeen:${room}`

  const load = () => api.get(`/artist-campaigns/chat/${encodeURIComponent(room)}`).then(r => {
    const list = r.data.data || []
    setMsgs(list)
    const latest = list.length ? list[list.length - 1].id : 0
    const seen = Number(localStorage.getItem(seenKey) || 0)
    setHasNew(latest > seen && !open)
    return list
  }).catch(() => {})

  useEffect(() => { load() }, [room]) // eslint-disable-line
  useEffect(() => {
    const t = setInterval(() => { tick.current++; load() }, 8000)
    return () => clearInterval(t)
  }, [room, open]) // eslint-disable-line
  useEffect(() => { if (open) { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight } }, [msgs, open])

  const markSeen = () => {
    const latest = msgs.length ? msgs[msgs.length - 1].id : 0
    localStorage.setItem(seenKey, String(latest)); setHasNew(false)
    api.post(`/artist-campaigns/chat/${encodeURIComponent(room)}/read`).catch(() => {})
  }
  const openPanel = () => { setOpen(true); setTimeout(markSeen, 300) }

  const send = async () => {
    const b = body.trim(); if (!b || busy.current) return
    busy.current = true
    if (editing) {
      const id = editing; setEditing(null); setBody('')
      try { await api.put(`/artist-campaigns/chat/messages/${id}`, { body: b }); await load() } catch { toast('Failed', 'error') } finally { busy.current = false }
      return
    }
    setBody('')
    try { const { data } = await api.post(`/artist-campaigns/chat/${encodeURIComponent(room)}`, { body: b }); setMsgs(m => [...m, data.data]) } catch { toast('Failed', 'error'); setBody(b) } finally { busy.current = false }
  }
  const del = async (id) => { try { await api.delete(`/artist-campaigns/chat/messages/${id}`); load() } catch { toast('Failed', 'error') } }

  return (
    <>
      <button onClick={openPanel} className="fixed bottom-20 right-5 lg:bottom-6 z-40 w-12 h-12 rounded-full bg-brand-600 text-white shadow-modal flex items-center justify-center hover:bg-brand-700" title="Campaign chat">
        <MessageSquare size={20} />
        {hasNew && <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-rose-500 border-2 border-card" />}
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex justify-end" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-overlay" />
          <div className="relative w-full max-w-md bg-card h-full shadow-modal flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="h-14 px-4 border-b border-rule flex items-center justify-between flex-shrink-0">
              <span className="font-bold text-ink">Campaign chat</span>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-ink"><X size={18} /></button>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
              {msgs.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No messages yet.</p>}
              {msgs.map(m => {
                const mine = Number(m.user_id) === Number(user.id)
                return (
                  <div key={m.id} className="group">
                    <div className="flex items-baseline gap-2"><span className="text-sm font-semibold text-ink">{m.author || 'Unknown'}</span><span className="text-[10px] text-gray-400">{fmt(m.created_at)}{m.edited_at ? ' · edited' : ''}</span></div>
                    {m.deleted ? <p className="text-sm text-gray-400 italic">message deleted</p> : <p className="text-sm text-ink whitespace-pre-wrap break-words">{m.body}</p>}
                    {mine && !m.deleted && (
                      <div className="flex gap-2 mt-0.5 opacity-0 group-hover:opacity-100">
                        <button onClick={() => { setEditing(m.id); setBody(m.body) }} className="text-[11px] text-gray-400 hover:text-brand-600 inline-flex items-center gap-0.5"><Pencil size={11} /> edit</button>
                        <button onClick={() => del(m.id)} className="text-[11px] text-gray-400 hover:text-danger inline-flex items-center gap-0.5"><Trash2 size={11} /> delete</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="p-3 border-t border-rule flex-shrink-0">
              {editing && <div className="text-xs text-amber-600 mb-1">Editing… <button onClick={() => { setEditing(null); setBody('') }} className="underline">cancel</button></div>}
              <div className="flex items-end gap-2 border border-rule rounded-xl p-2">
                <textarea value={body} onChange={e => setBody(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} rows={1} placeholder="Message…  @ to mention" className="flex-1 resize-none bg-transparent outline-none text-sm text-ink max-h-32 py-1 px-1" />
                <button onClick={send} disabled={!body.trim()} className="p-2 rounded-lg bg-brand-600 text-white disabled:opacity-40 hover:bg-brand-700">{editing ? <Check size={16} /> : <Send size={16} />}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
