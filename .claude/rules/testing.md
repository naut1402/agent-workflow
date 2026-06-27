# Testing Rules — Coverage-first

Coverage là ưu tiên cao. Mỗi module refactor phải kèm test (unit + e2e).

## Runner & phạm vi

| Tầng | Runner | Phạm vi | Lệnh |
|------|--------|---------|------|
| Unit/integration backend | **bun test** | `server/**`, `mcp/**` (pure fn, domain module với fake ctx, Hono `app.request`) | `bun run test` |
| Unit frontend | **vitest** (jsdom) | `src/**`, `shared/**` (composable, lib, schema, component @vue/test-utils) | `bun run test:fe` |
| E2E | **@playwright/test** | full stack: server thật + fixture `.dev-team-agent/` + browser | `bun run test:e2e` |

`bun run test:all` chạy tuần tự: typecheck → bun test → vitest → playwright.

## Layout test — mirror cấu trúc module
- **Unit: co-locate** `*.test.ts` NGAY CẠNH source (`pipeline/merge.ts` ↔ `pipeline/merge.test.ts`). Đây là cách "test phân cấp theo module" — không tạo cây test song song.
- **E2E: thư mục riêng** `e2e/<feature>.spec.ts` + `e2e/fixtures/` (`.dev-team-agent/` giả + golden snapshot).
- Backend test → `bun:test` API. Frontend/shared test → import từ `vitest`.

## Triết lý không-regression
- **Trước khi đụng code production**: viết **characterization / golden test** trên hành vi JS hiện tại (pure fn + API response snapshot qua Hono `app.request`). Test xanh = "ảnh chụp" hành vi gốc. Refactor dưới màu xanh.
- Logic/module MỚI tách ra → **test-first (TDD thật)**.

## Coverage threshold
- Khởi điểm threshold = 0 (chưa có test). **Tăng dần theo từng module** khi test module đó land; mục tiêu global ~60% rồi siết lên.
- Cập nhật threshold trong `vitest.config.ts` (frontend). Backend coverage qua `bun test --coverage`.

## E2E trong giai đoạn migrate
- E2E **chỉ chuyển đổi code** từ `scripts/verify-*.mjs` sang `@playwright/test`, **chưa cần xác nhận chạy** (làm sau cho đỡ tốn token). CI dùng `--pass-with-no-tests` nên không chặn khi chưa có spec.
