import { forwardRef } from 'react'

// Semantic button on Cadence tokens. Prefer this over the raw .btn-* classes
// in new code. Variants map to brand/surface/danger; sizes to sm/md/lg.
const VARIANTS = {
  primary:   'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800',
  secondary: 'bg-card text-ink border border-rule hover:bg-gray-50',
  ghost:     'bg-transparent text-ink hover:bg-gray-50',
  danger:    'bg-danger text-white hover:opacity-90',
}
const SIZES = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-5 text-base',
}
const BASE = 'inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400'

const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', className = '', type = 'button', children, ...rest }, ref,
) {
  return (
    <button ref={ref} type={type}
      className={`${BASE} ${VARIANTS[variant] ?? VARIANTS.primary} ${SIZES[size] ?? SIZES.md} ${className}`}
      {...rest}>
      {children}
    </button>
  )
})

export default Button
