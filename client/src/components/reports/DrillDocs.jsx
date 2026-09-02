// The paper behind a drill row — without leaving the report.
//
// A number on a P&L is an assertion; the invoice is the evidence for it. Making
// someone leave the drill, land on the Ledger, find the row again and open the
// file there is what stops the check from happening at all.
//
// HOW FILES ARE FETCHED HERE MATTERS. Cadence serves ledger documents as
// short-lived SIGNED R2 URLs from `GET /ledger/entries/:id/file/:type`; the
// `?token=` query-param auth mode the reference app used was REMOVED for
// security and must not come back. So opening a document is a fetch first and
// an iframe second — and when R2 is not configured that endpoint answers 503
// with a sentence, which this renders instead of an empty frame. It degrades,
// it never crashes.
//
// The row carries `docs` from the server (see reports.js `docsOf`), already
// resolved to the entry that actually HOLDS each file — on a split family the
// invoice hangs off the root, not the slice you drilled into.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, X } from 'lucide-react'
import api from '../../api'
import useEscapeStack from '../../hooks/useEscapeStack'

/** Signed-URL fetch for one document. `doc` null fetches nothing. */
export function useDocUrl(doc) {
  const [state, setState] = useState({ loading: false, url: null, error: null })
  const entryId = doc?.entry_id
  const type = doc?.type

  useEffect(() => {
    if (!entryId || !type) { setState({ loading: false, url: null, error: null }); return undefined }
    let live = true
    setState({ loading: true, url: null, error: null })
    api.get(`/ledger/entries/${entryId}/file/${type}`)
      .then((r) => { if (live) setState({ loading: false, url: r.data?.data?.url || null, error: r.data?.data?.url ? null : 'No file behind that link' }) })
      .catch((err) => { if (live) setState({ loading: false, url: null, error: err.response?.data?.error || 'Could not open that document' }) })
    return () => { live = false }
  }, [entryId, type])

  return state
}

/**
 * Opens the row's best document. Renders NOTHING when the row has none — a
 * disabled button on every bank-booked row would be noise, and the row already
 * says "bank" where that is the reason.
 */
export function DocButton({ row, onOpen, className = '' }) {
  const docs = row?.docs || []
  if (!docs.length) return null
  const first = docs[0]
  const names = docs.map((d) => d.label + (d.filename ? ` — ${d.filename}` : '')).join(' · ')
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(first) }}
      title={docs.length > 1 ? `View ${first.label} (${docs.length} documents: ${names})` : `View ${names}`}
      aria-label={`View ${first.label}`}
      className={`shrink-0 text-ink-faint hover:text-brand-ink ${className}`}
    >
      <FileText size={13} />
    </button>
  )
}

/**
 * The document overlay. Portalled to `document.body` deliberately: the drill
 * modal's own backdrop closes on click, so a preview rendered inside it would
 * take the drill down with it on every dismissal.
 *
 * Sits at z-[85] — above the drill (70), the review deck (75) and the drill's
 * action sub-modal (80), all of which a document can be opened from.
 */
export function DocPreview({ row, doc, onClose }) {
  const docs = row?.docs || []
  const [active, setActive] = useState(doc || docs[0] || null)
  // The overlay stays mounted while the drill swaps which row it is showing,
  // so the tab has to follow the row rather than keep the first row's document.
  useEffect(() => { setActive(doc || (row?.docs || [])[0] || null) }, [doc, row])
  useEscapeStack(true, onClose)
  const { loading, url, error } = useDocUrl(active)
  if (!active) return null

  return createPortal(
    <div className="fixed inset-0 z-[85] bg-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-modal w-full max-w-4xl h-[88vh] flex flex-col overflow-hidden"
        role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-rule flex-shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink truncate">{active.filename || active.label}</p>
            <p className="text-[11px] text-ink-muted truncate">{[row?.payee, row?.invoice_number ? `inv ${row.invoice_number}` : null].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {docs.length > 1 && (
              <div className="flex items-center gap-1">
                {docs.map((d) => (
                  <button key={d.type} onClick={() => setActive(d)}
                    className={`text-[11px] font-semibold px-2 py-1 rounded ${d.type === active.type ? 'bg-brand-500/15 text-brand-ink' : 'text-ink-muted hover:bg-elev'}`}>
                    {d.label}
                  </button>
                ))}
              </div>
            )}
            {url && <a href={url} target="_blank" rel="noreferrer" className="text-xs text-brand-ink hover:underline">Open in new tab</a>}
            <button onClick={onClose} className="text-ink-faint hover:text-ink" aria-label="Close"><X size={18} /></button>
          </div>
        </div>
        <div className="flex-1 min-h-0 bg-elev flex items-center justify-center">
          {loading && <p className="text-xs text-ink-muted">Loading…</p>}
          {!loading && error && (
            <p className="px-8 text-center text-sm text-ink-muted max-w-md">{error}</p>
          )}
          {!loading && url && <iframe src={url} title={active.filename || active.label} className="flex-1 w-full h-full bg-elev" />}
        </div>
      </div>
    </div>,
    document.body
  )
}

/**
 * The same document, INLINE beside the review deck's card. A panel, not an
 * overlay: the question a reviewer is asking is "does this invoice justify this
 * category", and a modal that covers the card removes half of it.
 */
export function InlineDoc({ row }) {
  const docs = row?.docs || []
  const [active, setActive] = useState(docs[0] || null)
  useEffect(() => { setActive((row?.docs || [])[0] || null) }, [row])
  const { loading, url, error } = useDocUrl(active)

  return (
    <div className="rounded-lg border border-rule overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-divider bg-elev">
        <FileText size={12} className="text-ink-faint shrink-0" />
        <span className="text-[11px] font-semibold text-ink truncate flex-1">
          {active ? (active.filename || active.label) : 'No document'}
        </span>
        {docs.length > 1 && docs.map((d) => (
          <button key={d.type} onClick={() => setActive(d)}
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${d.type === active?.type ? 'bg-brand-500/15 text-brand-ink' : 'text-ink-muted hover:bg-card'}`}>
            {d.label}
          </button>
        ))}
        {url && <a href={url} target="_blank" rel="noreferrer" className="text-[10px] font-semibold text-brand-ink hover:underline shrink-0">open</a>}
      </div>
      <div className="h-56 bg-elev flex items-center justify-center">
        {!active && <p className="px-6 text-center text-[11px] text-ink-muted">No invoice, proof, receipt or W-9 on this row — a line booked from a bank descriptor has no document behind it.</p>}
        {active && loading && <p className="text-[11px] text-ink-muted">Loading…</p>}
        {active && !loading && error && <p className="px-6 text-center text-[11px] text-ink-muted">{error}</p>}
        {active && !loading && url && <iframe src={url} title={active.filename || active.label} className="w-full h-full bg-elev" />}
      </div>
    </div>
  )
}
