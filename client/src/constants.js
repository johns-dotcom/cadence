// Mirrored in server/lib/constants.js — keep in sync. Platform defaults only;
// tenant-specific data lives in the database scoped by label_id.

export const ROLES = ['Superadmin', 'Admin', 'Approver', 'User']

export const ROLE_DESCRIPTIONS = {
  Superadmin: 'Workspace owner — full control, including impersonation and team management.',
  Admin: 'Manage team, contracts, and all operational data.',
  Approver: 'Review and approve, plus full read access. Cannot manage the team.',
  User: 'Day-to-day access, scoped to assigned pages.',
}

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'MXN', 'JPY', 'BRL', 'CHF', 'SEK', 'NOK', 'DKK']

export const RELEASE_TYPES = ['Single', 'EP', 'Album', 'Compilation', 'Mixtape']

export const RELEASE_STATUSES = ['Draft', 'Scheduled', 'Released', 'Archived']

export const DEPARTMENTS = ['Executive', 'A&R', 'Marketing', 'Operations', 'Finance', 'Legal']
