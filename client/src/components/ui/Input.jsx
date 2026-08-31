import { forwardRef } from 'react'

const BASE = 'w-full h-9 text-sm px-3 py-2 bg-card text-ink border border-rule rounded-lg transition-all duration-150 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-500 disabled:opacity-50 disabled:cursor-not-allowed'

const Input = forwardRef(function Input({ className = '', type = 'text', ...rest }, ref) {
  return <input ref={ref} type={type} className={`${BASE} ${className}`} {...rest} />
})

export default Input
