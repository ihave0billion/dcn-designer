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
  test: {
    include: ['src/domain/**/*.test.ts', 'src/domain/**/*.spec.ts'],
    environment: 'node',
    globals: false
  }
})
