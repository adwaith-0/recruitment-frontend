import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Only used to locate the local API bridge; never exposed to client code
  // (Vite only exposes variables prefixed with VITE_).
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = `http://${env.API_HOST || '127.0.0.1'}:${env.API_PORT || 8787}`

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          // Hosted agent cold starts plus tool calls can take a while.
          timeout: 150_000,
          proxyTimeout: 150_000,
        },
      },
    },
    preview: {
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true, timeout: 150_000, proxyTimeout: 150_000 },
      },
    },
  }
})
