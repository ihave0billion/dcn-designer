import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Build config for the self-hosted web target (served by src/server). The Electron
// desktop build still uses electron.vite.config.ts — this one only differs in that it
// emits a plain static bundle and flags the renderer to talk HTTP instead of IPC.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: '/',
  define: {
    'import.meta.env.VITE_DCN_TARGET': JSON.stringify('web')
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@': resolve(__dirname, 'src/renderer/src'),
      '@domain': resolve(__dirname, 'src/domain')
    }
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(__dirname, 'out/web'),
    emptyOutDir: true,
    sourcemap: false
  },
  server: {
    port: 5174,
    // `npm run dev:web` runs Vite next to the API server; proxy so relative /api calls
    // from the adapter reach it without CORS.
    proxy: {
      '/api': { target: `http://127.0.0.1:${process.env.PORT || 8788}`, changeOrigin: true }
    }
  }
})
