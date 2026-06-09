import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'
import App from './App'
import { ThemeProvider } from './context/ThemeContext'
import { ToastProvider } from './context/ToastContext'
import { applyAccent } from './utils/branding'
import './index.css'

// Apply saved theme + brand accent before React renders to avoid a flash of
// the wrong theme / default accent on reload.
if (localStorage.getItem('theme') === 'dark') {
  document.documentElement.classList.add('dark')
}
const savedAccent = localStorage.getItem('brand_accent')
if (savedAccent) applyAccent(savedAccent)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || ''}>
      <BrowserRouter>
        <ThemeProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </ThemeProvider>
      </BrowserRouter>
    </GoogleOAuthProvider>
  </React.StrictMode>,
)
