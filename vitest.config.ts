import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Node ≥25 ships incomplete built-in localStorage that shadows jsdom's.
// Disable it so jsdom owns the global (vitest#8757 / node#60303).
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10)
const execArgv = nodeMajor >= 25 ? ['--no-webstorage'] : []

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { version: appVersion } = JSON.parse(
  readFileSync(path.join(__dirname, 'package.json'), 'utf8'),
)

// Frontend unit tests (Vue components, composables, src/core + contracts).
// Backend unit/integration tests run under `bun test` instead (see package.json).
export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/core/contracts'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    execArgv,
    // Unit tests live under tests/ mirroring the source tree. Vitest owns FE +
    // contracts; bun test owns tests/src/server + tests/mcp.
    include: ['tests/src/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist', 'test-e2e/**', 'tests/src/server/**', 'tests/src/core/log/**', 'tests/src/features/**/business/**', 'tests/src/features/**/server/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage/frontend',
      include: ['src/**/*.{ts,vue}'],
      exclude: [
        'src/api/apiServer.ts',
        'src/api/devTeamApi.ts',
        'src/core/http/responseHelper.ts',
        'src/core/http/types.ts',
        'src/core/http/AbstractController.ts',
        'src/core/registry.ts',
        'src/standalone.ts',
        'src/runner-cli.mjs',
        'src/features/**/business/**',
      ],
      // Thresholds start at 0 (no tests yet on setup branch) and are raised
      // per-module as each module's tests land. Target: 60% global, then tighten.
      thresholds: { lines: 0, functions: 0, branches: 0, statements: 0 },
    },
  },
})
