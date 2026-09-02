import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { SocketProvider } from './context/SocketContext'
import Messages from './pages/Messages'
import Layout from './components/Layout'
import UpdateBanner from './components/UpdateBanner'
import PlatformLayout from './components/PlatformLayout'
import PlatformOverview from './pages/PlatformOverview'
import PlatformActivity from './pages/PlatformActivity'
import PlatformAnalytics from './pages/PlatformAnalytics'
import PlatformAnnouncements from './pages/PlatformAnnouncements'
import PlatformOperators from './pages/PlatformOperators'
import PlatformAccount from './pages/PlatformAccount'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import Releases from './pages/Releases'
import ReleaseDetail from './pages/ReleaseDetail'
import Artists from './pages/Artists'
import Catalog from './pages/Catalog'
import Brand from './pages/Brand'
import ArtistProfile from './pages/ArtistProfile'
import Deals from './pages/Deals'
import Contracts from './pages/Contracts'
import PendingContracts from './pages/PendingContracts'
import Legal from './pages/Legal'
import AdminDocs from './pages/AdminDocs'
import CreateLabelWaiver from './pages/CreateLabelWaiver'
import CreateNda from './pages/CreateNda'
import ArtistClearance from './pages/ArtistClearance'
import Renewals from './pages/Renewals'
import CreateContract from './pages/CreateContract'
import MyWork from './pages/MyWork'
import TeamWork from './pages/TeamWork'
import Calendar from './pages/Calendar'
import Financials from './pages/Financials'
import FinancialsMonth from './pages/FinancialsMonth'
import Reports from './pages/Reports'
import BankMatching from './pages/BankMatching'
import LedgerMatching from './pages/LedgerMatching'
import LedgerArchive from './pages/LedgerArchive'
import Creators from './pages/Creators'
import BulkDeals from './pages/BulkDeals'
import ArtistBudgets from './pages/ArtistBudgets'
import ArtistBudgetSheet from './pages/ArtistBudgetSheet'
import Recoupments from './pages/Recoupments'
import RecoupmentPlanning from './pages/RecoupmentPlanning'
import RecoupmentArtist from './pages/RecoupmentArtist'
import RecoupmentAudit from './pages/RecoupmentAudit'
import Salary from './pages/Salary'
import BankStatements from './pages/BankStatements'
import DataQuality from './pages/DataQuality'
import Notifications from './pages/Notifications'
import UserManual from './components/UserManual'
import RecordingBudgets from './pages/RecordingBudgets'
import RecordingBudgetDetail from './pages/RecordingBudgetDetail'
import Campaigns from './pages/Campaigns'
import ArtistCampaigns from './pages/ArtistCampaigns'
import ArtistCampaignDetail from './pages/ArtistCampaignDetail'
import AdAllocation from './pages/AdAllocation'
import Ledger from './pages/Ledger'
import InvoiceSearch from './pages/InvoiceSearch'
import Approvals from './pages/Approvals'
import AddLedgerEntry from './pages/AddLedgerEntry'
import BulkUpload from './pages/BulkUpload'
import Payments from './pages/Payments'
import Vendors from './pages/Vendors'
import VendorsAdded from './pages/VendorsAdded'
import VendorSubmitLab from './pages/VendorSubmitLab'
import CreateInvoice from './pages/CreateInvoice'
import VendorSubmit from './pages/VendorSubmit'
import AcceptInvite from './pages/AcceptInvite'
import Team from './pages/Team'
import TeamMember from './pages/TeamMember'
import Settings from './pages/Settings'
import Activity from './pages/Activity'
import Usage from './pages/Usage'
import InternalRequests from './pages/InternalRequests'
import Workspaces from './pages/Workspaces'
import Privacy from './pages/Privacy'
import EULA from './pages/EULA'
import NotFound from './components/NotFound'

function Spinner() {
  return (
    <div className="flex items-center justify-center h-screen bg-page">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    </div>
  )
}

// Gate: requires an authenticated session.
function ProtectedRoute({ children }) {
  const { token, loading } = useAuth()
  if (loading) return <Spinner />
  if (!token) return <Navigate to="/login" replace />
  return children
}

// Gate: admin/superadmin/approver only. Non-admins are redirected home (the
// server independently 403s the underlying data, so this is just UX).
// The in-app manual as a routable page (also available as a modal in Layout).
function ManualPage() {
  const navigate = useNavigate()
  // navigate(-1) is a no-op when there is nothing to pop — opening /manual in a
  // fresh tab left Close doing visibly nothing. history.state.idx is React
  // Router's own position counter; 0 means this entry is the start of the stack.
  const close = () => {
    if (window.history.state?.idx > 0) navigate(-1)
    else navigate('/', { replace: true })
  }
  return <UserManual open onClose={close} />
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!['Superadmin', 'Admin', 'Approver'].includes(user?.role)) return <Navigate to="/" replace />
  return children
}

// Admin/Superadmin only — for surfaces whose SERVER gate is requireAdmin.
// AdminRoute admits Approvers, so using it on an admin-gated API hands those
// users a page that can only ever render an empty, silently-403ing shell.
function StrictAdminRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!['Superadmin', 'Admin'].includes(user?.role)) return <Navigate to="/" replace />
  return children
}

function AppContent() {
  const { token, loading, user, impersonating, sessionEpoch } = useAuth()

  // Platform operators get their own neutral shell + platform pages — UNLESS
  // they've entered a specific workspace (impersonating), in which case they
  // get that label's full shell. This keeps the operator from being "logged
  // into" any one label by default.
  const platformMode = !!user?.is_platform_admin && !impersonating

  return (
    <>
    <UpdateBanner />
    {/* `key` = the acting identity. Entering or leaving a workspace only ever
        swapped the token in state, so React reconciled the mounted pages and
        kept them alive: the new tenant's Dashboard was the previous tenant's
        numbers until something happened to trigger a refetch. Re-keying the
        tree forces a real unmount, which is what every page's load-on-mount
        effect is already written against. AuthContext bumps it ONLY on an
        identity change, never on first load. */}
    <Routes key={sessionEpoch}>
      {/* Public */}
      <Route path="/login"        element={token ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/submit/:slug" element={<VendorSubmit />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/privacy"      element={<Privacy />} />
      <Route path="/eula"         element={<EULA />} />

      {platformMode ? (
        /* ── Platform operator shell ── */
        <Route element={<ProtectedRoute><PlatformLayout /></ProtectedRoute>}>
          <Route path="/"           element={<PlatformOverview />} />
          <Route path="/messages"   element={<Messages />} />
          <Route path="/messages/:channelId" element={<Messages />} />
          <Route path="/workspaces" element={<Workspaces />} />
          <Route path="/activity"   element={<PlatformActivity />} />
          <Route path="/analytics"  element={<PlatformAnalytics />} />
          <Route path="/announcements" element={<PlatformAnnouncements />} />
          {user?.platform_role === 'owner' && <Route path="/operators" element={<PlatformOperators />} />}
          <Route path="/account"    element={<PlatformAccount />} />
          <Route path="*"           element={<NotFound />} />
        </Route>
      ) : (
      /* ── Label workspace shell ── */
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/"             element={<Dashboard />} />
        <Route path="/my-work"      element={<MyWork />} />
        {/* AdminRoute is misleadingly named — it gates on Approver-or-above, which
            is exactly the team-lead tier. The server re-decides scope per request. */}
        <Route path="/team-work"    element={<AdminRoute><TeamWork /></AdminRoute>} />
        <Route path="/messages"     element={<Messages />} />
        <Route path="/messages/:channelId" element={<Messages />} />
        <Route path="/calendar"     element={<Calendar />} />
        <Route path="/releases"     element={<Releases />} />
        <Route path="/releases/:id" element={<ReleaseDetail />} />
        <Route path="/artists"      element={<Artists />} />
        <Route path="/catalog"      element={<Catalog />} />
        <Route path="/brand"        element={<Brand />} />
        <Route path="/artists/:id"  element={<ArtistProfile />} />
        <Route path="/deals"        element={<Deals />} />
        <Route path="/contracts"    element={<AdminRoute><Contracts /></AdminRoute>} />
        <Route path="/contracts/create" element={<AdminRoute><CreateContract /></AdminRoute>} />
        <Route path="/pending-contracts" element={<AdminRoute><PendingContracts /></AdminRoute>} />
        <Route path="/renewals"     element={<AdminRoute><Renewals /></AdminRoute>} />
        <Route path="/legal"        element={<AdminRoute><Legal /></AdminRoute>} />
        <Route path="/label-waivers" element={<AdminRoute><CreateLabelWaiver /></AdminRoute>} />
        <Route path="/create-nda"          element={<AdminRoute><CreateNda /></AdminRoute>} />
        <Route path="/create-nda/:template" element={<AdminRoute><CreateNda /></AdminRoute>} />
        <Route path="/clearances"   element={<AdminRoute><ArtistClearance /></AdminRoute>} />
        <Route path="/admin-docs"   element={<StrictAdminRoute><AdminDocs /></StrictAdminRoute>} />
        <Route path="/financials"   element={<AdminRoute><Financials /></AdminRoute>} />
        <Route path="/financials/month/:month" element={<AdminRoute><FinancialsMonth /></AdminRoute>} />
        <Route path="/reports"      element={<AdminRoute><Reports /></AdminRoute>} />
        <Route path="/recoupments"  element={<AdminRoute><Recoupments /></AdminRoute>} />
        <Route path="/recoupments/planning" element={<AdminRoute><RecoupmentPlanning /></AdminRoute>} />
        <Route path="/recoupments/artist/:key" element={<AdminRoute><RecoupmentArtist /></AdminRoute>} />
        <Route path="/recoupments/audit" element={<AdminRoute><RecoupmentAudit /></AdminRoute>} />
        <Route path="/salary"       element={<AdminRoute><Salary /></AdminRoute>} />
        <Route path="/bank-statements" element={<AdminRoute><BankStatements /></AdminRoute>} />
        <Route path="/bank-matching" element={<AdminRoute><BankMatching /></AdminRoute>} />
        <Route path="/ledger-matching" element={<StrictAdminRoute><LedgerMatching /></StrictAdminRoute>} />
        {/* Same component as /ledger, `bank` prop — the reference app's
            one-component-two-routes. Statement-born rows are not a different
            table, so they take the same inline edits, bulk edits, splits and
            undo; only the row set, three columns and the lens differ. */}
        <Route path="/bank-ledger" element={<AdminRoute><Ledger bank /></AdminRoute>} />
        <Route path="/approvals/archive" element={<AdminRoute><LedgerArchive /></AdminRoute>} />
        <Route path="/creators" element={<AdminRoute><Creators /></AdminRoute>} />
        <Route path="/bulk-deals" element={<AdminRoute><BulkDeals /></AdminRoute>} />
        <Route path="/artist-budgets" element={<AdminRoute><ArtistBudgets /></AdminRoute>} />
        <Route path="/artist-budgets/:artistKey" element={<AdminRoute><ArtistBudgetSheet /></AdminRoute>} />
        <Route path="/bank-statements/:id" element={<AdminRoute><BankStatements /></AdminRoute>} />
        <Route path="/data-quality" element={<DataQuality />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/manual" element={<ManualPage />} />
        <Route path="/recording-budgets" element={<AdminRoute><RecordingBudgets /></AdminRoute>} />
        <Route path="/recording-budgets/:id" element={<AdminRoute><RecordingBudgetDetail /></AdminRoute>} />
        <Route path="/marketing"    element={<Campaigns />} />
        <Route path="/artist-campaigns" element={<AdminRoute><ArtistCampaigns /></AdminRoute>} />
        <Route path="/artist-campaigns/:artist" element={<AdminRoute><ArtistCampaignDetail /></AdminRoute>} />
        <Route path="/artist-campaigns/:artist/:song" element={<AdminRoute><ArtistCampaignDetail /></AdminRoute>} />
        <Route path="/ad-allocation" element={<AdminRoute><AdAllocation /></AdminRoute>} />
        <Route path="/approvals"    element={<AdminRoute><Approvals /></AdminRoute>} />
        <Route path="/ledger"       element={<AdminRoute><Ledger /></AdminRoute>} />
        {/* Search-oriented invoices index — distinct from /invoices (outbound creator) */}
        <Route path="/invoice-search" element={<AdminRoute><InvoiceSearch /></AdminRoute>} />
        <Route path="/bulk-upload"  element={<AdminRoute><BulkUpload /></AdminRoute>} />
        <Route path="/add-invoice"  element={<AddLedgerEntry mode="invoice" />} />
        <Route path="/ledger/new-invoice"       element={<AdminRoute><AddLedgerEntry mode="invoice" /></AdminRoute>} />
        <Route path="/ledger/new-reimbursement" element={<AdminRoute><AddLedgerEntry mode="reimbursement" /></AdminRoute>} />
        <Route path="/payments"     element={<AdminRoute><Payments /></AdminRoute>} />
        <Route path="/vendors"      element={<AdminRoute><Vendors /></AdminRoute>} />
        <Route path="/vendors/added-expenses" element={<AdminRoute><VendorsAdded /></AdminRoute>} />
        <Route path="/vendor-lab" element={<AdminRoute><VendorSubmitLab /></AdminRoute>} />
        <Route path="/invoices"     element={<AdminRoute><CreateInvoice /></AdminRoute>} />
        <Route path="/invoices/new" element={<AdminRoute><CreateInvoice /></AdminRoute>} />
        {/* Open to every member: the roster is the workspace's only people
            directory, and gating it behind AdminRoute meant a plain User had no way
            to look a colleague up. Every mutation on the page is still admin-tier
            and enforced in routes/team.js; the page hides what would 403. The
            member DETAIL page is open on the same reasoning, and filters its task
            list per viewer server-side. */}
        <Route path="/team"         element={<Team />} />
        <Route path="/team/:id"     element={<TeamMember />} />
        {/* Strict: the server route is requireAdmin, so an Approver admitted by
            AdminRoute could only ever see a 403 banner. */}
        <Route path="/activity"     element={<StrictAdminRoute><Activity /></StrictAdminRoute>} />
        {/* StrictAdminRoute, not AdminRoute: /api/analytics/summary is requireAdmin,
            so an Approver would get a page that can only ever render a 403. */}
        <Route path="/usage"        element={<StrictAdminRoute><Usage /></StrictAdminRoute>} />
        <Route path="/requests"     element={<InternalRequests />} />
        <Route path="/settings"     element={<Settings />} />
        {/* Inside the shell, so the sidebar and search stay available — being
            lost is exactly when you need the navigation most. */}
        <Route path="*"             element={<NotFound />} />
      </Route>
      )}

      <Route path="*" element={<Navigate to={token ? '/' : '/login'} replace />} />
    </Routes>
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <AppContent />
      </SocketProvider>
    </AuthProvider>
  )
}
