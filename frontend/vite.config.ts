import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backend = process.env.TN_BACKEND ?? 'http://127.0.0.1:8077'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1600,
  },
})
