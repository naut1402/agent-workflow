import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Container dashboard đặt NODE_ENV=production, và vitest chỉ tự set 'test' khi biến chưa có.
// Phải ép ở đây, không phải trong test.env: Vite đọc nó lúc load config để tính isProduction.
process.env.NODE_ENV = 'test'

// Node ≥25 ships incomplete built-in localStorage that shadows jsdom's.
// Disable it so jsdom owns the global (vitest#8757 / node#60303).
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10)
const execArgv = nodeMajor >= 25 ? ['--no-webstorage'] : []

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { version: appVersion } = JSON.parse(
  readFileSync(path.join(__dirname, 'package.json'), 'utf8'),
)

// Frontend unit tests (Vue components, composables, src/core + configs).
// Backend unit/integration tests run under `bun test` instead (see package.json).
export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      '@configs': path.resolve(__dirname, 'src/core/configs'),
      '@': path.resolve(__dirname, 'src'),
      // zod 3.25 dual-package: Vite leaves named `{ z }` undefined — use shim.
      zod: path.resolve(__dirname, 'tests/shims/zod.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    execArgv,
    // Unit tests live under tests/ mirroring the source tree. Vitest owns FE +
    // configs; bun test owns tests/src/server + tests/mcp.
    include: ['tests/src/**/*.{test,spec}.ts'],
    exclude: [
      'node_modules',
      'dist',
      'test-e2e/**',
      'tests/src/server/**',
      // Node-only helpers (fs / phase) — bun test, not jsdom. Các file core/lib
      // còn lại là test vitest thuần (vi.stubGlobal / vi.resetModules /
      // __APP_VERSION__) nên phải để vitest nhặt — liệt kê đích danh thay vì
      // loại trừ cả thư mục, tránh test viết rồi mà không runner nào chạy.
      'tests/src/core/lib/fileHelper.test.ts',
      'tests/src/core/lib/phase.test.ts',
      'tests/src/core/log/**',
      'tests/src/core/events/**',
      'tests/src/features/**/business/**',
      'tests/src/features/**/server/**',
    ],
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
