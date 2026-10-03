# MCP — tài liệu chủ đề
← [`../README.md`](../README.md) (Danh mục tài liệu)

Repo này dính tới MCP theo **hai vai ngược chiều nhau**. Phân biệt trước, rồi mới đọc tiếp.

---

## Hai vai, đừng nhầm

| Vai | Nghĩa | Nơi cấu hình | Đọc |
|---|---|---|---|
| **Server (inbound)** | Dashboard **làm** MCP server; Claude Code gọi vào qua stdio | Chạy `bun run mcp`, khai ở `mcpServers` của client (§Quickstart) | [`server.md`](server.md) |
| **Client (outbound)** | Dashboard **gọi** MCP server khác (playwright, serena…) | Tab **MCP** của Runner Config | [`client.md`](client.md) |

Tách ngay đầu trang vì đây là chỗ người đọc hay đi nhầm nhánh: comment header `mcp/server.ts` phải dành riêng một đoạn để đính chính. Hai vai không dùng chung một dòng code nào — `mcp/` là vai server, `src/features/mcp/` là vai client.

---

## Chọn đường đọc

| Tôi muốn… | Đọc |
|---|---|
| Cho Claude Code đọc task / artifact / knowledge của dashboard | [`server.md`](server.md) §2 — Chạy và khai báo ở client |
| Gọi một tool cụ thể, cần biết field và ràng buộc | [`server.md`](server.md) §4 — Tham chiếu từng tool |
| Hiểu vì sao client không thấy mã lỗi ở `structuredContent` | [`server.md`](server.md) §5 — Hợp đồng kết quả (envelope) |
| Khai một MCP server ngoài cho job của runner | [`client.md`](client.md) |

---

## Quickstart — vai server

1. Chạy server (stdio, 🚫 không cần HTTP server của dashboard chạy):

   ```bash
   bun run mcp
   ```

2. Khai vào `mcpServers` của client:

   ```json
   {
     "mcpServers": {
       "dev-team-dashboard": {
         "command": "bun",
         "args": ["run", "mcp"],
         "cwd": "/duong/dan/toi/agent-workflow",
         "env": { "DEVTEAM_MCP_MODE": "full" }
       }
     }
   }
   ```

3. Mặc định là mode `readonly` — **tool ghi chỉ xuất hiện khi đặt `DEVTEAM_MCP_MODE=full`**. Chạy pipeline agent mà quên bật thì `create_qa` không tồn tại; chi tiết triệu chứng ở [`server.md`](server.md) §2.3.

---

## Mode vận hành

| Mode | Tool được đăng ký |
|---|---|
| `readonly` (mặc định) | 8 tool đọc — `list_projects` · `get_project` · `get_knowledge_bundle` · `list_tasks` · `get_task_state` · `get_task_context` · `list_artifacts` · `read_artifact` |
| `full` | 8 tool trên + 3 tool ghi — `add_project` · `create_qa` · `remove_project` |

Mode **lọc ở khâu đăng ký**, không phải lúc gọi: tool ngoài quyền **biến khỏi `tools/list`** chứ không hiện ra rồi bị từ chối. Thứ tự ưu tiên và cách xử lý giá trị sai ở [`server.md`](server.md) §3.

---

## Danh mục file

| File | Nội dung |
|---|---|
| [`server.md`](server.md) | Vai inbound: bảng 11 tool, cách chạy và khai `mcpServers`, mode vận hành, tham chiếu field / output / mã lỗi / annotations từng tool, hợp đồng envelope, ví dụ, giới hạn |
| [`client.md`](client.md) | Vai outbound: store `mcp-servers.json`, 3 transport, chốt endpoint, masking secret, 4 route API, cách runner tiêu thụ |
