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

// Release priority. 'Standard' is the DB default and the neutral state — it
// renders no badge, which is why the badge rule below is "set AND not Standard"
// rather than "set". Ordered most- to least-urgent for the pickers.
export const PRIORITIES = ['High', 'Medium', 'Low']
export const PRIORITY_TONES = { High: 'danger', Medium: 'warning', Low: 'info' }

// Genres offered on the release + catalog filters. Data-derived values are
// merged in on top of these so a workspace's own spellings still appear.
export const GENRE_OPTIONS = [
  'Hip-Hop', 'R&B', 'Pop', 'Rock', 'Alt', 'Electronic', 'EDM', 'Latin', 'Country', 'Jazz',
]

// Genre → chip tint for the roster cards. A grid of 60 artists is only
// scannable by genre if genre is a colour, not a word in the same gray as
// everything else. Tints are translucent (`/15`) so they read on both themes —
// the solid `-100` fills go near-white in dark and take their text with them.
// `genreTone()` falls back to a partial match ("Alt Hip-Hop" → Hip-Hop) and
// then to neutral, so a workspace's own spellings still get colour.
export const GENRE_COLORS = {
  'Hip-Hop': 'bg-violet-500/15 text-violet-600',
  'Rap': 'bg-violet-500/15 text-violet-600',
  'R&B': 'bg-pink-500/15 text-pink-600',
  'Soul': 'bg-pink-500/15 text-pink-600',
  'Pop': 'bg-sky-500/15 text-sky-600',
  'Rock': 'bg-red-500/15 text-red-600',
  'Metal': 'bg-red-500/15 text-red-600',
  'Punk': 'bg-red-500/15 text-red-600',
  'Alt': 'bg-orange-500/15 text-orange-600',
  'Indie': 'bg-orange-500/15 text-orange-600',
  'Electronic': 'bg-cyan-500/15 text-cyan-600',
  'EDM': 'bg-cyan-500/15 text-cyan-600',
  'House': 'bg-cyan-500/15 text-cyan-600',
  'Techno': 'bg-cyan-500/15 text-cyan-600',
  'Drum & Bass': 'bg-cyan-500/15 text-cyan-600',
  'Latin': 'bg-amber-500/15 text-amber-600',
  'Reggaeton': 'bg-amber-500/15 text-amber-600',
  'Afrobeats': 'bg-amber-500/15 text-amber-600',
  'Country': 'bg-yellow-500/15 text-yellow-600',
  'Folk': 'bg-yellow-500/15 text-yellow-600',
  'Jazz': 'bg-indigo-500/15 text-indigo-600',
  'Blues': 'bg-indigo-500/15 text-indigo-600',
  'Classical': 'bg-indigo-500/15 text-indigo-600',
  'Reggae': 'bg-emerald-500/15 text-emerald-600',
  'Dancehall': 'bg-emerald-500/15 text-emerald-600',
  'Gospel': 'bg-teal-500/15 text-teal-600',
  'Christian': 'bg-teal-500/15 text-teal-600',
  'World': 'bg-lime-500/15 text-lime-600',
  'Funk': 'bg-fuchsia-500/15 text-fuchsia-600',
  'Disco': 'bg-fuchsia-500/15 text-fuchsia-600',
  'Soundtrack': 'bg-slate-500/15 text-slate-600',
  'Instrumental': 'bg-slate-500/15 text-slate-600',
  'Experimental': 'bg-purple-500/15 text-purple-600',
  'Ambient': 'bg-blue-500/15 text-blue-600',
  'Lo-fi': 'bg-blue-500/15 text-blue-600',
  'Trap': 'bg-rose-500/15 text-rose-600',
}
const GENRE_KEYS = Object.keys(GENRE_COLORS)
export function genreTone(genre) {
  if (!genre) return null
  if (GENRE_COLORS[genre]) return GENRE_COLORS[genre]
  const g = String(genre).toLowerCase()
  const hit = GENRE_KEYS.find(k => g.includes(k.toLowerCase()) || k.toLowerCase().includes(g))
  return hit ? GENRE_COLORS[hit] : 'bg-gray-100 text-ink-muted'
}

// Manual calendar-event kinds. `manual` is the untyped default so old rows and
// the plain "add an event" path keep working.
export const CALENDAR_EVENT_TYPES = ['manual', 'meeting', 'deadline', 'travel', 'other']

// Release budget line-item categories. Deliberately NOT the expense-ledger
// categories: a release budget is planned spend by production workstream,
// while the ledger's list is an accounting chart. Order is the display order.
export const BUDGET_CATEGORIES = [
  'Music Video', 'Marketing', 'Artwork', 'Mixing/Mastering',
  'Distribution', 'Promotion', 'Studio', 'Advance', 'Other',
]

export const COVER_ART_STATUSES = ['Pending', 'In Progress', 'Approved', 'Final']

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

// What KIND OF AGREEMENT is on the table. Deliberately NOT the release
// vocabulary (Single/EP/Album) this field used to carry — a deal is a contract
// shape, not a format, so the old list could never answer the question anyone
// asks of a pipeline. Mirrored in server/lib/constants.js, which validates it.
export const DEAL_TYPES = ['360 Deal', 'Master License', 'Single License', 'Distribution', 'Publishing', 'Other']

// Where a bulk-deal deliverable was posted. Matches SocialHandlesEditor's list
// so a handle and the post it produced speak the same vocabulary.
export const DELIVERABLE_PLATFORMS = ['TikTok', 'Instagram', 'YouTube', 'X', 'Snapchat', 'Twitch', 'Other']

// Boom order (Recording, Publishing, Distribution, Management, Licensing);
// 'Producer' is a Cadence-era addition kept last so existing rows stay valid.
export const CONTRACT_TYPES = ['Recording', 'Publishing', 'Distribution', 'Management', 'Licensing', 'Producer']

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
  'TIDAL', 'Pandora', 'Deezer', 'iHeartRadio', 'Audiomack',
]
export const DSP_STATUSES = ['Not Submitted', 'Submitted', 'Approved', 'Live', 'Rejected']

// Artist development-log entry kinds (A&R timeline).
export const DEV_LOG_TYPES = ['Note', 'Meeting', 'Demo', 'Offer', 'Call', 'Feedback', 'Milestone']
