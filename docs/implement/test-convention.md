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

### Vòng lặp local — chạy theo phạm vi

Full suite (~1 phút: bun test ~20s + vitest ~40s) là việc của CI — mọi PR đều chạy đủ ở workflow `CI`. Ở local dùng:

```bash
bun run test:scope                       # suy ra phạm vi từ thay đổi chưa commit
bun run test:scope --base origin/dev/1.1.1/main   # + các commit trên nhánh
bun run test:scope src/features/automations       # ép phạm vi theo path/thư mục
bun run test:scope --list                # chỉ in ra sẽ chạy gì
```

Script dựng đồ thị import của `src/` + `mcp/` + `tests/` rồi chọn mọi test file **đi tới được** file đã đổi (transitive), tách sẵn theo runner. Nó cố tình chọn rộng hơn là hẹp: sửa `src/core/lib/fileHelper.ts` kéo theo ~100 file test, sửa một component chỉ còn 2.

Blind spot phải tự biết — trong các trường hợp này chạy full trước khi push:

- **Nạp động**: `apiServer.ts` quét `features/<name>/api.ts` lúc chạy, không có cạnh import nào. Script bù bằng cạnh ảo cho đúng chỗ này; nếu thêm điểm nạp động khác thì phải khai báo thêm trong `.github/scripts/test-scope.ts`.
- **Không đi qua import**: fixture, file JSON/YAML, snapshot, biến môi trường, dữ liệu trong `test-e2e/fixtures/`.
- **Đổi hạ tầng** (`package.json`, `vitest.config.ts`, `tsconfig.json`, `bun.lock`, …) — script tự nhận ra và chạy full.

Chọn hẹp chỉ giảm thời gian, không giảm trách nhiệm: **test xanh ở local vẫn có thể đỏ ở CI** vì môi trường khác (plugin cài sẵn trên máy, `/opt/bundled-plugins`, `~/.claude/…`, browser cho e2e). Test đụng filesystem/registry/agent resolution nên chạy thêm một lượt với env đã tước (`HOME` rỗng, biến plugin trỏ path không tồn tại) trước khi tin là xanh.

**Chạy test trong container dashboard**: image có sẵn `bun` + `node` (Node 24 — `vitest`/`eslint`/`vue-tsc` là script `#!/usr/bin/env node`). `cd /data/project/<repo>` rồi chạy đúng các lệnh trong bảng trên, không cần thêm biến môi trường. `node_modules` lấy từ chính repo mount, không dùng `/app/node_modules`.

---

## 2. Layout test — gom vào `tests/` + `test-e2e/`

Unit test mirror cây source trong `tests/` (vd `src/features/pipeline-editor/business/pipeline/index.ts` ↔ `tests/src/server/pipeline/merge.test.ts` — một số test domain vẫn giữ path `tests/src/server/` nhưng import source đã trỏ feature business). `tests/src/server/**` + `tests/src/features/**/business/**` + `tests/mcp/**` → bun test; `tests/src/**` (FE) → vitest.

E2E ở `test-e2e/`: `test-e2e/<feature>.spec.ts` + `test-e2e/fixtures/` (`.dev-team-agent/` giả + golden snapshot); `playwright.config.ts` trỏ `testDir` về đây.

---

## 3. Triết lý không-regression

Trước khi đụng code production: viết characterization/golden test trên hành vi hiện tại (pure fn + API response snapshot qua `app.request`) — test xanh là "ảnh chụp" hành vi gốc, refactor dưới nền xanh đó. Logic/module mới hoàn toàn → test-first (TDD thật).

Test tự nhiên fail sau khi sửa code (kể cả lỗi chỉ lộ ra ở CI, không tái hiện local): điều tra **root cause**, sửa code sản phẩm — không mock/stub để né qua đường code đang lỗi. Trạng thái trước khi sửa xanh thì sau khi sửa phải xanh lại đúng nghĩa (test vẫn chạy qua code thật), không phải "làm cho CI đỡ đỏ". Mock chỉ hợp lệ cho phụ thuộc ngoài (API, thư viện nặng/không chạy được dưới jsdom, …) đã hợp lý từ đầu — không dùng mock để thay cho việc sửa 1 bug vừa phát hiện.

---

## 4. Coverage threshold

Khởi điểm 0%, tăng dần theo từng module khi test module đó land; mục tiêu global ~60% rồi siết lên — đừng đòi coverage cao ngay từ đầu. Cập nhật threshold ở `vitest.config.ts` (frontend); backend xem qua `bun test --coverage`.

---

## 5. E2E capture

Module frontend: bắt buộc có bước capture e2e — Playwright boot app thật (standalone + fixture `.dev-team-agent`) và screenshot mode liên quan; spec này chạy thật và **gate CI** mỗi PR frontend.

Ảnh capture không ghi vào `docs/` — chụp vào `testInfo.outputPath(...)` (gitignored) rồi `testInfo.attach(...)` để vào playwright-report, đính vào comment kết quả test trên PR (xem [`pr-docs-convention.md`](pr-docs-convention.md)); CI upload artifact `test-evidence` (coverage + playwright-report).

Module backend: e2e không bắt buộc nếu chỉ migrate code. `bun run test:e2e` = `playwright test --pass-with-no-tests` (không có spec thì không chặn).
