// Team Work — the same database views as My Work, pointed at a team, plus a
// Workload view showing per-person load.
//
// WHOSE tasks appear is decided server-side (teamFilter in server/routes/tasks.js):
// Superadmin/Admin see the whole workspace, an Approver sees their own department.
// The client never asks for a scope, so a stale saved view can't widen access.

import PageHeader from '../components/PageHeader'
import TaskSurface from '../components/mywork/TaskSurface'
import { useAuth } from '../context/AuthContext'

export default function TeamWork() {
  const { user } = useAuth()
  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)

  return (
    <div>
      <PageHeader
        title="Team Work"
        subtitle={isAdmin
          ? 'Everyone in this workspace'
          : `Your team${user?.department ? ` · ${user.department}` : ''}`}
      />
      <TaskSurface surface="team" />
    </div>
  )
}
