# PR Description — U0003 docs (F0003)

## Issue

Part of [agent-workflow#39](https://github.com/naut1402/agent-workflow/issues/39) — tài liệu hướng dẫn epic Deploy dashboard multi-environment.

## Nội dung thay đổi

| File | Thay đổi |
| --- | --- |
| `docs/README.md` | **Mới** — hub mục lục F0003, sơ đồ 3 luồng runner, quick start |
| `docs/deploy.md` | **Cập nhật** — bảng env, bare-metal, Git/MCP, sửa bảng luồng C, API token UI |
| `docs/multi-env.md` | **Mới** — runbook #43: data dir, logging, backup, checklist T43 |
| `docs/ssh-remote.md` | **Mở rộng** — Docker keys, rsync paths, API, env stub, checklist T44 |
| `docker-compose.yml` | **Sửa** — bỏ volume `/workspaces` thừa (clone nằm trong `/data/workspaces/`) |
| `.dev-team-agent/tasks/U0003/*` | Artifacts orchestrator investigate/design |

## Test

- Doc-only — không thay đổi runtime logic
- `docker-compose.yml`: volume mount align với `server/git/workspace.ts` (`registryHome()/workspaces/`)

## Checklist reviewer

- [ ] Link issue/sub-issue đúng
- [ ] Tiếng Việt nhất quán
- [ ] Không commit screenshot e2e vào `docs/`
