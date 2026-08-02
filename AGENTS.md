# AGENTS.md

Nguồn quy ước **hub** cho mọi AI agent trong repo. Chi tiết nằm ở `docs/`; nếu xung đột về **bất biến** hoặc coupling tối thiểu, coi file này là đúng.

**Đọc file này trước**, rồi mở doc tương ứng scope task (bảng dưới).

| Chủ đề | Tài liệu |
|--------|----------|
| Quickstart | [`README.md`](README.md) |
| Kiến trúc / cây thư mục chi tiết | [`docs/architecture.md`](docs/architecture.md) |
| Tổ chức feature / business / helper | [`docs/implement/feature-organization-rule.md`](docs/implement/feature-organization-rule.md) |
| Coding convention (TS, Zod, FE, i18n) | [`docs/implement/coding-convention.md`](docs/implement/coding-convention.md) |
| Test | [`docs/implement/test-convention.md`](docs/implement/test-convention.md) |
| PR / commit / docs output | [`docs/implement/pr-docs-convention.md`](docs/implement/pr-docs-convention.md) |
| Git hygiene | [`docs/implement/git-convention.md`](docs/implement/git-convention.md) |
| Worktree | [`docs/implement/worktree-convention.md`](docs/implement/worktree-convention.md) |
| Checklist review | [`docs/implement/review-checklist-rule.md`](docs/implement/review-checklist-rule.md) |
| i18n chi tiết | [`docs/i18n.md`](docs/i18n.md) |
| Cookbook tái cấu trúc core/feature | [`docs/cookbook/core-path-reorg.md`](docs/cookbook/core-path-reorg.md) |
| Claude Code | [`CLAUDE.md`](CLAUDE.md) |

---

## 1. Dự án này là gì

`dev-team-dashboard` là SPA Vue 3 + Vite trực quan hoá runtime state của một **dev-agent-teams orchestrator khác** — repo này không chạy orchestrator, chỉ quan sát. Với *state* từng task (`.dev-state/*.json`) thì chỉ đọc; với *config* (pipeline, custom agent, template, knowledge) và **artifact markdown** thì đọc/ghi được (ghi qua `PUT /api/artifact`).

- **Backend**: Hono trên 2 transport. Feature: `api.ts` + `controller.ts` + `business/`. Setup app-root ở `src/api/`; kernel HTTP ở `src/core/http/`; registry ở `src/core/registry.ts`. Entry: `src/standalone.ts`.
- **Frontend**: `src/features/<mode>/` (components, scripts, styles, locales, schemas); nền `src/core/`; contract `@shared` → `src/core/contracts/`.
- **Data root** `.dev-team-agent/`; standalone qua `ProjectRegistry` (`?project=<id>`).
- **Pipeline**: `DEFAULT_PIPELINE` ← `pipeline.yaml` ← `tasks/<id>/pipeline.yaml`.
- **MCP**: `bun run mcp` — CRUD registry, không cần HTTP server.

Chi tiết: [`docs/architecture.md`](docs/architecture.md).

---

## 2. Cấu trúc dự án — nhìn nhanh

```
agent-workflow/
├── src/          # features/, core/, api/, plugins/, styles/
├── mcp/
├── tests/        # unit (bun + vitest)
├── test-e2e/
├── docs/
│   ├── architecture.md, i18n.md, ui-buttons.md
│   ├── cookbook/           # tái cấu trúc / bài học đợt lớn
│   └── implement/          # *-rule.md, *-convention.md
└── .claude/
```

Ngoại lệ cố ý còn `.js`: `src/core/contracts/agentMarkdown.js`, `src/runner-cli.mjs`. Tooling: `vite`/`vitest`/`playwright` dùng `.ts`; `eslint.config.js` giữ `.js`.

---

## 3. Bắt buộc khi implement (tóm tắt)

Đọc đủ trước khi code feature/business:

1. [`feature-organization-rule.md`](docs/implement/feature-organization-rule.md) — đặt file, `business/` theo nghiệp vụ, peer qua `business/index`, `fileHelper` / `*Utils` / `*Lib`.
2. [`coding-convention.md`](docs/implement/coding-convention.md) — ESM/TS, Zod, Vue, i18n.
3. Mục **Bất biến** bên dưới — không được phá.

---

## 4. Bất biến bắt buộc giữ

Thêm scan/endpoint mới không được phá các bất biến sau:

- **Đọc filesystem phải phòng thủ**: `safeReadDir`/`statSafe` (`fileHelper`) / `readYamlSafe` (`yamlLib`) /`readState`/`loadRegistry` nuốt lỗi, trả empty/false thay vì throw — một file state ghi dở không được làm sập request.
- **Chống path-traversal**: mọi input từ request phải sanitize tại feature sở hữu (`resolveArtifact` + `fileHelper.resolvePathUnder`, `sanitiseProfileName`, `sanitiseAgentName`, `sanitiseSlug`, taskId regex); endpoint ghi file mới phải nghiêm ngặt tương đương. Hàm sanitize domain **không** nằm ở core — gắn vào module business liên quan (vd `pipeline/index`, `agents`, `tasks`, `jobLog`) và export qua `business/index.ts` nếu feature khác cần dùng.
- **Ghi registry atomic** (temp file + rename trong `saveRegistry`).
- **Fetch URL người dùng** phải qua `fetchUrlSafe` (https-only, chặn private host) — tránh SSRF.
- **ESM thuần**; server import core `node:`-prefixed.
- `ANTHROPIC_API_KEY` tùy chọn, bật NL agent-draft generation (`/api/custom-agents/generate`); không có key thì fallback heuristic.

---

## 5. Con trỏ nhanh theo loại task

| Task | Đọc thêm |
|------|----------|
| Viết/sửa code feature | implement `*-rule` + `coding-convention` + bất biến §4 |
| Review PR | [`review-checklist-rule.md`](docs/implement/review-checklist-rule.md) |
| Test / CI | [`test-convention.md`](docs/implement/test-convention.md) |
| Commit / PR / docs | [`pr-docs-convention.md`](docs/implement/pr-docs-convention.md) + [`git-convention.md`](docs/implement/git-convention.md) |
| Agent song song | [`worktree-convention.md`](docs/implement/worktree-convention.md) |
