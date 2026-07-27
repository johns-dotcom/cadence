import { forwardRef } from 'react'

const BASE = 'w-full text-sm px-3 py-2.5 bg-card text-ink border border-rule rounded-lg transition-colors placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-50 disabled:cursor-not-allowed'

const Input = forwardRef(function Input({ className = '', type = 'text', ...rest }, ref) {
  return <input ref={ref} type={type} className={`${BASE} ${className}`} {...rest} />
})

export default Input
