import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// xem docs/architecture/code/tooling.md §4
process.env.NODE_ENV = 'test'

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10)
const execArgv = nodeMajor >= 25 ? ['--no-webstorage'] : []

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { version: appVersion } = JSON.parse(
  readFileSync(path.join(__dirname, 'package.json'), 'utf8'),
)

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // xem docs/architecture/code/tooling.md §4
      zod: path.resolve(__dirname, 'tests/shims/zod.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    execArgv,
    include: ['tests/src/**/*.{test,spec}.ts'],
    exclude: [
      'node_modules',
      'dist',
      'test-e2e/**',
      'tests/src/server/**',
      'tests/src/backend/lib/fileHelper.test.ts',
      'tests/src/shared/lib/phase.test.ts',
      'tests/src/backend/log/**',
      'tests/src/backend/db/**',
      'tests/src/backend/events/**',
      'tests/src/features/**/business/**',
      'tests/src/features/**/server/**',
    ],
    coverage: {
      provider: 'v8',
      // xem docs/architecture/code/tooling.md §5
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: './coverage/frontend',
      include: ['src/**/*.{ts,vue}'],
      exclude: [
        'src/backend/**',
        'src/features/**/business/**',
      ],
      // xem docs/agent-rules/testing.md §6
    },
  },
})
