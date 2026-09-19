# Mục lục domain events — theo mode

← [`../README.md`](../README.md) (Cấp 4 · Code)

Tham chiếu nhanh các **domain event** phát trên event bus nội bộ (`src/backend/events/`). Dùng khi đọc tab **Logs › Events**, viết subscriber, hoặc thêm emit mới. Kernel / nguyên tắc emit — xem cấp Component.

- API: `emit(type, payload)` · `emitEntity(op, entity, payload)` → `entity.{created|updated|deleted}`
- Quan sát: JSONL `~/.dev-team-dashboard/logs/events.jsonl` (prefs `logging.types.events`); UI Logs tab Events
- **Quy ước:** emit **sau** persist thành công; payload tối thiểu (id / taskId / stepId …); không đưa secret. Không có type riêng `pipeline.*` / `step.*` — tiến trình step gắn qua `job.*` + `task.advanced` / `hitl.*`. Riêng nhóm `orchestrator.*` là quyết định **điều phối**, không phải tiến trình step.
- Cột **Event** trên UI = giá trị `type` trong các bảng dưới.

## Theo mode

Mỗi file có bảng event + state chart (vòng đời) + flow chart (trigger → emit):

| Mode | File | Phạm vi |
|---|---|---|
| Monitor | [`monitor.md`](monitor.md) | Task, HITL gate, project |
| Runner | [`runner.md`](runner.md) | Job lifecycle, CRUD runner/connection/provider/command/credential |
| Automations | [`automations.md`](automations.md) | Rule trigger, chuỗi action, run history |
| Orchestrator | [`orchestrator.md`](orchestrator.md) | Vòng lặp quyết định điều phối (opt-in) |

---

## Type đã khai báo nhưng chưa / ít wire trên nhánh này

Khai báo trong `DashboardEventType` (`eventBus.ts`); có thể xuất hiện khi feature tương ứng đã emit:

| Event | Ghi chú |
|-------|---------|
| `webhook.received` / `webhook.triggered` | Epic webhook — không nằm emit survey nhánh logs/events hiện tại |
| `usage.recorded` | Token usage — tương tự |
| `entity.*` cho pipeline-editor / agent-editor | Follow-up CRUD emit — chưa wire (#256). `knowledge` đã wire, xem `automations.md` |

`DashboardEventType` còn `| string` — type tùy nghi vẫn emit được; ưu tiên dùng union đã có.

---

## Phân biệt với audit / request log

| Kênh | `type` JSONL | Mục đích |
|------|--------------|----------|
| Domain events | `events` | Bus `emit` / `emitEntity` — automation & quan sát lifecycle |
| Audit | `audit` | Đổi cấu hình (`emitAudit`) — op/entity/identifier |
| Request | `request` | HTTP `/api/*` |
| Jobs (tab) | (không phải JSONL type) | Stdout file job runner |

Cùng một thao tác (vd tạo task) có thể vừa `task.created` (events) vừa dòng `audit` — không thay thế nhau.

**Chỉ có audit, không có domain event** — thao tác không phải lifecycle của entity có màn hình quản lý:

| Audit `entity` | `op` | Khi nào | `detail` | File |
|---|---|---|---|---|
| `nl-chat-session` | `create` / `update` | Mở / gửi tiếp / huỷ phiên chat tạo mới | `entityType`, `jobId`, `action` | `features/nl-chat/controller.ts` |
| `nl-chat-attachment` | `create` | Upload tập tin đính kèm từ khung chat | `count`, `bytes` (không kèm nội dung file) | `features/nl-chat/controller.ts` |

---

## Cách cập nhật tài liệu này

Khi thêm / sửa / xoá emit:

1. Thêm / cập nhật / gỡ hàng trong bảng ở file mode tương ứng (event, khi nào, payload, file). Đổi luôn state/flow chart nếu vòng đời thay đổi.
2. Nếu type mới hoặc đổi tên: `DashboardEventType` (`src/backend/events/eventBus.ts`) + mục "Type chưa wire" ở trên nếu cần.
3. Giữ nguyên tắc persist → emit; không log secret trong payload.
