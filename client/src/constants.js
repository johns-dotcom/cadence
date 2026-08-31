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

export const PRIORITIES = ['High', 'Medium', 'Low']

// Release prep checklist — boolean columns on the releases table, surfaced on
// the release detail page so ops can track delivery readiness.
export const RELEASE_CHECKLIST = [
  { key: 'cover_art_received', label: 'Cover art received' },
  { key: 'audio_uploaded',    label: 'Audio uploaded to distributor' },
  { key: 'pitched_spotify',   label: 'Pitched to Spotify' },
  { key: 'pitched_apple',     label: 'Pitched to Apple Music' },
  { key: 'pitched_amazon',    label: 'Pitched to Amazon Music' },
  { key: 'pitched_pandora',   label: 'Pitched to Pandora' },
  { key: 'marketing_plan',    label: 'Marketing plan done' },
  { key: 'content_ready',     label: 'Content ready' },
  { key: 'youtube_video',     label: 'YouTube video ready' },
  { key: 'official_thread',   label: 'Official thread created' },
  { key: 'dsp_email_sent',    label: 'DSP email sent' },
  { key: 'lyrics_submitted',  label: 'Lyrics submitted' },
  { key: 'musixmatch',        label: 'Musixmatch synced' },
  { key: 'recoup_setup',      label: 'Recoupment set up' },
]

// The same 14 checklist items grouped by workstream, for the release tracker's
// grouped view with per-group completion. Every RELEASE_CHECKLIST key appears
// in exactly one group.
export const RELEASE_CHECKLIST_GROUPS = [
  { name: 'Content', keys: ['cover_art_received', 'content_ready', 'marketing_plan', 'youtube_video', 'official_thread'] },
  { name: 'Distribution', keys: ['audio_uploaded', 'recoup_setup'] },
  { name: 'Pitching', keys: ['pitched_spotify', 'pitched_apple', 'pitched_amazon', 'pitched_pandora', 'dsp_email_sent', 'lyrics_submitted', 'musixmatch'] },
]

// A&R deal pipeline stages, in funnel order.
export const DEAL_STAGES = ['Scouting', 'Meeting', 'Offer', 'Negotiation', 'Signed', 'Passed']

export const DEAL_TYPES = ['Single', 'EP', 'Album', 'Multi-release', 'Distribution', 'Licensing']

export const CONTRACT_TYPES = ['Recording', 'Distribution', 'Publishing', 'Management', 'Licensing', 'Producer']

export const CONTRACT_STATUSES = ['Active', 'Pending', 'Expired', 'Terminated']

export const TASK_STATUSES = ['To Do', 'In Progress', 'Done']

// ── Bookkeeping ──────────────────────────────────────────────────────────
// Categories are now DATA — a per-label `categories` table seeded from these
// lists (server/lib/seedCategories.js). These constants are the seed and the
// offline fallback for pickers (hooks/useCategories.js); order matters (the
// review deck's 1-9 hotkeys index the rendered list, and Royalties /
// Reimbursements sit between Salary and Advance by design).
export const EXPENSE_CATEGORIES = [
  'Recording', 'Mixing & Mastering', 'Music Video', 'Marketing', 'PR',
  'Sync/Licensing', 'Distribution', 'Design', 'Production', 'Legal',
  'Services', 'Merch', 'Tour/Live',
  'Travel', 'Meals & Entertainment', 'Software / Subscriptions', 'Bank Fees',
  'Salary', 'Royalties', 'Reimbursements',
  'Advance', 'Other',
]

// Income types (artist_income.source vocabulary). Reimbursements sits between
// Drawdown Fund and Refund by design.
export const INCOME_TYPES = [
  'Streaming / Distribution', 'Sync Licensing', 'Publishing', 'Merch',
  'Performance', 'Drawdown Fund', 'Reimbursements', 'Refund', 'Other Income',
]

export const PAYMENT_METHODS = ['ACH', 'Check', 'Wire', 'Credit Card', 'PayPal', 'Cash']

// Ledger entry workflow status.
export const LEDGER_STATUSES = ['pending', 'approved', 'rejected']

export const PAYMENT_STATUSES = ['Unpaid', 'Paid']

export const PAYMENT_TERMS = ['Due on receipt', 'Net 7', 'Net 14', 'Net 30', 'Net 45', 'Net 60', 'Net 90']

// DSP platforms tracked per release, and the submission lifecycle states.
export const DSP_PLATFORMS = [
  'Spotify', 'Apple Music', 'Amazon Music', 'YouTube Music',
  'TIDAL', 'Deezer', 'Pandora', 'iHeartRadio', 'Audiomack',
]
export const DSP_STATUSES = ['Not Submitted', 'Submitted', 'Approved', 'Live', 'Rejected']

// Artist development-log entry kinds (A&R timeline).
export const DEV_LOG_TYPES = ['Note', 'Meeting', 'Demo', 'Offer', 'Call', 'Feedback', 'Milestone']
