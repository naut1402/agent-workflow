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

### Docker (standalone)

Mọi file Docker nằm trong [`docker/`](docker/). Deploy mẫu:

```bash
cp docker/.env.example docker/.env   # sửa HOST_HOME, PUID, DEV_TEAM_PROJECT_PATH, PORT
./docker/install.sh                  # up -d (build chỉ khi image chưa có)
./docker/install.sh --runners        # + auth Claude/Cursor từ HOST_HOME (không ép rebuild)
./docker/install.sh --build          # rebuild image (Dockerfile / CA / deps)
./docker/install.sh --port=8080      # đổi host port, ghi vào docker/.env
./docker/install.sh --down
```

Không cần cài Bun trên host. Image chạy `src/standalone.ts`, bind `0.0.0.0:5174` trong container. Runtime **cài sẵn** `claude` + `agent` (Linux).

`DEV_TEAM_ROOT` trong container = `/data/project/.dev-team-agent` (data root).

```bash
# Build thủ công (context = repo root)
docker build -f docker/Dockerfile -t dev-team-dashboard:local .

# Compose — luôn truyền --env-file docker/.env (substitute + runtime)
cp docker/.env.example docker/.env   # chỉnh PUID/HOST_HOME/PORT/…
docker compose --env-file docker/.env -f docker/compose.yml up -d

# + runners
docker compose --env-file docker/.env -f docker/compose.yml -f docker/compose.runners.yml up -d
```

| Env | Mặc định | Ý nghĩa |
|-----|----------|---------|
| `PUID` / `PGID` | `1001` (compose) / điền trong `docker/.env` | Process User/Group ID — trùng owner project trên host |
| `DEV_TEAM_PROJECT_PATH` | trong `docker/.env` | Bind mount → `/data/project` |
| `HOST_HOME` | trong `docker/.env` (runners) | Mount `.claude` / `.cursor` / credentials |
| `DEV_TEAM_DASHBOARD_PORT` | `5174` | **Host** publish port (`host:5174` → container). Đổi bằng `.env` hoặc `./docker/install.sh --port=N` |
| `DEV_TEAM_ROOT` | `/data/project/.dev-team-agent` | Data root trong container |
| `DEV_TEAM_DASHBOARD_HOME` | `/data/dashboard-home` | Registry multi-project |
| `ANTHROPIC_API_KEY` / `CURSOR_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` | (trống) | Optional — đặt trong `docker/.env` |
| `GH_TOKEN` / `GITHUB_TOKEN` | (trống) | PAT cho `git push` / `gh` — xem [`docker/.env.example`](docker/.env.example) |
| `FIX_PROJECT_OWNERSHIP` | `0` | Xem ghi chú trong [`docker/.env.example`](docker/.env.example) |
| `NODE_EXTRA_CA_CERTS` / `SSL_CERT_FILE` / `REQUESTS_CA_BUNDLE` / `CURL_CA_BUNDLE` | (host, tùy chọn) | CA tổ chức / MITM — `install.sh` copy vào image khi build |

**Corporate CA (MITM / Fortinet / Zscaler):** nếu host đã set các biến CA ở trên, `./docker/install.sh` stage file + `manifest.env` (basename) vào `docker/certs/` (gitignored), bake vào `/etc/ssl/corp-ca/`, chạy `update-ca-certificates`, và export path trong container qua `env.sh`. Không truyền absolute `/etc/...` làm build-arg (Git Bash/MSYS sẽ đổi thành `C:/Program Files/Git/etc/...`). Không bật `NODE_TLS_REJECT_UNAUTHORIZED=0` trong image.

**`docker/.env` (runtime):** Compose dùng `--env-file docker/.env` để substitute `${…}` trong YAML và `env_file` inject vào container. Sample: [`docker/.env.example`](docker/.env.example). File `docker/.env` gitignored — không commit secret/path máy.

**PUID/PGID (khuyến nghị):** process trong container = user sở hữu `DEV_TEAM_PROJECT_PATH` → ghi được `src/**` **không** đổi owner host. **Không dùng `PUID=0`**. Entrypoint vẫn `chown` riêng cây `.dev-team-agent` khi cần.

**Runners** (`docker/compose.runners.yml`): mount ro auth từ `HOST_HOME` trong `.env` → entrypoint copy vào `/home/dashboard`. Cần `$HOST_HOME/.claude/.credentials.json` (có dấu chấm) và `$HOST_HOME/.claude.json` (file). Entrypoint ghi `.claude.json` vào cả `$HOME/.claude.json` và `$CLAUDE_CONFIG_DIR/.claude.json` — Claude CLI với `CLAUDE_CONFIG_DIR` chỉ đọc path sau. Nếu copy tay vào container, đặt file tại `/home/dashboard/.claude/.claude.json` (không chỉ `$HOME/.claude.json`). Host macOS: OAuth có thể nằm Keychain — file `.credentials.json` trống/stale → dùng `claude setup-token` + `CLAUDE_CODE_OAUTH_TOKEN` trong `.env`, hoặc login một lần trong container Linux.

**Plugin agents:** template tại [`docs/template/agents/`](docs/template/agents/) → `/opt/bundled-plugins/dev-agent-teams/agents` trong image.

Chi tiết path / quyền: xem comment trong `docker/compose.yml`, `docker/entrypoint.sh`, `docker/install.sh`.

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
- [Docker](#docker-standalone) — image / Compose / volume  
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
