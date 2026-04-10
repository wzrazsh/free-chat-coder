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
  define: {
    __APP_WORKSPACE_PATH__: JSON.stringify(config.workspace.path),
    __APP_WEB_IDE_URL__: JSON.stringify(config.webIde.httpUrl)
  },
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
      }
    }
  }
})
