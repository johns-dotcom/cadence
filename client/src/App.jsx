import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Releases from './pages/Releases'
import ReleaseDetail from './pages/ReleaseDetail'
import Artists from './pages/Artists'
import Deals from './pages/Deals'
import Contracts from './pages/Contracts'
import Renewals from './pages/Renewals'
import MyWork from './pages/MyWork'
import Ledger from './pages/Ledger'
import Payments from './pages/Payments'
import Vendors from './pages/Vendors'
import Invoices from './pages/Invoices'
import VendorSubmit from './pages/VendorSubmit'
import Team from './pages/Team'
import Settings from './pages/Settings'
import Activity from './pages/Activity'
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

// Gate: platform admin only (the SaaS operator). For workspace provisioning.
function PlatformRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user?.is_platform_admin) return <Navigate to="/" replace />
  return children
}

function AppContent() {
  const { token, loading } = useAuth()

  return (
    <Routes>
      {/* Public */}
      <Route path="/login"        element={token ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/submit/:slug" element={<VendorSubmit />} />
      <Route path="/privacy"      element={<Privacy />} />
      <Route path="/eula"         element={<EULA />} />

      {/* Authenticated app shell */}
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/"             element={<Dashboard />} />
        <Route path="/my-work"      element={<MyWork />} />
        <Route path="/releases"     element={<Releases />} />
        <Route path="/releases/:id" element={<ReleaseDetail />} />
        <Route path="/artists"      element={<Artists />} />
        <Route path="/deals"        element={<Deals />} />
        <Route path="/contracts"    element={<AdminRoute><Contracts /></AdminRoute>} />
        <Route path="/renewals"     element={<AdminRoute><Renewals /></AdminRoute>} />
        <Route path="/ledger"       element={<AdminRoute><Ledger /></AdminRoute>} />
        <Route path="/payments"     element={<AdminRoute><Payments /></AdminRoute>} />
        <Route path="/vendors"      element={<AdminRoute><Vendors /></AdminRoute>} />
        <Route path="/invoices"     element={<AdminRoute><Invoices /></AdminRoute>} />
        <Route path="/team"         element={<AdminRoute><Team /></AdminRoute>} />
        <Route path="/activity"     element={<AdminRoute><Activity /></AdminRoute>} />
        <Route path="/settings"     element={<Settings />} />
        <Route path="/workspaces"   element={<PlatformRoute><Workspaces /></PlatformRoute>} />
      </Route>

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
