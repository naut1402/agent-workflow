# Testing Rules — Coverage-first

Coverage là ưu tiên cao. Mỗi module refactor phải kèm test (unit + e2e).

## Runner & phạm vi

| Tầng | Runner | Phạm vi | Lệnh |
|------|--------|---------|------|
| Unit/integration backend | **bun test** | `server/**`, `mcp/**` (pure fn, domain module với fake ctx, Hono `app.request`) | `bun run test` |
| Unit frontend | **vitest** (jsdom) | `src/**`, `shared/**` (composable, lib, schema, component @vue/test-utils) | `bun run test:fe` |
| E2E | **@playwright/test** | full stack: server thật + fixture `.dev-team-agent/` + browser | `bun run test:e2e` |

`bun run test:all` chạy tuần tự: typecheck → bun test → vitest → playwright.

## Layout test — gom vào `tests/` + `test-e2e/`
- **Unit: `tests/` mirror cây source** (`server/pipeline/merge.ts` ↔ `tests/server/pipeline/merge.test.ts`). KHÔNG co-locate cạnh source nữa.
  - `tests/server/**` + `tests/mcp/**` → **bun test** (`bun run test` = `bun test tests/server tests/mcp`).
  - `tests/src/**` + `tests/shared/**` → **vitest** (`bun run test:fe`).
  - Backend test → `bun:test` API. Frontend/shared test → import từ `vitest`.
  - Import source bằng **relative path** trỏ ngược về cây gốc (vd `tests/server/pipeline/merge.test.ts` → `../../../server/pipeline/merge`).
- **E2E: `test-e2e/`** — `test-e2e/<feature>.spec.ts` + `test-e2e/fixtures/` (`.dev-team-agent/` giả + golden snapshot). `playwright.config.ts` → `testDir: './test-e2e'`.

## Triết lý không-regression
- **Trước khi đụng code production**: viết **characterization / golden test** trên hành vi JS hiện tại (pure fn + API response snapshot qua Hono `app.request`). Test xanh = "ảnh chụp" hành vi gốc. Refactor dưới màu xanh.
- Logic/module MỚI tách ra → **test-first (TDD thật)**.

## Coverage threshold
- Khởi điểm threshold = 0 (chưa có test). **Tăng dần theo từng module** khi test module đó land; mục tiêu global ~60% rồi siết lên.
- Cập nhật threshold trong `vitest.config.ts` (frontend). Backend coverage qua `bun test --coverage`.

## E2E capture
- **Module frontend**: BẮT BUỘC có bước **xác nhận capture từ e2e** — Playwright boot app thật (standalone + fixture `.dev-team-agent`) và screenshot mode liên quan vào `docs/<feature>-evidence/`. Spec này **chạy thật và gate CI** mỗi PR frontend (refactor hỏng import → SPA không mount → CI đỏ).
- **Module backend**: e2e không bắt buộc; nếu chỉ migrate code chưa cần spec mới.
- `bun run test:e2e` = `playwright test --pass-with-no-tests` (không có spec thì không chặn; có spec thì chạy).
