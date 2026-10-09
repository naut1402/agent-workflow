# Shared — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho `src/shared/`. Chỉ ghi phần không tự giải thích được qua tên file. Khi sửa, đối chiếu lại với code thật.

---

## 1. Gate HITL đang chặn — `resolveHitlPending()`

- **Xét con trỏ trước** — `current_phase` rỗng hoặc `completed` ⇒ không gate nào chặn. Kiểm tra này phải đứng trước nhánh "pipeline không đọc được"; đảo thứ tự thì `repairTaskState` (đường gỡ tay) giữ lại gate cũ trên task đã xong.
- **Pipeline không đọc được ⇒ giữ gate** — `steps` rỗng hoặc `null` (config `untrusted` qua `gateStepsFromConfig()`) thì trả lại gate id đang chờ: thiếu bằng chứng thì không coi gate là đã bỏ. Riêng giá trị legacy `true` thành `null`, vì UI không vẽ được nút duyệt cho nó.
