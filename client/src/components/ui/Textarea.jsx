import { forwardRef } from 'react'

const BASE = 'w-full text-sm px-3 py-2.5 bg-card text-ink border border-rule rounded-lg transition-colors placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-50 disabled:cursor-not-allowed resize-y'

const Textarea = forwardRef(function Textarea({ className = '', rows = 4, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={`${BASE} ${className}`} {...rest} />
})

export default Textarea
