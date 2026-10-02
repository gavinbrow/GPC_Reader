import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        // Forward WebSocket upgrades (the one-click analysis progress stream
        // lives at ws://…/api/experiments/{id}/progress). Without this the WS
        // never reaches the backend and the progress bar hangs at 0%.
        ws: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 5000,
  },
})