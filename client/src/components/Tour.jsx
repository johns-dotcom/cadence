// The spotlight walkthrough engine. Mounted once in Layout; the steps come from
// tours/index.js.
//
// Auto-start: the welcome walk on first sign-in, then each page's own tour the
// first time that page is opened — only after welcome is done, only for pages
// the person can actually open, one at a time. Completion is stored per user on
// the server (users.tours_done), so it follows them between devices, and it is
// keyed by the tour's VERSION so an edited walkthrough offers itself again.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Loader2, SkipForward, X } from 'lucide-react'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { allTours, tourById, tourForPath } from '../tours'

const TourContext = createContext(null)
const NOOP = { startTour: () => false, tours: [], done: {}, active: null, isDone: () => false, pageTour: null, replayAll: () => {} }
export const useTour = () => useContext(TourContext) || NOOP

const visible = (el) => {
  if (!el) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

// `target` is a comma-separated list in PREFERENCE order; the first selector
// with a VISIBLE match wins. An element hidden by a responsive class has no
// size, so it does not count — which is what stops a step spotlighting
// something the person cannot see.
const findTarget = (target) => {
  for (const sel of String(target).split(',')) {
    const s = sel.trim()
    if (!s) continue
    let list = []
    try { list = document.querySelectorAll(s) } catch { list = [] }
    for (const el of list) if (visible(el)) return el
  }
  return null
}

// How long a step waits for its page to render the anchor. Harnesses shorten it.
const WAIT_MS = () => (typeof window !== 'undefined' && window.__TOUR_WAIT_MS__) || 4000

export function TourProvider({ children }) {
  const { user, canView } = useAuth()
  const location = useLocation()
  const [done, setDone] = useState(null)       // null until loaded
  const [active, setActive] = useState(null)   // { tour, index }
  const started = useRef(new Set())

  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)
  const isApprover = isAdmin || user?.role === 'Approver'
  const tours = useMemo(
    () => allTours({ isAdmin, isApprover, canView }).filter(t => t.id === 'welcome' || canView(t.path)),
    [isAdmin, isApprover, canView]
  )

  useEffect(() => {
    if (!user) return
    api.get('/settings/me').then(r => setDone(r.data?.data?.tours_done || {})).catch(() => setDone({}))
  }, [user?.id])

  const isDone = useCallback((t) => !!t && done?.[t.id]?.version === t.version, [done])
  const startTour = useCallback((id) => {
    const t = tourById(tours, id)
    if (!t || !t.steps.length) return false
    setActive({ tour: t, index: 0 })
    return true
  }, [tours])

  // completed: true = finished, false = skipped, null = nothing to show (the
  // tour is not recorded, so it still offers itself next time).
  const finish = useCallback(async (completed) => {
    const t = active?.tour
    setActive(null)
    if (!t || completed === null) return
    // Finishing the walk holds back the page it ended on for this session, so a
    // second tour does not pounce the moment the walk closes.
    if (t.id === 'welcome') {
      const here = tourForPath(tours, location.pathname)
      if (here) started.current.add(here.id)
    }
    const body = { id: t.id, version: t.version, skipped: !completed }
    try {
      const r = await api.put('/settings/me/tours', body)
      setDone(r.data?.data || {})
    } catch {
      setDone(d => ({ ...(d || {}), [t.id]: { version: t.version } }))
    }
  }, [active, tours, location.pathname])

  const replayAll = useCallback(async () => {
    try { const r = await api.delete('/settings/me/tours'); setDone(r.data?.data || {}) }
    catch { setDone({}) }
    started.current.clear()
  }, [])

  // Auto-start: welcome first, then the page's own tour once per session.
  useEffect(() => {
    if (!user || done === null || active) return undefined
    const welcome = tourById(tours, 'welcome')
    if (welcome?.steps.length && !isDone(welcome) && !started.current.has('welcome')) {
      const t = setTimeout(() => { started.current.add('welcome'); setActive({ tour: welcome, index: 0 }) }, 700)
      return () => clearTimeout(t)
    }
    if (welcome?.steps.length && !isDone(welcome)) return undefined
    const pt = tourForPath(tours, location.pathname)
    if (pt && !isDone(pt) && !started.current.has(pt.id)) {
      const t = setTimeout(() => { started.current.add(pt.id); setActive({ tour: pt, index: 0 }) }, 900)
      return () => clearTimeout(t)
    }
    return undefined
  }, [user?.id, done, location.pathname, active, isDone, tours])

  const value = useMemo(() => ({
    startTour, tours, done: done || {}, active, isDone, replayAll,
    pageTour: tourForPath(tours, location.pathname),
  }), [startTour, tours, done, active, isDone, replayAll, location.pathname])

  return (
    <TourContext.Provider value={value}>
      {children}
      {active && (
        <TourOverlay
          tour={active.tour}
          index={active.index}
          setIndex={(i) => setActive(a => (a ? { ...a, index: i } : a))}
          onFinish={finish}
          canView={canView}
        />
      )}
    </TourContext.Provider>
  )
}

function TourOverlay({ tour, index, setIndex, onFinish, canView }) {
  const location = useLocation()
  const navigate = useNavigate()
  const steps = tour.steps

  // Steps on pages this person cannot open are dropped up front, so the counter
  // is honest rather than counting things they will never be shown.
  const order = useMemo(
    () => steps.map((st, i) => i).filter(i => canView(steps[i].path || tour.path)),
    [steps, tour.path, canView]
  )
  const pos = Math.max(0, order.indexOf(index) === -1 ? 0 : order.indexOf(index))
  const stepIdx = order[pos]
  const step = steps[stepIdx]
  const wantPath = step?.path || null
  const onPage = !wantPath || location.pathname === wantPath

  const [rect, setRect] = useState(null)
  const [waiting, setWaiting] = useState(false)
  const [missing, setMissing] = useState(false)
  const navigatedFor = useRef(null)

  const famOf = (st) => st?.family || `page:${st?.path || tour.path}`
  const nextPagePos = order.findIndex((idx, k) => k > pos && (steps[idx].path || tour.path) !== (step?.path || tour.path))
  const nextFamilyPos = order.findIndex((idx, k) => k > pos && famOf(steps[idx]) !== famOf(step))

  useEffect(() => { if (order.length === 0) onFinish(null) }, [order.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!step || onPage || navigatedFor.current === stepIdx) return
    navigatedFor.current = stepIdx
    navigate(wantPath)
  }, [step, stepIdx, onPage, wantPath, navigate])

  useLayoutEffect(() => {
    if (!step) return undefined
    setMissing(false)
    let cancelled = false
    const startedAt = Date.now()
    setWaiting(true)
    const tryMeasure = () => {
      if (cancelled) return
      const el = onPage ? findTarget(step.target) : null
      if (el) {
        try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch { /* jsdom */ }
        const r = el.getBoundingClientRect()
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
        setWaiting(false)
        // Re-measure after the smooth scroll settles.
        setTimeout(() => {
          if (cancelled) return
          const r2 = el.getBoundingClientRect()
          setRect({ top: r2.top, left: r2.left, width: r2.width, height: r2.height })
        }, 350)
        return
      }
      if (Date.now() - startedAt > WAIT_MS()) {
        setWaiting(false)
        setRect(null)
        // Never reached the page at all (a guard redirected): drop the whole
        // page rather than one step at a time.
        if (!onPage) {
          if (nextPagePos !== -1) setIndex(order[nextPagePos]); else onFinish(true)
          return
        }
        // On the page, but the anchor never rendered — SHOW the step centred
        // and let the person move on. Silently auto-advancing here is what
        // reads as the walkthrough being broken.
        setMissing(true)
        return
      }
      setTimeout(tryMeasure, 150)
    }
    tryMeasure()
    const onChange = () => {
      const el = findTarget(step.target)
      if (el) {
        const r = el.getBoundingClientRect()
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      }
    }
    window.addEventListener('resize', onChange)
    window.addEventListener('scroll', onChange, true)
    return () => {
      cancelled = true
      window.removeEventListener('resize', onChange)
      window.removeEventListener('scroll', onChange, true)
    }
  }, [step, stepIdx, onPage]) // eslint-disable-line react-hooks/exhaustive-deps

  const next = () => { if (pos + 1 >= order.length) onFinish(true); else setIndex(order[pos + 1]) }
  const back = () => { if (pos > 0) setIndex(order[pos - 1]) }
  const skipPage = () => { if (nextPagePos === -1) onFinish(true); else setIndex(order[nextPagePos]) }
  const skipFamily = () => { if (nextFamilyPos === -1) onFinish(true); else setIndex(order[nextFamilyPos]) }

  useEffect(() => {
    // Keys typed into a field are not tour controls. Enter on a focused button
    // is not either — it also clicks it — but the ARROWS always are: clicking
    // Next leaves focus on Next, and dropping every key while a control has
    // focus would kill the arrows after the first click.
    const onKey = (e) => {
      const el = e.target
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return
      const onControl = !!(el && /^(BUTTON|A)$/.test(el.tagName))
      if (e.key === 'Escape') onFinish(false)
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (!waiting) next() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back() }
      else if (e.key === 'Enter' && !onControl && !waiting) next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  if (!step) return null

  const pad = 8
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const spot = rect && !waiting && !missing
  const below = spot ? rect.top + rect.height + 16 + 210 < vh : true
  const cardTop = spot ? (below ? rect.top + rect.height + 14 : Math.max(12, rect.top - 14 - 220)) : Math.max(24, vh / 2 - 130)
  const cardLeft = spot ? Math.min(Math.max(12, rect.left), Math.max(12, vw - 372)) : Math.max(12, vw / 2 - 180)
  const samePage = order.filter(i => (steps[i].path || tour.path) === (step.path || tour.path))
  const pagePos = samePage.indexOf(stepIdx) + 1
  const pageLabel = step.familyLabel && step.page && step.familyLabel !== step.page
    ? `${step.familyLabel} › ${step.page}`
    : step.page

  return (
    <div className="fixed inset-0 z-[200]" data-tour-overlay data-tour-id={tour.id} data-tour-step={stepIdx}
      data-tour-waiting={waiting ? '1' : '0'} data-tour-anchor-missing={missing ? '1' : '0'} aria-live="polite">
      {spot ? (
        <div className="absolute rounded-lg pointer-events-none transition-all duration-200" data-tour-spotlight
          style={{
            top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2,
            boxShadow: '0 0 0 9999px rgba(17, 24, 39, 0.55)', outline: '2px solid rgba(255,255,255,0.9)',
          }} />
      ) : <div className="absolute inset-0 bg-overlay" />}

      <div className="absolute w-[360px] max-w-[calc(100vw-24px)] card shadow-modal p-4"
        style={{ top: cardTop, left: cardLeft }} data-tour-card role="dialog" aria-label={step.title}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-ink-faint uppercase tracking-wider" data-tour-counter>
              {tour.title} · {pos + 1} of {order.length}
              {tour.multipage && pageLabel ? ` · ${pageLabel}${samePage.length > 1 ? ` ${pagePos} of ${samePage.length}` : ''}` : ''}
            </p>
            <h3 className="text-sm font-semibold text-ink mt-0.5">{step.title}</h3>
          </div>
          <button onClick={() => onFinish(false)} aria-label="Close the walkthrough" data-tour-skip
            className="text-ink-faint hover:text-ink p-1 -m-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            <X size={14} />
          </button>
        </div>

        {waiting
          ? <p className="text-[13px] text-ink-muted mt-2 inline-flex items-center gap-2" data-tour-loading>
              <Loader2 size={12} className="animate-spin" /> Opening {pageLabel || 'the page'}…
            </p>
          : <p className="text-[13px] text-ink-muted mt-2 leading-relaxed">{step.body}</p>}

        {missing && !waiting && (
          <p className="text-[11px] text-warning mt-2" data-tour-missing>
            This part of the page appears once there is something to show here.
          </p>
        )}

        <div className="flex items-center justify-between mt-4 gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <button onClick={() => onFinish(false)} className="text-xs text-ink-faint hover:text-ink" data-tour-skip-all>Skip tour</button>
            {tour.multipage && nextPagePos !== -1 && (
              <button onClick={skipPage} className="text-xs text-ink-faint hover:text-ink inline-flex items-center gap-1" data-tour-skip-page>
                <SkipForward size={11} /> Skip this page
              </button>
            )}
            {tour.multipage && step?.family && nextFamilyPos !== -1 && nextFamilyPos !== nextPagePos && (
              <button onClick={skipFamily} className="text-xs text-ink-faint hover:text-ink inline-flex items-center gap-1" data-tour-skip-family>
                <SkipForward size={11} /> Skip {step.familyLabel}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {pos > 0 && (
              <button onClick={back} data-tour-back
                className="inline-flex items-center gap-1 text-xs font-semibold border border-rule rounded-lg px-2.5 py-1.5 hover:bg-elev">
                <ChevronLeft size={12} /> Back
              </button>
            )}
            <button onClick={next} disabled={waiting} data-tour-next
              className="inline-flex items-center gap-1 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-1.5 hover:bg-brand-700 disabled:opacity-40">
              {pos + 1 >= order.length ? 'Done' : 'Next'} {pos + 1 < order.length && <ChevronRight size={12} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
