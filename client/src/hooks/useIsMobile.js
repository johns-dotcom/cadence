import { useState, useEffect } from 'react'

// Shared responsive breakpoint hook. Defaults to the phone breakpoint the
// mobile card-list branches key on (<768px). Pass a custom media query for
// other breakpoints (e.g. '(max-width: 1023px)' for the sidebar collapse).
export default function useIsMobile(query = '(max-width: 767px)') {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}
