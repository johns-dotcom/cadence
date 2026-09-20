import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Where the dev client proxies the API. Defaults to the same :3001 this has
// always used, so nothing changes unless you ask it to — but boom-dashboard
// defaults to :3001 as well, and with both checked out on one machine the
// second server to start dies with EADDRINUSE. Setting this alongside the
// server's own PORT moves Cadence out of the way without editing tracked files:
//
//   PORT=3002 npm run dev:server
//   VITE_API_TARGET=http://localhost:3002 npm run dev:client
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:3001'

export default defineConfig({
  plugins: [react()],
  // Emit sourcemaps so production stack traces show real symbols + file:line
  // instead of minified names like "s is not a function".
  build: { sourcemap: true },
  server: {
    proxy: {
      // In dev, proxy API calls to the Express server so the client can use
      // relative /api paths (matching production same-origin behaviour).
      '/api': API_TARGET,
      // Realtime chat socket — must proxy the WS upgrade too.
      '/socket.io': { target: API_TARGET, ws: true },
    },
  },
})
