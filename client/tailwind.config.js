// A CSS-variable-backed color that still honours Tailwind's `/NN` opacity
// modifier. The variables hold HEX (they flip wholesale between light and
// dark), so the rgb(var()/<alpha-value>) form is unavailable; color-mix is the
// only way to make `bg-card/60` mean anything at all instead of emitting
// nothing. Returns the bare var when no modifier was used so the common case
// stays a plain `var()` reference.
const tokenColor = (name) => ({ opacityValue }) =>
  opacityValue === undefined
    ? `var(${name})`
    : `color-mix(in srgb, var(${name}) ${opacityValue * 100}%, transparent)`

export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        // Brand palette — backed by CSS variables (defaults in styles/tokens.css)
        // so a workspace's accent color can be applied per-tenant at runtime.
        // utils/branding.js generates the full scale from a single hex.
        brand: {
          DEFAULT: 'rgb(var(--color-brand-600) / <alpha-value>)',
          50:  'rgb(var(--color-brand-50)  / <alpha-value>)',
          100: 'rgb(var(--color-brand-100) / <alpha-value>)',
          200: 'rgb(var(--color-brand-200) / <alpha-value>)',
          300: 'rgb(var(--color-brand-300) / <alpha-value>)',
          400: 'rgb(var(--color-brand-400) / <alpha-value>)',
          500: 'rgb(var(--color-brand-500) / <alpha-value>)',
          600: 'rgb(var(--color-brand-600) / <alpha-value>)',
          700: 'rgb(var(--color-brand-700) / <alpha-value>)',
          800: 'rgb(var(--color-brand-800) / <alpha-value>)',
          900: 'rgb(var(--color-brand-900) / <alpha-value>)',
          950: 'rgb(var(--color-brand-950) / <alpha-value>)',
          // text-brand-ink — the accent as FOREGROUND. Flips to brand-400 in dark,
          // where brand-600 is only 2.6:1 on the card. Use this for links and active
          // affordances; keep the numeric shades for fills.
          ink: 'rgb(var(--color-brand-ink) / <alpha-value>)',
        },
        surface: {
          0: '#FFFFFF',
          50: '#F9FAFB',
          100: '#F3F4F6',
          200: '#E5E7EB',
        },

        // Theme-aware gray palette backed by CSS variables in styles/tokens.css.
        // Expressed as rgb(var(--…) / <alpha-value>) so opacity modifiers
        // (bg-gray-50/80, text-gray-400/60, …) keep working in both themes.
        gray: {
          50:  'rgb(var(--color-gray-50)  / <alpha-value>)',
          100: 'rgb(var(--color-gray-100) / <alpha-value>)',
          200: 'rgb(var(--color-gray-200) / <alpha-value>)',
          300: 'rgb(var(--color-gray-300) / <alpha-value>)',
          400: 'rgb(var(--color-gray-400) / <alpha-value>)',
          500: 'rgb(var(--color-gray-500) / <alpha-value>)',
          600: 'rgb(var(--color-gray-600) / <alpha-value>)',
          700: 'rgb(var(--color-gray-700) / <alpha-value>)',
          800: 'rgb(var(--color-gray-800) / <alpha-value>)',
          900: 'rgb(var(--color-gray-900) / <alpha-value>)',
        },

        // Semantic aliases backed by CSS variables (theme-aware).
        //
        // These are theme-flipped HEX vars, so Tailwind's
        // rgb(var(--…)/<alpha-value>) trick cannot apply — a bare
        // `var(--color-bg-page)` makes `bg-page/50` emit NOTHING (Tailwind has
        // nowhere to put the alpha, so it drops the declaration and the class
        // silently does nothing). 66 sites in this repo were written that way,
        // including the `bg-page/50` on every table <thead>. Routing the
        // opacity modifier through color-mix fixes all of them at once — the
        // same treatment success/warning/danger/info already got below, and the
        // same browser floor bg-selected already accepted (Chrome 111 /
        // Safari 16.2 / FF 113).
        page:     tokenColor('--color-bg-page'),
        card:     tokenColor('--color-bg-card'),
        elev:     tokenColor('--color-bg-elev'),
        // bg-selected — multi-select row tint. Opaque; see tokens.css for why.
        selected: tokenColor('--color-bg-selected'),
        sidebar:  tokenColor('--color-bg-sidebar'),
        header:   tokenColor('--color-bg-header'),

        ink:         tokenColor('--color-text'),
        'ink-muted': tokenColor('--color-text-muted'),
        'ink-faint': tokenColor('--color-text-faint'),

        rule:         tokenColor('--color-border'),
        'rule-light': tokenColor('--color-border-light'),
        divider:      tokenColor('--color-divider'),

        // Semantic status colors are theme-flipped HEX vars, so Tailwind's
        // rgb(var()/<alpha-value>) trick can't apply. Function colors route
        // opacity modifiers (bg-danger/10, border-warning/30…) through
        // color-mix instead — same floor the repo already accepted for
        // bg-selected (Chrome 111 / Safari 16.2 / FF 113). Without this the
        // /NN variants silently emit NOTHING.
        success: tokenColor('--color-success'),
        warning: tokenColor('--color-warning'),
        danger:  tokenColor('--color-danger'),
        info:    tokenColor('--color-info'),

        overlay: 'var(--color-overlay)',
      },
      boxShadow: {
        'xs': '0 1px 2px 0 rgb(0 0 0 / 0.03)',
        'card': '0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'elevated': '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
        'modal': '0 20px 25px -5px rgb(0 0 0 / 0.08), 0 8px 10px -6px rgb(0 0 0 / 0.08)',
      },
      borderRadius: {
        'xl': '0.75rem',
        '2xl': '1rem',
      },
    },
  },
  plugins: [],
}
