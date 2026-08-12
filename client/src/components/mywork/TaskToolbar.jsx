// The view bar: view switcher · group-by · sort · filters · columns · saved views.
//
// On phones the two popovers become BottomSheets — a column picker anchored to the
// bottom of a 390px viewport is unreachable.

import { useState } from 'react'
import {
  Calendar as CalendarIcon, Check, ChevronDown, Filter, LayoutGrid,
  List as ListIcon, Plus, Search, SlidersHorizontal, Star, Table as TableIcon, Trash2, Users,
} from 'lucide-react'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'
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

// Small popover that degrades to a BottomSheet on mobile.
function Popover({ open, onClose, title, isMobile, children, align = 'right' }) {
  if (!open) return null
  if (isMobile) {
    return <BottomSheet open={open} onClose={onClose} title={title}>{children}</BottomSheet>
  }
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className={`absolute top-full mt-1 ${align === 'right' ? 'right-0' : 'left-0'} z-40 w-64 card p-3 shadow-modal max-h-[70vh] overflow-y-auto`}>
        {children}
      </div>
    </>
  )
}

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

  const types = VIEW_TYPES.filter(t => !t.teamOnly || surface === 'team')
  const groups = GROUP_BYS.filter(g => canGroupBy(g))
  const categories = categoriesIn(tasks)
  const f = view.filters

  const promptSave = () => {
    const current = allViews.find(v => v.id === activeViewId)
    const name = window.prompt('Save this view as…', current && !current.preset ? current.name : '')
    if (name) saveView(name)
  }

  return (
    <div className="mb-4 space-y-2">
      {/* Row 1 — view switcher + saved views + add */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-0.5 bg-gray-100 rounded-xl p-0.5">
          {types.map(t => {
            const Icon = t.icon
            return (
              <button
                key={t.key}
                onClick={() => setType(t.key)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                  view.type === t.key ? 'bg-card text-ink shadow-sm' : 'text-gray-500 hover:text-ink'
                }`}
                title={t.label}
              >
                <Icon size={13} /> <span className="hidden sm:inline">{t.label}</span>
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
            {isDirty && <span className="text-brand-600" title="Unsaved changes">•</span>}
            <ChevronDown size={13} />
          </button>
          <Popover open={viewsOpen} onClose={() => setViewsOpen(false)} title="My views" isMobile={isMobile} align="left">
            <div className="space-y-0.5">
              {allViews.map(v => (
                <div key={v.id} className="flex items-center gap-1 group/v">
                  <button
                    onClick={() => { applyView(v.id); setViewsOpen(false) }}
                    className={`flex-1 flex items-center gap-1.5 text-left text-sm px-2 py-1.5 rounded-lg hover:bg-gray-100 ${
                      activeViewId === v.id ? 'text-brand-700 font-semibold' : 'text-ink'
                    }`}
                  >
                    {activeViewId === v.id ? <Check size={13} /> : <span className="w-[13px]" />}
                    <span className="truncate">{v.name}</span>
                    {v.preset && <span className="text-[10px] text-gray-400 ml-auto">preset</span>}
                  </button>
                  {!v.preset && (
                    <button
                      onClick={() => deleteView(v.id)}
                      className="text-gray-300 hover:text-danger opacity-0 group-hover/v:opacity-100 px-1"
                      title="Delete view"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
              <div className="pt-2 mt-1 border-t border-divider">
                <Button variant="secondary" size="sm" className="w-full" onClick={() => { promptSave(); setViewsOpen(false) }}>
                  Save current view
                </Button>
              </div>
            </div>
          </Popover>
        </div>

        <div className="flex-1" />

        <Button size="sm" onClick={onAdd}><Plus size={14} /> Add task</Button>
      </div>

      {/* Row 2 — search + group/sort + filters + columns */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[10rem] max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={searchRef}
            value={f.q}
            onChange={e => setFilter('q', e.target.value)}
            placeholder="Search tasks…"
            className="input !pl-8 !py-1.5 text-sm"
          />
        </div>

        <label className="inline-flex items-center gap-1.5 text-xs text-gray-500">
          <span className="hidden sm:inline">Group</span>
          <select value={view.group} onChange={e => setGroup(e.target.value)} className="input w-auto !py-1.5 text-xs">
            {groups.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </label>

        <label className="inline-flex items-center gap-1.5 text-xs text-gray-500">
          <span className="hidden sm:inline">Sort</span>
          <select value={view.sort.key} onChange={e => setSort(e.target.value, view.sort.dir)} className="input w-auto !py-1.5 text-xs">
            {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button
            onClick={() => setSort(view.sort.key, view.sort.dir === 'asc' ? 'desc' : 'asc')}
            className="px-1.5 py-1 rounded-md border border-rule text-xs text-gray-500 hover:text-ink"
            title={view.sort.dir === 'asc' ? 'Ascending' : 'Descending'}
          >
            {view.sort.dir === 'asc' ? '↑' : '↓'}
          </button>
        </label>

        <div className="relative">
          <button onClick={() => setFiltersOpen(v => !v)} className="btn-secondary !py-1.5 text-xs">
            <Filter size={13} /> Filters
            {activeFilterCount > 0 && (
              <span className="ml-0.5 px-1.5 rounded-full bg-brand-100 text-brand-700 text-[10px] font-bold">{activeFilterCount}</span>
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

        {(view.type === 'table' || view.type === 'list') && (
          <div className="relative">
            <button onClick={() => setColsOpen(v => !v)} className="btn-secondary !py-1.5 text-xs">
              <SlidersHorizontal size={13} /> <span className="hidden sm:inline">Columns</span>
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
                <p className="text-[11px] text-gray-400 mt-2">The List view always shows the task name only.</p>
              </div>
            </Popover>
          </div>
        )}
      </div>
    </div>
  )
}
