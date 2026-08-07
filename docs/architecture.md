# Kiến trúc — dev-team-dashboard

Tài liệu này mô tả **kiến trúc chi tiết** của `dev-team-dashboard`: cách backend và frontend được tổ chức, khái niệm "data root", cấu trúc thư mục, và cách một request đi qua hệ thống. Đây là **nguồn chính** cho phần kiến trúc + cấu trúc dự án cho người đọc — các tài liệu khác chỉ liên kết tới đây, không lặp lại.

- Giới thiệu + hướng dẫn chạy nhanh: xem [`../README.md`](../README.md).
- Hub agent + bất biến: [`../AGENTS.md`](../AGENTS.md).
- Coding / tổ chức feature: [`implement/coding-convention.md`](implement/coding-convention.md), [`implement/feature-organization-rule.md`](implement/feature-organization-rule.md).

> Tài liệu bám **cấu trúc thật** của nhánh hiện tại. Ngoại lệ đuôi file: `src/features/agent-editor/business/agentMarkdown.js` và `src/runner-cli.mjs` cố ý **chưa** chuyển `.ts` — ghi đúng đuôi.

---

## 1. Data root `.dev-team-agent/` — khái niệm trung tâm

Mọi thao tác đọc/ghi của backend đều **scope vào một thư mục `.dev-team-agent/`** (gọi là "root"). Thư mục này thuộc sở hữu của orchestrator plugin, **không** phải repo này — dashboard chỉ quan sát nó. Bên trong root:

- `.dev-state/<task-id>.json` — trạng thái sống của từng task (`current_phase`, `hitl_pending`, `review_round`, `doc_review_round`, …).
- `tasks/<task-id>/*.md` — artifact từng phase: `investigate.md`, `design.md`, `phpstan.md`, `review.md`, `test-spec.md`, `pr-desc.md`, `qa.md`, các sidecar `*-po.md` (doc-review).
- `pipeline.yaml` (global) và `tasks/<id>/pipeline.yaml` (per-task) — override cấu hình pipeline.
- Thư mục cấu hình do dashboard quản lý: `pipeline-profiles/`, `custom-agents/`, `agent-templates/`, `workflow-step-templates/`, `flow-profiles/`.
- `knowledge.config.yaml` + knowledge store (driver `file`).

### 1.1 Hai run mode resolve root

| Run mode | Cách resolve root | Ghi chú |
|---|---|---|
| **Dev** (`vite.config.ts` → plugin `devTeamApi`) | root = `cwd/..` (dashboard được scaffold vào `.dev-team-agent/viewer/`, nên thư mục cha là data root); override bằng env `DEV_TEAM_ROOT` | Đường single-project cũ. |
| **Standalone / multi-project** (`src/standalone.ts`) | root lấy từ **ProjectRegistry** tại `~/.dev-team-dashboard/projects.json` (override thư mục bằng `DEV_TEAM_DASHBOARD_HOME`); request mang `?project=<id>`; không có id → default project (registry default > env `DEV_TEAM_ROOT` > fallback cũ) | Xem `resolveProjectRoot` trong `src/core/registry.ts`. |

Đọc/ghi filesystem theo triết lý **defensive** (helper nuốt lỗi, trả empty/false thay vì throw) và **path-traversal hardening** (sanitize mọi input từ request) — chi tiết ở [`AGENTS.md` § Bất biến](../AGENTS.md#4-bất-biến-bắt-buộc-giữ).

---

## 2. Backend — "một app, nhiều transport"

Backend là **một app Hono duy nhất** chạy trên **hai transport** khác nhau. Toàn bộ logic route viết một lần, cả hai transport cùng thừa hưởng.

### 2.1 Tầng HTTP (Hono)

- `src/api/apiServer.ts` — `createApp(ctx)` dựng Hono + middleware resolve root từ `?project=` / tự duyệt `features/<name>/api.ts` (`registerFeatureRoutes`); `createApiHandler(ctx)` là **cầu nối Node ⇆ Hono** (lazy-await `createApp`).
- `src/core/http/AbstractController.ts` — base controller (json/ok/requireRoot/parseBody/…) + `bind(Controller, method)`.
- `src/core/business/AbstractBusiness.ts` — base tầng domain (requireRoot/fail; không biết HTTP).
- `src/features/<name>/controller.ts` — HTTP handler (extends AbstractController); gọi `XxxBusiness`.
- `src/features/<name>/business/` — domain + class `XxxBusiness` (extends AbstractBusiness).
- `src/features/<name>/api.ts` — **chỉ** map route → `bind(...)` + `routeOrder` / `registerRoutes`. Feature mới có `api.ts` thì được nạp (không sửa registry tay).
- `src/core/http/{responseHelper,types,client}.ts` — helper response (Node `json` + Hono `j`) + type tầng HTTP; `client.ts` là FE fetch (`apiGet`/`apiPost`/…).

> **Lưu ý routing:** `/api/knowledge` **không** đi qua Hono — nó được `handleKnowledgeApi` (node-res thuần trong module knowledge) xử lý và **chặn trước** nhánh Hono ngay trong `createApiHandler`. Đừng mô tả "mọi route đều qua Hono". `createApiHandler` cũng là **điểm chốt duy nhất** ghi request log (fire-and-forget trong `finally`, không await vào response).

### 2.2 Shim tương thích

`src/api/devTeamApi.ts` (36 dòng) chỉ là **shim** giữ hợp đồng cũ: re-export `createApiHandler` + export Vite plugin `devTeamApi({root})`. Nó **không** còn chứa logic core (khác hẳn mô tả cũ về "dispatcher `(req,res)=>boolean` là core").

### 2.3 Hai transport

- **Vite middleware** (`bun run dev`): plugin `devTeamApi({root})` mount handler vào dev server (port 5174).
- **Node standalone** (`src/standalone.ts`, chạy bằng `bun run serve`, cần `dist/`): HTTP server phục vụ `dist/` (SPA fallback) + mount `createApiHandler`; `PORT = DEV_TEAM_DASHBOARD_PORT | PORT | 5174`.

### 2.4 Domain / business (data thuần, không biết HTTP)

Domain nằm trong `src/features/<name>/business/`. Coupling xuống: `core/configs` + `core/lib` → business → controller → `src/api` (Hono setup). Registry ở `src/core/registry.ts`; entry `src/standalone.ts`. Trong feature, `business/` gom theo **nghiệp vụ đang xử lý cái gì** — tránh tách nhiều file theo loại thao tác kỹ thuật làm phân tán không cần thiết.

| Module | Đường dẫn thật | Vai trò |
|---|---|---|
| Types | `src/core/http/types.ts` | Nguồn type thống nhất (`HonoEnv`, registry types). |
| Registry | `src/core/registry.ts` | `projects.json`; REST + MCP. |
| Settings | `src/features/settings/business/` | Autoscan, fs browse, github tokens config. |
| Pipeline | `src/features/pipeline-editor/business/pipeline/` | Layered pipeline config + merge (một module). |
| Catalog / Rules | `src/features/pipeline-editor/business/{catalog,rules}/` | Catalog skills/agents (+ scan); rule project. |
| Agents | `src/features/agent-editor/business/` | `agents.ts` (CRUD/template/fetch) + NL generate. |
| Tasks / artifacts | `src/features/monitor/business/` | Tasks, artifact actions, github issue, task chat. |
| Knowledge | `src/features/knowledge/business/` | File driver + config/driver chọn trong cùng module. |
| Logging | `src/core/log/` (ghi + driver) + `src/features/logs/` (đọc UI, job log stream) | Request/audit JSONL; job log thuộc runner. |
| Runners | `src/features/runner/business/` | Job queue (+ reaper), connections, session ledger (+ capture), providers CLI. |
| Settings | `src/features/settings/business/` | Dashboard settings, autoscan, fs browse. |
| NL chat | `src/features/nl-chat/business/` | Session builder chat (prompt + parse trong cùng module). |
| CLI | `src/runner-cli.mjs` | Runner CLI entry. |

### 2.5 Config dùng chung `src/core/configs/` (alias `@configs`)

`src/core/configs/` giữ preference / version shell — không import HTTP kernel; domain/business import configs + `lib` + `registry` khi cần.

- `src/core/configs/appSettings.ts` — preference shell (theme/locale/notifications UI); core/plugins dùng. **Không** nhầm với schema business của feature `settings` (`autoscan`, `dashboardSettings`, `githubTokens` ở `features/settings/schemas/`).
- `src/core/configs/appVersion.ts` — semver từ `package.json`.
- Schema domain (task, log, autoscan, …) nằm ở `src/features/<feature>/schemas/` — Zod + `z.infer`, validate biên I/O của feature đó.
- `src/core/lib/` — `*Utils` / `*Lib` / `fileHelper` (`resolvePathUnder`, …) + helper domain (phase, theme, …).
- Sanitize / peer API gắn vào business hiện có và **re-export qua `business/index.ts`** khi feature khác cần dùng. Feature tiêu thụ chỉ import peer từ **index của chính nó**, không import thẳng `features/<khác>/business/...` (trừ khi tránh vòng barrel — xem feature-organization-rule).
- Round-trip agent markdown: `src/features/agent-editor/business/agentMarkdown.js` (**vẫn `.js`**) — sở hữu agent-editor; peer import sâu `agentMarkdown.js` khi cần tránh cycle.

---

## 3. Frontend (feature-module, 6 mode)

- `src/main.ts` mount `src/App.vue`. `App.vue` là shell với **6 mode**, sidebar + lựa chọn project lưu trong localStorage. Mode `monitor` **poll `/api/tasks` mỗi 1500ms** (qua `src/features/monitor/composables/useTaskPolling.ts`); các mode khác pause polling.

| Mode (`App.vue` `mode`) | Thư mục | Component / thành phần chính |
|---|---|---|
| `monitor` | `src/features/monitor/` | `MonitorLayout`, `TaskList`, `PipelineView`, `PipelineNode`, `QaPanel`, `ArtifactPanel`, `ProjectBar`, `SectionSaveIndicator`; composables `useTaskPolling.ts`, `useInlineMarkdownEdit.ts` |
| `editor` (Pipeline Editor) | `src/features/pipeline-editor/` | `PipelineEditor`, `PipelineEditorNode`, `StepConfigPanel`, `CatalogPanel`, `RulesPanel`, `ProfileManager`; `lib/pipelineRoundTrip.ts` |
| `agentEditor` | `src/features/agent-editor/` | `AgentEditor`, `AgentSectionEditor`, `WorkflowSectionEditor`, `AgentTemplatePicker`, `AgentNlWizard` |
| `knowledge` | `src/features/knowledge/` | `KnowledgePanel` |
| `runner` | `src/features/runner/` | `RunnerConfigPanel`, `ConnectionDialog` |
| `logs` (Nhật ký) | `src/features/logs/` | `LogsPanel`, `TaskTimeline`; composable `useTaskTimeline.ts` |

- `src/features/notifications/` — không phải mode, mount xuyên suốt cả 6 mode trong `App.vue` (bell trong `sidebar-footer` và/hoặc `FloatingNotificationIcon` overlay góc trên-phải toàn cục — chọn qua Settings › Thông báo › Vị trí hiển thị: `notificationUiPlacement` = `sidebar` | `floating` | `both`, mặc định `both`; ẩn float khi `unreadCount` về 0). Khi có unread, icon chuông rung + scale (CSS animation). Badge cho HITL-pending/QA-ready **client-only**, suy ra từ chính `tasks` ref đã poll qua `useTaskPolling.ts` (diff `hitl_pending`/`has_qa` qua các lần poll để bắt cạnh chuyển false→true) — không có endpoint/schema backend riêng, vì `.dev-state/<task-id>.json` đã phản ánh đồng nhất cả task chạy từ orchestrator lẫn task chạy từ runner của dashboard (`src/features/runner/business/jobQueue.ts`). Trạng thái đã đọc lưu `localStorage`. Composable `useNotifications.ts` đọc `src/core/configs/appSettings.ts` (`notificationsEnabled`, `notifyHitlPending`, `notifyQaReady`, `notifyBrowserEnabled`, `notifySoundEnabled`, `notificationUiPlacement` — cấu hình ở Settings › Thông báo) để bật/tắt notify theo loại sự kiện, vị trí UI, browser `Notification` API (`lib/browserNotification.ts`), và âm thanh Web Audio API (`lib/sound.ts`). Component dropdown dùng chung `components/NotificationList.vue`.

### 3.1 API layer

- **Server setup** (`src/api/`): `apiServer.ts` (`createApp` + `createApiHandler` + đăng ký feature routes), `devTeamApi.ts` (Vite plugin). Kernel HTTP (`types`, `AbstractController`, `responseHelper`, FE `client`) ở `src/core/http/`. Không có barrel FE trong `src/api/`.
- **FE fetch**: `src/core/http/client.ts` (`apiGet`/`apiPost`/…). Fetch theo consumer ở `src/features/<mode>/scripts/`. Hono route đăng ký ở `features/*/api.ts`.
- Suy diễn trạng thái phase (`PHASES`, `phasesFromPipeline`, `phaseStatus`) nằm ở `src/core/lib/phase.ts`. Phase status **được suy từ sự tồn tại của artifact** + con trỏ live — phản chiếu đúng quy tắc của orchestrator (status không bao giờ được encode, chỉ suy ra).

### 3.2 Core frontend (`src/core`)

Nền tảng FE / shell: `composables/*`, `lib/` (phase, `*Utils`, `*Lib`, `fileHelper`, …), `ui/`, `shell/keys.ts`, cộng `configs/` (preference shell + `appVersion`, alias `@configs` — xem §2.5). Schema domain ở `features/<name>/schemas/`. i18n cài qua `src/plugins` (`installPlugins`); message theo `features/<name>/locales/` + `plugins/i18n/locales/common/`.

Util / wrapper thư viện dùng chung (không gắn domain mode): `src/core/lib/{stringUtils,arrayUtils,dateUtils,yamlLib,markdownLib,diffLib,fileHelper,dirModuleLoader}.ts`.

**Roadmap kernel (sau 1.0.0):** ModeRegistry / `registerMode`, event bus, contribution API (plugin). Chưa triển khai trong 1.0.0.

### 3.3 Styling

Entry SCSS: `src/styles/main.scss` (tokens + scrollbar + shell, import từ `src/main.ts`). Style theo feature: `src/features/<mode>/styles/` (`common.scss` + `{Component}.scss` + `index.scss`) — **tự nạp** trong `src/main.ts` qua `import.meta.glob('./features/*/styles/index.scss', { eager: true })`, không liệt kê từng feature trong `main.scss`. Theme/runtime token (`_tokens` / `_shell`) là CSS variables trên `:root` nên sửa hàng loạt vẫn ảnh hưởng mọi module. Vite: `sass-embedded` + `scss.api = 'modern-compiler'`.

---

## 4. MCP server

`mcp/server.ts` (`bun run mcp`) là stdio entrypoint riêng, expose CRUD project-registry (`list_projects`/`get_project`/`add_project`/`remove_project`) cho Claude Code, nói chuyện trực tiếp với `src/core/registry.ts`. **Không** cần HTTP server chạy. Bật qua `.claude/settings.local.json` (`enabledMcpjsonServers`). Vì dùng chung `src/core/registry.ts`, project thêm từ Claude Code và từ UI luôn nhất quán.

---

## 5. Cấu trúc thư mục

Cây thư mục top-level. Chi tiết từng file backend/shared/frontend/mcp đã mô tả ở §2–§4 phía trên.

```
agent-workflow/
├── index.html, vite.config.ts, package.json, tsconfig.json, …
├── src/                    # SPA (features/, core/ + lib/) + api/
├── mcp/                    # MCP stdio — xem §4
├── tests/                  # mirror: tests/src/server · tests/src/core · tests/mcp
├── test-e2e/
├── docs/
├── dist/
└── .claude/
```

> Quy ước phát triển repo này nằm ở [`../AGENTS.md`](../AGENTS.md) + [`implement/`](implement/), **không** ở `.claude/rules/`.
