import { useEffect, useRef } from 'react'

// Shared keyboard-shortcut hook. Pass a map of key → handler:
//
//   useHotkeys({
//     n: () => setShowForm(true),
//     '1': () => setTab('Checklist'),
//     Escape: () => onClose(),
//   }, [deps])
//
// Handlers are ignored while the user is typing in an input/textarea/select or
// a contentEditable, and when a modifier (⌘/Ctrl/Alt) is held — so page keys
// never clash with browser or OS shortcuts. Keys are matched case-sensitively
// against KeyboardEvent.key (use 'Escape', 'Enter', 'ArrowDown', etc.).
export default function useHotkeys(map, deps = []) {
  const mapRef = useRef(map)
  mapRef.current = map

  useEffect(() => {
    const onKey = (e) => {
      const el = e.target
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const handler = mapRef.current[e.key]
      if (handler) { e.preventDefault(); handler(e) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
