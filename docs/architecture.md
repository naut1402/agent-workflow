# Kiến trúc — dev-team-dashboard

Tài liệu này mô tả **kiến trúc chi tiết** của `dev-team-dashboard`: cách backend và frontend được tổ chức, khái niệm "data root", cấu trúc thư mục, và cách một request đi qua hệ thống. Đây là **nguồn chính** cho phần kiến trúc + cấu trúc dự án cho người đọc — các tài liệu khác chỉ liên kết tới đây, không lặp lại.

- Giới thiệu + hướng dẫn chạy nhanh: xem [`../README.md`](../README.md).
- Quy ước code + nguyên tắc coupling + bất biến: xem [`../AGENTS.md`](../AGENTS.md).

> Tài liệu bám **cấu trúc thật** của nhánh hiện tại. Ngoại lệ đuôi file: `src/core/contracts/agentMarkdown.js` và `src/runner-cli.mjs` cố ý **chưa** chuyển `.ts` — ghi đúng đuôi.

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
| **Standalone / multi-project** (`src/standalone.ts`) | root lấy từ **ProjectRegistry** tại `~/.dev-team-dashboard/projects.json` (override thư mục bằng `DEV_TEAM_DASHBOARD_HOME`); request mang `?project=<id>`; không có id → default project (env `DEV_TEAM_ROOT` > default trong registry > fallback cũ) | Xem `resolveProjectRoot` trong `src/core/registry.ts`. |

Đọc/ghi filesystem theo triết lý **defensive** (helper nuốt lỗi, trả empty/false thay vì throw) và **path-traversal hardening** (sanitize mọi input từ request) — chi tiết ở [`AGENTS.md` §4 (Bất biến)](../AGENTS.md#4-bất-biến-của-codebase-bắt-buộc-giữ).

---

## 2. Backend — "một app, nhiều transport"

Backend là **một app Hono duy nhất** chạy trên **hai transport** khác nhau. Toàn bộ logic route viết một lần, cả hai transport cùng thừa hưởng.

### 2.1 Tầng HTTP (Hono)

- `src/core/http/app.ts` — `createApp(ctx)` (async) dựng instance `Hono`, middleware resolve `.dev-team-agent/` root từ `?project=`, rồi gọi `registerFeatureRoutes`.
- `src/core/http/AbstractController.ts` — base controller (json/ok/requireRoot/parseBody/…) + `bind(Controller, method)`.
- `src/core/business/AbstractBusiness.ts` — base tầng domain (requireRoot/fail; không biết HTTP).
- `src/features/<name>/controller.ts` — HTTP handler (extends AbstractController); gọi `XxxBusiness`.
- `src/features/<name>/business/` — domain + class `XxxBusiness` (extends AbstractBusiness).
- `src/features/<name>/api.ts` — **chỉ** map route → `bind(...)` + `routeOrder` / `registerRoutes`.
- `src/core/http/loadFeatureRoutes.ts` — static import các `api.ts`, sắp theo `routeOrder`. Thêm feature → thêm dòng registry (Vite/Node không dynamic-import `.ts`).
- `src/core/http/{respond,types}.ts` — helper response + type dùng chung tầng HTTP (controller ưu tiên AbstractController).
- `src/core/http/createApiHandler.ts` — **cầu nối Node ⇆ Hono**. Lazy-await `createApp` lần đầu.

> **Lưu ý routing:** `/api/knowledge` **không** đi qua Hono — nó được `handleKnowledgeApi` (node-res thuần trong module knowledge) xử lý và **chặn trước** nhánh Hono ngay trong `createApiHandler`. Đừng mô tả "mọi route đều qua Hono". `createApiHandler` cũng là **điểm chốt duy nhất** ghi request log (fire-and-forget trong `finally`, không await vào response).

### 2.2 Shim tương thích

`src/core/devTeamApi.ts` (36 dòng) chỉ là **shim** giữ hợp đồng cũ: re-export `createApiHandler` + export Vite plugin `devTeamApi({root})`. Nó **không** còn chứa logic core (khác hẳn mô tả cũ về "dispatcher `(req,res)=>boolean` là core").

### 2.3 Hai transport

- **Vite middleware** (`bun run dev`): plugin `devTeamApi({root})` mount handler vào dev server (port 5174).
- **Node standalone** (`src/standalone.ts`, chạy bằng `bun run serve`, cần `dist/`): HTTP server phục vụ `dist/` (SPA fallback) + mount `createApiHandler`; `PORT = DEV_TEAM_DASHBOARD_PORT | PORT | 5174`.

### 2.4 Domain / business (data thuần, không biết HTTP)

Domain nằm trong `src/features/<name>/business/`. Coupling xuống: `contracts` → business → controller → `core/http`. Kernel (registry, Hono transport) nằm `src/core/`; entry `src/standalone.ts`.

| Module | Đường dẫn thật | Vai trò |
|---|---|---|
| Types | `src/core/http/types.ts` | Nguồn type thống nhất (`HonoEnv`, registry types). |
| Registry | `src/core/registry.ts` | `projects.json`; REST + MCP. |
| Settings | `src/features/settings/business/` | Autoscan, fs browse, github tokens config. |
| Pipeline | `src/features/pipeline-editor/business/pipeline/` | Layered pipeline config + merge. |
| Catalog / Rules | `src/features/pipeline-editor/business/{catalog,rules}/` | Catalog skills/agents; rule project. |
| Agents | `src/features/agent-editor/business/` | CRUD custom-agent, template, NL generate. |
| Tasks / artifacts | `src/features/monitor/business/` | Tasks, state, artifact actions, github issue, task chat. |
| Knowledge | `src/features/knowledge/business/` | Driver pluggable (`file`). |
| Logging | `src/features/logs/business/` + controller/api | Job + request/audit log. |
| Runners | `src/features/runner/business/` | Job queue, connections, providers CLI. |
| NL chat | `src/features/nl-chat/business/` | Session builder chat. |
| CLI | `src/runner-cli.mjs` | Runner CLI entry. |

### 2.5 Type dùng chung `src/core/contracts/` (alias `@shared`)

`src/core/contracts/` không import HTTP kernel; domain/business import contracts + `registry` khi cần.

- `src/core/contracts/schemas/{log,task}.ts` — Zod schema (type suy ra bằng `z.infer`), single source cho type dùng chung 2 phía.
- `src/core/contracts/{frontmatter,fs,http,sanitize}.ts` — helper thuần.
- `src/core/contracts/agentMarkdown.js` (**vẫn `.js`**) — round-trip agent-markdown, import bởi cả frontend và domain module backend.

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

- `src/features/notifications/` — không phải mode, mount xuyên suốt cả 6 mode trong `App.vue` (bell trong `sidebar-footer` và/hoặc `FloatingNotificationIcon` overlay góc trên-phải toàn cục — chọn qua Settings › Thông báo › Vị trí hiển thị: `notificationUiPlacement` = `sidebar` | `floating` | `both`, mặc định `both`; ẩn float khi `unreadCount` về 0). Khi có unread, icon chuông rung + scale (CSS animation). Badge cho HITL-pending/QA-ready **client-only**, suy ra từ chính `tasks` ref đã poll qua `useTaskPolling.ts` (diff `hitl_pending`/`has_qa` qua các lần poll để bắt cạnh chuyển false→true) — không có endpoint/schema backend riêng, vì `.dev-state/<task-id>.json` đã phản ánh đồng nhất cả task chạy từ orchestrator lẫn task chạy từ runner của dashboard (`src/features/runner/business/jobQueue.ts`). Trạng thái đã đọc lưu `localStorage`. Composable `useNotifications.ts` đọc `src/core/contracts/schemas/appSettings.ts` (`notificationsEnabled`, `notifyHitlPending`, `notifyQaReady`, `notifyBrowserEnabled`, `notifySoundEnabled`, `notificationUiPlacement` — cấu hình ở Settings › Thông báo) để bật/tắt notify theo loại sự kiện, vị trí UI, browser `Notification` API (`lib/browserNotification.ts`), và âm thanh Web Audio API (`lib/sound.ts`). Component dropdown dùng chung `components/NotificationList.vue`.

### 3.1 API layer

- `src/api/{http.ts, client.ts, phase.ts, index.ts}` — `http.ts` (`qs`/`apiFetch`/`apiGet`/`apiPost`/`apiRequest`); fetch theo consumer ở `src/features/<mode>/*Api.ts` (không barrel vào `client.ts`). `client.ts` chỉ re-export helper HTTP dùng chung. Hono route đăng ký riêng ở `features/*/api.ts` (server).
- Suy diễn trạng thái phase (`PHASES`, `phasesFromPipeline`, `phaseStatus`) nằm ở `phase.ts`. Phase status **được suy từ sự tồn tại của artifact** + con trỏ live — phản chiếu đúng quy tắc của orchestrator (status không bao giờ được encode, chỉ suy ra).

### 3.2 Core frontend (`src/core`)

Nền tảng FE / shell: `composables/*`, `lib/`, `markdown.ts`, `ui/`, `i18n/`, `shell/keys.ts`, cộng `contracts/` (Zod + helper FE↔BE, alias `@shared` — xem §2.5).

**Roadmap kernel (sau 1.0.0):** ModeRegistry / `registerMode`, event bus, contribution API (plugin). Chưa triển khai trong 1.0.0 — xem [`src/core/README.md`](../src/core/README.md).

### 3.3 Styling

Entry SCSS: `src/styles/main.scss` (import từ `src/main.ts`). Partials: `_tokens.scss` (CSS custom properties theme), `_shell.scss` (layout/sidebar/mode/modal/btn dùng chung), `_<module>.scss` theo feature (`monitor`, `pipeline-editor`, `agent-editor`, `knowledge`, …). Theme runtime qua `data-theme` + CSS variables; SFC feature dùng `<style scoped lang="scss">` khi đã migrate. Khảo sát & kế hoạch: [`scss-adoption.md`](scss-adoption.md).

---

## 4. MCP server

`mcp/server.ts` (`bun run mcp`) là stdio entrypoint riêng, expose CRUD project-registry (`list_projects`/`get_project`/`add_project`/`remove_project`) cho Claude Code, nói chuyện trực tiếp với `src/core/registry.ts`. **Không** cần HTTP server chạy. Bật qua `.claude/settings.local.json` (`enabledMcpjsonServers`). Vì dùng chung `src/core/registry.ts`, project thêm từ Claude Code và từ UI luôn nhất quán.

---

## 5. Cấu trúc thư mục

Cây thư mục top-level. Chi tiết từng file backend/shared/frontend/mcp đã mô tả ở §2–§4 phía trên.

```
agent-workflow/
├── index.html, vite.config.ts, package.json, tsconfig.json, …
├── src/                    # SPA (features/, core/) + server/ + contracts trong core/
├── mcp/                    # MCP stdio — xem §4
├── tests/                  # mirror: tests/src/server · tests/src/core · tests/mcp
├── test-e2e/
├── docs/
├── dist/
└── .claude/
```

> Quy ước phát triển repo này (coding conventions, test, git hygiene, bất biến) nằm ở [`../AGENTS.md`](../AGENTS.md), **không** ở `.claude/rules/`.
