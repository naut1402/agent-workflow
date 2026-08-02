# dev-team-dashboard

`dev-team-dashboard` là một **SPA Vue 3 + Vite** trực quan hóa **runtime state của dev-agent-teams orchestrator** (một pipeline plugin của Claude Code chạy task dev qua các phase investigate → design → implement → review → PR). Dashboard **read-only** với *trạng thái* task (`.dev-state/*.json`), nhưng **read/write** với *cấu hình* (pipeline, custom agent, template, knowledge) và **artifact markdown** của task (`investigate.md`, `design.md`, `qa.md`, … qua `PUT /api/artifact`).

> **Repo này KHÔNG chạy orchestrator — nó quan sát một orchestrator.** Orchestrator ghi state xuống thư mục workspace `.dev-team-agent/`, còn dashboard đọc lại. UI dùng tiếng Việt.

## Kiến trúc 1 phút

- **Backend:** một request handler duy nhất (app **Hono**) chạy trên **2 transport** — Vite middleware (dev) và Node standalone server.
- **Frontend:** SPA **7 mode** — `monitor` / pipeline editor / agent editor / knowledge / runner / logs / quick action (cộng surface thông báo + NL chat không tính là mode).
- **Khái niệm cốt lõi:** thư mục dữ liệu **`.dev-team-agent/`** ("data root") mà mọi thao tác đọc/ghi đều scope vào.

→ Chi tiết kiến trúc: [`docs/architecture.md`](docs/architecture.md).

## Quickstart

Yêu cầu: **[Bun](https://bun.sh)** (là package manager; `bun.lock` có sẵn trong repo).

```bash
bun install               # cài dependencies
bun run dev               # Vite dev server :5174 (single-project mode)
bun run build             # vue-tsc check + build SPA → dist/
bun run serve             # Node standalone server (cần dist/) :5174
bun run start             # build + serve
bun run mcp               # MCP stdio server (mcp/server.ts)
```

Lint/format: `bun run lint` · `bun run lint:fix` · `bun run format`.

Chạy test: `bun run test` (backend) · `bun run test:fe` (frontend) · `bun run test:e2e` (e2e) · `bun run test:all` (typecheck → lint → test → test:fe → e2e). Chi tiết quy ước test: [`docs/implement/test-convention.md`](docs/implement/test-convention.md).

## Khái niệm `.dev-team-agent/` (data root)

Mọi read/write của backend đều scope vào một thư mục **`.dev-team-agent/`**, thuộc sở hữu của orchestrator plugin — không phải repo này. Bên trong: `.dev-state/<task>.json` (state), `tasks/<id>/*.md` (artifact từng phase), `pipeline.yaml` (+ per-task override), các thư mục cấu hình (`pipeline-profiles/`, `custom-agents/`, `agent-templates/`, …), và knowledge store.

Có **2 run mode** resolve root:

- **Dev:** root = `cwd/..`, override bằng `DEV_TEAM_ROOT`.
- **Standalone / multi-project:** root lấy từ ProjectRegistry (`~/.dev-team-dashboard/projects.json`, override thư mục bằng `DEV_TEAM_DASHBOARD_HOME`); request mang `?project=<id>`.

→ Chi tiết: [`docs/architecture.md`](docs/architecture.md).

## Tài liệu sâu

- **Kiến trúc + cấu trúc thư mục:** [`docs/architecture.md`](docs/architecture.md)
- **Hub AI agent + bất biến:** [`AGENTS.md`](AGENTS.md)
- **Implement (rule / convention):** [`docs/implement/`](docs/implement/)
- **Đặc thù Claude Code:** [`CLAUDE.md`](CLAUDE.md)
