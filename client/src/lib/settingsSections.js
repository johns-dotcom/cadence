import {
  Building2, Database, KeyRound, Mail, Palette, PanelLeft, ShieldCheck, Sun, User, Users,
} from 'lucide-react'

// The shape of the Settings page: two halves, and what lives in each.
//
// Module scope rather than inline in the component so that one list is the
// single answer to "what panels exist" — the rail renders from it, the
// `?tab=` validation resolves against it, and settings-fixture cross-checks it
// against the panels actually implemented in Settings.jsx. When those two
// drift, a rail button renders an empty page, which is exactly the failure
// nothing else here would catch.
//
// ── The split ──
// "My settings" changes what YOU see. "Label settings" changes what EVERYBODY
// sees. That is the only rule; when a new panel is ambiguous, ask whether a
// colleague would notice the change.
export function buildSettingsSections(isAdmin) {
  return [
    {
      half: 'My settings',
      items: [
        { key: 'profile', label: 'Profile', icon: User },
        { key: 'signin', label: 'Sign-in', icon: KeyRound },
        { key: 'appearance', label: 'Appearance', icon: Sun },
        { key: 'nav', label: 'My navigation', icon: PanelLeft },
      ],
    },
    ...(isAdmin ? [{
      half: 'Label settings',
      items: [
        { key: 'people', label: 'People', icon: Users },
        { key: 'roles', label: 'Roles & access', icon: ShieldCheck },
        { key: 'label', label: 'Label record', icon: Building2 },
        { key: 'branding', label: 'Identity & branding', icon: Palette },
        { key: 'email', label: 'Email & forms', icon: Mail },
        { key: 'data', label: 'Data', icon: Database },
      ],
    }] : []),
  ]
}

// Panels only an admin has. Used by the fixture to know which `tab === '…'`
// branches are expected to carry an `isAdmin` guard.
export const ADMIN_TABS = buildSettingsSections(true)
  .filter(s => s.half === 'Label settings')
  .flatMap(s => s.items.map(i => i.key))

/** Every panel key, both halves. */
export const ALL_SETTINGS_TABS = buildSettingsSections(true).flatMap(s => s.items.map(i => i.key))

// The tab keys from before the two-halves split. Bookmarks, Slack links and
// this app's own cross-links still carry them, so they are mapped rather than
// dropped — landing somebody on Profile would read as a broken link.
export const LEGACY_TABS = {
  account: 'profile',
  workspace: 'branding',
  finance: 'email',
  team: 'people',
}

/** The panel a `?tab=` value resolves to, or null if it names nothing. */
export function resolveSettingsTab(raw) {
  if (!raw) return null
  const key = LEGACY_TABS[raw] || raw
  return ALL_SETTINGS_TABS.includes(key) ? key : null
}
