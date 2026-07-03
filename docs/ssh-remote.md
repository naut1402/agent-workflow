# SSH Remote Runner — F0003.5 (#44)

Hướng dẫn cấu hình **Luồng C**: dashboard server điều phối job qua SSH tới máy dev, sau job **pull cache** (rsync) về server.

**Tracking:** Part of [agent-workflow#39](https://github.com/naut1402/agent-workflow/issues/39), [agent-workflow#44](https://github.com/naut1402/agent-workflow/issues/44).

Quay lại [mục lục F0003](./README.md) · Runtime Docker: [deploy.md](./deploy.md).

---

## Khi nào dùng Luồng C

- Dev giữ workspace local, không muốn push/sync thủ công (Luồng B)
- Server không clone được repo (private network, credential phức tạp)
- Cần `cli-session` OAuth trên máy dev nhưng dashboard tập trung trên server

## Prerequisites

- `openssh-client` và `rsync` trên PATH server (Docker image #40 đã cài)
- SSH private key quyền `600` (`chmod 600 /keys/id_ed25519`)
- `known_hosts` — cấu hình `knownHostsFile` trên runner nếu cần
- Binary `claude` có trên **máy remote** (không phải server)

## Docker: mount SSH keys

Trong `docker-compose.yml`:

```yaml
volumes:
  - keys:/keys:ro
```

Tạo credential với `secretRef: file:/keys/id_ed25519`.

```bash
# Trên host — copy key vào named volume (một lần)
docker compose run --rm -v keys:/keys dashboard sh -c \
  'install -m 600 /dev/stdin /keys/id_ed25519' < ~/.ssh/id_ed25519
```

Hoặc bind-mount trực tiếp:

```yaml
volumes:
  - ~/.ssh/id_ed25519:/keys/id_ed25519:ro
```

---

## Onboarding (3 bước)

### 1. Credential SSH

Tab **Runner → Credentials → Thêm**:

| Field | Ví dụ |
| --- | --- |
| Provider | `claude-code-ssh` |
| secretRef | `file:/keys/id_ed25519` |

Chỉ hỗ trợ `file:` reference trong MVP — không `ssh-agent` forwarding.

### 2. Runner SSH

Tab **Runner → Thêm runner**:

| Field | Ví dụ |
| --- | --- |
| Provider | `claude-code-ssh` |
| Credential | credential vừa tạo |
| Host | `dev-mac.local` |
| User | `developer` |
| Port | `22` |

Nhấn **Kiểm tra kết nối** — gọi `POST /api/runners/:id/test-ssh` (rate limit 5s/runner).

### 3. Project SSH

Tab **Projects → SSH remote**:

| Field | Ví dụ |
| --- | --- |
| Remote path | `/Users/dev/projects/myapp/.dev-team-agent` (POSIX) |
| Host / User | trùng runner |
| Runner | runner SSH vừa tạo |

Server tạo `artifactCache` tự động dưới `$DEV_TEAM_DASHBOARD_HOME/cache/<project-id>/` nếu không chỉ định.

Project `kind: 'ssh'` — Monitor đọc từ **cache local**, không phải remote path.

---

## Luồng runtime

```text
Submit job (?project=<ssh-id>)
  → SSH: cd <remoteWs> && claude ... (provider claude-code-ssh)
  → post-job: pullArtifacts (rsync remote → artifactCache)
  → Monitor poll GET /api/tasks đọc cache (không SSH)
```

### Paths rsync sau mỗi job

Từ remote `<remoteRoot>/` về `<artifactCache>/`:

| Path | Bắt buộc | Ghi chú |
| --- | --- | --- |
| `.dev-state/` | Có | `--delete` |
| `tasks/` | Có | `--delete` |
| `pipeline.yaml` | Tuỳ chọn | bỏ qua nếu thiếu |
| `knowledge.config.yaml` | Tuỳ chọn | |
| `knowledge/` | Tuỳ chọn | |

Field `lastSyncedAt` / `lastSyncError` cập nhật trên project registry sau pull.

---

## API thủ công

```bash
# Test SSH connection
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5174/api/runners/<runner-id>/test-ssh"

# Pull cache thủ công (ngoài post-job)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5174/api/projects/<project-id>/pull-cache?project=<project-id>"
```

- `test-ssh`: rate limit 5 giây/runner
- `pull-cache`: trả `409` nếu pull đang chạy

---

## Env override (test / stub)

| Biến | Mặc định | Mô tả |
| --- | --- | --- |
| `SSH_BINARY` | `ssh` | Override binary SSH |
| `RSYNC_BINARY` | `rsync` | Override binary rsync |
| `SSH_STUB_SCRIPT` | — | Stub script cho unit test |
| `RSYNC_STUB_SCRIPT` | — | Stub script cho unit test |

---

## Troubleshooting

| Triệu chứng | Gợi ý |
| --- | --- |
| Host key verification failed | Thêm host vào known_hosts hoặc set `knownHostsFile` trên runner config |
| Permission denied (publickey) | Kiểm tra key path, quyền 600, user@host, mount `/keys` |
| Cache stale | Xem `lastSyncedAt` trên UI badge SSH; **↻ Đồng bộ cache** hoặc `pull-cache` |
| rsync not found | Cài `rsync` trên server (Docker image #40 đã có) |
| Job OK nhưng Monitor trống | Chờ post-job pull; kiểm tra `lastSyncError` |
| `409 pull already in progress` | Đợi job/pull hiện tại xong |

---

## Giới hạn MVP

- Monitor **không** SSH realtime mỗi poll — chỉ đọc cache sau pull
- Remote paths luôn **POSIX** (`/Users/...`, `/home/...`)
- Không hỗ trợ `ssh-agent` forwarding
- Không SSH jump host / bastion chain
- Không SFTP mount toàn bộ workspace
- Windows OpenSSH edge cases — out of scope

---

## Bảo mật

| Rủi ro | Mitigation |
| --- | --- |
| SSH key lộ trên server | Key riêng per-runner, quyền hạn chế, volume `:ro`, không expose qua API |
| Host key MITM | `StrictHostKeyChecking=yes` (mặc định), `knownHostsFile` pinning |
| Conflict cùng task-id | Policy: 1 task = 1 runner active — xem [deploy.md §10](./deploy.md#10-conflict-policy-42) |

---

## Checklist smoke test (#44)

- [ ] **T44-01**: Credential `file:/keys/...` + runner SSH test → `connection ok`
- [ ] **T44-02**: Thêm project SSH remote path hợp lệ
- [ ] **T44-03**: Submit job → job succeeded trên remote
- [ ] **T44-04**: Post-job pull → Monitor hiện task state
- [ ] **T44-05**: `pull-cache` thủ công cập nhật `lastSyncedAt`
