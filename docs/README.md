# Hướng dẫn Deploy — Epic F0003

Tài liệu hướng dẫn triển khai **dev-team-dashboard** lên server độc lập, hỗ trợ multi-environment và 3 luồng runner.

**Tracking:** Part of [agent-workflow#39](https://github.com/naut1402/agent-workflow/issues/39) — Deploy dashboard lên server độc lập.

## Mục lục

| Tài liệu | Sub-issue | Nội dung |
| --- | --- | --- |
| [deploy.md](./deploy.md) | #40, #41, #42 | Docker, API token, health, Git workspace, runner hybrid (Luồng A/B) |
| [ssh-remote.md](./ssh-remote.md) | #44 | SSH remote runner, pull cache (Luồng C) |
| [multi-env.md](./multi-env.md) | #43 | Nhiều instance (staging/prod), logging, backup |

## Kiến trúc tổng quan

Dashboard chuyển từ **local-first** (`127.0.0.1:5174`, registry tại `~/.dev-team-dashboard/`) sang **server-ready**:

- Bind `0.0.0.0` (Docker / reverse proxy)
- Auth tuỳ chọn qua `DEV_TEAM_API_TOKEN`
- Project registry hỗ trợ `kind: local | git | ssh`
- Job queue + runner providers (`claude-code-cli`, `claude-code-ssh`)

### Ba luồng runner

```
┌─────────────────────────────────────────────────────────────────┐
│  Luồng A — Server runner (#42)                                   │
│  Dashboard → job queue → claude CLI trên server (ANTHROPIC_API_KEY)│
│  Workspace = git clone trên server (kind: git) hoặc local path   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Luồng B — Dev runner + sync (#42)                               │
│  Dev machine → claude CLI local (cli-session OAuth)              │
│  workspace:push → git remote → server workspace:sync             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Luồng C — SSH remote runner (#44)                               │
│  Dashboard → SSH → claude trên máy dev → post-job rsync cache   │
│  Monitor đọc cache local — không SSH mỗi poll                    │
└─────────────────────────────────────────────────────────────────┘
```

### Chọn luồng phù hợp

| Tình huống | Luồng | Project kind |
| --- | --- | --- |
| CI/headless trên server, repo public HTTPS | A | `git` |
| Dev giữ OAuth `cli-session`, artifact push git | B | `local` (dev) + `git` (server) |
| Workspace chỉ trên máy dev, dashboard tập trung | C | `ssh` |
| Server không clone được repo (private network phức tạp) | C | `ssh` |

## Quick start (Docker)

```bash
# 1. Clone repo và build
git clone https://github.com/naut1402/agent-workflow.git
cd agent-workflow
git checkout feat/U0003/main   # hoặc branch đã merge epic

# 2. Cấu hình env
cat > .env <<'EOF'
DEV_TEAM_API_TOKEN=your-secret-token
DEV_TEAM_ENV=staging
ANTHROPIC_API_KEY=sk-ant-...   # chỉ cần nếu dùng Luồng A
EOF

# 3. Chạy
docker compose up -d --build

# 4. Kiểm tra
curl -sS http://localhost:5174/api/health
curl -H "Authorization: Bearer your-secret-token" http://localhost:5174/api/tasks
```

Chi tiết smoke test: [deploy.md §4](./deploy.md#4-checklist-smoke-test-40).

## Thứ tự triển khai sub-issue

Đề xuất từ epic #39:

```text
#40 (runtime) → #41 (git onboard) → #44 (SSH runner) → #42 (hybrid sync) → #43 (multi-env ops)
```

PR liên quan trên branch tích hợp `feat/U0003/main`:

- #45 — API token + health (#40)
- #47 — Git workspace (#41)
- #49 — SSH remote runner (#44)
- #48 — Hybrid runner (#42)
- #5 (fork) — Multi-env badge + backup (#43)

## Liên kết ngoài

- [CLAUDE.md](../CLAUDE.md) — kiến trúc dashboard
- [Issue #39](https://github.com/naut1402/agent-workflow/issues/39) — epic tracking
- [Issue #27](https://github.com/naut1402/agent-workflow/issues/27) — docs umbrella
