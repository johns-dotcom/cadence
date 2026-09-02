// Recharts theming.
//
// Recharts' default <Tooltip /> is a white box with a light border and dark
// text — in dark mode that is a glaring light popup floating over #131520 —
// and an axis with no explicit `fill` renders its ticks in Recharts' default
// #666, which is 2.8:1 on the dark page. Neither responds to a CSS class,
// because Recharts writes both as inline styles / SVG attributes.
//
// These are the two objects that fix it. They reference the same CSS variables
// the rest of the app uses, so they follow the theme (and a workspace's accent)
// without a JS mirror of the palette.

// contentStyle/itemStyle/labelStyle for <Tooltip>. Spread it:
//   <Tooltip {...TOOLTIP} formatter={…} />
export const TOOLTIP = {
  contentStyle: {
    background: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    fontSize: 12,
    color: 'var(--color-text)',
    boxShadow: '0 8px 20px -6px rgb(0 0 0 / 0.2)',
  },
  itemStyle: { color: 'var(--color-text)' },
  labelStyle: { color: 'var(--color-text-muted)', fontWeight: 600 },
  cursor: { fill: 'rgb(148 163 184 / 0.12)' },
}

// tick={...} for <XAxis>/<YAxis>. text-muted is 4.9:1 on the light page and
// 5.6:1 on the dark one — the only tier that clears AA on both.
export const AXIS_TICK = { fontSize: 10, fill: 'var(--color-text-muted)' }
export const AXIS_TICK_SM = { fontSize: 9, fill: 'var(--color-text-muted)' }

// Grid lines that disappear into whichever page they are drawn on.
export const GRID_STROKE = 'var(--color-border)'
