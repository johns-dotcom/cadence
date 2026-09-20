import { ALL_PAGES, PAGE_LABEL } from '../constants/pages'

// Page presets, keyed to the departments a workspace actually has.
//
// The change that matters here is that presets are ADDITIVE. The old dropdown
// replaced the whole grant set, so a person who needed A&R plus a look at
// Marketing had to be built by hand every time — and picking a second preset
// silently threw the first away, which looks identical to a mis-click until
// someone notices a page is gone. Ticking two now unions them; Clear is the
// only thing that removes.
//
// `/` and `/my-work` are in every preset because a grant set without them is a
// person who signs in to a dashboard they cannot open. They are not a preset's
// opinion, they are the floor.
const BASE = ['/', '/my-work']
const P = (...paths) => [...BASE, ...paths]

// `department` links a preset to the department that seeds it on a new account.
// It is a default tick, not a rule: an admin unticks it like any other.
// A department with no preset (or a custom one a workspace added) simply seeds
// nothing, which is the honest behaviour — better than guessing a page set for
// a department this app has never heard of.
export const NAV_PRESETS = [
  {
    id: 'executive',
    name: 'Executive',
    department: 'Executive',
    note: 'The read-across: money, roster, releases and contracts. No data entry.',
    pages: P('/calendar', '/financials', '/reports', '/recoupments', '/artists',
      '/releases', '/catalog', '/deals', '/contracts', '/team'),
  },
  {
    id: 'anr',
    name: 'A&R',
    department: 'A&R',
    note: 'Signing and the pipeline behind it.',
    pages: P('/calendar', '/deals', '/artists', '/releases', '/contracts', '/pending-contracts'),
  },
  {
    id: 'marketing',
    name: 'Marketing',
    department: 'Marketing',
    note: 'Campaigns, roster and releases — no financial pages.',
    pages: P('/calendar', '/marketing', '/artists', '/releases', '/catalog', '/deals'),
  },
  {
    id: 'ops',
    name: 'Operations',
    department: 'Operations',
    note: 'Release delivery and the catalog behind it, plus the data-quality hub.',
    pages: P('/calendar', '/releases', '/catalog', '/artists', '/data-quality', '/vendors'),
  },
  {
    id: 'bookkeeper',
    name: 'Bookkeeping / AP',
    department: 'Finance',
    note: 'Day-to-day money in and out. The widest of the finance sets.',
    pages: P('/calendar', '/ledger', '/invoice-search', '/bulk-upload', '/payments',
      '/vendors', '/invoices', '/recoupments', '/financials', '/reports'),
  },
  {
    id: 'finance-exec',
    name: 'Finance exec',
    note: 'Reading the numbers without the entry surfaces. Includes Salary.',
    pages: P('/financials', '/reports', '/recoupments', '/payments', '/ledger', '/salary'),
  },
  {
    id: 'legal',
    name: 'Legal',
    department: 'Legal',
    note: 'The paperwork lifecycle, tracked and generated.',
    pages: P('/contracts', '/pending-contracts', '/renewals', '/legal',
      '/create-nda', '/label-waivers', '/clearances'),
  },
]

/** Everything, as a preset. Kept separate: it is a shortcut, not a job. */
export const FULL_ACCESS = { id: 'full', name: 'Full access', pages: ALL_PAGES }

export const presetById = (id) =>
  id === FULL_ACCESS.id ? FULL_ACCESS : NAV_PRESETS.find(p => p.id === id) || null

/**
 * Adds a preset's pages to what is already granted. Never removes.
 * Returns a new Set so callers can compare identity to detect a no-op.
 */
export function addPreset(current, presetId) {
  const preset = presetById(presetId)
  if (!preset) return current
  const next = new Set(current)
  for (const p of preset.pages) next.add(p)
  return next
}

/**
 * How much of a preset a grant set already covers.
 *
 * Drives the tick state, and the distinction matters: a preset showing as
 * "on" when only its two floor pages are granted would be a lie, and one
 * showing "off" when every page but one is granted hides how close it is.
 */
export function presetCoverage(current, presetId) {
  const preset = presetById(presetId)
  if (!preset) return { state: 'none', have: 0, total: 0 }
  const have = preset.pages.filter(p => current.has(p)).length
  const total = preset.pages.length
  if (have === total) return { state: 'full', have, total }
  // The floor alone is not partial coverage of anything — every grant set has
  // it, so counting it would light up every preset on an empty selection.
  const beyondFloor = preset.pages.some(p => !BASE.includes(p) && current.has(p))
  return { state: beyondFloor ? 'partial' : 'none', have, total }
}

/** The preset a new account in this department should start with, or null. */
export function presetForDepartment(department) {
  if (!department) return null
  return NAV_PRESETS.find(p => p.department === department) || null
}

/** Pages a preset would add that aren't granted yet — for "adds 6 pages". */
export function pagesAddedBy(current, presetId) {
  const preset = presetById(presetId)
  if (!preset) return []
  return preset.pages.filter(p => !current.has(p))
}

/** Human labels for a page list, for showing what a preset is about to add. */
export const labelsFor = (paths) => paths.map(p => PAGE_LABEL[p] || p)
