# Deploy dev-team-dashboard (Docker Compose)

Tài liệu này phục vụ **sub-issue #40 (Server-ready runtime)**: chạy dashboard như một service độc lập, có healthcheck và API token tuỳ chọn.

## 1. Prerequisites

- Docker + Docker Compose
- (Tuỳ chọn) Reverse proxy / TLS: Caddy / Nginx / Traefik (tuỳ hạ tầng)

## 2. Biến môi trường

- `DEV_TEAM_API_TOKEN` (tuỳ chọn): nếu **không set** → API **không** yêu cầu auth (giữ behavior cũ + CI).
  - nếu **set** → mọi `/api/*` **trừ** `/api/health` cần token qua:
    - `Authorization: Bearer <token>` **hoặc**
    - `X-Dev-Team-Token: <token>`
- `DEV_TEAM_ENV` (tuỳ chọn): label môi trường trả về trong `/api/health`.

## 3. Chạy bằng docker compose

```bash
docker compose up -d --build
```

Các volume mặc định:

- `/data` (persist): registry + runners + logs (`DEV_TEAM_DASHBOARD_HOME=/data`)
- `/workspaces` (persist): chỗ dành cho workspace server (phục vụ phase sau)
- `/keys` (read-only): secret files (phục vụ phase sau)

## 4. Checklist smoke test (#40)

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

## 5. Reverse proxy (tuỳ chọn)

PR #40 **không** ship sẵn config reverse proxy vì mỗi môi trường có lựa chọn khác nhau (Caddy/Nginx/Traefik/Cloudflare…).

Nếu cần HTTPS:
- Terminate TLS ở reverse proxy
- Reverse proxy vào app tại `http://dashboard:5174` (trong compose) hoặc `http://127.0.0.1:5174` (nếu chạy bare)

## 6. Git workspaces (#41)

Khi đăng ký project bằng Git HTTPS URL, server shallow-clone repo vào:

```
$DEV_TEAM_DASHBOARD_HOME/workspaces/<project-id>/
```

- Cần binary `git` trong `PATH` (container image phải cài `git`, ví dụ `apt-get install -y git`).
- Volume `dashboard-home` (hoặc thư mục tương đương) cần đủ dung lượng cho các clone.
- Gỡ project khỏi registry **không** xóa thư mục clone — operator có thể dọn thủ công.
- Private repo / SSH URL chưa được hỗ trợ trong MVP (chỉ HTTPS public).
- Đồng bộ thủ công: nút **Đồng bộ** trên UI, `POST /api/projects/:id/sync`, hoặc `bun run workspace:sync [--project=<id>]`.

## 7. Runner server (Luồng A, #42)

Dashboard **không** cài Claude Code — operator phải đảm bảo binary `claude` có trong `PATH` trên host/container.

1. Set biến môi trường `ANTHROPIC_API_KEY` cho process dashboard (ví dụ trong `docker-compose.yml`).
2. Preset sẵn có: runner `claude-code-server` (`flags: ['--bare']`) + credential `claude-server-env` (`env:ANTHROPIC_API_KEY`).
3. Trên server production: UI **Runner → Set default** chọn `claude-code-server`, hoặc orchestrator truyền `--runner claude-code-server`.
4. Smoke test: Runner panel → chọn `claude-code-server` → **Smoke test** → kỳ vọng `succeeded` khi env + CLI OK.
5. Khi `ANTHROPIC_API_KEY` chưa set: job fail — kiểm tra log job và env container/host.

**Lưu ý:** Credential `cli-session` cần phiên đăng nhập Claude Code trên máy local; trên server headless dashboard sẽ hiển thị cảnh báo — dùng `claude-code-server` thay thế.

## 8. Dev push & server sync (Luồng B, #42)

Workflow dev workstation:

1. Chạy orchestrator local với runner mặc định `claude-code-local` + credential `cli-session`.
2. Artifact ghi vào `.dev-team-agent/` trong repo git.
3. Đẩy lên remote:

```bash
bun run workspace:push --project=<id>
```

4. Trên server: đồng bộ mirror bằng một trong các cách:
   - UI nút **Đồng bộ**
   - `bun run workspace:sync --project=<id>`
   - `curl -X POST -H "Authorization: Bearer $TOKEN" "https://dashboard.example.com/api/projects/<id>/sync?project=<id>"`

**Tuỳ chọn một lệnh:** gọi sync ngay sau push:

```bash
bun run workspace:push --project=<id> --sync-server=https://dashboard.example.com
```

Cần `DEV_TEAM_API_TOKEN` nếu server bật auth. Có thể set `DEV_TEAM_SERVER_URL` thay cho `--sync-server`.

- Project id trên dev và server **nên trùng** khi cùng repo git.
- `kind: 'local'` trên dev registry **được phép** push nếu `project.path` nằm trong git repo có remote `origin`.
- Push chỉ stage/commit `.dev-team-agent/**` — không add toàn repo.

## 9. Conflict policy (#42)

- **Một task chỉ nên có một runner active** tại một thời điểm (dev local **hoặc** server headless).
- MVP **không** có distributed lock — operator tránh chạy đồng thời cùng `task-id`.
- Nếu push dev và server job ghi cùng artifact: last-write-wins trên git; server `sync` pull có thể ghi đè mirror local.

## 10. Orchestrator chọn runner (#42)

| Môi trường | Runner | Credential | CLI |
|---|---|---|---|
| Dev workstation | `claude-code-local` (default) | `cli-session` | `runner-cli.mjs submit ...` (không `--runner`) |
| Server / CI headless | `claude-code-server` | `env:ANTHROPIC_API_KEY` | `runner-cli.mjs submit --runner claude-code-server ...` |
| Remote SSH (#44) | `claude-code-ssh` | `file:` key | *Out of scope #42* |

Gợi ý env orchestrator trên server (doc only): `DEV_TEAM_RUNNER_ID=claude-code-server`.

### Bảng luồng A / B / C

| Luồng | Mô tả | Task |
|---|---|---|
| A | Server chạy job headless | #42 |
| B | Dev local + push artifact | #42 |
| C | SSH remote runner | #44 (OUT) |
