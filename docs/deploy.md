# Deploy dev-team-dashboard (Docker Compose)

Tài liệu runtime, Git workspace và runner hybrid (Luồng A/B).

**Tracking:** Part of [agent-workflow#39](https://github.com/naut1402/agent-workflow/issues/39) — sub-issues [#40](https://github.com/naut1402/agent-workflow/issues/40), [#41](https://github.com/naut1402/agent-workflow/issues/41), [#42](https://github.com/naut1402/agent-workflow/issues/42).

Quay lại [mục lục F0003](./README.md) · SSH runner: [ssh-remote.md](./ssh-remote.md) · Multi-env: [multi-env.md](./multi-env.md).

---

## 1. Prerequisites

- Docker + Docker Compose
- (Tuỳ chọn) Reverse proxy / TLS: Caddy / Nginx / Traefik
- (Luồng A) Binary `claude` trong PATH container/host + `ANTHROPIC_API_KEY`
- (Luồng B) Git remote `origin` trên repo dev
- (Git onboard) Binary `git` trong PATH (Docker image đã cài sẵn)

## 2. Biến môi trường

| Biến | Mặc định | Mô tả |
| --- | --- | --- |
| `DEV_TEAM_DASHBOARD_HOST` | `127.0.0.1` | Bind address — Docker set `0.0.0.0` |
| `DEV_TEAM_DASHBOARD_PORT` | `5174` | HTTP port |
| `DEV_TEAM_DASHBOARD_HOME` | `~/.dev-team-dashboard` | Data dir (registry, workspaces, logs) |
| `DEV_TEAM_API_TOKEN` | *(không set)* | Nếu set → mọi `/api/*` trừ health cần auth |
| `DEV_TEAM_ENV` | *(không set)* | Label trong `/api/health` — xem [multi-env.md](./multi-env.md) |
| `DEV_TEAM_ROOT` | — | Seed project mặc định khi registry rỗng (legacy) |
| `ANTHROPIC_API_KEY` | — | Luồng A — server headless runner |
| `DEV_TEAM_SERVER_URL` | — | Luồng B — URL server cho `workspace:push --sync-server` |

**Auth header** (khi token bật):

- `Authorization: Bearer <token>` **hoặc**
- `X-Dev-Team-Token: <token>`

## 3. Chạy bằng docker compose

```bash
docker compose up -d --build
```

Volume mặc định:

| Mount | Path trong container | Nội dung |
| --- | --- | --- |
| `dashboard-home` | `/data` | Registry, git clones, cache SSH, jobs, logs (`DEV_TEAM_DASHBOARD_HOME=/data`) |
| `keys` (ro) | `/keys` | SSH private keys cho credential `file:/keys/...` (#44) |

Git clone nằm tại **`/data/workspaces/<project-id>/`** (cùng volume `dashboard-home`, không mount riêng).

## 4. Chạy bare-metal (không Docker)

```bash
bun install
bun run build

export DEV_TEAM_DASHBOARD_HOST=0.0.0.0
export DEV_TEAM_DASHBOARD_PORT=5174
export DEV_TEAM_DASHBOARD_HOME=/var/lib/dev-team-dashboard
export DEV_TEAM_API_TOKEN=your-token   # tuỳ chọn

bun run serve
# hoặc: bun run start  (build + serve)
```

## 5. Checklist smoke test (#40)

- **T40-D-01**: Build image

```bash
docker build -t dev-team-dashboard:test .
```

- **T40-D-02**: Compose up (nếu dùng token thì set trong `.env`)

```bash
echo "DEV_TEAM_API_TOKEN=my-token" > .env
docker compose up -d
```

- **T40-D-03**: Health endpoint luôn public

```bash
curl -sS http://localhost:5174/api/health
```

- **T40-D-04**: Khi token được set, API khác cần auth

```bash
curl -i http://localhost:5174/api/tasks
curl -i -H "Authorization: Bearer my-token" http://localhost:5174/api/tasks
```

- **T40-D-05**: Restart container vẫn giữ dữ liệu registry

```bash
docker compose restart
```

## 6. Reverse proxy (tuỳ chọn)

PR #40 **không** ship sẵn config reverse proxy.

Nếu cần HTTPS:

- Terminate TLS ở reverse proxy
- Proxy vào `http://dashboard:5174` (trong compose) hoặc `http://127.0.0.1:5174` (bare-metal)

## 7. Git workspaces (#41)

Khi đăng ký project bằng Git HTTPS URL, server shallow-clone repo vào:

```text
$DEV_TEAM_DASHBOARD_HOME/workspaces/<project-id>/
```

### UI

Tab **Projects → Git URL** → nhập HTTPS URL + branch (tuỳ chọn).

### API

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"gitUrl":"https://github.com/org/repo.git","branch":"main","name":"My Repo"}' \
  "http://localhost:5174/api/projects"
```

### MCP (Claude Code)

Tool `add_project` với `gitUrl`:

```json
{ "gitUrl": "https://github.com/org/repo.git", "branch": "main", "name": "My Repo" }
```

Chạy MCP: `bun run mcp` — không cần HTTP server.

### Đồng bộ

- UI nút **↻ Đồng bộ** (tooltip hiện `lastSyncAt`)
- `POST /api/projects/:id/sync`
- CLI: `bun run workspace:sync [--project=<id>]`

### Giới hạn MVP

- Chỉ **HTTPS public** — `validateGitUrl` chặn private/loopback host
- Private repo / SSH git URL **chưa** hỗ trợ
- Gỡ project khỏi registry **không** xóa thư mục clone
- Sync đồng thời cùng project bị queue (`withProjectSyncLock`)

### Troubleshooting Git clone trên Docker

| Lỗi API | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| `EACCES: permission denied, mkdir '/data/workspaces'` | Volume `/data` mount với owner `root`, process chạy user `app` | Rebuild image có `scripts/docker-entrypoint.sh` (tự `chown` `/data`), hoặc một lần trên host: `docker compose exec -u root dashboard chown -R app:app /data` |
| `not a dev-team-agent workspace` | Repo clone OK nhưng thiếu `.dev-team-agent/` *(bản cũ)* | Từ bản có auto-scaffold: server tự tạo `.dev-state/` + `tasks/` sau clone. Rebuild/redeploy nếu vẫn gặp lỗi |
| `git clone failed (branch '…'?)` | Branch không tồn tại | Kiểm tra tên branch (mặc định `main`) |
| `only https URLs allowed` | URL `http://` hoặc SSH git URL | Dùng HTTPS public |
| `private hosts not allowed` | URL trỏ localhost / IP nội bộ | Dùng URL public |

## 8. Runner server — Luồng A (#42)

Dashboard **không** cài Claude Code — operator đảm bảo binary `claude` trong PATH.

1. Set `ANTHROPIC_API_KEY` cho process dashboard (ví dụ trong `docker-compose.yml`).
2. Preset: runner `claude-code-server` (`flags: ['--bare']`) + credential `claude-server-env` (`env:ANTHROPIC_API_KEY`).
3. UI **Runner → Set default** chọn `claude-code-server`, hoặc CLI:

```bash
bun server/runner-cli.mjs submit \
  --task-id U0003 \
  --step-id investigate \
  --agent explore \
  --runner claude-code-server \
  --workspace .dev-team-agent/tasks/U0003 \
  --project-root . \
  --dev-team-root .dev-team-agent \
  --prompt-file .dev-team-agent/tasks/U0003/.prompt.txt \
  --produces investigate.md \
  --wait
```

4. Smoke test: Runner panel → `claude-code-server` → **Smoke test** → kỳ vọng `succeeded`.
5. Khi `ANTHROPIC_API_KEY` chưa set: job fail — kiểm tra log job.

**Lưu ý:** Credential `cli-session` cần OAuth trên máy local; trên server headless UI hiện cảnh báo — dùng `claude-code-server`.

## 9. Dev push & server sync — Luồng B (#42)

Workflow dev workstation:

1. Orchestrator local với runner `claude-code-local` + credential `cli-session`.
2. Artifact ghi vào `.dev-team-agent/` trong repo git.
3. Push artifact:

```bash
bun run workspace:push --project=<id>
```

4. Server sync (một trong các cách):
   - UI nút **↻ Đồng bộ**
   - `bun run workspace:sync --project=<id>`
   - `curl -X POST -H "Authorization: Bearer $TOKEN" "https://dashboard.example.com/api/projects/<id>/sync"`

**Một lệnh** (push + sync):

```bash
bun run workspace:push --project=<id> --sync-server=https://dashboard.example.com
# hoặc set DEV_TEAM_SERVER_URL
```

- Project id trên dev và server **nên trùng** khi cùng repo git.
- `kind: 'local'` trên dev **được phép** push nếu `project.path` nằm trong git repo có remote `origin`.
- Push chỉ stage/commit `.dev-team-agent/**`.

## 10. Conflict policy (#42)

- **Một task chỉ nên có một runner active** (dev local **hoặc** server headless).
- MVP **không** có distributed lock.
- Push dev và server job ghi cùng artifact: last-write-wins trên git.

## 11. Orchestrator chọn runner (#42 / #44)

| Môi trường | Runner | Credential | Ghi chú |
| --- | --- | --- | --- |
| Dev workstation | `claude-code-local` (default) | `cli-session` | OAuth local |
| Server / CI headless | `claude-code-server` | `env:ANTHROPIC_API_KEY` | `--runner claude-code-server` |
| Remote SSH (#44) | `claude-code-ssh` | `file:` key | Xem [ssh-remote.md](./ssh-remote.md) |

### Bảng luồng A / B / C

| Luồng | Mô tả | Doc |
| --- | --- | --- |
| A | Server chạy job headless | §8 |
| B | Dev local + push artifact | §9 |
| C | SSH remote runner + pull cache | [ssh-remote.md](./ssh-remote.md) |

## 12. API token từ browser

Khi server bật auth, set token trong DevTools Console:

```javascript
localStorage.setItem('dev-team-api-token', 'your-secret-token')
location.reload()
```

Chi tiết multi-instance: [multi-env.md §5](./multi-env.md#5-api-token-từ-browser).
