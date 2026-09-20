import { useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Paperclip, X } from 'lucide-react'
import { DEAL_STAGES, DEAL_TYPES, PRIORITIES } from '../constants'
import { dateOnly, isPastLocal } from '../utils/dates'

// The board's sibling view: every deal and every field in one grid, sorted and
// editable in place.
//
// The board answers "what shape is the funnel"; it cannot answer "show me every
// offer over 50k, largest first" or "which four deals have gone quiet", because
// six columns of cards give you no way to line values up against each other.
// This view exists for those, so it optimises for the opposite things —
// density, one row per deal, a sortable column per field, and editing without
// opening anything.
//
// Deliberately NOT a general DataTable: the column set, the editors and the
// vocabularies are the deals schema. A generic one would need a config object
// per page that is longer than the markup it replaces.

// Column widths are fixed so the grid stays aligned while cells swap between
// their display and editor forms — an auto-width table reflows every column the
// moment a <select> replaces a word, which makes editing feel like the page is
// coming apart.
const COLS = [
  // The artist cell opens the record instead of editing, mirroring a click on
  // a board card. Renaming is rare and belongs in the drawer; giving the row an
  // identity column that reliably opens it is worth more than inline rename.
  { key: 'artist_name',  label: 'Artist',    type: 'open',   w: 'w-44', sticky: true },
  { key: 'stage',        label: 'Stage',     type: 'select', w: 'w-32', options: DEAL_STAGES, clearable: false },
  { key: 'priority',     label: 'Priority',  type: 'select', w: 'w-24', options: PRIORITIES,  clearable: true },
  { key: 'offer_amount', label: 'Offer',     type: 'money',  w: 'w-28', align: 'right' },
  { key: 'spotify_monthly_listeners', label: 'Listeners', type: 'number', w: 'w-28', align: 'right' },
  { key: 'ar_rep',       label: 'A&R rep',   type: 'text',   w: 'w-32' },
  { key: 'genre',        label: 'Genre',     type: 'text',   w: 'w-28' },
  { key: 'source',       label: 'Source',    type: 'text',   w: 'w-28' },
  { key: 'deal_type',    label: 'Deal type', type: 'select', w: 'w-36', options: DEAL_TYPES, clearable: true },
  { key: 'next_followup_date', label: 'Follow-up', type: 'date', w: 'w-32' },
  // Derived, so not editable: the age comes from stage_entered_at, which only a
  // genuine stage move is allowed to set.
  { key: '_age',   label: 'Age',   type: 'computed', w: 'w-20', align: 'right' },
  { key: '_files', label: 'Files', type: 'computed', w: 'w-16', align: 'right' },
]

// Tab walks only the cells that actually edit — landing on the identity column
// would open the drawer mid-traversal.
const EDITABLE = COLS.filter(c => c.type !== 'computed' && c.type !== 'open').map(c => c.key)

const money = (n) => `$${Number(n || 0).toLocaleString()}`

// Sorting a stage column alphabetically puts Meeting before Offer before
// Passed before Scouting, which is nonsense for a funnel — the only meaningful
// order is the pipeline's own.
const stageRank = (v) => {
  const i = DEAL_STAGES.indexOf(v)
  return i === -1 ? DEAL_STAGES.length : i
}
const priorityRank = (v) => {
  const i = PRIORITIES.indexOf(v)
  return i === -1 ? PRIORITIES.length : i
}

// Blank always sorts last, in both directions. A column sorted descending that
// opens with forty empty cells has buried the thing you sorted for.
function compare(a, b, col, deriveAge, fileCounts) {
  const empty = (v) => v === null || v === undefined || v === ''
  let x, y
  if (col.key === '_age')        { x = deriveAge(a); y = deriveAge(b) }
  else if (col.key === '_files') { x = fileCounts[a.id] || 0; y = fileCounts[b.id] || 0 }
  else if (col.key === 'stage')  { x = stageRank(a.stage); y = stageRank(b.stage) }
  else if (col.key === 'priority') { x = priorityRank(a.priority); y = priorityRank(b.priority) }
  else { x = a[col.key]; y = b[col.key] }

  if (empty(x) && empty(y)) return 0
  if (empty(x)) return 1
  if (empty(y)) return -1

  if (col.type === 'money' || col.type === 'number' || typeof x === 'number') {
    return Number(x) - Number(y)
  }
  if (col.type === 'date') return String(dateOnly(x) || '').localeCompare(String(dateOnly(y) || ''))
  return String(x).localeCompare(String(y), undefined, { sensitivity: 'base' })
}

// One cell's editor. Owns its own draft so a keystroke doesn't re-render the
// whole grid, and commits exactly once — Enter and the blur it causes would
// otherwise fire two PATCHes and two toasts for one edit.
function CellEditor({ col, value, onCommit, onCancel }) {
  const [v, setV] = useState(value ?? '')
  const done = useRef(false)
  const finish = (commit, opts) => {
    if (done.current) return
    done.current = true
    commit ? onCommit(v, opts) : onCancel()
  }
  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true) }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false) }
    // Tab commits and opens the next field along, which is the one habit
    // carried over from a spreadsheet that people actually miss.
    else if (e.key === 'Tab') { e.preventDefault(); finish(true, { advance: e.shiftKey ? -1 : 1 }) }
  }
  const cls = 'w-full bg-card border border-brand-400 rounded px-1 py-0.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand-300'

  if (col.type === 'select') {
    return (
      <select
        autoFocus className={cls} value={v}
        onChange={(e) => { setV(e.target.value); done.current = true; onCommit(e.target.value) }}
        onKeyDown={onKeyDown}
        onBlur={() => finish(false)}
      >
        {col.clearable && <option value="">—</option>}
        {col.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  return (
    <input
      autoFocus className={`${cls} ${col.align === 'right' ? 'text-right' : ''}`}
      type={col.type === 'date' ? 'date' : col.type === 'money' || col.type === 'number' ? 'number' : 'text'}
      {...(col.type === 'money' ? { step: '0.01', min: '0' } : col.type === 'number' ? { min: '0' } : {})}
      value={col.type === 'date' ? (dateOnly(v) || '') : v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
    />
  )
}

export default function DealsTable({ deals, fileCounts, onOpen, onSave, onDelete, daysInStage, staleAfter }) {
  const [sort, setSort] = useState({ key: null, dir: 'asc' })
  const [edit, setEdit] = useState(null) // { id, key }

  const rows = useMemo(() => {
    if (!sort.key) return deals
    const col = COLS.find(c => c.key === sort.key)
    if (!col) return deals
    const sorted = [...deals].sort((a, b) => compare(a, b, col, daysInStage, fileCounts))
    return sort.dir === 'desc' ? sorted.reverse() : sorted
  }, [deals, sort, fileCounts, daysInStage])

  const toggleSort = (key) => setSort(s =>
    s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })

  const commit = async (deal, col, raw, opts = {}) => {
    // Both sides go through the same normaliser before being compared, because
    // Postgres hands back shapes the editor never produces: a DATE arrives as a
    // full ISO timestamp and NUMERIC as a string, so "2026-04-12T00:00:00.000Z"
    // vs "2026-04-12" and "250.00" vs "250" would both read as edits and fire a
    // PATCH every time a cell was opened and closed untouched.
    const norm = (v) => {
      if (v === null || v === undefined || v === '') return ''
      if (col.type === 'date') return dateOnly(v) || ''
      if (col.type === 'money' || col.type === 'number') {
        const n = Number(v)
        return Number.isFinite(n) ? String(n) : ''
      }
      return String(v)
    }
    const before = norm(deal[col.key])
    const next = norm(raw)
    setEdit(null)

    if (next !== before) {
      await onSave(deal.id, { [col.key]: next }, { silent: true })
    }

    if (opts.advance) {
      const i = EDITABLE.indexOf(col.key)
      const nextKey = EDITABLE[i + opts.advance]
      if (nextKey) setEdit({ id: deal.id, key: nextKey })
    }
  }

  // A pipeline's headline number. Sitting under the column it sums, which is
  // where a spreadsheet would put it.
  const totalOffer = rows.reduce((s, d) => s + (Number(d.offer_amount) || 0), 0)
  const withOffer = rows.filter(d => Number(d.offer_amount) > 0).length

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-divider text-left text-[10px] uppercase tracking-wide text-ink-faint">
            {COLS.map(col => {
              const active = sort.key === col.key
              return (
                <th
                  key={col.key}
                  className={`${col.w} px-2 py-2 font-semibold whitespace-nowrap ${col.align === 'right' ? 'text-right' : ''} ${
                    col.sticky ? 'sticky left-0 bg-card z-20 border-r border-divider' : ''
                  }`}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    onClick={() => toggleSort(col.key)}
                    className={`inline-flex items-center gap-1 hover:text-ink transition ${active ? 'text-ink' : ''} ${
                      col.align === 'right' ? 'flex-row-reverse' : ''
                    }`}
                  >
                    {col.label}
                    {active && (sort.dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                  </button>
                </th>
              )
            })}
            <th className="w-8 px-2 py-2" />
          </tr>
        </thead>

        <tbody className="divide-y divide-divider">
          {rows.map(deal => {
            const age = daysInStage(deal)
            const limit = staleAfter[deal.stage]
            const stale = age != null && limit != null && age > limit
            const overdue = isPastLocal(deal.next_followup_date)

            return (
              <tr key={deal.id} className="group hover:bg-elev/60">
                {COLS.map(col => {
                  const editing = edit && edit.id === deal.id && edit.key === col.key
                  const base = `${col.w} px-2 py-1.5 align-middle ${col.align === 'right' ? 'text-right' : ''} ${
                    col.sticky ? 'sticky left-0 bg-card group-hover:bg-elev z-10 border-r border-divider' : ''
                  }`

                  if (editing) {
                    return (
                      <td key={col.key} className={base}>
                        <CellEditor
                          col={col}
                          value={deal[col.key]}
                          onCommit={(v, opts) => commit(deal, col, v, opts)}
                          onCancel={() => setEdit(null)}
                        />
                      </td>
                    )
                  }

                  // ---- computed cells ----
                  if (col.key === '_age') {
                    return (
                      <td key={col.key} className={`${base} tabular-nums ${stale ? 'text-warning' : 'text-ink-faint'}`}
                          title={age == null ? '' : `${age} days in ${deal.stage}${stale ? ` — past the ${limit}-day mark` : ''}`}>
                        {age == null ? '—' : `${age}d`}
                      </td>
                    )
                  }
                  if (col.key === '_files') {
                    const n = fileCounts[deal.id] || 0
                    return (
                      <td key={col.key} className={`${base} text-ink-faint tabular-nums`}>
                        {n > 0 ? <span className="inline-flex items-center gap-0.5"><Paperclip size={9} />{n}</span> : '—'}
                      </td>
                    )
                  }

                  // ---- editable cells ----
                  // The whole cell is the hit target, not a pencil that appears
                  // on hover: in a grid the cell IS the affordance, and a hover
                  // icon costs a second gesture on every edit.
                  if (col.type === 'open') {
                    return (
                      <td key={col.key} className={base}>
                        <button
                          onClick={() => onOpen(deal)}
                          className="w-full text-left rounded px-1 -mx-1 py-0.5 font-medium text-ink truncate hover:text-brand-ink hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-400"
                          title="Open this deal"
                        >{deal.artist_name}</button>
                      </td>
                    )
                  }

                  const openEditor = () => setEdit({ id: deal.id, key: col.key })
                  let body

                  if (col.key === 'stage') {
                    body = <span className="text-ink-muted truncate block">{deal.stage}</span>
                  } else if (col.key === 'priority') {
                    body = deal.priority
                      ? <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                          deal.priority === 'High' ? 'bg-danger/10 text-danger'
                            : deal.priority === 'Medium' ? 'bg-warning/10 text-warning'
                              : 'bg-elev text-ink-muted'
                        }`}>{deal.priority}</span>
                      : <span className="text-ink-faint">—</span>
                  } else if (col.type === 'money') {
                    body = Number(deal.offer_amount) > 0
                      ? <span className="tabular-nums text-ink">{money(deal.offer_amount)}</span>
                      : <span className="text-ink-faint">—</span>
                  } else if (col.type === 'number') {
                    body = Number(deal[col.key]) > 0
                      ? <span className="tabular-nums text-ink-muted">{Number(deal[col.key]).toLocaleString()}</span>
                      : <span className="text-ink-faint">—</span>
                  } else if (col.type === 'date') {
                    const d = dateOnly(deal[col.key])
                    body = d
                      ? <span className={`tabular-nums ${overdue ? 'text-warning font-medium' : 'text-ink-muted'}`}>{d}</span>
                      : <span className="text-ink-faint">—</span>
                  } else {
                    body = deal[col.key]
                      ? <span className="text-ink-muted truncate block">{deal[col.key]}</span>
                      : <span className="text-ink-faint">—</span>
                  }

                  return (
                    <td key={col.key} className={base}>
                      <button
                        onClick={openEditor}
                        className={`w-full text-left rounded px-1 -mx-1 py-0.5 hover:bg-brand-500/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-400 ${
                          col.align === 'right' ? 'text-right' : ''
                        }`}
                        title="Click to edit"
                      >
                        {body}
                      </button>
                    </td>
                  )
                })}
                <td className="w-8 px-2 py-1.5 text-right">
                  <button
                    onClick={() => onDelete(deal)}
                    className="p-0.5 text-ink-faint hover:text-danger opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 transition"
                    title="Delete deal"
                  ><X size={12} /></button>
                </td>
              </tr>
            )
          })}
        </tbody>

        <tfoot>
          <tr className="border-t border-rule text-[11px] font-semibold text-ink">
            <td className="sticky left-0 bg-card z-10 border-r border-divider px-2 py-2">
              {rows.length} deal{rows.length === 1 ? '' : 's'}
            </td>
            <td colSpan={2} />
            <td className="px-2 py-2 text-right tabular-nums" title={`${withOffer} of ${rows.length} deals carry an offer`}>
              {money(totalOffer)}
            </td>
            <td colSpan={COLS.length - 4} />
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
