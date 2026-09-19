# C4 · Cấp 4 — Code

← [Danh mục kiến trúc (C4)](../README.md)

Chi tiết implementation cụ thể: schema DB, danh sách file config shell, styling, và cây thư mục đầy đủ. Đây là cấp **thay đổi thường xuyên nhất** — khi sửa, đối chiếu lại với code thật thay vì tin nội dung cũ.

---

## Tầng DB `src/backend/db/`

Một file SQLite dùng chung cho mọi subsystem chuyển khỏi lưu trữ file-based — hiện gồm log backend `sqlite` (opt-in) và collection/tag của knowledge (luôn bật).

- **Vị trí file**: `registryHome()/dashboard.sqlite` — **nằm ngoài cây repo**, cùng chỗ với `projects.json`. Không có file DB nào sinh trong repo, `.gitignore` không phải đụng.
- **`client.ts`** giữ connection cache dùng chung (`getDb()`), bật `WAL` + `foreign_keys`, và chạy migration Drizzle khi mở lần đầu (idempotent). Migration chạy cho **mọi** subsystem dùng chung file, nên một migration hỏng kéo cả đường log xuống theo.
- **`schema.ts` + `migrations/`** — schema Drizzle giữ portable (không dùng feature riêng của SQLite) để sau này đổi sang Postgres không phải viết lại. Bảng: `log_entries`, `knowledge_collections`, `knowledge_tags`, `knowledge_tag_aliases`.
- **`migrateLogs.ts`** + `scripts/migrate-logs-to-sqlite.ts` — nạp JSONL cũ vào bảng `log_entries`, một transaction cho mỗi file nguồn. Chỉ đọc, **không xoá** file nguồn; **không idempotent** (chạy lại sinh bản ghi trùng).
- **`migrateKnowledge.ts`** + `scripts/migrate-knowledge-to-sqlite.ts` — nạp `collections.yaml` của mọi project đã đăng ký + store global vào `knowledge_collections` / `knowledge_tag_aliases`. Chỉ đọc, **không xoá** file nguồn, và **idempotent** (`UNIQUE(store_key, collection_id)` + `onConflictDoNothing`). ⚠️ Phải chạy tay một lần trên mỗi máy đang chạy dashboard sau khi nâng cấp, nếu không collection cũ không hiện lại.
- **Lỗi mở DB nổi lên ở knowledge, nuốt ở log.** Log giữ bất biến *append không bao giờ throw*; knowledge thì không — `KnowledgeDbError` → 500 tường minh, vì hiện thành "chưa có nhóm nào" sẽ khiến người dùng tạo mới đè lên dữ liệu cũ.
- **Giới hạn đã biết — `logging.driver = 'sqlite'` làm mode Thống kê rỗng.** `readUsageEntries()` (`src/features/statistics/business/`) đọc `usage.jsonl` vô điều kiện, không hỏi `activeLogDriverKind()`, nên khi driver là `sqlite` thì entry `usage` chỉ vào `log_entries` và `GET /api/statistics/usage` trả 0 mà không báo lỗi. Chỉ bật `sqlite` để thử PoC, đừng bật khi cần số liệu usage.
- **Backend không dùng được thì cảnh báo một lần.** `getDb()` in `[db] sqlite unavailable` ra stderr lần đầu mở thất bại (vd chạy dưới Node, không có `bun:sqlite`). Hai consumer xử lý khác nhau: **đường log** nuốt lỗi để giữ bất biến *append không bao giờ throw*, nên không có dòng cảnh báo đó thì log rỗng trông y hệt "chưa có log"; **knowledge** thì ném `KnowledgeDbError` → 500.

---

## Config shell

Preference / version shell tách theo scope chạy: `src/frontend/configs/` cho preference đọc trên browser, `src/backend/configs/` cho thứ phải đọc `package.json`. Không import HTTP kernel; domain/business import configs + `lib` + `registry` khi cần.

- `src/frontend/configs/appSettings.ts` — preference shell (theme/locale/notifications UI); core/plugins dùng. **Không** nhầm với schema business của feature `settings` (`autoscan`, `dashboardSettings`, `githubTokens`, `scanPatterns` ở `features/settings/schemas/`).
- `src/backend/configs/appVersion.ts` — semver từ `package.json`.
- Schema domain (task, log, autoscan, …) nằm ở `src/features/<feature>/schemas/` — Zod + `z.infer`, validate biên I/O của feature đó.
- `src/backend/lib/` — helper Node-only (`fileHelper` `resolvePathUnder`, `processHelper`, `yamlLib`, `dirModuleLoader`, `arrayUtils`, `dateUtils`). `src/frontend/lib/` — helper thuần browser (`theme`, `markdownLib`, `diffLib`, `authToken`, `workflowSteps`, `pipelineArtifactGraph`, `appVersion`). `src/shared/lib/` — logic thuần dùng cả hai phía (`phase`, `stringUtils`).
- Sanitize / peer API gắn vào business hiện có và **re-export qua `business/index.ts`** khi feature khác cần dùng. Feature tiêu thụ chỉ import peer từ **index của chính nó**, không import thẳng `features/<khác>/business/...` (trừ khi tránh vòng barrel — xem feature-organization-rule).
- Round-trip agent markdown: `src/features/agent-editor/business/agentMarkdown.js` (**vẫn `.js`**) — sở hữu agent-editor; peer import sâu `agentMarkdown.js` khi cần tránh cycle.

---

## Styling

Entry SCSS: `src/frontend/styles/main.scss` (tokens + scrollbar + shell, import từ `src/frontend/main.ts`). Style theo feature: `src/features/<mode>/styles/` (`common.scss` + `{Component}.scss` + `index.scss`) — **tự nạp** trong `src/frontend/main.ts` qua `import.meta.glob('../features/*/styles/index.scss', { eager: true })`, không liệt kê từng feature trong `main.scss`. Theme/runtime token (`_tokens` / `_shell`) là CSS variables trên `:root` nên sửa hàng loạt vẫn ảnh hưởng mọi module. Vite: `sass-embedded` + `scss.api = 'modern-compiler'`.

---

## Cấu trúc thư mục đầy đủ

```
agent-workflow/
├── index.html, vite.config.ts, package.json, tsconfig.json, …
├── src/
│   ├── backend/            # scope Node/Bun — HTTP kernel, db, events, log, registry, entry
│   ├── frontend/           # scope browser — app root, composables, ui, shell, plugins, styles
│   ├── shared/             # dùng chung cả hai phía — logic/type thuần, không hạ tầng
│   └── features/           # feature-module (giữ nguyên cấu trúc)
├── mcp/                    # MCP stdio — chi tiết ở cấp Container
├── tests/                  # mirror: tests/src/server · tests/src/{backend,frontend,shared} · tests/mcp
├── test-e2e/
├── docs/
├── dist/
└── .claude/
```

> Thư mục `.claude/` là state cục bộ của công cụ AI (worktree, cache, settings.local) — chỉ phần rule được version. Danh mục tài liệu cho người đọc: [`../../README.md`](../../README.md).

> Ngoại lệ đuôi file cố ý còn `.js`: `src/features/agent-editor/business/agentMarkdown.js` và `src/backend/runner-cli.mjs`. Tooling `vite` / `vitest` / `playwright` dùng `.ts`; `eslint.config.js` giữ `.js`.
