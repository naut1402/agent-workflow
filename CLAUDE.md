# CLAUDE.md

> **Quy ước chung cho MỌI agent nằm ở [`AGENTS.md`](AGENTS.md) — đọc `AGENTS.md` trước**, rồi mở rule trong [`.claude/rules/`](.claude/rules/) theo bảng trong hub. File này chỉ bổ sung phần đặc thù Claude Code.

Guidance cho Claude Code (claude.ai/code) khi làm việc trong repo này.

- **Hub + bất biến:** [`AGENTS.md`](AGENTS.md).
- **Rule theo bước pipeline:** [`.claude/rules/`](.claude/rules/).
- **Chạy dự án + quickstart:** [`README.md`](README.md).
- **Kiến trúc:** [`docs/architecture.md`](docs/architecture.md).

## Đặc thù Claude Code

- **MCP server:** `mcp/server.ts` (`bun run mcp`) expose CRUD project-registry cho Claude Code; bật qua `.claude/settings.local.json` (`enabledMcpjsonServers`, file local — gitignored). Không cần HTTP server chạy — xem [`docs/architecture.md`](docs/architecture.md) §4.
- **Rule của repo này:** [`.claude/rules/`](.claude/rules/) — mỗi file một category (`coding`, `doc-writing`, `test`, `git-pr`); dashboard quét qua `GET /api/rules` và gắn cho từng bước pipeline. Đây là **bản chuẩn**, không phải bản rút gọn của tài liệu nào khác.
- Khi sửa API: domain ở `business/`; HTTP ở `controller.ts`; map route ở `api.ts` (`bind`); `apiServer.ts` tự duyệt `features/<name>/api.ts`.
