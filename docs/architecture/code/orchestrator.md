# Orchestrator — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho feature `src/features/orchestrator/`. Chỉ ghi phần **không tự giải thích được qua tên file**: quirk, giới hạn đã biết, ràng buộc ẩn. Khi sửa, đối chiếu lại với code thật.

---

## 1. `business/mcpRoute.ts` — chọn tuyến ra lệnh điều phối

`resolveDecisionRoute()` là nơi **duy nhất** trả lời «lượt điều phối này ra lệnh bằng tool `orchestrator_decide` (`mcp`) hay bằng dòng JSON cuối output (`sentinel`)».

- **Chốt một lần, đọc lại cùng một giá trị** — `askAgent` (`business/decisionLoop.ts`) gọi nó ngay trước `submitJob` rồi đóng dấu vào `metadata.orchestratorMcpRoute`; prompt và runner (`SelfMcpServer.forJob`) cùng đọc lại giá trị đó. Tính lại ở hai nơi là mở cửa sổ «prompt dạy gọi tool nhưng job không có tool».
- **Không ném** — mọi lỗi (vd đọc file registry hỏng) chỉ làm lượt đó rơi về `sentinel`, không làm chết lượt điều phối.
- **Điều kiện tuyến `mcp`**, theo thứ tự:
  1. `SelfMcpServer.selfBaseUrl()` có giá trị sau khi trim — thiếu thì `SelfMcpServer.childEnv` không bơm token xuống tiến trình con, tool chắc chắn 401.
  2. Có runner mặc định — job điều phối không pin runner (`askAgent` không truyền `runnerId`) nên chạy trên đúng `getDefaultRunner()`. Pin runner thì phải đổi cả hàm này.
  3. Connection của runner đó tồn tại.
  4. Provider có `mcpDelivery.acceptsSelfServer` — chỉ cách giao nhận được entry tự gắn mới mang được tool; hiện là `ConfigFlagMcpDelivery` (file `--mcp-config` riêng theo job của `claude-code-cli`).
  5. `SelfMcpServer.canAttach()` — định vị được `mcp/stdio.ts` ([`mcp.md`](mcp.md) §8).
- **`route` chỉ nói job sẽ có tool** — CLI có kết nối được MCP hay không thì dashboard không biết, nên prompt tuyến `mcp` (`renderMcpProtocol`, `business/decision.ts`) vẫn giữ hướng dẫn dòng sentinel làm lối thoát khi tool vắng hoặc trả lỗi.
