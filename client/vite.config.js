import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // In dev, proxy API calls to the Express server so the client can use
      // relative /api paths (matching production same-origin behaviour).
      '/api': 'http://localhost:3001',
    },
  },
})
