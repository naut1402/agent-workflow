# Test convention — coverage-first

Quy ước test **hiện hành**. Hub agent: [`AGENTS.md`](../../AGENTS.md).

Coverage ưu tiên cao — mỗi module refactor phải kèm test (unit + e2e khi thuộc phạm vi dưới đây).

---

## 1. Runner & phạm vi

| Tầng | Runner | Phạm vi | Lệnh |
|------|--------|---------|------|
| Unit/integration backend | **bun test** | `src/core/**` (http/registry), `src/features/**/business/**`, `mcp/**` | `bun run test` |
| Unit frontend | **vitest** (jsdom) | `src/**` (features, core, configs) | `bun run test:fe` |
| E2E | **@playwright/test** | full stack: server thật + fixture `.dev-team-agent/` + browser | `bun run test:e2e` |

`bun run test:all` chạy tuần tự: typecheck → lint → bun test → vitest → playwright.

---

## 2. Layout test — gom vào `tests/` + `test-e2e/`

Unit test mirror cây source trong `tests/` (vd `src/features/pipeline-editor/business/pipeline/index.ts` ↔ `tests/src/server/pipeline/merge.test.ts` — một số test domain vẫn giữ path `tests/src/server/` nhưng import source đã trỏ feature business). `tests/src/server/**` + `tests/src/features/**/business/**` + `tests/mcp/**` → bun test; `tests/src/**` (FE) → vitest.

E2E ở `test-e2e/`: `test-e2e/<feature>.spec.ts` + `test-e2e/fixtures/` (`.dev-team-agent/` giả + golden snapshot); `playwright.config.ts` trỏ `testDir` về đây.

---

## 3. Triết lý không-regression

Trước khi đụng code production: viết characterization/golden test trên hành vi hiện tại (pure fn + API response snapshot qua `app.request`) — test xanh là "ảnh chụp" hành vi gốc, refactor dưới nền xanh đó. Logic/module mới hoàn toàn → test-first (TDD thật).

---

## 4. Coverage threshold

Khởi điểm 0%, tăng dần theo từng module khi test module đó land; mục tiêu global ~60% rồi siết lên — đừng đòi coverage cao ngay từ đầu. Cập nhật threshold ở `vitest.config.ts` (frontend); backend xem qua `bun test --coverage`.

---

## 5. E2E capture

Module frontend: bắt buộc có bước capture e2e — Playwright boot app thật (standalone + fixture `.dev-team-agent`) và screenshot mode liên quan; spec này chạy thật và **gate CI** mỗi PR frontend.

Ảnh capture không ghi vào `docs/` — chụp vào `testInfo.outputPath(...)` (gitignored) rồi `testInfo.attach(...)` để vào playwright-report, đính vào comment kết quả test trên PR (xem [`pr-docs-convention.md`](pr-docs-convention.md)); CI upload artifact `test-evidence` (coverage + playwright-report).

Module backend: e2e không bắt buộc nếu chỉ migrate code. `bun run test:e2e` = `playwright test --pass-with-no-tests` (không có spec thì không chặn).
