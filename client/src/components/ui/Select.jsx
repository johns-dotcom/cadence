import { forwardRef } from 'react'

// Native select with a custom caret drawn via background-image so it matches
// our surfaces in dark mode (the OS caret clashes with dark backgrounds).
const CARET = "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%226%22 viewBox=%220 0 10 6%22 fill=%22none%22><path d=%22M1 1L5 5L9 1%22 stroke=%22currentColor%22 stroke-width=%221.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/></svg>')] bg-no-repeat bg-[right_0.75rem_center]"
const BASE = `w-full text-sm pl-3 pr-8 py-2.5 bg-card text-ink border border-rule rounded-lg transition-colors appearance-none focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-50 disabled:cursor-not-allowed ${CARET}`

const Select = forwardRef(function Select({ className = '', children, ...rest }, ref) {
  return <select ref={ref} className={`${BASE} ${className}`} {...rest}>{children}</select>
})

export default Select
