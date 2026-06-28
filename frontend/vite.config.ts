import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The SPA talks to Ollama via this dev-server proxy, so the browser only ever
// hits same-origin /ollama/* — no CORS config needed on Ollama's side.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/ollama': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ''),
      },
    },
  },
})
