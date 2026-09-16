// The day's headline, in four words or fewer.
//
// Lifted out of TaskSurface so /my-work can print it beside the greeting — the
// place boom put it — while the Team tab keeps it above its own toolbar. One
// definition, so the two surfaces cannot disagree about what "overdue" means:
// every count here comes from the same `dueBucketOf`/`isOpen` the board groups on.

import { dueBucketOf, isOpen } from './taskFields'

export default function StatusPills({ tasks, className = 'mb-4' }) {
  const open = tasks.filter(isOpen)
  const overdue = open.filter(t => dueBucketOf(t) === 'overdue').length
  const today = open.filter(t => dueBucketOf(t) === 'today').length
  const inProgress = open.filter(t => t.status === 'In Progress').length
  const pills = [
    overdue && { key: 'o', text: `${overdue} overdue`, cls: 'bg-red-500 text-white' },
    today && { key: 't', text: `${today} due today`, cls: 'bg-amber-500 text-white' },
    inProgress && { key: 'p', text: `${inProgress} in progress`, cls: 'bg-blue-500 text-white' },
    open.length && { key: 'n', text: `${open.length} open`, cls: 'bg-elev text-ink-muted' },
  ].filter(Boolean)

  if (!pills.length) return null
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {pills.map(p => (
        <span key={p.key} className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${p.cls}`}>{p.text}</span>
      ))}
    </div>
  )
}
