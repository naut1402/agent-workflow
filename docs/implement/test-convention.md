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

### 2.1 Danh mục suite

Tra bảng này để biết **vùng mình sửa đã có suite nào** (chạy đúng suite đó) và **chỗ nào chưa có** (phải bổ sung test, đừng để trống). Cột "Vùng source phủ" lấy từ import trực tiếp của các test trong suite — nó nói suite đó *của* module nào, không phải toàn bộ closure.

Sinh lại sau khi thêm/đổi thư mục test — bảng lệch là bảng vô dụng:

```bash
bun run test:scope --catalog
```

Chạy nhiều suite một lượt thì nối path (cùng runner), hoặc để `bun run test:scope` tự suy ra từ thay đổi:

```bash
bun test tests/src/server/automations tests/src/features/monitor/business
npx vitest run tests/src/features/automations tests/src/core/ui
```

| Suite | Runner | Vùng source phủ | Số file | Lệnh chạy |
|---|---|---|---|---|
| `tests/mcp` | bun | `mcp` | 1 | `bun test tests/mcp` |
| `tests/src` | vitest | `core/shell`, `App.vue`, `core/container` | 1 | `npx vitest run tests/src/*.test.ts` |
| `tests/src/api` | vitest | `features/pipeline-editor/scripts`, `features/agent-editor/scripts` | 2 | `npx vitest run tests/src/api` |
| `tests/src/core/composables` | vitest | `core/composables` | 4 | `npx vitest run tests/src/core/composables` |
| `tests/src/core/configs` | vitest | `core/configs` | 3 | `npx vitest run tests/src/core/configs` |
| `tests/src/core/container` | vitest | `core/container` | 1 | `npx vitest run tests/src/core/container` |
| `tests/src/core/events` | bun | `core/events` | 1 | `bun test tests/src/core/events` |
| `tests/src/core/http` | vitest | `core/http` | 1 | `npx vitest run tests/src/core/http` |
| `tests/src/core/i18n` | vitest | `core/composables`, `core/configs`, `plugins/i18n` | 1 | `npx vitest run tests/src/core/i18n` |
| `tests/src/core/lib` | vitest | `core/lib`, `core/http` | 8 | `npx vitest run tests/src/core/lib` |
| `tests/src/core/log` | bun | `core/log`, `features/logs/business`, `core/events` | 4 | `bun test tests/src/core/log` |
| `tests/src/core/shell` | vitest | `core/shell` | 2 | `npx vitest run tests/src/core/shell` |
| `tests/src/core/ui` | vitest | `core/ui` | 4 | `npx vitest run tests/src/core/ui` |
| `tests/src/features/agent-editor/business` | bun | `features/agent-editor/business` | 2 | `bun test tests/src/features/agent-editor/business` |
| `tests/src/features/agent-editor/components` | vitest | `features/agent-editor/components`, `core/lib`, `features/agent-editor/business` | 3 | `npx vitest run tests/src/features/agent-editor/components` |
| `tests/src/features/agent-editor/composables` | vitest | `features/agent-editor/composables` | 1 | `npx vitest run tests/src/features/agent-editor/composables` |
| `tests/src/features/automations/components` | vitest | `features/automations/components`, `features/automations/scripts` | 2 | `npx vitest run tests/src/features/automations/components` |
| `tests/src/features/automations/composables` | vitest | `features/automations/composables`, `features/automations/scripts` | 1 | `npx vitest run tests/src/features/automations/composables` |
| `tests/src/features/automations/scripts` | vitest | `features/automations/scripts` | 1 | `npx vitest run tests/src/features/automations/scripts` |
| `tests/src/features/knowledge/business` | bun | `features/knowledge/business` | 3 | `bun test tests/src/features/knowledge/business` |
| `tests/src/features/knowledge/components` | vitest | `features/knowledge/components` | 1 | `npx vitest run tests/src/features/knowledge/components` |
| `tests/src/features/logs/business` | bun | `features/logs/business`, `features/runner/business`, `core/log` | 3 | `bun test tests/src/features/logs/business` |
| `tests/src/features/logs/components` | vitest | `features/logs/components`, `features/settings/scripts` | 1 | `npx vitest run tests/src/features/logs/components` |
| `tests/src/features/logs/composables` | vitest | `core/log`, `features/logs/composables` | 3 | `npx vitest run tests/src/features/logs/composables` |
| `tests/src/features/logs/scripts` | vitest | `features/logs/scripts` | 1 | `npx vitest run tests/src/features/logs/scripts` |
| `tests/src/features/monitor` | vitest | `features/monitor/composables` | 1 | `npx vitest run tests/src/features/monitor/*.test.ts` |
| `tests/src/features/monitor/business` | bun | `features/monitor/business`, `core/lib`, `features/runner/business` | 4 | `bun test tests/src/features/monitor/business` |
| `tests/src/features/monitor/components` | vitest | `features/monitor/components`, `features/monitor/scripts`, `core/composables` | 10 | `npx vitest run tests/src/features/monitor/components` |
| `tests/src/features/monitor/composables` | vitest | `features/monitor/composables`, `features/runner/scripts` | 6 | `npx vitest run tests/src/features/monitor/composables` |
| `tests/src/features/monitor/lib` | vitest | `features/monitor/lib` | 4 | `npx vitest run tests/src/features/monitor/lib` |
| `tests/src/features/monitor/schemas` | vitest | `features/monitor/schemas` | 1 | `npx vitest run tests/src/features/monitor/schemas` |
| `tests/src/features/nl-chat/composables` | vitest | `features/nl-chat/composables` | 2 | `npx vitest run tests/src/features/nl-chat/composables` |
| `tests/src/features/nl-chat/lib` | vitest | `features/nl-chat/lib` | 1 | `npx vitest run tests/src/features/nl-chat/lib` |
| `tests/src/features/notifications/components` | vitest | `features/notifications/components`, `features/notifications/lib` | 3 | `npx vitest run tests/src/features/notifications/components` |
| `tests/src/features/notifications/composables` | vitest | `features/notifications/lib`, `core/composables`, `features/notifications/composables` | 1 | `npx vitest run tests/src/features/notifications/composables` |
| `tests/src/features/notifications/lib` | vitest | `features/notifications/lib` | 2 | `npx vitest run tests/src/features/notifications/lib` |
| `tests/src/features/pipeline-editor/business` | bun | `features/pipeline-editor/business` | 2 | `bun test tests/src/features/pipeline-editor/business` |
| `tests/src/features/pipeline-editor/components` | vitest | `features/pipeline-editor/components`, `features/pipeline-editor/scripts` | 3 | `npx vitest run tests/src/features/pipeline-editor/components` |
| `tests/src/features/pipeline-editor/lib` | vitest | `features/pipeline-editor/lib` | 1 | `npx vitest run tests/src/features/pipeline-editor/lib` |
| `tests/src/features/pipeline-editor/scripts` | vitest | `features/pipeline-editor/scripts` | 1 | `npx vitest run tests/src/features/pipeline-editor/scripts` |
| `tests/src/features/quick-action/components` | vitest | `features/quick-action/components`, `features/quick-action/scripts`, `features/runner/scripts` | 1 | `npx vitest run tests/src/features/quick-action/components` |
| `tests/src/features/quick-action/composables` | vitest | `features/quick-action/composables` | 1 | `npx vitest run tests/src/features/quick-action/composables` |
| `tests/src/features/quick-action/lib` | vitest | `features/quick-action/lib` | 1 | `npx vitest run tests/src/features/quick-action/lib` |
| `tests/src/features/runner/business` | bun | `features/runner/business` | 8 | `bun test tests/src/features/runner/business` |
| `tests/src/features/runner/components` | vitest | `features/runner/components`, `features/runner/scripts`, `features/runner/locales` | 2 | `npx vitest run tests/src/features/runner/components` |
| `tests/src/features/runner/scripts` | vitest | `features/runner/scripts` | 1 | `npx vitest run tests/src/features/runner/scripts` |
| `tests/src/features/running-jobs/components` | vitest | `features/running-jobs/components`, `features/running-jobs/lib` | 1 | `npx vitest run tests/src/features/running-jobs/components` |
| `tests/src/features/running-jobs/composables` | vitest | `features/runner/scripts`, `features/running-jobs/composables` | 1 | `npx vitest run tests/src/features/running-jobs/composables` |
| `tests/src/features/running-jobs/lib` | vitest | `features/running-jobs/lib` | 1 | `npx vitest run tests/src/features/running-jobs/lib` |
| `tests/src/features/settings/components` | vitest | `core/composables`, `features/settings/components`, `features/settings/scripts` | 1 | `npx vitest run tests/src/features/settings/components` |
| `tests/src/features/settings/schemas` | vitest | `features/settings/schemas` | 4 | `npx vitest run tests/src/features/settings/schemas` |
| `tests/src/features/statistics/business` | bun | `core/log`, `features/statistics/business` | 1 | `bun test tests/src/features/statistics/business` |
| `tests/src/features/statistics/components` | vitest | `features/statistics/components`, `features/statistics/lib` | 2 | `npx vitest run tests/src/features/statistics/components` |
| `tests/src/features/statistics/lib` | vitest | `features/statistics/lib` | 2 | `npx vitest run tests/src/features/statistics/lib` |
| `tests/src/server` | bun | `features/settings/business`, `core/registry.ts`, `api/apiServer.ts` | 3 | `bun test tests/src/server/*.test.ts` |
| `tests/src/server/agents` | bun | `features/agent-editor/business` | 5 | `bun test tests/src/server/agents` |
| `tests/src/server/artifactActions` | bun | `features/monitor/business`, `features/monitor/schemas` | 1 | `bun test tests/src/server/artifactActions` |
| `tests/src/server/automations` | bun | `features/automations/business`, `features/automations/schemas`, `core/events` | 9 | `bun test tests/src/server/automations` |
| `tests/src/server/catalog` | bun | `features/pipeline-editor/business` | 3 | `bun test tests/src/server/catalog` |
| `tests/src/server/chat` | bun | `features/runner/business`, `features/monitor/business`, `features/nl-chat/business` | 5 | `bun test tests/src/server/chat` |
| `tests/src/server/github` | bun | `features/monitor/business`, `api/apiServer.ts`, `core/registry.ts` | 2 | `bun test tests/src/server/github` |
| `tests/src/server/http` | bun | `api/apiServer.ts`, `core/http`, `features/runner/business` | 22 | `bun test tests/src/server/http` |
| `tests/src/server/lib` | bun | `core/lib` | 1 | `bun test tests/src/server/lib` |
| `tests/src/server/pipeline` | bun | `features/pipeline-editor/business` | 2 | `bun test tests/src/server/pipeline` |
| `tests/src/server/rules` | bun | `features/pipeline-editor/business` | 1 | `bun test tests/src/server/rules` |
| `tests/src/server/runners` | bun | `features/runner/business`, `core/events`, `core/log` | 20 | `bun test tests/src/server/runners` |
| `tests/src/server/settings` | bun | `features/settings/business` | 1 | `bun test tests/src/server/settings` |
| `tests/src/server/tasks` | bun | `features/monitor/business`, `features/runner/business`, `core/events` | 4 | `bun test tests/src/server/tasks` |
| `tests/tools` | bun | `tooling` | 1 | `bun test tests/tools` |

Script tooling của repo (`.github/scripts/`) có test riêng ở `tests/tools/` — cùng runner bun, khai báo trong script `test` của `package.json`.

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
