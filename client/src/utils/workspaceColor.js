// How the operator console tells one workspace from another.
//
// TWO encodings, deliberately. A colour narrows the field; a short text tag
// decides. That is not belt-and-braces — it is forced by the arithmetic:
// running the categorical palette through a CVD/ΔE validator, no ordering of
// eight hues clears the all-pairs gate past THREE slots, and a calendar day can
// stack any two tenants side by side. So colour alone cannot carry identity
// here, and anything that renders a workspace chip renders its tag too.

// ── Colour ──────────────────────────────────────────────────────────────────
//
// The console does NOT paint with `labels.accent_color`. Telling tenants apart
// and expressing a brand are different jobs: real workspaces set dark, low-
// chroma brand colours, and two of those are the same grey chip at a glance —
// which is exactly the report that prompted this. `accent_color` still brands
// the workspace's own shell and is still edited in the workspace drawer.
//
// The eight slots live in tokens.css as `--ws-1 … --ws-8`, with a separate
// stepping for the dark card. Returning a `var()` rather than a hex is what
// makes a chip theme-aware without plumbing the theme through every component —
// including the OS-level "system" setting, which a JS theme value can miss.
export const WORKSPACE_SLOTS = 8

// Stable string hash, for the rare workspace with no numeric id to hand.
function hash(str) {
  let h = 0
  for (let i = 0; i < String(str).length; i++) h = (h * 31 + String(str).charCodeAt(i)) | 0
  return Math.abs(h)
}

// Which slot (1…8) a workspace owns.
//
// Derived from the workspace ID, NOT its position in a list: index-based
// assignment repaints every surviving workspace the moment one is created,
// suspended or filtered out, and a colour you had learned to recognise becomes
// somebody else's. Colour follows the entity, never its rank.
export function workspaceSlot(ws) {
  if (!ws) return 1
  const id = typeof ws === 'object' ? Number(ws.id) : Number(ws)
  const seed = Number.isInteger(id) ? id : hash(ws?.name || ws || '')
  return (seed % WORKSPACE_SLOTS) + 1
}

// The workspace's colour, as a CSS value usable in any inline style.
export function workspaceColor(ws) {
  return `var(--ws-${workspaceSlot(ws)})`
}

// ── Why there is no tint helper here ────────────────────────────────────────
//
// The first cut filled each chip with a ~20% wash of the slot colour. Run the
// composited fills back through the validator and they measure a normal-vision
// deltaE of 2.2 on white and 2.3 on the dark card — a fifth of the >=15 floor.
// A pale wash of ANY hue is a pale pastel, and pale pastels are the same
// colour; the fill looked like it was carrying identity while carrying none,
// which is precisely the "these all look grey" report.
//
// So the surfaces below paint chips in a NEUTRAL token and spend their colour
// on one solid block of the undiluted slot hue, which measures deltaE 19.6
// light / 19.3 dark between adjacent slots. One coloured element, and it is
// the one that was validated.

// ── Tag ─────────────────────────────────────────────────────────────────────
//
// The encoding that actually decides, and the one that keeps working at the
// ninth tenant, for a colourblind reader, and on a printout.
//
// Initials from the first letters of up to two significant words; a leading
// article is dropped because "The Nest" and "The Nook" would otherwise both be
// "TN". A single remaining word gives up its first two letters.
const STOPWORDS = new Set(['the', 'a', 'an'])
export function workspaceTag(ws) {
  const name = (typeof ws === 'string' ? ws : ws?.name) || ''
  const words = name.trim().split(/[\s\-_/]+/).filter(Boolean)
  const significant = words.filter(w => !STOPWORDS.has(w.toLowerCase()))
  const use = significant.length ? significant : words
  if (!use.length) return '??'
  if (use.length === 1) return use[0].slice(0, 2).toUpperCase()
  return (use[0][0] + use[1][0]).toUpperCase()
}

// Tags are only worth reading if they are unique. Where two workspaces collide
// ("Nova Ray" and "Night Riders" are both NR) the loser takes a third letter
// from its first word, and anything still colliding falls back to a numeral —
// resolved against the WHOLE roster and in a stable id order, so a tag does not
// change when a workspace is filtered off screen.
export function tagMap(workspaces = []) {
  const out = new Map()
  const taken = new Set()
  for (const w of [...workspaces].sort((a, b) => Number(a.id) - Number(b.id))) {
    const base = workspaceTag(w)
    let tag = base
    if (taken.has(tag)) {
      const name = (w.name || '').replace(/[^A-Za-z0-9]/g, '')
      for (let i = 2; i < name.length && taken.has(tag); i++) tag = (base[0] + name[i]).toUpperCase()
    }
    for (let n = 2; taken.has(tag); n++) tag = base[0] + n
    taken.add(tag)
    out.set(Number(w.id), tag)
  }
  return out
}

// Build the id → colour map once per render pass, so a month of chips does not
// re-derive the same eight values.
export function colorMap(workspaces = []) {
  const m = new Map()
  for (const w of workspaces) m.set(Number(w.id), workspaceColor(w))
  return m
}
