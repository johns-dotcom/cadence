// How the operator console tells one workspace from another.
//
// TWO encodings, deliberately. A colour narrows the field; a short text tag
// decides. That is forced by arithmetic, not taste: run a categorical palette
// through a CVD/ΔE validator and no ordering of eight hues clears the all-pairs
// gate past THREE slots, while a calendar day can stack any two tenants. So
// anything that renders a workspace chip renders its tag too.

// ── The palette ─────────────────────────────────────────────────────────────
//
// A validated categorical set — these hues and both steppings mirror
// `--ws-1 … --ws-8` in tokens.css, kept here as literals because the
// similarity maths below needs real numbers and `var()` cannot be measured.
// Change one and you change the other, then re-run the validator.
//
// The ORDER is the colourblind-safety mechanism, not decoration: slot n and
// n+1 are held furthest apart, so colours are handed out IN ORDER (see
// resolveColors) rather than by a hash. Adjacent-pair worst CVD ΔE 9.1 light /
// 8.4 dark; worst normal-vision 19.6 / 19.3.
export const PALETTE = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark:  ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
}
export const PALETTE_NAMES = ['Blue', 'Orange', 'Aqua', 'Yellow', 'Magenta', 'Green', 'Violet', 'Red']

// The published gates, mirrored from the palette validator so the numbers on
// screen are the numbers that were validated rather than a feel.
//
// Normal-vision ΔE below 15 means "hard to tell apart even with full colour
// vision" — a hard floor that secondary encoding does NOT excuse.
//
// The CVD gate is min(protan, deutan) — the same pair the validator gates on.
// Tritan is computed and shown but deliberately not gated: tritanopia is
// vanishingly rare, and holding a palette to it rejects sets that are
// genuinely fine (it failed this very palette's yellow↔magenta at 5.8 while
// protan/deutan measure comfortably clear). ≥8 is the target; 6–8 is a floor
// that is legal only alongside secondary encoding, which the tag provides.
export const DE_FLOOR = 15
export const CVD_TARGET = 8
export const CVD_FLOOR = 6

// ── Colour maths (OKLab ΔE + Machado CVD simulation) ────────────────────────
//
// Ported from the palette validator so the console can MEASURE whether two
// workspaces are distinguishable instead of hoping. Same constants, same
// formulas — a second, looser copy would let the UI claim a pair is fine that
// the validator calls a failure.
const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
}
const HEX6 = /^#[0-9a-f]{6}$/i
const HEX3 = /^#[0-9a-f]{3}$/i

export function isHexColor(v) {
  const s = String(v || '').trim()
  return HEX6.test(s) || HEX3.test(s)
}
// Expand #abc so the maths only ever sees six digits.
export function normalizeHex(v) {
  const s = String(v || '').trim()
  if (HEX6.test(s)) return s.toLowerCase()
  if (HEX3.test(s)) return ('#' + s.slice(1).split('').map(c => c + c).join('')).toLowerCase()
  return null
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linearOf = (hex) => [1, 3, 5].map(i => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255))
function oklabFromLinear([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ]
}
function simulate(lin, kind) {
  const M = MACHADO[kind], clamp = (c) => Math.max(0, Math.min(1, c))
  return [0, 1, 2].map(i => clamp(M[i][0] * lin[0] + M[i][1] * lin[1] + M[i][2] * lin[2]))
}
// Euclidean distance in OKLab ×100. No `kind` → unsimulated (normal) vision.
export function deltaE(a, b, kind) {
  const ha = normalizeHex(a), hb = normalizeHex(b)
  if (!ha || !hb) return Infinity   // unmeasurable is never reported as a clash
  const la = linearOf(ha), lb = linearOf(hb)
  const x = oklabFromLinear(kind ? simulate(la, kind) : la)
  const y = oklabFromLinear(kind ? simulate(lb, kind) : lb)
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}
// How well a reader separates this pair. `cvd` is min(protan, deutan) — the
// gated statistic; `tritan` rides along for reporting only.
export function separation(a, b) {
  const normal = deltaE(a, b)
  const cvd = Math.min(deltaE(a, b, 'protan'), deltaE(a, b, 'deutan'))
  const tritan = deltaE(a, b, 'tritan')
  return { normal, cvd, tritan, ok: normal >= DE_FLOOR && cvd >= CVD_TARGET }
}

// ── Resolution ──────────────────────────────────────────────────────────────
//
// Order: the operator's explicit choice → the workspace's BRAND accent → a
// palette slot. Brand is the default because these are the colours the label
// already answers to; the override exists because two labels' brand colours can
// be the same dark grey, which is a console problem and not a brand one.
//
// Auto slots are handed out IN PALETTE ORDER by roster rank, not by `id % 8`.
// That distinction is the whole ballgame: the palette's separation guarantee
// covers ADJACENT slots, so a hash that pairs slot 3 with slot 6 lands outside
// it — measured, that is two greens at ΔE 15.6, versus 33.6 for slots 1 and 2.
// Rank is taken over the WHOLE roster in id order, so hiding or filtering a
// workspace never repaints the survivors; only creating or deleting one can.
export function resolveColors(workspaces = [], theme = 'light') {
  const steps = PALETTE[theme === 'dark' ? 'dark' : 'light']
  const roster = [...workspaces].sort((a, b) => Number(a.id) - Number(b.id))
  const out = new Map()
  let auto = 0
  for (const w of roster) {
    const custom = normalizeHex(w.console_color)
    const brand = normalizeHex(w.accent_color)
    if (custom) out.set(Number(w.id), { color: custom, source: 'custom' })
    else if (brand) out.set(Number(w.id), { color: brand, source: 'brand' })
    else out.set(Number(w.id), { color: steps[auto++ % steps.length], source: 'auto' })
  }
  return out
}

// Pairs a reader cannot separate, worst first. Reported as measurements rather
// than a verdict, because the fix is the operator's call.
export function similarPairs(workspaces = [], resolved) {
  const list = workspaces.filter(w => resolved.has(Number(w.id)))
  const out = []
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]
      const sep = separation(resolved.get(Number(a.id)).color, resolved.get(Number(b.id)).color)
      if (!sep.ok) out.push({ a, b, ...sep })
    }
  }
  return out.sort((x, y) => Math.min(x.normal, x.cvd * 2) - Math.min(y.normal, y.cvd * 2))
}

// The palette slot that sits furthest from everything else currently on screen
// — a maximin choice, so fixing one clash cannot quietly create another.
export function suggestColor(targetId, workspaces = [], resolved, theme = 'light') {
  const steps = PALETTE[theme === 'dark' ? 'dark' : 'light']
  const others = workspaces
    .filter(w => Number(w.id) !== Number(targetId) && resolved.has(Number(w.id)))
    .map(w => resolved.get(Number(w.id)).color)
  if (!others.length) return steps[0]
  let best = steps[0], bestScore = -1
  for (const candidate of steps) {
    const score = Math.min(...others.map(o => {
      const s = separation(candidate, o)
      // Score on the binding constraint, normalised against each floor, so a
      // candidate that is fine for normal vision but fails CVD cannot win.
      return Math.min(s.normal / DE_FLOOR, s.cvd / CVD_TARGET)
    }))
    if (score > bestScore) { bestScore = score; best = candidate }
  }
  return best
}

// ── Tag ─────────────────────────────────────────────────────────────────────
//
// The encoding that actually decides, and the one that keeps working at the
// ninth tenant, for a colourblind reader, and on a printout.
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

// Tags are only worth reading if they are unique. Where two collide ("Nova Ray"
// and "Night Riders" are both NR) the loser takes a later letter from its own
// name, and anything still colliding falls back to a numeral — resolved against
// the WHOLE roster in a stable id order, so a tag never changes because a
// workspace was filtered off screen.
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
