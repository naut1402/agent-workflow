# Template (dev-agent-teams)

Mẫu agent + pipeline dùng cho dashboard / Docker — **không** vendor toàn bộ plugin Claude
(`skills/`, script `.mjs`, `plugin.json`, …).

Nguồn gốc: snapshot phần template từ plugin `dev-agent-teams` (orchestrator riêng).
Khi cần bản mới, copy lại từ máy đã cài plugin:

```bash
# Agents (cần cho resolveAgent / Docker fallback)
cp ~/.claude/plugins/cache/*/dev-agent-teams/<ver>/agents/*.md docs/template/agents/

# Pipeline (tài liệu / scaffold — không bắt buộc trong image)
cp ~/.claude/plugins/cache/*/dev-agent-teams/<ver>/skills/dev-team-orchestrator/assets/pipeline*.yaml docs/template/pipeline/
cp ~/.claude/plugins/cache/*/dev-agent-teams/<ver>/skills/dev-team-orchestrator/assets/orchestrator-remote.example.json docs/template/pipeline/
```

## Cấu trúc

| Path | Mục đích |
|------|----------|
| `agents/*.md` | Agent markdown (`dev-agent-teams:<name>`) — Docker COPY → `/opt/bundled-plugins/dev-agent-teams/agents/` |
| `pipeline/*` | YAML/JSON mẫu pipeline & remote orchestrator — chỉ docs, không vào image runtime |

## Docker

Image chỉ đóng gói `docs/template/agents/` (xem `docker/Dockerfile`). Resolver tìm
`/opt/bundled-plugins/<plugin>/agents/<name>.md` (hoặc `DEV_TEAM_BUNDLED_PLUGINS`).

Khi mount host plugins (`docker/compose.runners.yml`), cache host thắng; seed entrypoint bỏ qua nếu đã có agent.
