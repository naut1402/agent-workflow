import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

// Frontend unit tests (Vue components, composables, src/ + shared/ logic).
// Backend unit/integration tests run under `bun test` instead (see package.json).
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // Co-located *.test.ts / *.spec.ts next to source — mirrors module structure.
    include: ['src/**/*.{test,spec}.ts', 'shared/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist', 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage/frontend',
      include: ['src/**/*.{ts,vue}', 'shared/**/*.ts'],
      // Thresholds start at 0 (no tests yet on setup branch) and are raised
      // per-module as each module's tests land. Target: 60% global, then tighten.
      thresholds: { lines: 0, functions: 0, branches: 0, statements: 0 },
    },
  },
})
