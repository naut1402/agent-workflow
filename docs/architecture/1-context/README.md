# C4 · Cấp 1 — System Context

← [Danh mục kiến trúc (C4)](../README.md)

`dev-team-dashboard` là SPA quan sát + cấu hình runtime state của một **orchestrator agent chạy ngoài** tiến trình này. Dashboard không sở hữu vòng đời task — nó đọc/ghi vào một thư mục dữ liệu dùng chung với orchestrator, và gọi ra vài dịch vụ ngoài khi người dùng cần.

```mermaid
C4Context
  title System Context — dev-team-dashboard
  Person(user, "Dev / PM", "Theo dõi pipeline, sửa config agent/knowledge")
  System(dashboard, "dev-team-dashboard", "SPA Vue 3 + backend Hono — quan sát và cấu hình")
  System_Ext(orchestrator, "Orchestrator agent", "Tiến trình chạy ngoài repo này, sở hữu vòng đời task")
  System_Ext(claude, "Claude Code / AI provider", "Sinh nội dung NL: agent draft, chat, review")
  System_Ext(github, "GitHub", "Issue/PR liên kết task")
  System_Ext(claudeCli, "Claude Code (CLI/IDE)", "Gọi MCP server để CRUD project registry")

  Rel(user, dashboard, "Xem trạng thái, sửa pipeline/agent/knowledge", "HTTPS")
  BiRel(dashboard, orchestrator, "Đọc/ghi state + artifact", "Filesystem .dev-team-agent/")
  Rel(dashboard, claude, "Gọi API sinh nội dung", "HTTPS, tuỳ chọn ANTHROPIC_API_KEY")
  BiRel(dashboard, github, "Đọc/ghi issue", "REST API, token cấu hình")
  Rel(claudeCli, dashboard, "list/get/add/remove project", "MCP stdio")
```

## Vai trò của từng actor

| Actor | Quan hệ với dashboard | Ghi chú |
|---|---|---|
| **Dev / PM** | Người dùng chính, thao tác qua trình duyệt | Nhiều mode (monitor, editor, agentEditor, …) — chi tiết ở cấp Component |
| **Orchestrator agent** | Ghi `.dev-state/*.json` + artifact khi chạy pipeline; dashboard đọc để hiển thị | Ngoại lệ: pipeline bật `orchestrator.enabled` thì dashboard tự giữ quyền start step (`src/features/orchestrator/`) |
| **Claude Code / AI provider** | Sinh nội dung khi người dùng bấm "generate" (agent draft, NL chat) | Không có `ANTHROPIC_API_KEY` → fallback heuristic, không chặn luồng |
| **GitHub** | Liên kết issue với task, đọc/ghi qua REST API | Token cấu hình per-project trong Settings |
| **Claude Code (CLI/IDE)** | Gọi MCP server (`mcp/server.ts`) để CRUD project registry | Không cần HTTP server chạy — chi tiết ở cấp Container |

Bất biến áp dụng xuyên suốt mọi cấp — xem mục **Bất biến kiến trúc** ở cấp Container ([danh mục](../README.md)).
