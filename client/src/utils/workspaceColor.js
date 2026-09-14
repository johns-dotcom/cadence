// One colour per workspace, used by the operator console's Overview cards and
// by every chip on the cross-workspace calendar. Shared so the two surfaces
// can never disagree about which tenant is which colour — a legend that means
// something different one page over is worse than no legend.

// `labels.accent_color` is nullable and, in practice, unset on most workspaces,
// so the fallback is the common case and has to be good rather than grey.
//
// Mid-tone hues on purpose: the console renders in both themes, and a palette
// picked for a white card goes muddy on the dark one. These are used as a solid
// identifier (dot / rail) plus a low-percentage tint, never as a text colour —
// which is what keeps contrast a token's job (`text-ink`) rather than luck.
export const WORKSPACE_PALETTE = [
  '#6366F1', // indigo
  '#10B981', // emerald
  '#F59E0B', // amber
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#8B5CF6', // violet
  '#EF4444', // red
  '#84CC16', // lime
  '#F97316', // orange
  '#14B8A6', // teal
  '#3B82F6', // blue
  '#A855F7', // purple
]

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

// Stable string hash, for the rare workspace with no numeric id to hand.
function hash(str) {
  let h = 0
  for (let i = 0; i < String(str).length; i++) h = (h * 31 + String(str).charCodeAt(i)) | 0
  return Math.abs(h)
}

// Resolve a workspace's identity colour.
//
// An explicitly-set accent_color always wins — that is the workspace's own
// branding and an operator who set it expects to see it. Otherwise the colour
// is derived from the workspace ID, NOT from its position in the list: index
// -based assignment reshuffles every colour the moment a workspace is created,
// suspended or filtered out, so the thing you learned to recognise changes.
export function workspaceColor(ws) {
  if (!ws) return WORKSPACE_PALETTE[0]
  const accent = typeof ws === 'string' ? ws : ws.accent_color
  if (accent && HEX.test(String(accent).trim())) return String(accent).trim()
  const id = typeof ws === 'object' ? Number(ws.id) : NaN
  const seed = Number.isInteger(id) ? id : hash(ws?.name || ws || '')
  return WORKSPACE_PALETTE[seed % WORKSPACE_PALETTE.length]
}

// A translucent wash of the workspace colour, as an inline style.
//
// Inline rather than a Tailwind class because the colour is per-row data, and
// `color-mix(... transparent)` rather than an opaque tint because it composites
// onto whatever card surface the active theme paints — the same reason the
// design tokens route their `/NN` modifiers through color-mix. An opaque
// light-theme tint is the bug that made five `bg-brand-50` fills go near-white
// in dark, taking their text with them.
export function workspaceTint(color, pct = 14) {
  return { backgroundColor: `color-mix(in srgb, ${color} ${pct}%, transparent)` }
}

// Build the id → colour map once per render pass, so a list of 400 calendar
// chips does not re-derive the same dozen colours.
export function colorMap(workspaces = []) {
  const m = new Map()
  for (const w of workspaces) m.set(Number(w.id), workspaceColor(w))
  return m
}
