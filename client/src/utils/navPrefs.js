// Per-person sidebar tidying: hide nav items you can see but never use.
//
// This is a PREFERENCE, not a permission — everything hidden here is still
// reachable by URL, by ⌘K search and by every link in the app. Permissions live
// server-side in `user_page_permissions`; nothing in this file may ever be
// mistaken for a security boundary.
//
// Stored in localStorage per user id, so two accounts sharing a laptop don't
// inherit each other's sidebar. `/settings` is never hideable — hiding the page
// that owns the "show all" button would leave no way back.

const EVENT = 'cadence:nav-prefs'
export const NEVER_HIDEABLE = ['/settings']

const keyFor = (userId) => `nav_hidden_pages:${userId || 'anon'}`

export function getHiddenPages(userId) {
  try {
    const raw = localStorage.getItem(keyFor(userId))
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter(p => typeof p === 'string' && !NEVER_HIDEABLE.includes(p)) : []
  } catch { return [] }
}

export function setHiddenPages(userId, paths) {
  const list = [...new Set((paths || []).filter(p => typeof p === 'string' && !NEVER_HIDEABLE.includes(p)))]
  try { localStorage.setItem(keyFor(userId), JSON.stringify(list)) } catch { /* private mode / quota */ }
  // localStorage's own `storage` event only fires in OTHER tabs, so the sidebar
  // in THIS one would keep the stale list until a reload without this.
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { userId, list } }))
  return list
}

// Subscribe to changes from this tab (custom event) and from others (storage).
export function onNavPrefsChange(handler) {
  const local = () => handler()
  const remote = (e) => { if (!e.key || e.key.startsWith('nav_hidden_pages:')) handler() }
  window.addEventListener(EVENT, local)
  window.addEventListener('storage', remote)
  return () => {
    window.removeEventListener(EVENT, local)
    window.removeEventListener('storage', remote)
  }
}
