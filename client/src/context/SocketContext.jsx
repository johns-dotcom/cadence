import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { io } from 'socket.io-client'
import { useAuth } from './AuthContext'

const SocketContext = createContext(null)

// One shared socket for the whole app. It connects when there's a token and a
// non-operator workspace context, authenticates with the JWT, and exposes:
//  - on(event, handler): subscribe to a server event (auto-cleans up)
//  - emit(event, payload): send an ephemeral signal (typing, etc.)
//  - online: Set of currently-online user ids (this workspace)
//  - connected: boolean
export function SocketProvider({ children }) {
  const { token, user } = useAuth()
  const socketRef = useRef(null)
  const [connected, setConnected] = useState(false)
  const [online, setOnline] = useState(() => new Set())

  useEffect(() => {
    // Connect whenever there's an authenticated session. Operators chat within
    // their Platform HQ home label; workspace users within their tenant.
    if (!token || !user) {
      if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; setConnected(false); setOnline(new Set()) }
      return
    }

    const socket = io({
      path: '/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    })
    socketRef.current = socket

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('connect_error', () => setConnected(false))

    socket.on('presence:list', ({ online }) => setOnline(new Set((online || []).map(Number))))
    socket.on('presence:update', ({ userId, online: isOn }) => {
      setOnline(prev => {
        const next = new Set(prev)
        if (isOn) next.add(Number(userId)); else next.delete(Number(userId))
        return next
      })
    })

    return () => { socket.disconnect(); socketRef.current = null }
  }, [token, user?.id, user?.is_platform_admin])

  // Stable subscribe helper that returns an unsubscribe fn.
  const on = useCallback((event, handler) => {
    const s = socketRef.current
    if (!s) return () => {}
    s.on(event, handler)
    return () => s.off(event, handler)
  }, [])

  const emit = useCallback((event, payload) => {
    socketRef.current?.emit(event, payload)
  }, [])

  return (
    <SocketContext.Provider value={{ on, emit, online, connected }}>
      {children}
    </SocketContext.Provider>
  )
}

export function useSocket() {
  const ctx = useContext(SocketContext)
  if (!ctx) throw new Error('useSocket must be used within SocketProvider')
  return ctx
}
