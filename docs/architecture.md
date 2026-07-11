# Kiến trúc — dev-team-dashboard

Tài liệu này mô tả **kiến trúc chi tiết** của `dev-team-dashboard`: cách backend và frontend được tổ chức, khái niệm "data root", cấu trúc thư mục, và cách một request đi qua hệ thống. Đây là **nguồn chính** cho phần kiến trúc + cấu trúc dự án cho người đọc — các tài liệu khác chỉ liên kết tới đây, không lặp lại.

- Giới thiệu + hướng dẫn chạy nhanh: xem [`../README.md`](../README.md).
- Quy ước code + nguyên tắc coupling + bất biến: xem [`../AGENTS.md`](../AGENTS.md).

> Tài liệu bám **cấu trúc thật** của nhánh hiện tại. Ngoại lệ đuôi file: `shared/agentMarkdown.js`, `vite.config.js` và `server/runner-cli.mjs` cố ý **chưa** chuyển `.ts` — ghi đúng đuôi.

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
| **Dev** (`vite.config.js` → plugin `devTeamApi`) | root = `cwd/..` (dashboard được scaffold vào `.dev-team-agent/viewer/`, nên thư mục cha là data root); override bằng env `DEV_TEAM_ROOT` | Đường single-project cũ. |
| **Standalone / multi-project** (`server/standalone.ts`) | root lấy từ **ProjectRegistry** tại `~/.dev-team-dashboard/projects.json` (override thư mục bằng `DEV_TEAM_DASHBOARD_HOME`); request mang `?project=<id>`; không có id → default project (env `DEV_TEAM_ROOT` > default trong registry > fallback cũ) | Xem `resolveProjectRoot` trong `server/registry.ts`. |

Đọc/ghi filesystem theo triết lý **defensive** (helper nuốt lỗi, trả empty/false thay vì throw) và **path-traversal hardening** (sanitize mọi input từ request) — chi tiết ở [`AGENTS.md` §4 (Bất biến)](../AGENTS.md#4-bất-biến-của-codebase-bắt-buộc-giữ).

---

## 2. Backend — "một app, nhiều transport"

Backend là **một app Hono duy nhất** chạy trên **hai transport** khác nhau. Toàn bộ logic route viết một lần, cả hai transport cùng thừa hưởng.

### 2.1 Tầng HTTP (Hono)

- `server/http/app.ts` — `createApp(ctx)` dựng và trả về một instance `Hono`. Một middleware resolve `.dev-team-agent/` root cho từng request từ `?project=`.
- `server/http/routes/*.ts` — route **mỏng** (parse input → gọi domain module → `c.json`). Các nhóm route hiện có: `agents`, `catalog`, `config`, `logs`, `registry`, `runners`, `tasks`.
- `server/http/{respond,types}.ts` — helper response + type dùng chung tầng HTTP.
- `server/http/createApiHandler.ts` — **cầu nối Node ⇆ Hono**. Trả về `async (req, res) => boolean`: `true` khi đã tạo response cho request `/api/*`, `false` cho path không phải API (caller fall-through sang static / middleware kế tiếp).

> **Lưu ý routing:** `/api/knowledge` **không** đi qua Hono — nó được `handleKnowledgeApi` (node-res thuần trong module knowledge) xử lý và **chặn trước** nhánh Hono ngay trong `createApiHandler`. Đừng mô tả "mọi route đều qua Hono". `createApiHandler` cũng là **điểm chốt duy nhất** ghi request log (fire-and-forget trong `finally`, không await vào response).

### 2.2 Shim tương thích

`server/devTeamApi.ts` (36 dòng) chỉ là **shim** giữ hợp đồng cũ: re-export `createApiHandler` + export Vite plugin `devTeamApi({root})`. Nó **không** còn chứa logic core (khác hẳn mô tả cũ về "dispatcher `(req,res)=>boolean` là core").

### 2.3 Hai transport

- **Vite middleware** (`bun run dev`): plugin `devTeamApi({root})` mount handler vào dev server (port 5174).
- **Node standalone** (`server/standalone.ts`, chạy bằng `bun run serve`, cần `dist/`): HTTP server phục vụ `dist/` (SPA fallback) + mount `createApiHandler`; `PORT = DEV_TEAM_DASHBOARD_PORT | PORT | 5174`.

### 2.4 Domain modules (data thuần, không biết HTTP)

Domain module nhận `ctx`/`root`, trả data thuần; tầng HTTP mới biết về request/response. Coupling **chỉ đi xuống** (`shared/` → domain → `http/` → adapter) — xem [`AGENTS.md` §3.4](../AGENTS.md#34-kiến-trúc--coupling).

| Module | Đường dẫn thật | Vai trò |
|---|---|---|
| Registry | `server/registry.ts` | **Single source of truth** cho `projects.json`; `createRegistryContext`, `resolveProjectRoot`, atomic save (temp + rename). Dùng chung bởi REST API và MCP. |
| Pipeline | `server/pipeline/{default,index,merge}.ts` | Cấu hình pipeline **layered**: `DEFAULT_PIPELINE` (`default.ts`) ← `pipeline.yaml` global ← `tasks/<id>/pipeline.yaml` (patch theo step `id`, hoặc full replace khi `steps_replace`/toàn id mới). |
| Catalog | `server/catalog/{index,scan,dedupe,builtins}.ts` | Gộp skills + agents từ nhiều nguồn, dedupe theo `name` (`sourcePriority`), fallback `BUILTIN_CATALOG`. |
| Agents | `server/agents/*` | CRUD custom-agent, template, generate (NL→draft khi có `ANTHROPIC_API_KEY`, không thì heuristic). |
| Tasks | `server/tasks/index.ts` | Liệt kê task, đọc state + artifact. |
| Rules | `server/rules/index.ts` | Đọc rule project (`.claude/rules/*`). |
| Knowledge | `server/knowledge/{knowledgeApi,driverRegistry,fileDriver}.ts` | Driver pluggable sau `getKnowledgeDriver(root)`; hiện chỉ có driver `file`. |
| Runners | `server/runners/{agentResolver,connections,credentials,index,jobQueue,providerRegistry,registry,types}.ts` + `providers/{claude-code-cli,cursor-cli,codex-cli}.ts` | Điều phối job runner. Runner chọn **connection** (local-console hoặc ai-provider); provider CLI: `claude-code-cli`, `cursor-cli`, `codex-cli`. |
| Logging | `server/logging/{jobLog,store}.ts` | Nhật ký job + request log. |
| CLI | `server/runner-cli.mjs` (còn `.mjs`) | Runner CLI. |

### 2.5 Type dùng chung `shared/` (repo-root)

`shared/` không import gì trong `server/`; domain module import ngược lên `shared/`.

- `shared/schemas/{log,task}.ts` — Zod schema (type suy ra bằng `z.infer`), là single source cho type dùng chung 2 phía.
- `shared/{frontmatter,fs,http,sanitize}.ts` — helper thuần.
- `shared/agentMarkdown.js` (**vẫn `.js`**) — round-trip agent-markdown (`parseAgentMarkdown`/`compileAgentMarkdown`/`draftFromAgentMarkdown`/`heuristicDraftFromDescription`), import bởi cả frontend và domain module backend.

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

### 3.1 API layer

- `src/api/{client.ts, phase.ts, index.ts}` — wrapper `fetch` mỏng cho mọi endpoint + query builder `?project=`.
- Suy diễn trạng thái phase (`PHASES`, `phasesFromPipeline`, `phaseStatus`) nằm ở `phase.ts`. Phase status **được suy từ sự tồn tại của artifact** + con trỏ live — phản chiếu đúng quy tắc của orchestrator (status không bao giờ được encode, chỉ suy ra).

### 3.2 Shared frontend

`src/shared/` gồm: `composables/*` (`useAsyncState`, `useDrop`, `useLocalToggle`, `useSearch`, `useSortable`), `lib/workflowSteps.ts`, `markdown.ts`, `ui/RailIcon.vue`.

---

## 4. MCP server

`mcp/server.ts` (`bun run mcp`) là stdio entrypoint riêng, expose CRUD project-registry (`list_projects`/`get_project`/`add_project`/`remove_project`) cho Claude Code, nói chuyện trực tiếp với `server/registry.ts`. **Không** cần HTTP server chạy. Bật qua `.claude/settings.local.json` (`enabledMcpjsonServers`). Vì dùng chung `server/registry.ts`, project thêm từ Claude Code và từ UI luôn nhất quán.

---

## 5. Cấu trúc thư mục

Cây thư mục top-level. Chi tiết từng file backend/shared/frontend/mcp đã mô tả ở §2–§4 phía trên.

```
agent-workflow/
├── index.html              # SPA entry; loads /src/main.ts
├── vite.config.js          # Vite + Vue plugin + devTeamApi middleware; dev port 5174 (còn .js)
├── package.json            # ESM ("type":"module"); bun; scripts: dev/build/preview/serve/start/mcp/
│                           #   typecheck/test/test:fe/test:e2e/test:all
├── tsconfig.json           # allowJs:true, checkJs:false, strict:false (xem AGENTS.md §3.1)
├── vitest.config.ts        # frontend unit (jsdom) + coverage
├── playwright.config.ts    # e2e; boots standalone + fixture, E2E_PORT (mặc định 4319)
├── bun.lock                # lockfile (bun)
├── src/                    # Vue 3 frontend (SPA, feature-module) — xem §3
├── server/                 # Backend: Hono app + domain modules + registry + knowledge — xem §2
├── shared/                 # Type + helper dùng chung repo-root (Zod schemas, fs/http/…) — xem §2.5
├── mcp/                    # MCP stdio server (project-registry CRUD) — xem §4
├── tests/                  # unit tests mirror cây source (bun test: server/mcp · vitest: src/shared)
├── test-e2e/               # @playwright/test specs + fixtures/.dev-team-agent/
├── docs/                   # Tài liệu người đọc: architecture.md (file này); history/ (sử liệu)
├── dist/                   # Build output (generated by `bun run build`)
└── .claude/
    ├── settings.local.json # bật dev-team-dashboard MCP server
    └── rules/              # rule project do orchestrator nạp (không phải quy ước repo này)
```

> Quy ước phát triển repo này (coding conventions, test, git hygiene, bất biến) nằm ở [`../AGENTS.md`](../AGENTS.md), **không** ở `.claude/rules/`.

## 6. Lịch sử migration

Quá trình migrate sang Bun + TypeScript + Hono (đã hoàn tất) được lưu ở [`history/refactor-workflow.md`](history/refactor-workflow.md) làm sử liệu; **không** phải quy trình hiện hành.
