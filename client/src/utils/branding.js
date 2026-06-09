// Per-workspace brand accent. Given a single hex (treated as the 600 shade),
// generate a full 50–950 scale by mixing toward white (tints) and black
// (shades), then write them to the --color-brand-* CSS variables that
// tailwind.config.js reads. Clearing falls back to the defaults in tokens.css.

const SCALE = {
  50:  ['#ffffff', 0.95],
  100: ['#ffffff', 0.90],
  200: ['#ffffff', 0.78],
  300: ['#ffffff', 0.62],
  400: ['#ffffff', 0.35],
  500: ['#ffffff', 0.15],
  600: null,            // base
  700: ['#000000', 0.12],
  800: ['#000000', 0.25],
  900: ['#000000', 0.40],
  950: ['#000000', 0.55],
}

const HEX_RE = /^#([0-9a-fA-F]{6})$/

export function isValidHex(hex) {
  return typeof hex === 'string' && HEX_RE.test(hex.trim())
}

function hexToRgb(hex) {
  const h = hex.trim().replace('#', '')
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
}

function mix(channel, target, amt) {
  return Math.round(channel + (target - channel) * amt)
}

// Apply an accent hex across the brand scale. No-op + reset on invalid input.
// persist=false is used for live previews so an unsaved choice doesn't survive
// a reload (the persisted value is re-applied from /auth/me on next load).
export function applyAccent(hex, persist = true) {
  if (!isValidHex(hex)) { resetAccent(persist); return }
  const base = hexToRgb(hex)
  const root = document.documentElement
  for (const [shade, spec] of Object.entries(SCALE)) {
    let r, g, b
    if (!spec) {
      ({ r, g, b } = base)
    } else {
      const t = hexToRgb(spec[0]); const amt = spec[1]
      r = mix(base.r, t.r, amt); g = mix(base.g, t.g, amt); b = mix(base.b, t.b, amt)
    }
    root.style.setProperty(`--color-brand-${shade}`, `${r} ${g} ${b}`)
  }
  if (persist) localStorage.setItem('brand_accent', hex.trim())
}

// Remove runtime overrides so the tokens.css defaults (Cadence indigo) apply.
export function resetAccent(persist = true) {
  const root = document.documentElement
  Object.keys(SCALE).forEach(shade => root.style.removeProperty(`--color-brand-${shade}`))
  if (persist) localStorage.removeItem('brand_accent')
}

// Curated presets for the picker. Values are the 600-shade hex.
export const ACCENT_PRESETS = [
  { name: 'Cadence Indigo', hex: '#4F46E5' },
  { name: 'Violet',         hex: '#7C3AED' },
  { name: 'Blue',           hex: '#2563EB' },
  { name: 'Emerald',        hex: '#059669' },
  { name: 'Rose',           hex: '#E11D48' },
  { name: 'Amber',          hex: '#D97706' },
  { name: 'Slate',          hex: '#475569' },
  { name: 'Crimson',        hex: '#DC2626' },
]
