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

// Frontend unit tests (Vue components, composables, src/frontend + src/shared).
// Backend unit/integration tests run under `bun test` instead (see package.json).
export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // zod 3.25 dual-package: Vite leaves named `{ z }` undefined — use shim.
      zod: path.resolve(__dirname, 'tests/shims/zod.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    execArgv,
    // Unit tests live under tests/ mirroring the source tree. Vitest owns src/frontend
    // + src/shared; bun test owns tests/src/server + tests/mcp.
    include: ['tests/src/**/*.{test,spec}.ts'],
    exclude: [
      'node_modules',
      'dist',
      'test-e2e/**',
      'tests/src/server/**',
      // Node-only helpers (fs / phase) — bun test, not jsdom. Các file lib
      // còn lại là test vitest thuần (vi.stubGlobal / vi.resetModules /
      // __APP_VERSION__) nên phải để vitest nhặt — liệt kê đích danh thay vì
      // loại trừ cả thư mục, tránh test viết rồi mà không runner nào chạy.
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
      // `json-summary` sinh `coverage-summary.json` — file mà `coverage-gate.ts`
      // đọc để ghi **mốc** coverage của version vào `reports/`, và cũng là tầng nhẹ
      // duy nhất được commit vào dòng test. `html`/`lcov` chỉ dùng cho người.
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: './coverage/frontend',
      include: ['src/**/*.{ts,vue}'],
      exclude: [
        // Scope backend — chạy bằng `bun test`, không nằm trong mẫu số coverage FE.
        'src/backend/**',
        'src/features/**/business/**',
      ],
      // 🚫 KHÔNG khai `thresholds`. Từ 2026-09-11 mức phủ không còn là cổng
      // (`docs/agent-rules/testing.md` §6): nợ test gác theo TASK ở
      // `.github/scripts/test-coverage-status.ts`, còn phần trăm chỉ được **ghi lại**.
      // `thresholds` là sàn tuyệt đối chạy trong chính lượt `vitest run --coverage`,
      // nên giữ lại thì cổng chỉ **dời chỗ** — và đỏ ở đó khó truy hơn vì không phát
      // ra từ step nào mang tên cổng. #304 (hạ ngưỡng statements về 57) là bằng chứng
      // sàn này vốn đã bị hạ bằng tay chứ không hoạt động như sàn.
    },
  },
})
