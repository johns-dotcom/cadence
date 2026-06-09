// Canonical lists used across the API. Mirrored in client/src/constants.js —
// keep the two in sync.
//
// These are platform defaults shared by every tenant. Anything label-specific
// (team member names, custom categories, etc.) belongs in the database scoped
// by label_id — never hardcode a tenant's data here.

const ROLES = ['Superadmin', 'Admin', 'Approver', 'User'];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'MXN', 'JPY', 'BRL', 'CHF', 'SEK', 'NOK', 'DKK'];

const RELEASE_TYPES = ['Single', 'EP', 'Album', 'Compilation', 'Mixtape'];

const RELEASE_STATUSES = ['Draft', 'Scheduled', 'Released', 'Archived'];

module.exports = { ROLES, CURRENCIES, RELEASE_TYPES, RELEASE_STATUSES };
