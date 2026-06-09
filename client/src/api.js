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
      localStorage.removeItem('token')
      localStorage.removeItem('admin_token')
      const path = window.location.pathname
      if (path !== '/login' && path !== '/signup') {
        window.location.href = '/login?expired=1'
      }
    }
    return Promise.reject(error)
  }
)

export default api
