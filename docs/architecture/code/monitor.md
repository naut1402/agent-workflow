# Monitor — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho feature `src/features/monitor/`. Chỉ ghi phần **không tự giải thích được qua tên file**: quirk, giới hạn đã biết, ràng buộc ẩn. Khi sửa, đối chiếu lại với code thật.

---

## 1. `createQa` tự validate task id

`createQa()` (`business/tasks/qa.ts`) từ chối task id chứa ký tự ngoài `[A-Za-z0-9_-]`, dù route HTTP đã có regex ở controller.

- **Vì sao validate ở business** — MCP tool gọi thẳng `createQa()`, không đi qua controller. `resolveArtifact` chỉ chặn thoát khỏi `root`, không chặn thoát khỏi `root/tasks/<id>` khi chính `id` chứa `..` hay `/` (`../evil` vẫn "nằm dưới root"). Validate tại đây để bất biến *không ghi ra ngoài phạm vi task* đúng cho mọi caller.
- **Chặt hơn `TASK_ID_PATTERN` của MCP** — pattern của MCP (`mcp/tools/TaskTools.ts`) nhận dấu `.`, regex này thì không. Id như `20260927.001` đọc được qua `list_tasks` / `read_artifact` nhưng bị `createQa` từ chối.
- **Thông điệp lỗi nêu đúng ràng buộc** — lỗi trả về ghi rõ tập ký tự được nhận. Thông điệp trống kiểu "invalid task id" làm caller tưởng mình đọc sai id rồi thử lại vô hạn.
