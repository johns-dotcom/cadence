import { useEffect } from 'react'

// Arm the browser's are-you-sure prompt while a form holds unsaved work.
// Ported from boom-dashboard's hooks/useUnsavedWarning — pass a boolean;
// the listener exists only while it's true, so an untouched or just-saved
// form never blocks navigation.
export default function useUnsavedWarning(dirty) {
  useEffect(() => {
    if (!dirty) return
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
}
