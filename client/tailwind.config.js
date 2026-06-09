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
        // Brand palette (indigo). Used throughout the UI — change here to
        // re-skin the whole app.
        brand: {
          DEFAULT: '#4F46E5',
          50:  '#EEF2FF',
          100: '#E0E7FF',
          200: '#C7D2FE',
          300: '#A5B4FC',
          400: '#818CF8',
          500: '#6366F1',
          600: '#4F46E5',
          700: '#4338CA',
          800: '#3730A3',
          900: '#312E81',
          950: '#1E1B4B',
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
        page:    'var(--color-bg-page)',
        card:    'var(--color-bg-card)',
        elev:    'var(--color-bg-elev)',
        sidebar: 'var(--color-bg-sidebar)',
        header:  'var(--color-bg-header)',

        ink:         'var(--color-text)',
        'ink-muted': 'var(--color-text-muted)',
        'ink-faint': 'var(--color-text-faint)',

        rule:         'var(--color-border)',
        'rule-light': 'var(--color-border-light)',
        divider:      'var(--color-divider)',

        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        danger:  'var(--color-danger)',
        info:    'var(--color-info)',

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
