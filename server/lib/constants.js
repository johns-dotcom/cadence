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

// Order matches boom's tracker (TIDAL → Pandora → Deezer). 'iHeartRadio' keeps
// the brand's own one-word spelling rather than boom's 'iHeart Radio'; renaming
// it would orphan every existing dsp_submissions row for no gain.
const DSP_PLATFORMS = [
  'Spotify', 'Apple Music', 'Amazon Music', 'YouTube Music',
  'TIDAL', 'Pandora', 'Deezer', 'iHeartRadio', 'Audiomack',
];

const DSP_STATUSES = ['Not Submitted', 'Submitted', 'Approved', 'Live', 'Rejected'];

const DEV_LOG_TYPES = ['Note', 'Meeting', 'Demo', 'Offer', 'Call', 'Feedback', 'Milestone'];

const TASK_STATUSES = ['To Do', 'In Progress', 'Done'];

const PRIORITIES = ['High', 'Medium', 'Low'];

// Tasks carry their own priority vocabulary. 'Urgent' exists on tasks and NOT on
// releases or deals: a release is either a priority record or it isn't, whereas a
// task queue needs a level above High to triage a day by. Kept as its own list so
// adding it here can't leak an 'Urgent' option into the release/deal pickers, which
// validate against PRIORITIES. Ordered most- to least-urgent (the rank index).
const TASK_PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];

// The 14 release-prep checklist booleans, in display order. Shared so anything
// computing a completion % (releases.js patch allow-list, team velocity/workload,
// the member detail page) counts the same denominator.
const RELEASE_CHECKLIST_COLUMNS = [
  'cover_art_received', 'audio_uploaded', 'pitched_spotify', 'pitched_apple',
  'marketing_plan', 'content_ready', 'dsp_email_sent', 'lyrics_submitted',
  'pitched_amazon', 'pitched_pandora', 'youtube_video', 'official_thread',
  'musixmatch', 'recoup_setup',
];

// A member's department is a PERMISSION BOUNDARY, not just a label: Team Work
// scopes an Approver to their own department (see routes/tasks.js teamFilter),
// so an unvalidated typo would create a one-person department nobody can lead
// out of. Validated on POST/PATCH /api/team.
const DEPARTMENTS = ['Executive', 'A&R', 'Marketing', 'Operations', 'Finance', 'Legal'];

// Deal pipeline. Stages are ordered — the card's one-click advance and the
// board's column order both index this array, so reordering it reorders the
// funnel.
const DEAL_STAGES = ['Scouting', 'Meeting', 'Offer', 'Negotiation', 'Signed', 'Passed'];

// What KIND OF AGREEMENT is on the table. This is deliberately not the release
// vocabulary (Single/EP/Album) — a deal is a contract shape, not a format, and
// the pipeline used to offer release types here, which meant the field could
// never answer the question anyone asks of it.
const DEAL_TYPES = ['360 Deal', 'Master License', 'Single License', 'Distribution', 'Publishing', 'Other'];

module.exports = {
  ROLES, CURRENCIES, RELEASE_TYPES, RELEASE_STATUSES, DSP_PLATFORMS, DSP_STATUSES,
  DEV_LOG_TYPES, TASK_STATUSES, PRIORITIES, TASK_PRIORITIES, DEPARTMENTS,
  DEAL_STAGES, DEAL_TYPES, RELEASE_CHECKLIST_COLUMNS,
};
