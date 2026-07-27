import React, { createContext, useContext, useState, useEffect } from 'react'
import api from '../api'
import { applyAccent, resetAccent } from '../utils/branding'

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
      setLabel({ id: u.label_id, name: u.label_name, slug: u.label_slug, accent_color: u.label_accent_color, logo_url: u.label_logo_url, vendor_form_token: u.label_vendor_form_token })
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
    if (path === '/settings') return true // self-service (My Nav / Theme) — never gated
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
      pagePermissions, canView,
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
