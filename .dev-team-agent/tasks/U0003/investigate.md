# Investigate — U0003 (F0003 docs)

**Issue:** [naut1402/agent-workflow#39](https://github.com/naut1402/agent-workflow/issues/39) — Deploy dashboard lên server độc lập, multi-environment.

## Phạm vi epic

Epic F0003 gồm 5 sub-issue đã implement trên branch `feat/U0003/main`:

| Issue | ID | Mô tả | Doc hiện có |
| --- | --- | --- | --- |
| #40 | F0003.1 | Docker + API token + health | `docs/deploy.md` §1–§5 |
| #41 | F0003.2 | Git workspace onboarding | `docs/deploy.md` §6 (sơ lược) |
| #42 | F0003.3 | Runner hybrid (Luồng A/B) | `docs/deploy.md` §7–§10 |
| #44 | F0003.5 | SSH remote runner (Luồng C) | `docs/ssh-remote.md` |
| #43 | F0003.4 | Multi-env ops | **Thiếu** — chỉ 1 dòng `DEV_TEAM_ENV` |

## Kiến trúc đã chốt (#39)

- **Workspace:** server host git clone hoặc bind-mount `.dev-team-agent/` per project (`kind: local | git | ssh`).
- **Auth MVP:** `DEV_TEAM_API_TOKEN` (Bearer hoặc `X-Dev-Team-Token`); `/api/health` luôn public.
- **Runner:** 3 luồng — server headless (A), dev push + sync (B), SSH remote + pull cache (C).
- **Monitor SSH:** không đọc realtime qua SSH; chỉ cache sau post-job rsync.

## Gap phân tích doc

1. Không có **index/hub** liên kết toàn bộ hướng dẫn F0003.
2. `docs/deploy.md` §10 ghi SSH "OUT" — đã lỗi thời sau #44.
3. `docker-compose.yml` mount volume `/workspaces` riêng nhưng code clone vào `$DEV_TEAM_DASHBOARD_HOME/workspaces/` (`/data/workspaces/`).
4. Thiếu runbook **multi-env** (#43): cấu trúc data dir, logging, backup thủ công, API token từ browser.
5. `docs/ssh-remote.md` chưa nêu đủ paths rsync, mount `/keys`, env override test stub.
6. Thiếu hướng dẫn MCP `add_project` với `gitUrl`.

## Deliverable mục tiêu

- `docs/README.md` — mục lục epic + sơ đồ luồng.
- Cập nhật `docs/deploy.md` — sửa lỗi thời, bổ sung bare-metal env, MCP.
- `docs/multi-env.md` — runbook #43.
- Mở rộng `docs/ssh-remote.md` — Docker, rsync paths, troubleshooting.
- Sửa `docker-compose.yml` — bỏ volume `/workspaces` thừa.
