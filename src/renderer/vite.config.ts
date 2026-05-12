import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Dev-only Vite config for running the renderer in a plain browser preview.
// The production Electron build uses electron.vite.config.ts at the repo root.
export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src'),
      '@': resolve(__dirname, 'src')
    }
  },
  plugins: [react(), tailwindcss()]
})
