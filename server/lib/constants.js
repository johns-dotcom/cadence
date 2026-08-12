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

const DSP_PLATFORMS = [
  'Spotify', 'Apple Music', 'Amazon Music', 'YouTube Music',
  'TIDAL', 'Deezer', 'Pandora', 'iHeartRadio', 'Audiomack',
];

const DSP_STATUSES = ['Not Submitted', 'Submitted', 'Approved', 'Live', 'Rejected'];

const DEV_LOG_TYPES = ['Note', 'Meeting', 'Demo', 'Offer', 'Call', 'Feedback', 'Milestone'];

const TASK_STATUSES = ['To Do', 'In Progress', 'Done'];

const PRIORITIES = ['High', 'Medium', 'Low'];

// A member's department is a PERMISSION BOUNDARY, not just a label: Team Work
// scopes an Approver to their own department (see routes/tasks.js teamFilter),
// so an unvalidated typo would create a one-person department nobody can lead
// out of. Validated on POST/PATCH /api/team.
const DEPARTMENTS = ['Executive', 'A&R', 'Marketing', 'Operations', 'Finance', 'Legal'];

module.exports = {
  ROLES, CURRENCIES, RELEASE_TYPES, RELEASE_STATUSES, DSP_PLATFORMS, DSP_STATUSES,
  DEV_LOG_TYPES, TASK_STATUSES, PRIORITIES, DEPARTMENTS,
};
