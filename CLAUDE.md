# CLAUDE.md

> **Quy ước chung cho MỌI agent nằm ở [`AGENTS.md`](AGENTS.md) — đọc `AGENTS.md` trước**, rồi mở doc trong `docs/implement/` / `docs/cookbook/` theo bảng trong hub. File này chỉ bổ sung phần đặc thù Claude Code.

Guidance cho Claude Code (claude.ai/code) khi làm việc trong repo này.

- **Hub + bất biến:** [`AGENTS.md`](AGENTS.md).
- **Implement (rule / convention):** [`docs/implement/`](docs/implement/).
- **Chạy dự án + quickstart:** [`README.md`](README.md).
- **Kiến trúc:** [`docs/architecture.md`](docs/architecture.md).

## Đặc thù Claude Code

- **MCP server:** `mcp/server.ts` (`bun run mcp`) expose CRUD project-registry cho Claude Code; bật qua `.claude/settings.local.json` (`enabledMcpjsonServers`, file local — gitignored). Không cần HTTP server chạy — xem [`docs/architecture.md`](docs/architecture.md) §4.
- **Rule của repo này cho công cụ AI:** [`.claude/rules/`](.claude/rules/) — bản rút gọn theo category (`coding`, `doc-writing`, `test`, `git-pr`), được dashboard quét qua `GET /api/rules` và gắn cho từng bước pipeline. Bản đầy đủ dành cho người đọc ở [`docs/implement/`](docs/implement/).
- Khi sửa API: domain ở `business/`; HTTP ở `controller.ts`; map route ở `api.ts` (`bind`); `apiServer.ts` tự duyệt `features/<name>/api.ts`.
