# Multi-environment Ops — F0003.4 (#43)

Runbook vận hành nhiều instance dashboard (dev / staging / production) với data tách biệt, logging và backup thủ công.

**Tracking:** Part of [agent-workflow#39](https://github.com/naut1402/agent-workflow/issues/39), [agent-workflow#43](https://github.com/naut1402/agent-workflow/issues/43).

Quay lại [mục lục F0003](./README.md).

---

## 1. Mô hình isolation

Mỗi môi trường là **một process dashboard riêng** với thư mục data riêng qua `DEV_TEAM_DASHBOARD_HOME`:

| Môi trường | `DEV_TEAM_ENV` | `DEV_TEAM_DASHBOARD_HOME` | Token |
| --- | --- | --- | --- |
| Dev local | *(bỏ trống)* | `~/.dev-team-dashboard` | *(không bật)* |
| Staging | `staging` | `/data/staging` hoặc volume Docker | token A |
| Production | `production` | `/data/prod` | token B |

**Không chia sẻ** `projects.json`, `runners.json`, `credentials.json` giữa các env — mỗi instance có registry riêng.

### Cấu trúc thư mục dưới `DEV_TEAM_DASHBOARD_HOME`

```text
$DEV_TEAM_DASHBOARD_HOME/
  projects.json          # registry project (local/git/ssh)
  runners.json           # runner presets + defaultRunnerId
  credentials.json       # cli-session, env:ANTHROPIC_API_KEY, file:/keys/...
  workspaces/            # git shallow clones (kind: git)
    <project-id>/
      .dev-team-agent/
  cache/                 # artifact cache cho project kind: ssh
    <project-id>/
  jobs/                  # job metadata + stdout log per job
  logs/
    request.jsonl        # mọi /api/* request
    request.jsonl.1      # backup sau rotate (>5MB)
    audit.jsonl          # mutation: project, runner, pipeline, artifact...
    audit.jsonl.1
```

---

## 2. Biến môi trường theo instance

| Biến | Mô tả |
| --- | --- |
| `DEV_TEAM_DASHBOARD_HOME` | **Bắt buộc** tách env — root data |
| `DEV_TEAM_ENV` | Label trả về trong `GET /api/health` → `{ ok, version, env? }` |
| `DEV_TEAM_API_TOKEN` | Token riêng per env — **khác nhau** giữa staging/prod |
| `DEV_TEAM_DASHBOARD_HOST` | `0.0.0.0` trên server |
| `DEV_TEAM_DASHBOARD_PORT` | Mặc định `5174` |
| `ANTHROPIC_API_KEY` | Chỉ instance chạy Luồng A (server headless) |

### Ví dụ docker-compose multi-env (2 file)

**staging/docker-compose.yml:**

```yaml
services:
  dashboard:
    build: ..
    ports: ["5174:5174"]
    environment:
      DEV_TEAM_DASHBOARD_HOME: /data
      DEV_TEAM_ENV: staging
      DEV_TEAM_API_TOKEN: ${STAGING_TOKEN}
    volumes:
      - staging-data:/data
volumes:
  staging-data:
```

**production/docker-compose.yml:** tương tự với port `5175`, volume `prod-data`, `DEV_TEAM_ENV=production`.

---

## 3. Health & monitoring

### Health endpoint (luôn public)

```bash
curl -sS https://dashboard-staging.example.com/api/health
# → { "ok": true, "version": "0.1.0", "env": "staging" }
```

Dùng cho:

- Docker `healthcheck` (wget `/api/health`)
- Load balancer / uptime probe
- Phân biệt instance khi debug (field `env`)

**Lưu ý:** UI dashboard **chưa** hiển thị badge env — kiểm tra qua API hoặc reverse proxy header tuỳ chọn.

### Docker healthcheck (mặc định)

Trong `docker-compose.yml`:

```yaml
healthcheck:
  test: ["CMD", "wget", "-qO-", "http://127.0.0.1:5174/api/health"]
  interval: 30s
  timeout: 5s
  retries: 3
```

---

## 4. Logging & audit

### Request log

Mọi request `/api/*` ghi JSONL tại `logs/request.jsonl`:

- `method`, `path`, `projectId`, `status`, `durationMs`, `error`

### Audit log

Mutation thành công ghi `logs/audit.jsonl`:

- Thêm/xóa project, runner, credential
- Ghi pipeline, custom agent, artifact PUT

### Xem log trên UI

Tab **Logs** trong dashboard:

- **Audit** — thay đổi cấu hình
- **Request** — HTTP API
- **Jobs** — tail stdout job runner

### API đọc log

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://dashboard.example.com/api/logs?type=audit&limit=50"
```

Query params: `type` (`request` | `audit`), `project`, `limit` (mặc định 200).

### Log rotation

- File vượt **5 MB** → rotate thành `<file>.1` (giữ **một** bản backup).
- Không tự xóa — operator dọn định kỳ nếu cần.

---

## 5. API token từ browser

Khi server bật `DEV_TEAM_API_TOKEN`, frontend cần token trong `localStorage`:

1. Mở dashboard, DevTools → Console
2. Chạy:

```javascript
localStorage.setItem('dev-team-api-token', 'your-secret-token')
location.reload()
```

Frontend đọc key `dev-team-api-token` (`src/shared/lib/authToken.ts`) và gắn header `Authorization: Bearer ...` hoặc `X-Dev-Team-Token`.

**Production:** cân nhắc reverse proxy thêm auth layer (Basic/OAuth) trước dashboard.

---

## 6. Backup & restore thủ công

MVP **không** ship script backup tự động. Operator backup định kỳ:

### Backup registry + config

```bash
DASH_HOME="${DEV_TEAM_DASHBOARD_HOME:-$HOME/.dev-team-dashboard}"
BACKUP="dashboard-backup-$(date +%Y%m%d-%H%M).tar.gz"

tar -czf "$BACKUP" \
  -C "$DASH_HOME" \
  projects.json runners.json credentials.json \
  workspaces cache jobs logs
```

### Restore

```bash
# Dừng dashboard trước
docker compose down   # hoặc stop process

tar -xzf dashboard-backup-YYYYMMDD-HHMM.tar.gz -C "$DASH_HOME"
docker compose up -d
```

### Backup selective (chỉ registry)

```bash
cp "$DASH_HOME/projects.json" "$DASH_HOME/projects.json.bak.$(date +%s)"
cp "$DASH_HOME/runners.json" "$DASH_HOME/runners.json.bak.$(date +%s)"
```

**Quan trọng:** `credentials.json` có thể chứa reference tới SSH key — backup cùng thư mục `/keys` mount.

---

## 7. Checklist vận hành (#43)

- [ ] **T43-01**: Mỗi env có `DEV_TEAM_DASHBOARD_HOME` riêng, không mount chung volume
- [ ] **T43-02**: `DEV_TEAM_ENV` khác nhau; `/api/health` trả đúng label
- [ ] **T43-03**: Token khác nhau per env; request không token → 401
- [ ] **T43-04**: Tab Logs hiển thị audit sau thêm project
- [ ] **T43-05**: Backup tar registry + restore trên instance test
- [ ] **T43-06**: Log rotate: file >5MB tạo `.1` backup

---

## 8. Troubleshooting

| Triệu chứng | Nguyên nhân | Gợi ý |
| --- | --- | --- |
| UI 401 mọi tab | Thiếu token localStorage | Set `dev-team-api-token` (§5) |
| Staging thấy project prod | Chung volume `/data` | Tách `DEV_TEAM_DASHBOARD_HOME` |
| Health không có `env` | `DEV_TEAM_ENV` chưa set | Thêm vào compose/env file |
| Audit log trống | Chưa có mutation | Thêm project thử, refresh Logs |
| Disk đầy | `workspaces/` + `cache/` lớn | Dọn clone cũ, rotate logs |

---

## Liên quan

- [deploy.md](./deploy.md) — Docker runtime (#40)
- [ssh-remote.md](./ssh-remote.md) — cache SSH (#44)
