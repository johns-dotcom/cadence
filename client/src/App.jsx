import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import PlatformLayout from './components/PlatformLayout'
import PlatformOverview from './pages/PlatformOverview'
import PlatformActivity from './pages/PlatformActivity'
import PlatformAnnouncements from './pages/PlatformAnnouncements'
import PlatformOperators from './pages/PlatformOperators'
import PlatformAccount from './pages/PlatformAccount'
import Login from './pages/Login'
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
import MyWork from './pages/MyWork'
import Calendar from './pages/Calendar'
import Financials from './pages/Financials'
import Recoupments from './pages/Recoupments'
import RecoupmentPlanning from './pages/RecoupmentPlanning'
import Salary from './pages/Salary'
import RecordingBudgets from './pages/RecordingBudgets'
import Campaigns from './pages/Campaigns'
import ArtistCampaigns from './pages/ArtistCampaigns'
import Ledger from './pages/Ledger'
import Approvals from './pages/Approvals'
import AddLedgerEntry from './pages/AddLedgerEntry'
import Payments from './pages/Payments'
import Vendors from './pages/Vendors'
import CreateInvoice from './pages/CreateInvoice'
import VendorSubmit from './pages/VendorSubmit'
import AcceptInvite from './pages/AcceptInvite'
import Team from './pages/Team'
import Settings from './pages/Settings'
import Activity from './pages/Activity'
import InternalRequests from './pages/InternalRequests'
import Workspaces from './pages/Workspaces'
import Privacy from './pages/Privacy'
import EULA from './pages/EULA'

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
function AdminRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!['Superadmin', 'Admin', 'Approver'].includes(user?.role)) return <Navigate to="/" replace />
  return children
}

function AppContent() {
  const { token, loading, user, impersonating } = useAuth()

  // Platform operators get their own neutral shell + platform pages — UNLESS
  // they've entered a specific workspace (impersonating), in which case they
  // get that label's full shell. This keeps the operator from being "logged
  // into" any one label by default.
  const platformMode = !!user?.is_platform_admin && !impersonating

  return (
    <Routes>
      {/* Public */}
      <Route path="/login"        element={token ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/submit/:slug" element={<VendorSubmit />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="/privacy"      element={<Privacy />} />
      <Route path="/eula"         element={<EULA />} />

      {platformMode ? (
        /* ── Platform operator shell ── */
        <Route element={<ProtectedRoute><PlatformLayout /></ProtectedRoute>}>
          <Route path="/"           element={<PlatformOverview />} />
          <Route path="/workspaces" element={<Workspaces />} />
          <Route path="/activity"   element={<PlatformActivity />} />
          <Route path="/announcements" element={<PlatformAnnouncements />} />
          {user?.platform_role === 'owner' && <Route path="/operators" element={<PlatformOperators />} />}
          <Route path="/account"    element={<PlatformAccount />} />
          <Route path="*"           element={<Navigate to="/" replace />} />
        </Route>
      ) : (
      /* ── Label workspace shell ── */
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/"             element={<Dashboard />} />
        <Route path="/my-work"      element={<MyWork />} />
        <Route path="/calendar"     element={<Calendar />} />
        <Route path="/releases"     element={<Releases />} />
        <Route path="/releases/:id" element={<ReleaseDetail />} />
        <Route path="/artists"      element={<Artists />} />
        <Route path="/catalog"      element={<Catalog />} />
        <Route path="/brand"        element={<Brand />} />
        <Route path="/artists/:id"  element={<ArtistProfile />} />
        <Route path="/deals"        element={<Deals />} />
        <Route path="/contracts"    element={<AdminRoute><Contracts /></AdminRoute>} />
        <Route path="/pending-contracts" element={<AdminRoute><PendingContracts /></AdminRoute>} />
        <Route path="/renewals"     element={<AdminRoute><Renewals /></AdminRoute>} />
        <Route path="/legal"        element={<AdminRoute><Legal /></AdminRoute>} />
        <Route path="/label-waivers" element={<AdminRoute><CreateLabelWaiver /></AdminRoute>} />
        <Route path="/create-nda"          element={<AdminRoute><CreateNda /></AdminRoute>} />
        <Route path="/create-nda/:template" element={<AdminRoute><CreateNda /></AdminRoute>} />
        <Route path="/clearances"   element={<AdminRoute><ArtistClearance /></AdminRoute>} />
        <Route path="/admin-docs"   element={<AdminRoute><AdminDocs /></AdminRoute>} />
        <Route path="/financials"   element={<AdminRoute><Financials /></AdminRoute>} />
        <Route path="/recoupments"  element={<AdminRoute><Recoupments /></AdminRoute>} />
        <Route path="/recoupments/planning" element={<AdminRoute><RecoupmentPlanning /></AdminRoute>} />
        <Route path="/salary"       element={<AdminRoute><Salary /></AdminRoute>} />
        <Route path="/recording-budgets" element={<AdminRoute><RecordingBudgets /></AdminRoute>} />
        <Route path="/marketing"    element={<Campaigns />} />
        <Route path="/artist-campaigns" element={<AdminRoute><ArtistCampaigns /></AdminRoute>} />
        <Route path="/approvals"    element={<AdminRoute><Approvals /></AdminRoute>} />
        <Route path="/ledger"       element={<AdminRoute><Ledger /></AdminRoute>} />
        <Route path="/add-invoice"  element={<AddLedgerEntry mode="invoice" />} />
        <Route path="/ledger/new-invoice"       element={<AdminRoute><AddLedgerEntry mode="invoice" /></AdminRoute>} />
        <Route path="/ledger/new-reimbursement" element={<AdminRoute><AddLedgerEntry mode="reimbursement" /></AdminRoute>} />
        <Route path="/payments"     element={<AdminRoute><Payments /></AdminRoute>} />
        <Route path="/vendors"      element={<AdminRoute><Vendors /></AdminRoute>} />
        <Route path="/invoices"     element={<AdminRoute><CreateInvoice /></AdminRoute>} />
        <Route path="/invoices/new" element={<AdminRoute><CreateInvoice /></AdminRoute>} />
        <Route path="/team"         element={<AdminRoute><Team /></AdminRoute>} />
        <Route path="/activity"     element={<AdminRoute><Activity /></AdminRoute>} />
        <Route path="/requests"     element={<InternalRequests />} />
        <Route path="/settings"     element={<Settings />} />
      </Route>
      )}

      <Route path="*" element={<Navigate to={token ? '/' : '/login'} replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}
