import React, { createContext, useContext, useState, useEffect } from 'react'
import api from '../api'
import { applyAccent, resetAccent } from '../utils/branding'
import { resetCategoriesCache } from '../hooks/useCategories'
import { resetReconciledCache } from '../hooks/useReconciledThrough'

const AuthContext = createContext()

export const AuthProvider = ({ children }) => {
  const [user, setUser]   = useState(null)
  const [label, setLabel] = useState(null) // the current workspace (tenant)
  const [token, setToken] = useState(localStorage.getItem('token'))
  const [loading, setLoading] = useState(true)
  const [pagePermissions, setPagePermissions] = useState(null) // null = unrestricted

  // Impersonation — stash real admin token in a separate key while viewing as someone else
  const [impersonating, setImpersonating] = useState(!!localStorage.getItem('admin_token'))
  const [adminUser, setAdminUser]         = useState(null)

  // Bumped whenever the ACTING identity changes — enter/leave a workspace, or
  // impersonate/stop impersonating. App.jsx keys the route tree on it, so every
  // mounted page unmounts and refetches.
  //
  // Why a counter and not `${user?.id}:${label?.id}`: a derived key also flips
  // on first load (null → resolved) and would remount the whole app on every
  // cold start, double-fetching every page. This changes on exactly the events
  // that mean "you are now looking at different data".
  //
  // Why it is needed at all: entering a workspace was setState-only. React kept
  // Dashboard, useTaskData and every other mounted page alive with the previous
  // tenant's rows in state — new token, old numbers on screen.
  const [sessionEpoch, setSessionEpoch] = useState(0)
  const newSession = () => {
    // Module-level caches live outside React and a remount does not clear them.
    resetCategoriesCache()
    resetReconciledCache()
    setSessionEpoch(n => n + 1)
  }

  useEffect(() => {
    if (token) fetchUser()
    else setLoading(false)
  }, [token])

  // Apply the active workspace's brand accent (or reset to Cadence default).
  useEffect(() => {
    if (label?.accent_color) applyAccent(label.accent_color)
    else resetAccent()
  }, [label?.accent_color])

  const fetchUser = async () => {
    try {
      const { data } = await api.get('/auth/me')
      const u = data.data
      setUser(u)
      setLabel({ id: u.label_id, name: u.label_name, slug: u.label_slug, accent_color: u.label_accent_color, logo_url: u.label_logo_url, vendor_form_token: u.label_vendor_form_token, settings: u.label_settings || {} })
      setPagePermissions(u.pagePermissions ?? null)
    } catch (error) {
      console.error('Failed to fetch user:', error)
      // Only end the session on a real auth failure (401 — the interceptor also
      // handles the redirect). A transient 5xx/network error must NOT nuke a
      // valid session, or a blip logs the user out.
      if (error.response?.status === 401) logout()
    } finally {
      setLoading(false)
    }
  }

  const applySession = (newToken, userData, labelData) => {
    // A second login in the same tab (logout → sign in as someone else) reuses
    // this module instance, so the per-workspace caches have to go.
    resetCategoriesCache()
    resetReconciledCache()
    localStorage.setItem('token', newToken)
    setToken(newToken)
    setUser(userData)
    if (labelData) setLabel(labelData)
  }

  const login = async (email, password, workspace) => {
    try {
      const { data } = await api.post('/auth/login', { email, password, workspace })
      const { token: newToken, user: userData } = data.data
      applySession(newToken, userData)
      return { success: true }
    } catch (error) {
      // 409 = email maps to multiple workspaces; surface the list so the UI
      // can ask which one.
      if (error.response?.status === 409) {
        return { success: false, error: error.response.data.error, workspaces: error.response.data.workspaces }
      }
      const serverMsg = error.response?.data?.error
      return { success: false, error: serverMsg || error.message || 'Login failed' }
    }
  }

  const googleLogin = async (credential, workspace) => {
    try {
      const { data } = await api.post('/auth/google', { credential, workspace })
      const { token: newToken, user: userData } = data.data
      applySession(newToken, userData)
      return { success: true }
    } catch (error) {
      if (error.response?.status === 409) {
        return { success: false, error: error.response.data.error, workspaces: error.response.data.workspaces }
      }
      return { success: false, error: error.response?.data?.error || 'Google sign-in failed' }
    }
  }

  const logout = () => {
    resetCategoriesCache()
    resetReconciledCache()
    localStorage.removeItem('token')
    localStorage.removeItem('admin_token')
    setToken(null)
    setUser(null)
    setLabel(null)
    setPagePermissions(null)
    setImpersonating(false)
    setAdminUser(null)
  }

  // Swap into another user's session (same workspace) — stores the real token.
  const impersonate = async (targetUserId) => {
    try {
      const { data } = await api.post(`/auth/impersonate/${targetUserId}`)
      const { token: impToken, user: impUser } = data.data
      localStorage.setItem('admin_token', localStorage.getItem('token'))
      setAdminUser(user)
      localStorage.setItem('token', impToken)
      setToken(impToken)
      setUser(impUser)
      setImpersonating(true)
      newSession()
      return { success: true }
    } catch (err) {
      return { success: false, error: err.response?.data?.error || 'Failed to impersonate' }
    }
  }

  // Platform admin: drop into another label's workspace. Same stash/swap as
  // impersonate(), but also switches the label context to the target.
  const enterWorkspace = async (labelId) => {
    try {
      const { data } = await api.post(`/platform/workspaces/${labelId}/enter`)
      const { token: wsToken, user: wsUser, label: wsLabel } = data.data
      localStorage.setItem('admin_token', localStorage.getItem('token'))
      setAdminUser(user)
      localStorage.setItem('token', wsToken)
      setToken(wsToken)
      setUser(wsUser)
      setLabel(wsLabel)
      setImpersonating(true)
      newSession()
      return { success: true }
    } catch (err) {
      return { success: false, error: err.response?.data?.error || 'Failed to enter workspace' }
    }
  }

  const exitImpersonation = () => {
    const adminToken = localStorage.getItem('admin_token')
    if (!adminToken) { logout(); return }
    localStorage.setItem('token', adminToken)
    localStorage.removeItem('admin_token')
    setToken(adminToken)
    setImpersonating(false)
    setAdminUser(null)
    newSession()
    // Restore the real identity AND label context (we may have been viewing a
    // different workspace, so the label must be reset too).
    api.get('/auth/me').then(res => {
      const u = res.data.data
      setUser(u)
      setLabel({ id: u.label_id, name: u.label_name, slug: u.label_slug, accent_color: u.label_accent_color, logo_url: u.label_logo_url })
    }).catch(() => logout())
  }

  // Merge updates into the current workspace (used by Settings after a
  // branding change so the UI re-themes without a full reload).
  const updateLabel = (partial) => setLabel(l => ({ ...(l || {}), ...partial }))

  // canView: true if the current user may see a page path. Admins/Approvers
  // are unrestricted; a null permission set means unrestricted for everyone.
  const canView = (path) => {
    if (!user) return false
    if (path === '/settings' || path === '/requests' || path === '/add-invoice' || path === '/messages') return true // self-service — never gated
    if (['Superadmin', 'Admin', 'Approver'].includes(user.role)) return true
    if (pagePermissions === null) return true
    // A grant on a parent path covers its carved-out subpages
    // (e.g. '/recoupments' covers '/recoupments/planning').
    return pagePermissions.some(p => path === p || (p !== '/' && path.startsWith(p + '/')))
  }

  return (
    <AuthContext.Provider value={{
      user, label, token, loading,
      login, googleLogin, logout, updateLabel,
      impersonate, enterWorkspace, exitImpersonation, impersonating, adminUser,
      pagePermissions, canView, sessionEpoch,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
