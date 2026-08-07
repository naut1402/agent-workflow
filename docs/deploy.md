# Docker — chạy dashboard trong container

Compose + Dockerfile ở thư mục [`docker/`](../docker/). Deploy có bước chuẩn bị env / CA / auth CLI qua `install.sh`.

## Yêu cầu

- Docker + Compose plugin
- Bash (Git Bash / WSL trên Windows) cho `install.sh` và các `bun run docker:*` bọc script đó
- Sao chép env lần đầu: `cp docker/.env.example docker/.env` rồi chỉnh `DEV_TEAM_PROJECT_PATH`, `HOST_HOME`, …

## Lệnh bun (từ root repo)

| Script | Việc |
|--------|------|
| `bun run docker:up` | `install.sh` — up `-d` (tự tạo `.env` nếu thiếu; build nếu chưa có image) |
| `bun run docker:up:runners` | Up kèm overlay auth Claude/Cursor (`compose.runners.yml`) |
| `bun run docker:build` | Rebuild image rồi up |
| `bun run docker:down` | `compose down` |
| `bun run docker:logs` | Theo dõi log service `dashboard` |
| `bun run docker:ps` | Trạng thái container |
| `bun run docker:restart` | Restart service |

UI mặc định: `http://127.0.0.1:5174/` (đổi port bằng `DEV_TEAM_DASHBOARD_PORT` trong `docker/.env` hoặc `./docker/install.sh --port=N`).

## File chính

- [`compose.yml`](../docker/compose.yml) — service `dashboard`
- [`compose.runners.yml`](../docker/compose.runners.yml) — mount auth host (cần `HOST_HOME`)
- [`Dockerfile`](../docker/Dockerfile) — image `dev-team-dashboard:local`
- [`.env.example`](../docker/.env.example) — mẫu biến môi trường
- [`install.sh`](../docker/install.sh) — deploy helper đầy đủ (`--runners`, `--build`, `--down`, `--port`)
- [`certs/`](../docker/certs/) — CA corporate khi build (tuỳ chọn)

Chi tiết biến môi trường xem comment trong `.env.example`.
