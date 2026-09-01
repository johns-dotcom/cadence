import { useCallback, useState } from 'react'

// Collapse memory for a page of nested, foldable sections — one Set of string
// keys, persisted to localStorage so a user's folds survive a reload.
//
// Keys are the caller's vocabulary. On Recoupments they are deliberately NOT
// section-prefixed at the group level (`g:<artist>:<group>`), so folding "the
// Marketing group" folds it in every state section at once — the group is the
// same group, and having to fold it four times is not a feature.
export default function useCollapsed(storageKey) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const arr = JSON.parse(localStorage.getItem(storageKey) || '[]')
      return new Set(Array.isArray(arr) ? arr : [])
    } catch { return new Set() }
  })

  const persist = (next) => {
    try { localStorage.setItem(storageKey, JSON.stringify([...next])) } catch { /* private mode */ }
    return next
  }

  const isCollapsed = useCallback((key) => collapsed.has(key), [collapsed])

  const toggleCollapsed = useCallback((key) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return persist(next)
    })
  }, [storageKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Collapse/expand a whole list of keys in one write — the Collapse-all and
  // Expand-all buttons walk every level and hand the keys in together.
  const setAllCollapsed = useCallback((keys, collapse) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      for (const k of keys) collapse ? next.add(k) : next.delete(k)
      return persist(next)
    })
  }, [storageKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return { collapsed, isCollapsed, toggleCollapsed, setAllCollapsed }
}
