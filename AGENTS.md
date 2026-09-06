# AGENTS.md

📌 Nguồn quy ước **hub** dùng chung cho mọi AI agent làm việc trong repo này.

- 📖 **Đọc file này trước**, rồi mở rule tương ứng với bước đang làm (bảng §3).
- 📐 **Rule chi tiết ở [`docs/agent-rules/`](docs/agent-rules/)** — mỗi file một category, dashboard quét qua `GET /api/rules` và gắn cho từng bước pipeline.
- 📚 **Tài liệu mô tả hệ thống ở [`docs/`](docs/)** — kiến trúc, domain event, i18n, quy ước UI.
- ⚖️ **Xung đột về bất biến hoặc coupling tối thiểu** → coi file này là đúng.

---

## 1. Dự án này là gì

`dev-team-dashboard` là SPA Vue 3 + Vite trực quan hoá runtime state của một **orchestrator agent chạy ngoài**. Repo này quan sát và cấu hình, không chạy orchestrator.

- **State từng task** (`.dev-state/*.json`) — chỉ đọc.
- **Config + artifact markdown** (pipeline, custom agent, template, knowledge) — đọc/ghi được, ghi qua `PUT /api/artifact`.
- **Backend** — Hono trên 2 transport. Feature: `api.ts` + `controller.ts` + `business/`. Setup app-root ở `src/api/`; kernel HTTP ở `src/core/http/`; registry ở `src/core/registry.ts`. Entry: `src/standalone.ts`.
- **Frontend** — `src/features/<mode>/` (components, scripts, styles, locales, schemas); nền `src/core/`; config shell `@configs` → `src/core/configs/`.
- **Data root** — `.dev-team-agent/`; standalone qua `ProjectRegistry` (`?project=<id>`).
- **Pipeline** — `DEFAULT_PIPELINE` ← `pipeline.yaml` ← `tasks/<id>/pipeline.yaml`.
- **MCP** — `bun run mcp`, CRUD registry, không cần HTTP server.

Chi tiết: [`docs/architecture.md`](docs/architecture.md).

---

## 2. Cấu trúc dự án — nhìn nhanh

```
agent-workflow/
├── src/          # features/, core/, api/, plugins/, styles/
├── mcp/
├── tests/        # unit (bun + vitest)
├── test-e2e/
└── docs/
    ├── agent-rules/   # rule cho mọi AI agent, theo category
    ├── template/      # agent + pipeline mẫu
    └── architecture.md, event-catalog.md, i18n.md, ui-buttons.md, diagram/
```

⚠️ Ngoại lệ cố ý còn `.js`: `src/features/agent-editor/business/agentMarkdown.js`, `src/runner-cli.mjs`. Tooling `vite` / `vitest` / `playwright` dùng `.ts`; `eslint.config.js` giữ `.js`.

---

## 3. Rule theo bước pipeline

| Bước | Category | Rule |
|---|---|---|
| 🔍 Investigate · Design | `doc-writing` | [`doc-writing.md`](docs/agent-rules/doc-writing.md) — bố cục `investigate.md` / `design.md`, quy tắc trình bày |
| 🛠️ Implement | `coding` | [`coding-guideline.md`](docs/agent-rules/coding-guideline.md) · [`feature-architecture-guideline.md`](docs/agent-rules/feature-architecture-guideline.md) · [`mode-registry-guideline.md`](docs/agent-rules/mode-registry-guideline.md) |
| 🔎 Review | `coding` + `test` | [`review-checklist-guideline.md`](docs/agent-rules/review-checklist-guideline.md) · [`testing.md`](docs/agent-rules/testing.md) |
| 🚀 PR | `git-pr` | [`git-pr.md`](docs/agent-rules/git-pr.md) · [`git-worktree.md`](docs/agent-rules/git-worktree.md) · [`pr-todo-debt.md`](docs/agent-rules/pr-todo-debt.md) |

Tài liệu tra cứu kèm theo (không phải rule):

| Chủ đề | Tài liệu |
|--------|----------|
| Quickstart | [`README.md`](README.md) |
| Kiến trúc / cây thư mục chi tiết | [`docs/architecture.md`](docs/architecture.md) |
| Mục lục domain event theo feature | [`docs/event-catalog.md`](docs/event-catalog.md) |
| Sơ đồ bootstrap DI / ModeRegistry | [`docs/diagram/IoC.md`](docs/diagram/IoC.md) |
| i18n chi tiết | [`docs/i18n.md`](docs/i18n.md) |
| Quy ước UI button | [`docs/ui-buttons.md`](docs/ui-buttons.md) |
| Template agent / pipeline | [`docs/template/`](docs/template/) |

---

## 4. Bất biến bắt buộc giữ

🚫 Nội dung đầy đủ: [`docs/architecture.md` §6](docs/architecture.md#6-bất-biến-kiến-trúc) — đọc trước khi thêm scan/endpoint mới.

Danh mục: đọc filesystem phòng thủ · chống path-traversal (sanitize tại feature sở hữu) · ghi registry atomic · `fetchUrlSafe` cho URL người dùng · ESM thuần · `ANTHROPIC_API_KEY` tuỳ chọn · `DASHBOARD_SECRET_KEY` bắt buộc cho vault.

---

## 5. Con trỏ nhanh theo loại task

| Task | Đọc thêm |
|------|----------|
| Viết/sửa code feature | [`feature-architecture-guideline.md`](docs/agent-rules/feature-architecture-guideline.md) + [`coding-guideline.md`](docs/agent-rules/coding-guideline.md) + bất biến §4 |
| Thêm mode mới ở FE shell (`App.vue`) | [`mode-registry-guideline.md`](docs/agent-rules/mode-registry-guideline.md) — checklist §5 |
| Review PR | [`review-checklist-guideline.md`](docs/agent-rules/review-checklist-guideline.md) — mục **Dữ liệu & An toàn** có domain event khi đụng persist |
| Test / CI | [`testing.md`](docs/agent-rules/testing.md) |
| Commit / PR / docs | [`git-pr.md`](docs/agent-rules/git-pr.md) — tách commit §6 khi PR nhiều xử lý |
| Hoãn docs/test (hotfix, POC) | [`pr-todo-debt.md`](docs/agent-rules/pr-todo-debt.md) — gate CI chỉ khi PR `dev/x.y.z/main` → `main` |
| Agent chạy song song | [`git-worktree.md`](docs/agent-rules/git-worktree.md) |
| Viết `investigate.md` / `design.md` | [`doc-writing.md`](docs/agent-rules/doc-writing.md) |

---

## 6. Checklist hoàn thành workflow

Template agent (`docs/template/agents/*`) chỉ có **bước cuối generic**: đọc mục này. **Repo khác không có mục tương đương → agent bỏ qua.**

### Survey / investigate

Khi survey call chain đụng persist / lifecycle / CRUD domain:

- [ ] **Cân nhắc emit** — thêm/sửa/xoá `emit` / `emitEntity` (sau persist OK; payload tối thiểu, không secret).
- [ ] **Ghi kết luận** trong `investigate.md` (vd *Events: thêm … / sửa … / xoá … / không đổi — vì …*).
- [ ] **Cập nhật catalog nếu chốt đổi event** — [`docs/event-catalog.md`](docs/event-catalog.md) (+ `DashboardEventType` nếu type mới/đổi tên) trong cùng thay đổi code, hoặc ghi nợ `docs/todo/`.

### Design / implement / review (khi scope đụng event)

- [ ] **Nêu rõ emit dự kiến trong design** (hoặc *không emit*).
- [ ] **Đối chiếu catalog với code khi implement/review** — xem [`review-checklist-guideline.md`](docs/agent-rules/review-checklist-guideline.md) mục **Dữ liệu & An toàn**.

### Implement — test suite

Áp dụng cho **mọi** thay đổi code:

- [ ] **Tra danh mục suite** [`testing.md`](docs/agent-rules/testing.md) §4 — xác định suite nào phủ vùng vừa sửa (có thể nhiều suite, khác runner).
- [ ] **Chạy đúng các suite đó** — `bun run test:scope` hoặc nối path thủ công. Full suite là việc của CI.
- [ ] **Vùng sửa chưa có suite nào** → viết test mới đặt theo layout (business/server → bun; FE → vitest). `test:scope` chọn ra 0 file **không** phải "đã xanh", nó là "chỗ này chưa ai test".
- [ ] **Thêm/đổi thư mục test** → sinh lại bảng `bun run test:scope --catalog` và cập nhật §4 của rule trong cùng thay đổi.
- [ ] **Test đụng filesystem / registry / agent / plugin** → chạy thêm một lượt với env đã tước (`HOME` rỗng, biến plugin trỏ path không tồn tại).

### Implement — đổi quy ước

- [ ] **Cập nhật rule** trong [`docs/agent-rules/`](docs/agent-rules/) ngay trong cùng thay đổi — rule lệch code là nợ, không phải chi tiết.
- [ ] **Cập nhật tài liệu cho người** nếu quy ước đó cũng mô tả hệ thống — [`docs/architecture.md`](docs/architecture.md) và các file liên quan trong `docs/`.
- [ ] **Cập nhật file này** nếu bảng §3 / §5 không còn đúng.
