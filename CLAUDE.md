# CLAUDE.md

Guidance cho Claude Code (claude.ai/code) khi làm việc trong repo này.

Quy ước chung cho mọi agent: @AGENTS.md

## Đặc thù Claude Code

- **MCP server** — `mcp/server.ts` (`bun run mcp`) expose CRUD project-registry cho Claude Code; bật qua `.claude/settings.local.json` (`enabledMcpjsonServers`, file local — gitignored). Không cần HTTP server chạy.
- **Thư mục `.claude/`** — state cục bộ của máy dev (worktree, cache, `settings.local.json`), **không** commit. Rule của repo nằm ở `docs/agent-rules/`, không nằm ở đây.
- **Sửa API** — domain ở `business/`; HTTP ở `controller.ts`; map route ở `api.ts` (`bind`); `apiServer.ts` tự duyệt `features/<name>/api.ts`.
