import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import api from '../api'

const ThemeContext = createContext()

export const ThemeProvider = ({ children }) => {
  // localStorage first so the page paints in the right theme immediately — a
  // server round trip here would mean a white flash on every dark-mode load.
  const [theme, setThemeState] = useState(() => localStorage.getItem('theme') || 'light')
  // Set once the person changes the theme in THIS session, so a slow /settings/me
  // can't land afterwards and undo the click they just made.
  const touched = useRef(false)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
    localStorage.setItem('theme', theme)
  }, [theme])

  // Adopt the account's stored preference on load, so a new device or a cleared
  // browser opens in the theme this person actually chose. ThemeProvider sits
  // ABOVE AuthProvider, so it checks the token directly rather than useAuth.
  useEffect(() => {
    if (!localStorage.getItem('token')) return
    let cancelled = false
    api.get('/settings/me')
      .then(r => {
        const t = r.data?.data?.theme
        if (!cancelled && !touched.current && (t === 'light' || t === 'dark')) setThemeState(t)
      })
      .catch(() => { /* preference is a nicety; never block the app on it */ })
    return () => { cancelled = true }
  }, [])

  // Persist alongside the local write. Fire-and-forget: the theme has already
  // applied locally, and a failed sync must not surface as an error.
  const persist = (t) => { api.patch('/settings/theme', { theme: t }).catch(() => {}) }

  const setTheme = (t) => { touched.current = true; setThemeState(t); persist(t) }
  const toggleTheme = () => setThemeState(prev => {
    touched.current = true
    const next = prev === 'dark' ? 'light' : 'dark'
    persist(next)
    return next
  })

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
