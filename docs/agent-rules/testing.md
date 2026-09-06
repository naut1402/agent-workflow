# Testing — chọn runner, phạm vi chạy, danh mục suite

Quy ước test **hiện hành**. Coverage ưu tiên cao: mỗi module refactor phải kèm test.

---

## 1. Runner & phạm vi

| Tầng | Runner | Phạm vi | Lệnh |
|------|--------|---------|------|
| Unit/integration backend | **bun test** | `src/core/**` (http/registry), `src/features/**/business/**`, `mcp/**` | `bun run test` |
| Unit frontend | **vitest** (jsdom) | `src/**` (features, core, configs) | `bun run test:fe` |
| E2E | **@playwright/test** | full stack: server thật + fixture `.dev-team-agent/` + browser | `bun run test:e2e` |

`bun run test:all` chạy tuần tự: typecheck → lint → bun test → vitest → playwright.

---

## 2. Vòng lặp local — chạy theo phạm vi

Full suite là việc của CI; mọi PR đều chạy đủ ở workflow `CI`. Ở local dùng:

```bash
bun run test:scope                                # suy ra phạm vi từ thay đổi chưa commit
bun run test:scope --base origin/dev/1.1.2/main   # + các commit trên nhánh
bun run test:scope src/features/automations       # ép phạm vi theo path/thư mục
bun run test:scope --list                         # chỉ in ra sẽ chạy gì
```

Script dựng đồ thị import của `src/` + `mcp/` + `tests/` rồi chọn mọi test file **đi tới được** file đã đổi (transitive), tách sẵn theo runner. Nó cố tình chọn rộng hơn là hẹp.

### 2.1 Blind spot phải tự biết

Trong các trường hợp này chạy full trước khi push:

- **Nạp động** — `apiServer.ts` quét `features/<name>/api.ts` lúc chạy, không có cạnh import nào. Thêm điểm nạp động khác thì phải khai báo trong `.github/scripts/test-scope.ts`.
- **Không đi qua import** — fixture, file JSON/YAML, snapshot, biến môi trường, dữ liệu trong `test-e2e/fixtures/`.
- **Đổi hạ tầng** (`package.json`, `vitest.config.ts`, `tsconfig.json`, `bun.lock`) — script tự nhận ra và chạy full.

### 2.2 Xanh local vẫn có thể đỏ CI

- **Chọn hẹp chỉ giảm thời gian, không giảm trách nhiệm** — môi trường CI khác máy dev (plugin cài sẵn, `/opt/bundled-plugins`, `~/.claude/…`, browser cho e2e).
- **`bun run test:scope` chọn ra 0 file KHÔNG có nghĩa "đã xanh"** — nó nghĩa là "chỗ này chưa ai test".
- **Test đụng filesystem / registry / agent / plugin** — chạy thêm một lượt với env đã tước (`HOME` rỗng, biến plugin trỏ path không tồn tại) trước khi tin là xanh.

### 2.3 Resolve agent template khi chạy local

Repo **không** còn thư mục `plugins/` ở root — bản agent template chỉ là tài liệu, đặt ở `docs/template/agents/`.

`resolveAgentFilePath` (`src/features/runner/business/agentResolver.ts`) tìm agent theo thứ tự:

1. `<projectRoot>/plugins/<plugin>/agents/`
2. `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/agents/`
3. `DEV_TEAM_BUNDLED_PLUGINS` — biến trỏ tới thư mục **chứa** `<plugin>/agents/*.md`
4. `/opt/bundled-plugins`

- **Cache đứng TRƯỚC biến env** — đặt `DEV_TEAM_BUNDLED_PLUGINS` **không** thắng được bản cache cũ. Muốn bản mới thắng thì phải cập nhật hoặc xoá entry trong `~/.claude/plugins/cache/`.
- **Docker không bị ảnh hưởng** — `docker/Dockerfile` copy `docs/template/agents` vào `/opt/bundled-plugins`.

### 2.4 Chạy test trong container dashboard

- **Image có sẵn `bun` + `node`** (Node 24 — `vitest` / `eslint` / `vue-tsc` là script `#!/usr/bin/env node`).
- **`cd /data/project/<repo>` rồi chạy đúng lệnh ở bảng §1** — `bun test` / `vitest` không cần thêm biến môi trường; riêng **E2E cần một bước dựng thư viện hệ thống một lần**, xem §2.5.
- **`node_modules` lấy từ repo mount**, không dùng `/app/node_modules`.

### 2.5 E2E trên máy không có root

- **Chromium của Playwright cần một loạt shared library** (glib, nss, x11, gbm, …) **và ít nhất một font** — container dashboard không có cái nào, cũng không có `sudo` nên `npx playwright install-deps` (đường chuẩn, cần root) không dùng được.
- **Chạy một lần cho mỗi máy**: `bun run e2e:sysdeps`. Script tải browser + `.deb` của các lib đó vào `~/.cache/pw-sysdeps` (~375 MB sau khi giải), tự kiểm chứng bằng `ldd`; in `OK — prefix: …` là xong. Chạy lại lần sau thoát nhanh, không tải lại. Đổi chỗ prefix bằng `PW_SYSDEPS_PREFIX`.
- **Sau đó `bun run test:e2e` chạy bình thường** — `playwright.config.ts` tự phát hiện prefix và trỏ `LD_LIBRARY_PATH` + `XDG_DATA_DIRS` cho **riêng tiến trình browser** (không đụng env của `webServer`). Không có prefix thì khối đó là no-op, nên CI và máy đã cài đủ lib bằng root hành xử không đổi.
- **Tắt hẳn đường prefix** (máy đã cài đủ lib bằng root, hoặc nghi prefix cũ gây lỗi loader): `PW_SYSDEPS_PREFIX=/nonexistent bun run test:e2e`.
- **Cạm bẫy phải biết** — thiếu font thì chrome **vẫn chạy** nhưng mọi text render ra bề rộng 0px, Playwright coi phần tử bounding-box rỗng là "không visible" ⇒ đỏ hàng loạt với message `not visible` / `timeout waiting for locator`. Thấy triệu chứng đó thì chạy lại `bun run e2e:sysdeps` và kiểm `ls ~/.cache/pw-sysdeps/usr/share/fonts` **trước** khi nghi ngờ code.
- **CI không đi đường này** — workflow cài bằng root qua `playwright install --with-deps chromium`.

---

## 3. Layout test — gom vào `tests/` + `test-e2e/`

- **Unit test mirror cây source trong `tests/`** — không co-locate cạnh source.
- **Runner theo path** — `tests/src/server/**` + `tests/src/features/**/business/**` + `tests/mcp/**` → bun test; `tests/src/**` (FE) → vitest.
- **Script tooling của repo** (`.github/scripts/`) có test riêng ở `tests/tools/`, cùng runner bun.
- **E2E ở `test-e2e/`** — `test-e2e/<feature>.spec.ts` + `test-e2e/fixtures/`; `playwright.config.ts` trỏ `testDir` về đây.

---

## 4. Danh mục suite

Tra bảng này để biết **vùng mình sửa đã có suite nào** (chạy đúng suite đó) và **chỗ nào chưa có** (phải bổ sung test).

Cột "Vùng source phủ" lấy từ import trực tiếp của test trong suite — nó nói suite đó *của* module nào, không phải toàn bộ closure.

**Sinh lại bảng sau khi thêm/đổi thư mục test** — bảng lệch là bảng vô dụng:

```bash
bun run test:scope --catalog
```

Chạy nhiều suite một lượt thì nối path (cùng runner):

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
| `tests/src/core/lib` | vitest | `core/lib`, `core/http` | 9 | `npx vitest run tests/src/core/lib` |
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
| `tests/src/features/pipeline-editor/components` | vitest | `features/pipeline-editor/components`, `features/pipeline-editor/scripts` | 6 | `npx vitest run tests/src/features/pipeline-editor/components` |
| `tests/src/features/pipeline-editor/composables` | vitest | `features/pipeline-editor/composables`, `features/pipeline-editor/scripts` | 1 | `npx vitest run tests/src/features/pipeline-editor/composables` |
| `tests/src/features/pipeline-editor/lib` | vitest | `features/pipeline-editor/lib` | 3 | `npx vitest run tests/src/features/pipeline-editor/lib` |
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
| `tests/src/features/settings/schemas` | vitest | `features/settings/schemas` | 5 | `npx vitest run tests/src/features/settings/schemas` |
| `tests/src/features/statistics/business` | bun | `core/log`, `features/statistics/business` | 1 | `bun test tests/src/features/statistics/business` |
| `tests/src/features/statistics/components` | vitest | `features/statistics/components`, `features/statistics/lib` | 2 | `npx vitest run tests/src/features/statistics/components` |
| `tests/src/features/statistics/lib` | vitest | `features/statistics/lib` | 2 | `npx vitest run tests/src/features/statistics/lib` |
| `tests/src/server` | bun | `features/settings/business`, `core/registry.ts`, `api/apiServer.ts` | 3 | `bun test tests/src/server/*.test.ts` |
| `tests/src/server/agents` | bun | `features/agent-editor/business` | 5 | `bun test tests/src/server/agents` |
| `tests/src/server/artifactActions` | bun | `features/monitor/business`, `features/monitor/schemas` | 1 | `bun test tests/src/server/artifactActions` |
| `tests/src/server/automations` | bun | `features/automations/business`, `features/automations/schemas`, `core/events` | 9 | `bun test tests/src/server/automations` |
| `tests/src/server/catalog` | bun | `features/pipeline-editor/business` | 4 | `bun test tests/src/server/catalog` |
| `tests/src/server/chat` | bun | `features/runner/business`, `features/monitor/business`, `features/nl-chat/business` | 5 | `bun test tests/src/server/chat` |
| `tests/src/server/github` | bun | `features/monitor/business`, `api/apiServer.ts`, `core/registry.ts` | 2 | `bun test tests/src/server/github` |
| `tests/src/server/http` | bun | `api/apiServer.ts`, `core/http`, `features/runner/business` | 23 | `bun test tests/src/server/http` |
| `tests/src/server/lib` | bun | `core/lib` | 1 | `bun test tests/src/server/lib` |
| `tests/src/server/pipeline` | bun | `features/pipeline-editor/business` | 2 | `bun test tests/src/server/pipeline` |
| `tests/src/server/rules` | bun | `features/pipeline-editor/business` | 1 | `bun test tests/src/server/rules` |
| `tests/src/server/runners` | bun | `features/runner/business`, `core/events`, `core/log` | 20 | `bun test tests/src/server/runners` |
| `tests/src/server/settings` | bun | `features/settings/business` | 2 | `bun test tests/src/server/settings` |
| `tests/src/server/tasks` | bun | `features/monitor/business`, `features/runner/business`, `core/events` | 4 | `bun test tests/src/server/tasks` |
| `tests/tools` | bun | `tooling` | 1 | `bun test tests/tools` |

---

## 5. Triết lý không-regression

- **Trước khi đụng code production** — viết characterization/golden test trên hành vi hiện tại (pure fn + API response snapshot qua `app.request`), rồi refactor dưới nền xanh đó.
- **Logic/module mới hoàn toàn** — test-first (TDD thật).
- **Test fail sau khi sửa code** (kể cả lỗi chỉ lộ ở CI) — điều tra **root cause**, sửa code sản phẩm. Không mock/stub để né qua đường code đang lỗi.
- **Mock chỉ hợp lệ cho phụ thuộc ngoài** (API, thư viện nặng/không chạy được dưới jsdom) đã hợp lý từ đầu — không dùng mock để thay cho việc sửa bug vừa phát hiện.

---

## 6. Coverage threshold

- **Khởi điểm 0%, tăng dần theo từng module** khi test module đó land.
- **Mục tiêu global ~60%** rồi siết lên — đừng đòi coverage cao ngay từ đầu.
- **Cập nhật threshold ở `vitest.config.ts`** (frontend); backend xem qua `bun test --coverage`.

---

## 7. E2E capture

- **Module frontend bắt buộc có bước capture e2e** — Playwright boot app thật (standalone + fixture `.dev-team-agent`) và screenshot mode liên quan; spec này gate CI mỗi PR frontend.
- **Ảnh capture không ghi vào `docs/`** — chụp vào `testInfo.outputPath(...)` (gitignored) rồi `testInfo.attach(...)` để vào playwright-report, đính vào comment kết quả test trên PR.
- **CI upload artifact `test-evidence`** (coverage + playwright-report).
- **Module backend không bắt buộc e2e** nếu chỉ migrate code — `bun run test:e2e` chạy `--pass-with-no-tests`.
