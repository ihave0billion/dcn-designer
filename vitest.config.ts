import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const rendererSrc = fileURLToPath(new URL('./src/renderer/src', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': rendererSrc,
      '@renderer': rendererSrc,
      '@domain': resolve(fileURLToPath(new URL('./src/domain', import.meta.url)))
    }
  },
  // The renderer builds go through @vitejs/plugin-react, which sets the
  // automatic JSX runtime. This config has no plugins, so JSX in a test would
  // otherwise compile to the classic React.createElement form and fail on an
  // undefined `React` (Phase 9 — DesignReport.test.tsx).
  esbuild: { jsx: 'automatic' },
  test: {
    include: [
      'src/domain/**/*.test.ts',
      'src/domain/**/*.spec.ts',
      'src/renderer/src/lib/**/*.test.ts',
      // Phase 9 — the PDF report is JSX, so its test file is .tsx.
      'src/renderer/src/lib/**/*.test.tsx'
    ],
    environment: 'node',
    globals: false
  }
})
