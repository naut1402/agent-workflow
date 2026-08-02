# dev-team-dashboard

### Dashboard realtime cho pipeline dev-agent-teams

[Kiến trúc](docs/architecture.md) · [AGENTS.md](AGENTS.md) · [Implement](docs/implement/) · [Issues](https://github.com/naut1402/agent-workflow/issues) · [PR](https://github.com/naut1402/agent-workflow/pulls)

[![Bun](https://img.shields.io/badge/runtime-Bun-fbf0df?logo=bun&logoColor=black)](https://bun.sh)
[![Vue 3](https://img.shields.io/badge/UI-Vue%203-42b883?logo=vue.js&logoColor=white)](https://vuejs.org)
[![Hono](https://img.shields.io/badge/API-Hono-e36002)](https://hono.dev)
[![GitHub stars](https://img.shields.io/github/stars/naut1402/agent-workflow?style=social)](https://github.com/naut1402/agent-workflow)

---

## Về dự án

`dev-team-dashboard` là SPA **Vue 3 + Vite** trực quan hóa **runtime state** của [dev-agent-teams](https://github.com/naut1402/agent-workflow) orchestrator — pipeline agent chạy task qua các phase *investigate → design → implement → review → PR*.

Repo này **không chạy orchestrator**. Orchestrator ghi state vào `.dev-team-agent/`; dashboard **quan sát** và chỉnh config / artifact.

- **State task** (`.dev-state/*.json`): chỉ đọc  
- **Config** (pipeline, custom agent, template, knowledge) và **artifact markdown**: đọc/ghi (`PUT /api/artifact`)  
- UI mặc định: **tiếng Việt** (`vue-i18n`)

## Dashboard cho đội agent đang chạy

Theo dõi tiến độ, HITL gate, artifact và runner — một chỗ, realtime trên máy local.

- **Monitor pipeline** — xem phase hiện tại, chờ HITL, timeline và artifact từng task  
- **Chỉnh pipeline / agent** — profile YAML, custom agent, template bước workflow  
- **Knowledge & runner** — quản lý knowledge store; cấu hình / theo dõi job runner CLI  
- **Logs tập trung** — audit, request HTTP, stdout jobs (bật/tắt theo settings)  
- **Quick action & thông báo** — thao tác nhanh và bell/floating notification  
- **Multi-project** — standalone mode chọn project qua registry (`?project=<id>`)

## Mode & khả năng chính

| Mode / surface | Việc làm |
|----------------|----------|
| **Monitor** | Task list, pipeline view, artifact panel, Q&A / chat runner |
| **Pipeline editor** | Kéo thả / cấu hình bước, profile |
| **Agent editor** | Custom agent + template (kèm NL wizard khi có API key) |
| **Knowledge** | Đọc/ghi knowledge theo driver |
| **Runner** | Connection, credential, job queue |
| **Logs** | Audit / request / jobs |
| **Quick action** | Menu thao tác lồng nhau |
| **MCP** | CRUD project registry qua stdio (`bun run mcp`) — không cần HTTP |

Chi tiết lớp `src/features/*`, `src/core`, auto-load route: [`docs/architecture.md`](docs/architecture.md), [`docs/implement/feature-organization-rule.md`](docs/implement/feature-organization-rule.md).

## Data root `.dev-team-agent/`

Mọi I/O backend scope vào thư mục **`.dev-team-agent/`** (của orchestrator, không phải repo dashboard):

```text
.dev-team-agent/
├── .dev-state/<task>.json      # state sống (phase, HITL, …)
├── tasks/<id>/*.md             # investigate, design, review, qa, …
├── pipeline.yaml               # + override theo task
├── pipeline-profiles/ …
└── knowledge…                  # knowledge store
```

| Run mode | Resolve root |
|----------|----------------|
| **Dev** (`bun run dev`) | `cwd/..` hoặc `DEV_TEAM_ROOT` |
| **Standalone** (`bun run serve`) | ProjectRegistry `~/.dev-team-dashboard/projects.json` (+ `DEV_TEAM_DASHBOARD_HOME`); request `?project=<id>` |

---

# Bắt đầu nhanh

Yêu cầu: **[Bun](https://bun.sh)**.

```bash
bun install
bun run dev          # Vite :5174 — single-project
bun run build        # SPA → dist/
bun run serve        # Node standalone (cần dist/) :5174
bun run start        # build + serve
bun run mcp          # MCP stdio — project registry
```

### Lệnh hữu ích

```bash
bun run lint         # ESLint
bun run lint:fix    # ESLint --fix
bun run format       # Prettier
bun run test         # bun test — domain / API
bun run test:fe      # vitest — frontend + coverage
bun run test:e2e     # Playwright
bun run test:all     # typecheck → lint → test → test:fe → e2e
bun run check:todo   # gate docs/todo (CI promote → main)
```

### Liên kết hữu ích

- [Quickstart (mục này)](#bắt-đầu-nhanh) — cài và chạy trong vài phút  
- [Kiến trúc](docs/architecture.md) — data root, Hono × 2 transport, cây `src/`  
- [Test convention](docs/implement/test-convention.md) — bun / vitest / e2e  
- [PR & commit](docs/implement/pr-docs-convention.md) — format message, body PR  
- [Todo debt](docs/implement/todo-debt-convention.md) — hoãn docs/test, gate `dev/*/main` → `main`  
- [Cookbook core/feature](docs/cookbook/core-path-reorg.md) — bài học tái cấu trúc  
- [Claude Code](CLAUDE.md) — MCP / rule đặc thù Claude  

## Phát triển & đóng góp

Quy ước cho agent và người:

1. Đọc [`AGENTS.md`](AGENTS.md) (hub bất biến + bảng tài liệu)  
2. Feature mới / sửa business: [`docs/implement/feature-organization-rule.md`](docs/implement/feature-organization-rule.md) + [`coding-convention.md`](docs/implement/coding-convention.md)  
3. Worktree riêng mỗi instance: [`docs/implement/worktree-convention.md`](docs/implement/worktree-convention.md)  
4. Review checklist: [`docs/implement/review-checklist-rule.md`](docs/implement/review-checklist-rule.md)

Branch phát hành dòng version: `dev/x.y.z/main` (vd `dev/1.0.0/main`). Không commit thẳng `main`.

## Stack ngắn

- **FE:** Vue 3, Vite, vue-i18n, Vue Flow, Toast UI / Mermaid  
- **BE:** Hono (Vite middleware + `src/standalone.ts`), Zod, Bun  
- **Tooling:** ESLint, Prettier, Commitlint, Playwright, Vitest  

---

*Orchestrator viết state — dashboard nhìn thấy và cấu hình lại được.*
