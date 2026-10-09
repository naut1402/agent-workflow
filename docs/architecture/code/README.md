# Chi tiết cấp Code — mục lục

Cấp **Code** của [`../README.md`](../README.md) §4, tách theo feature / vùng. Mỗi file chỉ ghi phần **không tự giải thích được qua tên file**: bất biến an toàn, ràng buộc thứ tự, quirk của công cụ ngoài, lý do giữ một hành vi trông như thừa.

- **Code trỏ sang đây bằng một dòng** `// xem docs/architecture/code/<file>.md §N` — đó là chỗ duy nhất comment code được phép giải thích (`coding-guideline.md` §7).
- **Sửa code ở vùng nào thì đối chiếu section được trỏ tới** — nội dung lệch code là nợ, sửa cùng thay đổi.

---

| File | Vùng | Đọc khi |
|---|---|---|
| [`backend.md`](backend.md) | `src/backend/` | Sửa DB schema, `fileHelper`, event bus, chuỗi middleware `/api/*` |
| [`frontend.md`](frontend.md) | `src/frontend/` | Dùng `CLoadingOverlay`, render markdown/mermaid, sửa `.modal`, `CScreenLayout`, editor markdown |
| [`shared.md`](shared.md) | `src/shared/` | Sửa cách suy `hitl_pending` |
| [`tooling.md`](tooling.md) | `.github/scripts/`, config gốc | Sửa script CI, cấu hình vitest / eslint / vite |
| [`agent-editor.md`](agent-editor.md) | `features/agent-editor` | Đổi import giữa các business, so khoá ở editor section |
| [`automations.md`](automations.md) | `features/automations` | Đổi project đích của `runTask`, trigger một lần, cron |
| [`knowledge.md`](knowledge.md) | `features/knowledge` | Đổi scope / `store_key`, slug, đổi tên tag |
| [`monitor.md`](monitor.md) | `features/monitor` | Tạo task, quyền start step, `runTaskStep`, HITL, chat, git/worktree, SSE |
| [`nl-chat.md`](nl-chat.md) | `features/nl-chat` | Phiên builder, đính kèm, guard draft, chat với runner của step |
| [`orchestrator.md`](orchestrator.md) | `features/orchestrator` | Dispatch / resume / respawn, đọc quyết định, quét task treo, tuyến `mcp` / `sentinel` |
| [`pipeline-editor.md`](pipeline-editor.md) | `features/pipeline-editor` | Canvas Vue Flow, nạp/ghi pipeline, pin runner, scan pattern |
| [`quick-action.md`](quick-action.md) | `features/quick-action` | Catalog quick action, placeholder prompt |
| [`runner.md`](runner.md) | `features/runner` | Id / runner mặc định / family provider, job queue, provider CLI và API, secret MCP |
| [`settings.md`](settings.md) | `features/settings` | Merge `PUT` cấu hình, phát cấu hình mode đã merge |
| [`statistics.md`](statistics.md) | `features/statistics` | Thứ tự fetch, migrate prefs, filter |
