# Deploy — dev-team-dashboard

Tài liệu deploy server độc lập (epic #39). Chi tiết Docker/auth xem PR #40.

## SSH remote runner

Xem **[ssh-remote.md](./ssh-remote.md)** cho Luồng C (F0003.5):

- Cấu hình runner `claude-code-ssh` + project `kind: ssh`
- Post-job pull cache qua rsync
- Monitor đọc `artifactCache` local

## Checklist nhanh

- [ ] `openssh-client` + `rsync` trên server
- [ ] SSH key volume read-only (`/keys:ro`)
- [ ] Runner test-ssh OK trước khi submit job
- [ ] `lastSyncedAt` cập nhật sau job hoặc pull-cache thủ công
