// The notification-preference vocabulary — one definition shared by the bell
// and the Settings panel, so the two editors of the same server-backed prefs
// can never offer different toggles.
export const PREF_KEY = 'cadence_notif_prefs' // fast-paint cache only; server is authoritative
export const PREF_DEFAULTS = { smart: true, tasks: true, releases: true, contracts: true, vendor: true, budget: true, reminders: true }
export const PREF_LABELS = {
  smart: 'Smart alerts',
  tasks: 'Your tasks',
  releases: 'Upcoming releases',
  contracts: 'Expiring contracts',
  vendor: 'Vendor submissions & approvals',
  budget: 'Budget alerts',
  reminders: 'Reminders',
}
export const PREF_HELP = {
  smart: 'Computed alerts about work that needs a decision.',
  tasks: 'Your assigned tasks as they come due.',
  releases: 'Releases landing in the next two weeks.',
  contracts: 'Contracts approaching their expiry.',
  vendor: 'New vendor submissions and approval outcomes.',
  budget: 'When an artist budget crosses its threshold.',
  reminders: 'Statement and custom reminders when they fall due.',
}
