# Cấp 4 · Code — chi tiết implementation

← [`../README.md`](../README.md) (Kiến trúc — danh mục C4)

Tham chiếu file/hàm thật cho các module nền. Đây là cấp **thay đổi thường xuyên nhất** — khi sửa, đối chiếu lại với code thay vì tin nội dung cũ. Nguyên tắc và sơ đồ ở cấp Component ([`../README.md`](../README.md) §3); quy ước + checklist ở [`../../convention/`](../../convention/) và `AGENTS.md` §6, không lặp ở đây.

| Module | Đọc khi nào |
|---|---|
| [1. Frontend](#1-frontend) | Thêm mode mới, đổi cách FE gọi server, lần theo bootstrap lúc app khởi động |
| [2. HTTP kernel](#2-http-kernel) | Thêm/sửa endpoint API, hoặc cần biết vì sao server chạy được ở cả `bun run dev` lẫn `bun run serve` |
| [3. Data root](#3-data-root) | Cần biết chính xác 1 field/tên file mà orchestrator ghi/đọc |
| [4. DB (SQLite)](#4-db-sqlite) | Trước khi bật `logging.driver: sqlite` hoặc thêm bảng mới |
| [5. Config shell](#5-config-shell) | Không chắc 1 setting nên đặt ở preference shell hay schema business |
| [6. Styling](#6-styling) | Thêm style mới xuyên feature |
| [`../events/`](../events/README.md) | Viết subscriber, thêm emit mới, tra cứu 1 domain event cụ thể |
| [`i18n.md`](i18n.md) | Thêm/sửa cách nạp locale, đăng ký locale mới |
| [`ui-buttons.md`](ui-buttons.md) | Thêm nút mới, tra class chuẩn |
| [`ui-overflow.md`](ui-overflow.md) | Vùng UI có chiều cao phụ thuộc dữ liệu |

---

## 1. Frontend

Bootstrap & API layer. Tham chiếu code cho 2 việc: **ModeRegistry/service container** khởi động ra sao, và **FE gọi API / suy diễn trạng thái** qua đâu.

### 1.1 Bootstrap — ModeRegistry & service container

Bảng dưới map khái niệm ở cấp Component (sơ đồ bootstrap/runtime flow) sang đúng file.

| Khái niệm | File |
|---|---|
| Tự quét + đăng ký mode lúc khởi động, tạo container | `src/frontend/main.ts` |
| Danh sách mode (`ModeEntry`, `ModeRegistry`) | `src/frontend/shell/modeRegistry.ts` |
| Bộ quyết định mode nào dùng được — giao diện + khoá (`canAccessMode`) | `src/frontend/shell/modeAccess.ts` |
| Bản hiện thực đọc cấu hình bật/tắt mode trong Cài đặt | `src/features/settings/scripts/settingsModeAccess.ts` |
| Service container (`register`/`resolve`) | `src/frontend/container/{index,types}.ts` |
| Khoá để lấy container trong giao diện | `src/frontend/shell/containerKey.ts` |
| Bước cài đặt container vào giao diện | `src/frontend/plugins/index.ts` |
| Màn hình chính: lấy danh sách mode, vẽ sidebar/trạng thái/nội dung, xử lý theo dõi liên tục | `src/frontend/App.vue` |
| Mỗi tính năng tự khai báo mode của mình | `src/features/<feature>/registerMode.ts` |
| Theo dõi liên tục của mode Theo dõi (Monitor) — nhận task-list qua SSE `GET /api/tasks/stream` | `src/features/monitor/composables/useTaskPolling.ts` |
| Fetch-based SSE reader (tự gắn header `Authorization`, không dùng `EventSource` gốc) | `src/frontend/lib/sseClient.ts` |

### 1.2 API layer

| Khái niệm | File |
|---|---|
| Client fetch dùng chung mọi feature (`apiGet`/`apiPost`/…) | `src/frontend/http/client.ts` |
| Suy diễn trạng thái phase (`PHASES`, `phasesFromPipeline`, `phaseStatus`) từ artifact + con trỏ live | `src/shared/lib/phase.ts` |

---

## 2. HTTP kernel

HTTP kernel & entrypoint. Mọi route `/api/*` đều đi qua đây.

### 2.1 Tầng HTTP (Hono)

| File | Vai trò |
|---|---|
| `src/backend/apiServer.ts` | `createApp(ctx)` dựng Hono + middleware resolve root từ `?project=` / tự duyệt `features/<name>/api.ts` (`registerFeatureRoutes`); `createApiHandler(ctx)` là **cầu nối Node ⇆ Hono** (lazy-await `createApp`), và là **điểm chốt duy nhất** ghi request log (fire-and-forget trong `finally`, không await vào response). |
| `src/backend/http/AbstractController.ts` | Base controller (`json`/`ok`/`requireRoot`/`parseBody`/…) + `bind(Controller, method)`. |
| `src/backend/business/AbstractBusiness.ts` | Base tầng domain (`requireRoot`/`fail`; không biết HTTP). |
| `src/features/<name>/controller.ts` | HTTP handler (extends `AbstractController`); gọi `XxxBusiness`. |
| `src/features/<name>/business/` | Domain + class `XxxBusiness` (extends `AbstractBusiness`). |
| `src/features/<name>/api.ts` | Map route → `bind(...)` + `routeOrder` / `registerRoutes`. |
| `src/backend/http/{responseHelper,types}.ts` | Helper response (Node `json` + Hono `j`) + type tầng HTTP. |

### 2.2 Entrypoint & shim (2 transport)

| File | Vai trò |
|---|---|
| `src/backend/devTeamApi.ts` | Shim: re-export `createApiHandler` + export Vite plugin `devTeamApi({root})`, mount vào dev server. Không chứa logic core. |
| `src/backend/standalone.ts` | Node standalone, mount `createApiHandler` trực tiếp, phục vụ thêm `dist/` (SPA fallback). |

MCP server bật qua `.claude/settings.local.json` (`enabledMcpjsonServers`).

---

## 3. Data root

Schema chi tiết `.dev-team-agent/` — tên file/field thật mà orchestrator (bên ngoài repo) và dashboard cùng đọc/ghi. Đọc khi cần biết chính xác 1 giá trị nằm ở file nào, hoặc thêm field mới vào state.

| Nội dung | Vị trí | Ghi chú |
|---|---|---|
| Trạng thái sống của từng task | `.dev-state/<task-id>.json` | Field: `current_phase`, `hitl_pending`, `review_round`, `doc_review_round`, … |
| Artifact từng phase | `tasks/<task-id>/*.md` | `investigate.md`, `design.md`, `phpstan.md`, `review.md`, `test-spec.md`, `pr-desc.md`, `qa.md`, sidecar `*-po.md` (doc-review) |
| Override cấu hình pipeline | `pipeline.yaml` (global), `tasks/<id>/pipeline.yaml` (per-task) | — |
| Config do dashboard quản lý | `pipeline-profiles/`, `custom-agents/`, `agent-templates/`, `workflow-step-templates/`, `flow-profiles/` | — |
| Knowledge store (driver `file`) | `knowledge.config.yaml`, `knowledge/{project,system}/*.md`, sidecar `knowledge/collections.yaml` | Scope `global` **không** nằm ở đây — ở `registryHome()/knowledge/global/`, dùng chung mọi project |
| Resolve root theo run mode (Dev / Standalone) | `src/backend/registry.ts` | Hàm `resolveProjectRoot` |

---

## 4. DB (SQLite)

Tầng `src/backend/db/` — một file SQLite dùng chung cho mọi subsystem cần lưu trữ có cấu trúc thay vì file-based, hiện gồm log backend `sqlite` (opt-in) và collection/tag của knowledge (luôn bật).

| Chủ đề | Chi tiết |
|---|---|
| **Vị trí file** | `registryHome()/dashboard.sqlite` — nằm **ngoài** cây repo, cùng chỗ với `projects.json`. Không có file DB nào sinh trong repo, `.gitignore` không phải đụng. |
| **`client.ts`** | Giữ connection cache dùng chung (`getDb()`), bật `WAL` + `foreign_keys`, chạy migration Drizzle khi mở lần đầu (idempotent). Migration chạy cho **mọi** subsystem dùng chung file — một migration hỏng kéo cả đường log xuống theo. |
| **`schema.ts` + `migrations/`** | Schema Drizzle giữ portable (không dùng feature riêng của SQLite) để sau này đổi sang Postgres không phải viết lại. Bảng: `log_entries`, `knowledge_collections`, `knowledge_tags`, `knowledge_tag_aliases`. |
| **`migrateLogs.ts`** + `scripts/migrate-logs-to-sqlite.ts` | Nạp JSONL cũ vào bảng `log_entries`, một transaction cho mỗi file nguồn. Chỉ đọc, **không xoá** file nguồn; **không idempotent** (chạy lại sinh bản ghi trùng). |
| **`migrateKnowledge.ts`** + `scripts/migrate-knowledge-to-sqlite.ts` | Nạp `collections.yaml` của mọi project đã đăng ký + store global vào `knowledge_collections` / `knowledge_tag_aliases`. Chỉ đọc, **không xoá** file nguồn, và **idempotent** (`UNIQUE(store_key, collection_id)` + `onConflictDoNothing`). ⚠️ Phải chạy tay một lần trên mỗi máy đang chạy dashboard sau khi nâng cấp, nếu không collection cũ không hiện lại. |
| **Lỗi mở DB** | Nổi lên ở knowledge, nuốt ở log. Log giữ bất biến *append không bao giờ throw*; knowledge thì không — `KnowledgeDbError` → 500 tường minh, vì hiện thành "chưa có nhóm nào" sẽ khiến người dùng tạo mới đè lên dữ liệu cũ. |
| **Giới hạn đã biết** | `logging.driver = 'sqlite'` làm mode Thống kê rỗng. `readUsageEntries()` (`src/features/statistics/business/`) đọc `usage.jsonl` vô điều kiện, không hỏi `activeLogDriverKind()`, nên khi driver là `sqlite` thì entry `usage` chỉ vào `log_entries` và `GET /api/statistics/usage` trả 0 mà không báo lỗi. Chỉ bật `sqlite` để thử PoC, đừng bật khi cần số liệu usage. |
| **Backend không dùng được** | `getDb()` in `[db] sqlite unavailable` ra stderr lần đầu mở thất bại (vd chạy dưới Node, không có `bun:sqlite`). Hai consumer xử lý khác nhau: **đường log** nuốt lỗi để giữ bất biến *append không bao giờ throw* (log rỗng trông y hệt "chưa có log" nếu không để ý dòng cảnh báo); **knowledge** thì ném `KnowledgeDbError` → 500. |

---

## 5. Config shell

Preference/version shell tách theo scope chạy: `src/frontend/configs/` cho preference đọc trên browser, `src/backend/configs/` cho thứ phải đọc `package.json`. Không import HTTP kernel; domain/business import configs + `lib` + `registry` khi cần.

| File / thư mục | Vai trò |
|---|---|
| `src/frontend/configs/appSettings.ts` | Preference shell (theme/locale/notifications UI); core/plugins dùng. **Không** nhầm với schema business của feature `settings` (`autoscan`, `dashboardSettings`, `githubTokens`, `scanPatterns` ở `features/settings/schemas/`). |
| `src/backend/configs/appVersion.ts` | Semver từ `package.json`. |
| `src/features/<feature>/schemas/` | Schema domain (task, log, autoscan, …) — Zod + `z.infer`, validate biên I/O của feature đó. |
| `src/backend/lib/` | Helper Node-only: `fileHelper` (`resolvePathUnder`), `processHelper`, `yamlLib`, `dirModuleLoader`, `arrayUtils`, `dateUtils`. |
| `src/frontend/lib/` | Helper thuần browser: `theme`, `markdownLib`, `diffLib`, `authToken`, `workflowSteps`, `pipelineArtifactGraph`, `appVersion`. |
| `src/shared/lib/` | Logic thuần dùng cả hai phía: `phase`, `stringUtils`. |
| `src/features/agent-editor/business/agentMarkdown.js` | Round-trip agent markdown (**vẫn `.js`**) — sở hữu agent-editor; peer import sâu `agentMarkdown.js` khi cần tránh cycle. |

Sanitize / peer API gắn vào business hiện có và **re-export qua `business/index.ts`** khi feature khác cần dùng. Feature tiêu thụ chỉ import peer từ **index của chính nó**, không import thẳng `features/<khác>/business/...` (trừ khi tránh vòng barrel — xem feature-organization-rule).

---

## 6. Styling

Đọc khi thêm style mới xuyên feature, hoặc cần biết vì sao đổi 1 token lại ảnh hưởng toàn bộ giao diện.

| Chủ đề | Chi tiết |
|---|---|
| Entry SCSS | `src/frontend/styles/main.scss` (tokens + scrollbar + shell), import từ `src/frontend/main.ts`. |
| Style theo feature | `src/features/<mode>/styles/` (`common.scss` + `{Component}.scss` + `index.scss`) — **tự nạp** trong `src/frontend/main.ts` qua `import.meta.glob('../features/*/styles/index.scss', { eager: true })`, không liệt kê từng feature trong `main.scss`. |
| Theme / runtime token | `_tokens` / `_shell` là CSS variables trên `:root` nên sửa hàng loạt vẫn ảnh hưởng mọi module. |
| Build | Vite dùng `sass-embedded` + `scss.api = 'modern-compiler'`. |
