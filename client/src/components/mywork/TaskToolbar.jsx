// The view bar: view switcher · group-by · sort · filters · columns · saved views.
//
// On phones the two popovers become BottomSheets — a column picker anchored to the
// bottom of a 390px viewport is unreachable.

import { useRef, useState } from 'react'
import {
  ArrowDown, ArrowUp, Calendar as CalendarIcon, Check, ChevronDown, Filter, LayoutGrid,
  List as ListIcon, Plus, Search, SlidersHorizontal, Star, Table as TableIcon, Trash2, Users,
} from 'lucide-react'
import Button from '../ui/Button'
import ConfirmDialog from '../ui/ConfirmDialog'
import Popover from './Popover'
import { TASK_STATUSES, PRIORITIES } from '../../constants'
import {
  categoriesIn, COLS, DUE_FILTERS, GROUP_BYS, SORTS, UNCATEGORIZED,
} from './taskFields'

const VIEW_TYPES = [
  { key: 'board', label: 'Board', icon: LayoutGrid },
  { key: 'table', label: 'Table', icon: TableIcon },
  { key: 'calendar', label: 'Calendar', icon: CalendarIcon },
  { key: 'list', label: 'List', icon: ListIcon },
  { key: 'workload', label: 'Workload', icon: Users, teamOnly: true },
]

function CheckRow({ checked, label, onChange }) {
  return (
    <label className="flex items-center gap-2 py-1 text-sm cursor-pointer">
      <input type="checkbox" checked={checked} onChange={onChange} className="cursor-pointer" />
      <span className="text-ink">{label}</span>
    </label>
  )
}

export default function TaskToolbar({
  surface, isMobile, view, tasks, members, allViews, activeViewId, isDirty, activeFilterCount,
  setType, setGroup, setSort, setFilter, toggleFilterValue, resetFilters, toggleColumn,
  applyView, saveView, deleteView, onAdd, canGroupBy, searchRef,
}) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [colsOpen, setColsOpen] = useState(false)
  const [viewsOpen, setViewsOpen] = useState(false)
  const [saveName, setSaveName] = useState(null)   // null = form closed
  const [pendingDelete, setPendingDelete] = useState(null)
  const saveRef = useRef(null)

  const types = VIEW_TYPES.filter(t => !t.teamOnly || surface === 'team')
  const groups = GROUP_BYS.filter(g => canGroupBy(g))
  const categories = categoriesIn(tasks)
  const f = view.filters

  const openSave = () => {
    const current = allViews.find(v => v.id === activeViewId)
    setSaveName(current && !current.preset ? current.name : '')
    setTimeout(() => saveRef.current?.select(), 0)
  }

  // saveView upserts by case-insensitive name server-side, so an existing name
  // silently REPLACES that view. window.prompt couldn't warn about that; this can.
  const collides = saveName != null && allViews.some(v =>
    !v.preset && v.id !== activeViewId && v.name.toLowerCase() === saveName.trim().toLowerCase())

  const submitSave = (e) => {
    e?.preventDefault()
    if (!saveName?.trim()) return
    saveView(saveName)
    setSaveName(null)
    setViewsOpen(false)
  }

  return (
    <div className="mb-4 space-y-2">
      {/* Row 1 — view switcher + saved views + add */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* bg-page, not bg-gray-100: in dark the active pill (bg-card) was DARKER
            than a gray-100 track, so it read as recessed rather than raised. */}
        <div className="flex items-center gap-0.5 bg-page rounded-xl p-0.5" role="tablist" aria-label="View">
          {types.map(t => {
            const Icon = t.icon
            return (
              <button
                key={t.key}
                onClick={() => setType(t.key)}
                role="tab"
                aria-selected={view.type === t.key}
                aria-label={t.label}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                  view.type === t.key ? 'bg-card text-ink shadow-sm ring-1 ring-rule' : 'text-ink-muted hover:text-ink'
                }`}
              >
                <Icon size={13} aria-hidden="true" /> <span className="hidden sm:inline">{t.label}</span>
              </button>
            )
          })}
        </div>

        <div className="relative">
          <button onClick={() => setViewsOpen(v => !v)} className="btn-secondary !py-1.5 text-xs">
            <Star size={13} />
            <span className="max-w-[8rem] truncate">
              {allViews.find(v => v.id === activeViewId)?.name || 'My views'}
            </span>
            {isDirty && <span className="text-brand-ink" role="img" aria-label="Unsaved changes">•</span>}
            <ChevronDown size={13} />
          </button>
          {/* Clearing saveName here, not in the input's onKeyDown: useEscapeStack
              consumes Escape at document-capture, which pre-empts React's synthetic
              handler — so an onKeyDown on a field inside an overlay never runs. */}
          <Popover open={viewsOpen} onClose={() => { setViewsOpen(false); setSaveName(null) }} title="My views" isMobile={isMobile} align="left">
            <div className="space-y-0.5">
              {allViews.map(v => (
                <div key={v.id} className="flex items-center gap-1 group/v">
                  <button
                    onClick={() => { applyView(v.id); setViewsOpen(false) }}
                    className={`flex-1 flex items-center gap-1.5 text-left text-sm px-2 py-1.5 rounded-lg hover:bg-elev ${
                      activeViewId === v.id ? 'text-brand-ink font-semibold' : 'text-ink'
                    }`}
                  >
                    {activeViewId === v.id ? <Check size={13} /> : <span className="w-[13px]" />}
                    <span className="truncate">{v.name}</span>
                    {v.preset && <span className="text-[10px] text-ink-muted ml-auto">preset</span>}
                  </button>
                  {!v.preset && (
                    <button
                      onClick={() => setPendingDelete(v)}
                      className="text-ink-faint hover:text-danger opacity-0 group-hover/v:opacity-100 focus:opacity-100 px-1 rounded
                                 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                      aria-label={`Delete view ${v.name}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
              <div className="pt-2 mt-1 border-t border-divider">
                {saveName == null ? (
                  <Button variant="secondary" size="sm" className="w-full" onClick={openSave}>
                    Save current view
                  </Button>
                ) : (
                  <form onSubmit={submitSave} className="space-y-1.5">
                    <input
                      ref={saveRef}
                      className="input !py-1.5 text-sm"
                      value={saveName}
                      onChange={e => setSaveName(e.target.value)}
                      placeholder="View name"
                      autoFocus
                    />
                    {collides && (
                      <p className="text-[11px] text-warning">Replaces the existing “{saveName.trim()}” view.</p>
                    )}
                    <div className="flex gap-1.5">
                      <Button type="submit" size="sm" className="flex-1" disabled={!saveName.trim()}>
                        {collides ? 'Replace' : 'Save'}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setSaveName(null)}>Cancel</Button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </Popover>
        </div>

        {/* ml-auto, not an empty flex-1 div: a zero-basis grow item takes the rest
            of the line when the row wraps, producing a blank gutter row on mobile. */}
        <Button size="sm" onClick={onAdd} className="ml-auto"><Plus size={14} /> Add task</Button>
      </div>

      {/* Row 2 — search + group/sort + filters + columns */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[10rem] max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
          <input
            ref={searchRef}
            value={f.q}
            onChange={e => setFilter('q', e.target.value)}
            placeholder="Search tasks…"
            aria-label="Search tasks"
            className="input !pl-8 !py-1.5 text-sm"
          />
        </div>

        {/* aria-label as well as the visible text: below sm the label span is
            display:none, which removes it from the accessible name too — a phone
            user got two bare pills reading "Status" and "Manual". */}
        <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
          <span className="hidden sm:inline">Group</span>
          <select
            value={view.group}
            onChange={e => setGroup(e.target.value)}
            aria-label="Group by"
            className="input w-auto !py-1.5 text-xs"
          >
            {groups.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </label>

        {/* The direction button sits OUTSIDE the label: a <label> wrapping a second
            interactive control made the select's accessible name "Sort ↓" and mutate
            on every toggle. */}
        <div className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
          <label className="inline-flex items-center gap-1.5">
            <span className="hidden sm:inline">Sort</span>
            <select
              value={view.sort.key}
              onChange={e => setSort(e.target.value, view.sort.dir)}
              aria-label="Sort by"
              className="input w-auto !py-1.5 text-xs"
            >
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <button
            onClick={() => setSort(view.sort.key, view.sort.dir === 'asc' ? 'desc' : 'asc')}
            className="p-1.5 rounded-md border border-rule text-ink-muted hover:text-ink
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            aria-label={view.sort.dir === 'asc' ? 'Sorted ascending — switch to descending' : 'Sorted descending — switch to ascending'}
            aria-pressed={view.sort.dir === 'desc'}
          >
            {view.sort.dir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
          </button>
        </div>

        <div className="relative">
          <button onClick={() => setFiltersOpen(v => !v)} className="btn-secondary !py-1.5 text-xs">
            <Filter size={13} /> Filters
            {activeFilterCount > 0 && (
              <span className="ml-0.5 px-1.5 rounded-full bg-brand-500/15 text-brand-ink text-[10px] font-bold">{activeFilterCount}</span>
            )}
          </button>
          <Popover open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters" isMobile={isMobile}>
            <div className="space-y-3">
              <div>
                <p className="label">Due</p>
                <select value={f.due} onChange={e => setFilter('due', e.target.value)} className="input !py-1.5 text-sm">
                  {DUE_FILTERS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
              </div>
              <div>
                <p className="label">Status</p>
                {TASK_STATUSES.map(s => (
                  <CheckRow key={s} label={s} checked={f.status.includes(s)} onChange={() => toggleFilterValue('status', s)} />
                ))}
              </div>
              <div>
                <p className="label">Priority</p>
                {PRIORITIES.map(p => (
                  <CheckRow key={p} label={p} checked={f.priority.includes(p)} onChange={() => toggleFilterValue('priority', p)} />
                ))}
              </div>
              {surface === 'team' && members.length > 0 && (
                <div>
                  <p className="label">Assignee</p>
                  {members.map(m => (
                    <CheckRow key={m.id} label={m.name} checked={f.user_id.includes(m.id)} onChange={() => toggleFilterValue('user_id', m.id)} />
                  ))}
                  {/* Matches the Workload view's unassigned drill-through, which sets
                      user_id: [null] — without this the chip had no visible source. */}
                  <CheckRow label="Unassigned" checked={f.user_id.includes(null)} onChange={() => toggleFilterValue('user_id', null)} />
                </div>
              )}
              {categories.length > 0 && (
                <div>
                  <p className="label">Category</p>
                  {categories.map(c => (
                    <CheckRow key={c} label={c} checked={f.category.includes(c)} onChange={() => toggleFilterValue('category', c)} />
                  ))}
                  <CheckRow label="Uncategorized" checked={f.category.includes(UNCATEGORIZED)} onChange={() => toggleFilterValue('category', UNCATEGORIZED)} />
                </div>
              )}
              <div className="pt-2 border-t border-divider">
                <CheckRow
                  label="Hide Done older than 30 days"
                  checked={!!f.hide_old_done}
                  onChange={() => setFilter('hide_old_done', !f.hide_old_done)}
                />
                <Button variant="ghost" size="sm" className="w-full mt-1" onClick={resetFilters}>Clear all filters</Button>
              </div>
            </div>
          </Popover>
        </div>

        {/* Columns only bite in the desktop Table view: the List view renders the
            task name alone, and below 768px TaskSurface substitutes List FOR Table —
            so on a phone this control used to be visible and completely inert. */}
        {view.type === 'table' && !isMobile && (
          <div className="relative">
            <button onClick={() => setColsOpen(v => !v)} className="btn-secondary !py-1.5 text-xs">
              <SlidersHorizontal size={13} aria-hidden="true" /> <span className="hidden sm:inline">Columns</span>
            </button>
            <Popover open={colsOpen} onClose={() => setColsOpen(false)} title="Columns" isMobile={isMobile}>
              <div>
                {COLS.map(c => (
                  <CheckRow
                    key={c.key}
                    label={c.label}
                    checked={view.columns.includes(c.key)}
                    onChange={() => toggleColumn(c.key)}
                  />
                ))}
              </div>
            </Popover>
          </div>
        )}
      </div>

      {/* Deleting a saved view had no confirmation and no undo, while deleting a
          TASK had a native confirm — the risk policy was inverted. */}
      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => { deleteView(pendingDelete.id); setPendingDelete(null) }}
        title="Delete view"
        message={`“${pendingDelete?.name}” will be removed. Your tasks aren't affected.`}
        confirmLabel="Delete view"
      />
    </div>
  )
}
