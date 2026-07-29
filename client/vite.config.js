import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Emit sourcemaps so production stack traces show real symbols + file:line
  // instead of minified names like "s is not a function".
  build: { sourcemap: true },
  server: {
    proxy: {
      // In dev, proxy API calls to the Express server so the client can use
      // relative /api paths (matching production same-origin behaviour).
      '/api': 'http://localhost:3001',
      // Realtime chat socket — must proxy the WS upgrade too.
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
})
