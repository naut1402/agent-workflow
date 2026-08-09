# Mục lục domain events (theo feature)

Tham chiếu nhanh các **domain event** phát trên event bus nội bộ (`src/core/events/`). Dùng khi đọc tab **Logs › Events**, viết subscriber, hoặc thêm emit mới.

- Kernel / nguyên tắc: [`architecture.md`](architecture.md) §3.2 · [`roadmap/1.1.0-event-driven.md`](roadmap/1.1.0-event-driven.md)
- API: `emit(type, payload)` · `emitEntity(op, entity, payload)` → `entity.{created|updated|deleted}`
- Quan sát: JSONL `~/.dev-team-dashboard/logs/events.jsonl` (prefs `logging.types.events`); UI Logs tab Events

**Quy ước:** emit **sau** persist thành công; payload tối thiểu (id / taskId / stepId …); không đưa secret. Không có type riêng `pipeline.*` / `step.*` — tiến trình step gắn qua `job.*` + `task.advanced` / `hitl.*`.

Cột **Event** trên UI = giá trị `type` trong bảng dưới.

---

## 1. Monitor — task & HITL

| Event | Khi nào | Payload gợi ý | Nơi emit |
|-------|---------|---------------|----------|
| `task.created` | Tạo task (dialog / chat NL) | `taskId`, `projectId` | `monitor/controller.ts` `createTask` |
| `task.advanced` | Đổi `current_phase` sau job success (không gate), hoặc `review_retry` | `taskId`, `stepId`, `currentPhase`, đôi khi `reason` | `monitor/business/tasks/state.ts` `advanceStepOnJobSuccess` |
| `hitl.pending` | Step có `hitl.gate_id` — mở cổng chờ duyệt | `taskId`, `gateId`, `stepId` | `state.ts` `advanceStepOnJobSuccess` |
| `hitl.resolved` | Approve / reject HITL | `taskId`, `gateId`, `action`, `currentPhase` | `state.ts` `applyHitlAction` |
| `entity.updated` (`entity: task-state`) | Repair / cập nhật state task | `id`, `projectId`, `detail` | `monitor/controller.ts` |
| `entity.deleted` (`entity: task-state`) | Xóa task | `id`, `projectId` | `monitor/controller.ts` |

**Pipeline / pipeline step (gián tiếp):**

| Quan sát | Event liên quan | Ghi chú |
|----------|-----------------|--------|
| Bắt đầu chạy step (`run-step`) | `job.queued` → `job.started` → `job.finished` \| `job.failed` | `metadata` / payload có `taskId`, `pipelineStepId` (vd `investigator`) |
| Step không gate xong | `task.advanced` | `currentPhase` = step kế hoặc `completed` |
| Step có gate xong job | `hitl.pending` | `current_phase` giữ step hiện tại |
| Duyệt / từ chối gate | `hitl.resolved` | Có thể kèm đổi phase |
| Review-retry | `task.advanced` (`reason: review_retry`) | Quay `restart_from` |

Không emit `pipeline.created` / `step.started` trên bus hiện tại.

---

## 2. Monitor — project

| Event | Khi nào | Payload gợi ý | Nơi emit |
|-------|---------|---------------|----------|
| `entity.created` (`entity: project`) | Thêm / clone project | `id`, `projectId` | `monitor/controller.ts` |
| `entity.deleted` (`entity: project`) | Xóa project khỏi registry | `id`, `projectId` | `monitor/controller.ts` |

---

## 3. Runner — job lifecycle

| Event | Khi nào | Payload gợi ý | Nơi emit |
|-------|---------|---------------|----------|
| `job.queued` | `submitJob` sau `saveJob` | `jobId`, `runnerId`, `taskId?`, `projectId?` | `runner/business/jobQueue.ts` |
| `job.started` | Worker bắt đầu chạy | `jobId`, `runnerId`, `providerId`, `taskId?`, `projectId?` | `jobQueue.ts` `runJob` |
| `job.finished` | Kết thúc thành công | `jobId`, `status`, `taskId?`, `projectId?` | `jobQueue.ts` |
| `job.failed` | Lỗi / early-fail (no runner, cred, prompt, …) | `jobId`, `error?`, `taskId?`, `projectId?` | `jobQueue.ts` |
| `job.cancelled` | `cancelJob` sau persist | `jobId`, `taskId?`, `projectId?` | `jobQueue.ts` |

---

## 4. Runner — CRUD cấu hình

| Event | Entity (`payload.entity`) | Khi nào |
|-------|---------------------------|---------|
| `entity.updated` / `entity.deleted` | `runner` | Upsert / xóa runner |
| `entity.updated` / `entity.deleted` | `connection` | Upsert / xóa connection |
| `entity.updated` / `entity.deleted` | `command` | Upsert / xóa command |
| `entity.updated` / `entity.deleted` | `credential` | Upsert / xóa credential profile |

Nơi emit: `runner/controller.ts` (sau mutation OK).

---

## 5. Type đã khai báo nhưng chưa / ít wire trên nhánh này

Khai báo trong `DashboardEventType` (`eventBus.ts`); có thể xuất hiện khi feature tương ứng đã emit:

| Event | Ghi chú |
|-------|---------|
| `webhook.received` / `webhook.triggered` | Epic webhook — không nằm emit survey nhánh logs/events hiện tại |
| `usage.recorded` | Token usage — tương tự |
| `entity.*` cho pipeline-editor / agent-editor / knowledge | Follow-up CRUD emit (xem roadmap § checklist) |

`DashboardEventType` còn `| string` — type tùy nghi vẫn emit được; ưu tiên dùng union đã có.

---

## 6. Phân biệt với audit / request log

| Kênh | `type` JSONL | Mục đích |
|------|--------------|----------|
| Domain events | `events` | Bus `emit` / `emitEntity` — automation & quan sát lifecycle |
| Audit | `audit` | Đổi cấu hình (`emitAudit`) — op/entity/identifier |
| Request | `request` | HTTP `/api/*` |
| Jobs (tab) | (không phải JSONL type) | Stdout file job runner |

Cùng một thao tác (vd tạo task) có thể vừa `task.created` (events) vừa dòng `audit` — không thay thế nhau.

---

## 7. Cách cập nhật tài liệu này

Khi thêm emit mới:

1. Thêm / cập nhật hàng trong bảng feature tương ứng (event, khi nào, payload, file).
2. Nếu type mới: cập nhật `DashboardEventType` trong `eventBus.ts` và mục §5 nếu chưa wire đủ.
3. Giữ nguyên tắc persist → emit; không log secret trong payload.
