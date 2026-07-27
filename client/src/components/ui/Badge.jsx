// Status pill. Tones use translucent tints + theme-aware semantic text colors
// (var-backed), so intensity reads correctly on both light and dark surfaces.
const TONES = {
  success: 'bg-[rgba(16,185,129,0.12)] text-success',
  warning: 'bg-[rgba(245,158,11,0.12)] text-warning',
  danger:  'bg-[rgba(239,68,68,0.10)] text-danger',
  info:    'bg-[rgba(59,130,246,0.10)] text-info',
  neutral: 'bg-gray-100 text-ink-muted',
}

export default function Badge({ tone = 'neutral', className = '', children }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${TONES[tone] ?? TONES.neutral} ${className}`}>
      {children}
    </span>
  )
}
