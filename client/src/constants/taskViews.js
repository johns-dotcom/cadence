// View configs for My Work (/my-work) and Team Work (/team-work).
//
// Built-in presets are CONSTANTS, not seeded database rows — so the "My Views"
// strip works on first load with no writes and no onboarding migration, and an
// empty GET /api/tasks/views is a normal state rather than a bug.
//
// The shape below is owned entirely by the client. The server (POST
// /api/tasks/views) only checks it's a plain object under 4KB, so a new filter
// ships without an API deploy. Unknown keys are ignored on read, and `v` lets a
// future reader fall back per key instead of discarding a saved view wholesale.

import { DEFAULT_COLS, DEFAULT_TEAM_COLS } from '../components/mywork/taskFields'

export const VIEW_VERSION = 1

export const EMPTY_FILTERS = {
  q: '',
  status: [],
  priority: [],
  user_id: [],
  category: [],
  department: [],
  due: 'any',
  release_id: null,
  hide_old_done: true,
}

// `surface` decides which page lists a saved view — a client-side filter over the
// same task_views rows, so there's no second table and the server stays unaware.
// There is deliberately no `scope` key: visibility is derived server-side from
// role + department, so a saved view can never smuggle wider access than the
// viewer currently has.
export function defaultView(surface = 'mine') {
  const team = surface === 'team'
  return {
    v: VIEW_VERSION,
    surface,
    type: team ? 'workload' : 'board',
    group: team ? 'assignee' : 'status',
    sort: { key: 'manual', dir: 'asc' },
    filters: { ...EMPTY_FILTERS },
    columns: team ? [...DEFAULT_TEAM_COLS] : [...DEFAULT_COLS],
  }
}

const preset = (id, name, surface, patch) => ({
  id,
  name,
  preset: true,
  config: {
    ...defaultView(surface),
    ...patch,
    filters: { ...EMPTY_FILTERS, ...(patch.filters || {}) },
  },
})

export const PRESET_VIEWS = [
  preset('preset:today', 'Today', 'mine', {
    type: 'list', group: 'due', sort: { key: 'priority', dir: 'asc' },
    filters: { due: 'today', status: ['To Do', 'In Progress'] },
  }),
  preset('preset:overdue', 'Overdue', 'mine', {
    type: 'list', group: 'priority', sort: { key: 'due_date', dir: 'asc' },
    filters: { due: 'overdue', status: ['To Do', 'In Progress'] },
  }),
  preset('preset:open', 'All open', 'mine', {
    type: 'board', group: 'status',
    filters: { status: ['To Do', 'In Progress'] },
  }),
  preset('preset:team-load', 'Workload', 'team', {
    type: 'workload', group: 'assignee',
  }),
  preset('preset:team-overdue', 'Team overdue', 'team', {
    type: 'table', group: 'assignee', sort: { key: 'due_date', dir: 'asc' },
    filters: { due: 'overdue', status: ['To Do', 'In Progress'] },
  }),
  preset('preset:team-unscheduled', 'No due date', 'team', {
    type: 'table', group: 'assignee',
    filters: { due: 'none', status: ['To Do', 'In Progress'] },
  }),
]

export const presetsFor = (surface) => PRESET_VIEWS.filter(p => p.config.surface === surface)

// Merge a stored config over the surface default so a view saved before a new key
// existed still opens cleanly.
export function hydrateView(config, surface = 'mine') {
  const base = defaultView(surface)
  if (!config || typeof config !== 'object') return base
  return {
    ...base,
    ...config,
    surface,
    sort: { ...base.sort, ...(config.sort || {}) },
    filters: { ...base.filters, ...(config.filters || {}) },
    columns: Array.isArray(config.columns) && config.columns.length ? config.columns : base.columns,
  }
}
