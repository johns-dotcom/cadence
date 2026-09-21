import { Bell, ShieldCheck, Sun, User } from 'lucide-react'

// The shape of the CONSOLE Settings page — the operator-side mirror of
// lib/settingsSections.js. Module scope for the same reason: one list is the
// single answer to "what panels exist", so the rail, the `?tab=` validation and
// the fixture cannot drift into a rail button that opens an empty page.
//
// ── The split ──
// "My account" changes what YOU (this operator) see. "Platform" changes who can
// administer the platform — it changes things for OTHER operators, so it is
// owner-only, the same blast-radius rule the tenant shell draws.
//
// ── Why Announcements is NOT here ──
// It reads like settings, but it is a restrictable OPERATIONAL surface: an owner
// can hide it from a given operator (RESTRICTABLE_PAGES), so it belongs beside
// Workspaces/Calendar/Activity as a working page, not folded into Settings where
// that per-operator gate would have nowhere to live. It stays its own nav item.
export function buildConsoleSettingsSections(isOwner) {
  return [
    {
      half: 'My account',
      items: [
        { key: 'profile', label: 'Profile & sign-in', icon: User },
        { key: 'notifications', label: 'Notifications', icon: Bell },
        { key: 'appearance', label: 'Appearance', icon: Sun },
      ],
    },
    ...(isOwner ? [{
      half: 'Platform',
      items: [
        { key: 'operators', label: 'Operators', icon: ShieldCheck },
      ],
    }] : []),
  ]
}

// Old links keep working. The console used to route /account and /operators as
// their own pages; both now live as Settings tabs, and those URLs redirect here.
export const LEGACY_CONSOLE_TABS = {
  account: 'profile',
  signin: 'profile',
  operators: 'operators',
}
