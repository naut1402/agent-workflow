# Bundled `dev-agent-teams` plugin (Docker fallback)

Snapshot of Claude plugin agents/skills used when the container has **no** host
`~/.claude/plugins` mount (e.g. `./docker/install.sh` without `--runners`).

Entrypoint seeds this tree into:

`/home/dashboard/.claude/plugins/cache/bundled/dev-agent-teams/0.0.0/`

so `resolveAgent('dev-agent-teams:investigator')` can find
`agents/investigator.md`.

When host plugins are mounted (`docker/compose.runners.yml`), host cache wins.

Re-sync from a machine with the plugin installed:

```bash
cp -R ~/.claude/plugins/cache/*/dev-agent-teams/<ver>/agents docker/bundled-plugins/dev-agent-teams/
cp -R ~/.claude/plugins/cache/*/dev-agent-teams/<ver>/skills docker/bundled-plugins/dev-agent-teams/
```
