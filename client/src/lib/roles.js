// What the four roles actually do — written from the code that enforces them,
// not from intent.
//
// Every claim below is traceable: the role gates are `requireRole` /
// `requireAdmin` / `requireApprover` in server/middleware/tenant.js, and the
// page rule is `canView` in client/src/context/AuthContext.jsx. When one of
// those changes, this file changes in the same commit — a roles page that
// describes a permission model the server stopped enforcing is worse than no
// roles page, because people act on it.
//
// The reason this exists at all: four different things get called "permissions"
// in conversation, and only one of them is the role. See AXES below.

export const ROLE_GUIDE = [
  {
    role: 'Superadmin',
    summary: 'Owns the workspace. Everything an Admin can do, plus authority over other admins.',
    can: [
      'Everything in the Admin list below',
      'Set page permissions for Admin and Superadmin accounts',
      'Change another Superadmin’s role',
      'Impersonate a member of this workspace',
    ],
    cannot: [
      'Reach another workspace — a Superadmin owns their own label, not the platform',
    ],
    pages: 'Every page. Page permissions are not consulted.',
  },
  {
    role: 'Admin',
    summary: 'Runs the workspace day to day.',
    can: [
      'Add, edit and remove members; set roles, departments and page permissions',
      'Manage the department list, workspace settings and branding',
      'Bank statements, bank matching and the bookkeeper reconcile',
      'Salary, Activity, Usage and Admin Docs',
      'Everything in the Approver list below',
    ],
    cannot: [
      'Set page permissions for an Admin or Superadmin account — that is Superadmin-only',
    ],
    pages: 'Every page. Page permissions are not consulted.',
  },
  {
    role: 'Approver',
    summary: 'Reviews and approves, and reads everything operational. Does not run the team.',
    can: [
      'Approve expenses, run payments, and work the ledger',
      'Contracts, renewals, NDAs, waivers and clearances',
      'Financials, Reports, Recoupments, Artist Spend',
      'See the team’s work, narrowed to their own scope',
    ],
    cannot: [
      'Add or edit members, or change anybody’s role or permissions',
      'Open bank statements, bank matching, Salary, Activity, Usage or Admin Docs',
    ],
    pages: 'Every page their role reaches. Page permissions are not consulted.',
  },
  {
    role: 'User',
    summary: 'Day-to-day access, scoped to the pages they are granted.',
    can: [
      'Open the pages granted to them, and only those',
      'Always reach their own Settings, Requests, Messages and Add Invoice — these are never gated',
      'Submit invoices and reimbursements, and work their own tasks',
    ],
    cannot: [
      'Approve anything, run payments, or see a page nobody granted them',
    ],
    pages: 'Exactly what is ticked for them. This is the ONLY role page permissions apply to.',
  },
]

// The four things people mean when they say "permissions". Only the first two
// decide what anyone can open.
export const AXES = [
  {
    name: 'Role',
    decides: 'What kind of account it is — and everything the server gates on.',
    detail:
      'Superadmin, Admin, Approver or User. Enforced server-side on every request, so it cannot be '
      + 'worked around from the client. Changing it signs the person out, because their token carries it.',
  },
  {
    name: 'Page permissions',
    decides: 'Which pages a User account can open.',
    detail:
      'A list of paths ticked per person. Ignored for Superadmin, Admin and Approver — those roles '
      + 'already reach every page, so ticking boxes for them changes nothing. A grant on a parent path '
      + 'covers its subpages: granting /recoupments also grants /recoupments/planning.',
  },
  {
    name: 'Department',
    decides: 'Nothing, on its own.',
    detail:
      'Where someone sits in the label — it groups people on Team, Salary, Activity and My Work, and it '
      + 'seeds a default page preset when the account is made. It grants no access by itself, and moving '
      + 'somebody between departments does not change a single page they can open.',
  },
  {
    name: 'Hierarchy level',
    decides: 'Nothing. It is a sort order.',
    detail:
      'A number that orders people in lists — level 1 appears above level 99. Every place it is read is '
      + 'an ORDER BY. It confers no authority whatsoever, and a level 1 User can do strictly less than a '
      + 'level 99 Admin.',
  },
]

// Stated plainly because it is the single most common misreading: presets and
// templates are shortcuts for filling in the page list, not a fifth kind of role.
export const PRESET_NOTE =
  'Presets are shortcuts for filling in a User’s page list — pick one and it adds its pages to what is '
  + 'already ticked. They are not roles: there is no "Bookkeeper" account type, only a bookkeeping preset. '
  + 'Ticking two presets grants the union of both; Clear is the only thing that removes.'
