import { Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import PermissionsManager from './PermissionsManager'
import { AXES } from '../lib/roles'

// One person's access, on their own page.
//
// The summary strip is the whole reason this exists rather than just embedding
// the permissions editor. Four different things get called "permissions" (see
// lib/roles.js), and only one of them is the page list below. An admin looking
// at somebody who "cannot see Recoupments" needs to know FIRST that their role
// already decides it, or that their department decides nothing — otherwise the
// page list is the only lever visible and they reach for it.
//
// So: role, pages, department and hierarchy are stated side by side, each
// labelled with what it actually decides, and two of the four say "nothing".
const UNRESTRICTED_ROLES = ['Superadmin', 'Admin', 'Approver']

function Axis({ name, value, decides, muted }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-widest text-ink-faint">{name}</dt>
      <dd className={`truncate text-sm font-semibold ${muted ? 'text-ink-muted' : 'text-ink'}`}>{value}</dd>
      <dd className="mt-0.5 text-[11px] leading-snug text-ink-faint">{decides}</dd>
    </div>
  )
}

export default function AccessEditor({ member }) {
  if (!member) return null
  const roleUnrestricted = UNRESTRICTED_ROLES.includes(member.role)
  const axis = (n) => AXES.find(a => a.name === n)

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <h2 className="mb-1 inline-flex items-center gap-1.5 text-sm font-bold text-ink">
          <ShieldCheck size={15} /> What decides {member.name.split(' ')[0]}’s access
        </h2>
        <p className="mb-4 text-xs text-ink-muted">
          Four things get called “permissions”. Only the first two open or close a page.{' '}
          <Link to="/settings?tab=roles" className="font-medium text-brand-ink hover:underline">
            How access works
          </Link>
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
          <Axis
            name="Role"
            value={member.role || '—'}
            decides={axis('Role')?.decides}
          />
          <Axis
            name="Pages"
            value={roleUnrestricted ? 'Every page' : 'The list below'}
            decides={roleUnrestricted
              ? 'Their role already reaches everything, so the list below is stored but inert.'
              : 'Exactly what is ticked below.'}
            muted={roleUnrestricted}
          />
          <Axis
            name="Department"
            value={member.department || '—'}
            decides="Nothing on its own. Grouping, and the preset their account started from."
            muted
          />
          <Axis
            name="Hierarchy"
            value={member.hierarchy_level ?? '—'}
            decides="Nothing. A sort order — level 1 lists above level 99."
            muted
          />
        </dl>
      </div>

      <PermissionsManager member={member} />
    </div>
  )
}
