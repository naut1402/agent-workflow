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

