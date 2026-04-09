import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import config from '../shared/config.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': {
        target: config.queueServer.httpUrl,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/ws': {
        target: config.queueServer.wsUrl,
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/ws/, '')
      },
      '/ide': {
        target: config.webIde.httpUrl,
        ws: true,
        rewrite: (path) => path.replace(/^\/ide/, '')
      }
    }
  }
})
