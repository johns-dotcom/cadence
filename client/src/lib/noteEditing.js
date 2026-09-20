// Pure text transforms behind the note editor's toolbar and smart keys.
//
// Every function takes the textarea's current value plus its selection and
// returns { value, selStart, selEnd } — the new text and where the caret should
// land. Keeping them pure (no DOM) is what lets the fixture assert the tricky
// cases: Enter continuing a list, Tab nesting, an empty item ending a list, and
// a checkbox toggling the RIGHT line. The component just applies the result.

const LIST_RE = /^(\s*)([-*]\s+\[[ xX]\]\s+|[-*]\s+|\d+\.\s+)(.*)$/

// The [start, end] character range of the lines the selection touches.
function lineSpan(text, selStart, selEnd) {
  const start = text.lastIndexOf('\n', selStart - 1) + 1
  let end = text.indexOf('\n', selEnd)
  if (end === -1) end = text.length
  return [start, end]
}

// Wrap the selection in a marker (bold/italic). With nothing selected, drop the
// pair in and place the caret between them so the next keystroke is inside.
export function toggleWrap(text, selStart, selEnd, marker) {
  const sel = text.slice(selStart, selEnd)
  const m = marker.length
  // Already wrapped → unwrap (toggle off).
  if (sel.startsWith(marker) && sel.endsWith(marker) && sel.length >= m * 2) {
    const inner = sel.slice(m, -m)
    return { value: text.slice(0, selStart) + inner + text.slice(selEnd), selStart, selEnd: selStart + inner.length }
  }
  if (!sel) {
    const v = text.slice(0, selStart) + marker + marker + text.slice(selEnd)
    return { value: v, selStart: selStart + m, selEnd: selStart + m }
  }
  const v = text.slice(0, selStart) + marker + sel + marker + text.slice(selEnd)
  return { value: v, selStart: selStart + m, selEnd: selStart + m + sel.length }
}

// Apply/remove a line prefix (bullet, ordered, checkbox, heading) across every
// line the selection touches. If every touched line already has it, toggle off;
// otherwise add it to the ones that don't — so the toolbar button on a mixed
// selection completes the list rather than clearing half of it.
export function toggleLinePrefix(text, selStart, selEnd, kind) {
  const [s, e] = lineSpan(text, selStart, selEnd)
  const lines = text.slice(s, e).split('\n')
  const prefixFor = (n) => kind === 'bullet' ? '- '
    : kind === 'check' ? '- [ ] '
    : kind === 'ordered' ? `${n + 1}. `
    : kind === 'h1' ? '# ' : kind === 'h2' ? '## ' : kind === 'h3' ? '### ' : '- '
  const has = (l) => {
    const t = l.replace(/^\s*/, '')
    if (kind === 'bullet') return /^[-*]\s+(?!\[)/.test(t)
    if (kind === 'check') return /^[-*]\s+\[[ xX]\]\s+/.test(t)
    if (kind === 'ordered') return /^\d+\.\s+/.test(t)
    return new RegExp(`^#{${{ h1: 1, h2: 2, h3: 3 }[kind]}}\\s+`).test(t)
  }
  const stripAny = (l) => {
    const indent = l.match(/^\s*/)[0]
    return indent + l.slice(indent.length).replace(/^([-*]\s+\[[ xX]\]\s+|[-*]\s+|\d+\.\s+|#{1,3}\s+)/, '')
  }
  const allHave = lines.every(l => !l.trim() || has(l))
  const next = lines.map((l, n) => {
    if (!l.trim()) return l
    if (allHave) return stripAny(l)                       // toggle off
    const indent = l.match(/^\s*/)[0]
    return indent + prefixFor(n) + l.slice(indent.length).replace(/^([-*]\s+\[[ xX]\]\s+|[-*]\s+|\d+\.\s+|#{1,3}\s+)/, '')
  }).join('\n')
  const value = text.slice(0, s) + next + text.slice(e)
  return { value, selStart: s, selEnd: s + next.length }
}

// Enter inside a list continues it: a new item with the same marker and indent.
// An EMPTY item + Enter ends the list instead (removes the marker), which is how
// every editor lets you stop a list without reaching for the mouse. Returns null
// when the caret isn't in a list, so the caller lets the default newline happen.
export function continueList(text, selStart, selEnd) {
  if (selStart !== selEnd) return null
  const lineStart = text.lastIndexOf('\n', selStart - 1) + 1
  const lineEnd = text.indexOf('\n', selStart) === -1 ? text.length : text.indexOf('\n', selStart)
  const line = text.slice(lineStart, lineEnd)
  const m = line.match(LIST_RE)
  if (!m) return null
  const [, indent, marker, body] = m
  // Empty item → end the list: clear this line, caret to its start.
  if (!body.trim()) {
    const value = text.slice(0, lineStart) + text.slice(lineEnd)
    return { value, selStart: lineStart, selEnd: lineStart }
  }
  // Continue: an ordered marker increments, a checkbox resets to unchecked.
  let nextMarker = marker
  const ord = marker.match(/^(\d+)\.\s+$/)
  if (ord) nextMarker = `${Number(ord[1]) + 1}. `
  else if (/\[[ xX]\]/.test(marker)) nextMarker = '- [ ] '
  const insert = '\n' + indent + nextMarker
  const value = text.slice(0, selStart) + insert + text.slice(selStart)
  const caret = selStart + insert.length
  return { value, selStart: caret, selEnd: caret }
}

// Tab / Shift+Tab: indent or outdent by two spaces across the touched lines.
export function indentLines(text, selStart, selEnd, outdent) {
  const [s, e] = lineSpan(text, selStart, selEnd)
  const lines = text.slice(s, e).split('\n')
  let delta = 0
  const next = lines.map(l => {
    if (outdent) {
      const cut = l.match(/^( {1,2}|\t)/)
      if (cut) { delta -= cut[0].length; return l.slice(cut[0].length) }
      return l
    }
    delta += 2
    return '  ' + l
  }).join('\n')
  const value = text.slice(0, s) + next + text.slice(e)
  // Keep the selection over the same lines.
  return { value, selStart: Math.max(s, selStart + (outdent ? Math.max(-2, delta && -2) : 2)), selEnd: e + delta }
}

// Flip the checkbox on a specific SOURCE line (the renderer hands us its index).
// Returns the new text, or the text unchanged if that line isn't a checkbox.
export function toggleCheckAt(text, lineIndex) {
  const lines = text.split('\n')
  const l = lines[lineIndex]
  if (l == null) return text
  const m = l.match(/^(\s*[-*]\s+\[)([ xX])(\]\s+.*)$/)
  if (!m) return text
  lines[lineIndex] = m[1] + (m[2].toLowerCase() === 'x' ? ' ' : 'x') + m[3]
  return lines.join('\n')
}

// Insert a [text](url) link at the selection (selected text becomes the label).
export function insertLink(text, selStart, selEnd, url) {
  const label = text.slice(selStart, selEnd) || 'link'
  const snippet = `[${label}](${url})`
  const value = text.slice(0, selStart) + snippet + text.slice(selEnd)
  return { value, selStart: selStart + snippet.length, selEnd: selStart + snippet.length }
}
