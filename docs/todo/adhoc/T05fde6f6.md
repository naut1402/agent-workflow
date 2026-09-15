# Todo — T05fde6f6

- **Issue / epic:** adhoc
- **Loại nợ:** other
- **Branch / PR tạo nợ:** `dev/1.1.6/T05fde6f6_fix-orchestrator-node`
- **Ngày tạo:** 2026-09-14

### Vì sao hoãn

Hai lỗ hổng event bên lề vòng lặp điều phối, phát hiện trong lúc khảo sát nhưng
không chặn kịch bản nào của đề bài. Sửa chúng phải đụng đường emit của `runner` và
`monitor` — gộp vào thay đổi này là mở rộng blast radius của một bản fix đã chạm
14 file.

### Việc cần làm khi đối ứng

- [ ] `orchestrator.start_requested` (`automations/business/runAction.ts`) phát ra
      rồi bị chính `handleEvent` bỏ qua vì nó nằm trong tiền tố `orchestrator.*`.
      Quyết định: đổi tên event, hoặc bỏ emit và ghi lý do vào audit log.
- [ ] `advanceStepOnJobSuccessAssumingLock` không emit `task.advanced` /
      `hitl.pending`; `hitl.resolved` ở lượt reconcile thiếu `devTeamRoot`, nên
      subscriber chạy nền không tra được data root.
- [ ] Xoá **cả thư mục** `docs/todo/` khi không còn file nợ nào
