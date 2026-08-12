// My Work — your own tasks as a switchable database (Board / Table / Calendar /
// List) with grouping, filters, sort, inline editing, drag-to-reorder and saved
// views. All of that lives in TaskSurface, shared with Team Work.
//
// This page no longer has a "My tasks / Everyone" selector: seeing other people's
// work is Team Work's job (/team-work), which scopes by department server-side.

import PageHeader from '../components/PageHeader'
import TaskSurface from '../components/mywork/TaskSurface'

export default function MyWork() {
  return (
    <div>
      <PageHeader title="My Work" subtitle="Tasks assigned to you" />
      <TaskSurface surface="mine" />
    </div>
  )
}
