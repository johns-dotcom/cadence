import axios from 'axios'

const api = axios.create({
  // Same-origin /api in production (Express serves the build); dev uses the
  // Vite proxy (also /api). Override with VITE_API_URL if the API is elsewhere.
  baseURL: import.meta.env.VITE_API_URL || '/api',
})

// Attach the JWT to every request.
api.interceptors.request.use(
  config => {
    const token = localStorage.getItem('token')
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  },
  error => Promise.reject(error)
)

// On 401 (expired/invalid session), clear auth and bounce to login — but only
// if we actually had a token, and we're not already on a public page.
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401 && localStorage.getItem('token')) {
      const adminToken = localStorage.getItem('admin_token')
      if (adminToken) {
        // We were impersonating / inside a workspace as an operator. The scoped
        // session ended — restore the real operator session and drop back to the
        // console instead of logging out entirely.
        localStorage.setItem('token', adminToken)
        localStorage.removeItem('admin_token')
        window.location.href = '/'
        return Promise.reject(error)
      }
      localStorage.removeItem('token')
      const path = window.location.pathname
      if (path !== '/login' && path !== '/signup') {
        window.location.href = '/login?expired=1'
      }
    }
    return Promise.reject(error)
  }
)

export default api
