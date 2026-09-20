// Task notes rendered as a lightweight document.
//
// Notes stay a PLAIN-TEXT column with markdown markers — no schema change, and
// the card/table/console previews keep reading the same string. This renders
// that markdown to REACT ELEMENTS, never to an HTML string: there is no
// `dangerouslySetInnerHTML` anywhere in this app and this feature does not add
// the first one, so a note can never inject markup. React escapes every text
// node for us; the only thing we must police ourselves is link hrefs (a
// `javascript:` URL is script, not text), which `safeHref` does.
//
// Supported (the set chosen for task notes): headings (#/##/###), bullet and
// numbered lists with nesting, interactive checklists (- [ ] / - [x]), and the
// inline run **bold**, *italic*/_italic_, and [text](url). Dividers, quotes and
// code blocks were deliberately left out — add a block type here and both the
// renderer and the editor pick it up without touching the storage format.

import React from 'react'

const HEADING = /^(#{1,3})\s+(.*)$/
const CHECK = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/
const BULLET = /^(\s*)[-*]\s+(.*)$/
const ORDERED = /^(\s*)(\d+)\.\s+(.*)$/
// Indent is measured in units of two spaces (what the Tab handler inserts), so
// a note pasted with tabs or four-space indents still nests sanely.
const depthOf = (indent) => Math.min(4, Math.floor((indent || '').replace(/\t/g, '  ').length / 2))

// Only http(s) and mailto reach an href. Anything else — javascript:, data:,
// a relative path we can't vouch for — renders as plain text, so a crafted
// link is inert rather than a click-to-run.
export function safeHref(url) {
  const u = String(url || '').trim()
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : null
}

// ── inline: **bold**, *italic* / _italic_, [text](url) ──────────────────────
// A single left-to-right scan that never re-enters a matched span, so `*a*` and
// `[a](b)` can't nest into each other and produce surprises. Unmatched markers
// stay literal text (a lone `*` is just an asterisk).
export function renderInline(text, keyPrefix = 'i') {
  const out = []
  let rest = String(text ?? '')
  let k = 0
  // Ordered by how greedily each can misfire: links first (they contain
  // brackets and parens nothing else uses), then bold (**), then italic.
  const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/
  const BOLD = /\*\*([^*]+)\*\*/
  const ITAL = /(?:\*([^*\n]+)\*|_([^_\n]+)_)/

  while (rest) {
    const link = rest.match(LINK)
    const bold = rest.match(BOLD)
    const ital = rest.match(ITAL)
    // The earliest match in the remaining string wins this round.
    const cands = [link, bold, ital].filter(Boolean).sort((a, b) => a.index - b.index)
    const m = cands[0]
    if (!m) { out.push(rest); break }
    if (m.index > 0) out.push(rest.slice(0, m.index))

    if (m === link) {
      const href = safeHref(m[2])
      out.push(href
        ? <a key={`${keyPrefix}${k++}`} href={href} target="_blank" rel="noopener noreferrer"
             className="text-brand-ink underline underline-offset-2 hover:opacity-80">{m[1]}</a>
        : m[0]) // unsafe scheme → show the raw text, no live link
    } else if (m === bold) {
      out.push(<strong key={`${keyPrefix}${k++}`} className="font-semibold text-ink">{m[1]}</strong>)
    } else {
      out.push(<em key={`${keyPrefix}${k++}`}>{m[1] || m[2]}</em>)
    }
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}

// Classify one source line. `i` is its index in the ORIGINAL text, which the
// checkbox toggle needs to flip the right line back in the source.
function classify(line, i) {
  let m
  if ((m = line.match(HEADING))) return { type: 'heading', level: m[1].length, text: m[2], i }
  if ((m = line.match(CHECK))) return { type: 'check', depth: depthOf(m[1]), checked: m[2].toLowerCase() === 'x', text: m[3], i }
  if ((m = line.match(BULLET))) return { type: 'bullet', depth: depthOf(m[1]), text: m[2], i }
  if ((m = line.match(ORDERED))) return { type: 'ordered', depth: depthOf(m[1]), text: m[3], i }
  if (!line.trim()) return { type: 'blank', i }
  return { type: 'para', text: line, i }
}

/**
 * Render a note. `onToggleCheck(lineIndex)` — when provided, checklist boxes are
 * live buttons; when omitted (a read-only preview), they render disabled.
 */
export function renderMarkdownNote(src, { onToggleCheck } = {}) {
  const lines = String(src || '').split('\n')
  const blocks = lines.map(classify)
  const out = []
  const HPAD = ['pl-0', 'pl-4', 'pl-8', 'pl-12', 'pl-16']

  // Ordered lists number per (depth) run so `1. 2. 3.` is by position, not by
  // whatever digit the author happened to type.
  let orderedCounters = []

  blocks.forEach((b, idx) => {
    if (b.type !== 'ordered') orderedCounters = []
    const key = `b${idx}`
    if (b.type === 'blank') { out.push(<div key={key} className="h-2" />); return }

    if (b.type === 'heading') {
      const cls = b.level === 1 ? 'text-base font-bold text-ink mt-2'
        : b.level === 2 ? 'text-sm font-semibold text-ink mt-2'
        : 'text-[13px] font-semibold text-ink-muted uppercase tracking-wide mt-1.5'
      out.push(<div key={key} className={cls}>{renderInline(b.text, key)}</div>)
      return
    }

    if (b.type === 'check') {
      out.push(
        <div key={key} className={`flex items-start gap-2 ${HPAD[b.depth]}`}>
          <button
            type="button"
            disabled={!onToggleCheck}
            onClick={onToggleCheck ? () => onToggleCheck(b.i) : undefined}
            aria-checked={b.checked}
            role="checkbox"
            className={`mt-[3px] w-4 h-4 rounded border flex items-center justify-center shrink-0 transition
              ${b.checked ? 'bg-brand-600 border-brand-600 text-white' : 'border-rule bg-card'}
              ${onToggleCheck ? 'cursor-pointer hover:border-brand-400' : 'cursor-default'}`}
          >
            {b.checked && <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </button>
          <span className={`text-sm leading-snug ${b.checked ? 'line-through text-ink-faint' : 'text-ink'}`}>{renderInline(b.text, key)}</span>
        </div>
      )
      return
    }

    if (b.type === 'bullet') {
      out.push(
        <div key={key} className={`flex items-start gap-2 ${HPAD[b.depth]}`}>
          <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-ink-faint shrink-0" />
          <span className="text-sm leading-snug text-ink">{renderInline(b.text, key)}</span>
        </div>
      )
      return
    }

    if (b.type === 'ordered') {
      orderedCounters[b.depth] = (orderedCounters[b.depth] || 0) + 1
      orderedCounters = orderedCounters.slice(0, b.depth + 1) // deeper counters reset when we come back up
      const n = orderedCounters[b.depth]
      out.push(
        <div key={key} className={`flex items-start gap-2 ${HPAD[b.depth]}`}>
          <span className="text-sm leading-snug text-ink-muted tabular-nums shrink-0 min-w-[1.2em]">{`${n}.`}</span>
          <span className="text-sm leading-snug text-ink">{renderInline(b.text, key)}</span>
        </div>
      )
      return
    }

    out.push(<p key={key} className="text-sm leading-snug text-ink">{renderInline(b.text, key)}</p>)
  })

  return out
}

// The single-line preview for cards/table/console: the first non-empty line
// with its block AND inline markers removed, so "## Launch checklist" reads as
// "Launch checklist" and "- [x] **Draft**" reads as "Draft". One definition,
// shared with taskFields.noteLine.
export function stripMarkdownMarkers(line) {
  return String(line || '')
    .replace(/^\s*#{1,3}\s+/, '')            // heading
    .replace(/^\s*[-*]\s+\[[ xX]\]\s+/, '')  // checklist box
    .replace(/^\s*[-*]\s+/, '')              // bullet
    .replace(/^\s*\d+\.\s+/, '')             // ordered
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // link → its text
    .replace(/\*\*([^*]+)\*\*/g, '$1')       // bold
    .replace(/\*([^*]+)\*/g, '$1')           // italic *
    .replace(/_([^_]+)_/g, '$1')             // italic _
    .trim()
}
