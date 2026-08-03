# Bundled `dev-agent-teams` plugin (Docker fallback)

Snapshot of Claude plugin agents/skills used when the container has **no** host
`~/.claude/plugins` mount (e.g. bare `docker compose up` without
`docker-compose.runners.yml`).

Entrypoint seeds this tree into:

`/home/dashboard/.claude/plugins/cache/bundled/dev-agent-teams/0.0.0/`

so `resolveAgent('dev-agent-teams:investigator')` can find
`agents/investigator.md`.

When host plugins are mounted (runners overlay), host cache wins (newer mtime).

Re-sync from a machine with the plugin installed:

```bash
# PowerShell / bash — adjust market path if needed
cp -R ~/.claude/plugins/cache/*/dev-agent-teams/<ver>/agents docker/bundled-plugins/dev-agent-teams/
cp -R ~/.claude/plugins/cache/*/dev-agent-teams/<ver>/skills docker/bundled-plugins/dev-agent-teams/
```
