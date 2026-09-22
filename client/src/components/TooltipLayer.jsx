import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// One app-wide hover-tooltip layer, mounted once. It upgrades the app's existing
// icon buttons for free: 100+ of them carry a native `title=`, which shows the
// slow, unstyled OS tooltip. On first hover/focus this lazily moves that title
// into `data-tooltip` (and, if the button has no accessible name, into
// `aria-label`), then removes `title` so the native tooltip never fires — and
// shows a styled, theme-aware tooltip instead. New code can use `title` OR
// `data-tooltip` directly; both work.
//
// Delegated (a handful of document listeners, not one per button), keyboard-
// accessible (shows on focus), and mouse-only for the pointer path so it never
// fights a touch tap. Dismisses on scroll, click, Escape.
const TRIGGER = 'button, [role="button"], a[data-tooltip], a[title]'
const SHOW_DELAY = 350

export default function TooltipLayer() {
  const [tip, setTip] = useState(null) // { text, left, top, below }
  const ref = useRef(null)

  useEffect(() => {
    let timer = null
    let current = null

    // Move a native title into data-tooltip (+ aria-label when there's no other
    // accessible name) and strip title so the OS tooltip can't also appear.
    const upgrade = (el) => {
      if (el.hasAttribute('title')) {
        const t = el.getAttribute('title')
        if (t) {
          if (!el.getAttribute('data-tooltip')) el.setAttribute('data-tooltip', t)
          if (!el.getAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', t)
        }
        el.removeAttribute('title')
      }
      return el.getAttribute('data-tooltip') || ''
    }

    const place = (el, text) => {
      const r = el.getBoundingClientRect()
      if (!r.width && !r.height) return
      // Above by default; flip below when near the top of the viewport.
      const below = r.top < 44
      setTip({
        text,
        left: Math.round(r.left + r.width / 2),
        top: Math.round(below ? r.bottom + 6 : r.top - 6),
        below,
      })
    }

    const cancel = () => { clearTimeout(timer); timer = null }
    const hide = () => { cancel(); current = null; setTip(null) }

    const schedule = (el) => {
      const text = upgrade(el)
      if (!text) { hide(); return }
      current = el
      cancel()
      timer = setTimeout(() => { if (current === el && document.contains(el)) place(el, text) }, SHOW_DELAY)
    }

    const onOver = (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return // no tooltips on touch
      const el = e.target.closest?.(TRIGGER)
      if (!el || el === current) return
      schedule(el)
    }
    const onOut = (e) => {
      if (!current) return
      // pointerout also fires when the cursor crosses INTO the trigger's own
      // children (an icon <svg>, a text span) — which is most icon buttons. If
      // the pointer is still inside `current`, that's not a leave: hiding here
      // would flicker the tooltip off and restart the delay as you move over the
      // icon. Only hide when relatedTarget is genuinely outside the trigger.
      if (e.relatedTarget && current.contains(e.relatedTarget)) return
      const el = e.target.closest?.(TRIGGER)
      if (el === current) hide()
    }
    // Keyboard users get the tooltip on focus.
    const onFocus = (e) => { const el = e.target.closest?.(TRIGGER); if (el) schedule(el) }
    const onBlur = () => hide()
    const onKey = (e) => { if (e.key === 'Escape') hide() }

    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerout', onOut)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', onBlur)
    document.addEventListener('keydown', onKey)
    // A scroll or click means the pointer's intent has moved on — drop the tip.
    window.addEventListener('scroll', hide, true)
    document.addEventListener('click', hide, true)
    return () => {
      cancel()
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerout', onOut)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', onBlur)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
      document.removeEventListener('click', hide, true)
    }
  }, [])

  // The tip is centered on the button (translateX(-50%)); near a viewport edge
  // that would clip it. Measure the real box and nudge left so it stays on
  // screen with an 8px margin — before paint, so there's no visible jump.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !tip) return
    const r = el.getBoundingClientRect()
    const pad = 8
    let shift = 0
    if (r.left < pad) shift = pad - r.left
    else if (r.right > window.innerWidth - pad) shift = (window.innerWidth - pad) - r.right
    el.style.left = `${tip.left + shift}px`
  }, [tip])

  if (!tip) return null
  return (
    <div
      ref={ref}
      role="tooltip"
      className="fixed z-[100] pointer-events-none px-2 py-1 rounded-md bg-ink text-card text-[11px] font-medium
                 leading-snug shadow-modal max-w-[240px] whitespace-normal break-words"
      style={{
        left: tip.left,
        top: tip.top,
        transform: `translateX(-50%) translateY(${tip.below ? '0' : '-100%'})`,
      }}
    >
      {tip.text}
    </div>
  )
}
