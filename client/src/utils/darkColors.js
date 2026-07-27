// JS mirror of styles/tokens.css for inline-styled surfaces (dense finance
// tables, Recharts) that can't use Tailwind classes. Keep this in sync with
// tokens.css — when a token changes, change it in BOTH places, or
// className-styled (bg-card/text-ink) and inline-styled pages drift.
//
// CALL INSIDE COMPONENTS — never at module scope. A module-level call freezes
// the theme at import time and won't repaint on light/dark toggle.
//
//   const C = getDarkColors(theme)   // theme from useTheme(); or omit to sniff the DOM

export default function getDarkColors(themeOverride) {
  const isDark = themeOverride === 'dark'
    || (!themeOverride && typeof document !== 'undefined' && document.documentElement.classList.contains('dark'))

  // Brand is per-tenant (set at runtime via utils/branding.js). Read the live
  // --color-brand-600 triplet so charts pick up the workspace accent.
  let brand = '#4F46E5'
  if (typeof document !== 'undefined') {
    const t = getComputedStyle(document.documentElement).getPropertyValue('--color-brand-600').trim()
    if (t) brand = `rgb(${t})`
  }

  const common = {
    brand,
    success: isDark ? '#34d399' : '#059669',
    warning: isDark ? '#fbbf24' : '#d97706',
    danger:  isDark ? '#fca5a5' : '#dc2626',
    info:    isDark ? '#60a5fa' : '#2563eb',
  }

  return isDark ? {
    ...common, isDark: true,
    pageBg: '#131520', cardBg: '#1c1f2b', elevBg: '#232734',
    border: '#2e3340', borderLight: '#1f222c', divider: '#1f222c',
    text: '#e0e2e8', textMuted: '#8a8f9f', textFaint: '#555b6e',
    thBg: '#161824', thText: '#6b7085', thBorder: '#1f222c', tdBorder: '#1f222c',
    rowBg: '#1c1f2b', rowHover: '#232734',
    inputBg: '#232734', inputText: '#e0e2e8', inputBorder: '#2e3340',
    sidebarBg: '#161824', headerBg: '#131520',
    overlayBg: 'rgba(0,0,0,0.6)', shadow: '0 8px 32px rgba(0,0,0,.4)',
    badgeYesBg: 'rgba(16,185,129,.12)', badgeYesText: '#6ee7b7',
    badgeNoBg: 'rgba(239,68,68,.1)', badgeNoText: '#fca5a5',
    badgeNeutralBg: '#1f222c', badgeNeutralText: '#8a8f9f',
  } : {
    ...common, isDark: false,
    pageBg: '#f4f4f5', cardBg: '#ffffff', elevBg: '#fafafa',
    border: '#e4e4e7', borderLight: '#f3f4f6', divider: '#f3f4f6',
    text: '#18181b', textMuted: '#71717a', textFaint: '#a1a1aa',
    thBg: '#fafafa', thText: '#a1a1aa', thBorder: '#e4e4e7', tdBorder: '#f3f4f6',
    rowBg: '#ffffff', rowHover: '#fafafa',
    inputBg: '#ffffff', inputText: '#18181b', inputBorder: '#e4e4e7',
    sidebarBg: '#ffffff', headerBg: '#ffffff',
    overlayBg: 'rgba(24,24,27,0.5)', shadow: '0 8px 32px rgba(0,0,0,.12)',
    badgeYesBg: '#d1fae5', badgeYesText: '#065f46',
    badgeNoBg: '#fee2e2', badgeNoText: '#991b1b',
    badgeNeutralBg: '#f3f4f6', badgeNeutralText: '#6b7280',
  }
}
