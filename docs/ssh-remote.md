# SSH Remote Runner — F0003.5

Hướng dẫn cấu hình **Luồng C**: dashboard server điều phối job qua SSH tới máy dev, sau job **pull cache** (rsync) về server.

## Prerequisites

- `openssh-client` và `rsync` trên PATH (server / Docker image #40).
- SSH private key với quyền `600` (`chmod 600 /keys/id_ed25519`).
- `known_hosts` — cấu hình `knownHostsFile` trên runner nếu cần.

## Onboarding

1. **Credential**: tạo profile `provider: claude-code-ssh`, `secretRef: file:/path/to/key`.
2. **Runner**: tab Runner → provider `claude-code-ssh` → host, user, port → **Kiểm tra kết nối**.
3. **Project**: tab Projects → **SSH remote** → remote path POSIX, host, user, runner → Thêm.

## Luồng runtime

```
Submit job (?project=<ssh-id>)
  → execute qua ssh user@host 'cd <remoteWs> && claude ...'
  → post-job pullArtifacts (rsync .dev-state/ + tasks/ → artifactCache)
  → Monitor poll GET /api/tasks đọc cache (không SSH)
```

## API thủ công

- `POST /api/runners/:id/test-ssh` — kiểm tra kết nối (rate limit 5s/runner).
- `POST /api/projects/:id/pull-cache` — đồng bộ cache thủ công.

## Troubleshooting

| Triệu chứng | Gợi ý |
|---|---|
| Host key verification failed | Thêm host vào known_hosts hoặc set `knownHostsFile` |
| Permission denied (publickey) | Kiểm tra key path, quyền 600, user@host |
| Cache stale | Xem `lastSyncedAt`; dùng **Đồng bộ cache** hoặc chờ post-job pull |
| rsync not found | Cài `rsync` trên server (#40 image) |

## Giới hạn MVP

- Monitor **không** SSH realtime mỗi poll — chỉ đọc cache sau pull.
- Remote paths luôn **POSIX** (`/Users/...`).
- Không hỗ trợ `ssh-agent` forwarding trong MVP.
