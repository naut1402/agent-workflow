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
| `task.advanced` | Đổi `current_phase` sau job success (không gate), `review_retry`, hoặc reset step (nút reset) | `taskId`, `stepId`, `currentPhase`, đôi khi `reason` (+ `cascade`, `removedSteps` khi `reason: reset`) | `monitor/business/tasks/state.ts` `advanceStepOnJobSuccess` / `resetPipelineStepAssumingLock` |
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
| Reset step (nút reset trên `PipelineNode`) | `task.advanced` (`reason: reset`) | Lùi `current_phase` về `stepId`; kèm `cascade`, `removedSteps` |

Không emit `pipeline.created` / `step.started` / `task.reset` trên bus hiện tại — reset tái dùng `task.advanced` như review-retry, không cần type riêng.

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
| `job.awaiting_recovery` | Fail do `usage_limit`/`network` (`classifyJobFailure`) — non-terminal, chờ tự resume | `jobId`, `kind`, `resumeAfter`, `taskId?`, `projectId?` | `jobQueue.ts` `runJob` |
| `job.retry_scheduled` | Fail do `process_crash`, còn attempt — tự retry sau backoff | `jobId`, `attemptCount`, `resumeAfter`, `taskId?`, `projectId?` | `jobQueue.ts` `runJob` |
| `job.recovered` | Poller (`recoverPoller.ts`) resume job từ `awaiting_recovery`/backoff về `queued` | `jobId`, `kind`, `taskId?`, `projectId?` | `recoverPoller.ts` `resumeRecoveredJob` |

---

## 4. Runner — CRUD cấu hình

| Event | Entity (`payload.entity`) | Khi nào |
|-------|---------------------------|---------|
| `entity.updated` / `entity.deleted` | `runner` | Upsert / xóa runner |
| `entity.updated` / `entity.deleted` | `connection` | Upsert / xóa connection (chọn provider config + credential riêng, tự chứa providerId/credentialId) |
| `entity.updated` / `entity.deleted` | `provider-config` | Upsert / xóa provider config (interface + baseURL, không còn bao gồm credential) |
| `entity.updated` / `entity.deleted` | `command` | Upsert / xóa command |
| `entity.updated` / `entity.deleted` | `credential` | Upsert / xóa credential profile |

Nơi emit: `runner/controller.ts` (sau mutation OK).

---

## 5. Automations — rule lifecycle & run (#233)

| Event | Khi nào | Payload gợi ý | Nơi emit |
|-------|---------|---------------|----------|
| `automation.triggered` | Rule khớp trigger (tick scheduler / event / Run now) — trước khi action chạy | `automationId`, `projectId`, `runId`, `triggerKind`, `source` (`manual`/`schedule`/`event`) | `automations/business/runAction.ts` |
| `automation.run_succeeded` | Action `runTask` xong (job đã submit) | `automationId`, `projectId`, `runId`, `taskId?`, `jobId?` | `runAction.ts` |
| `automation.run_failed` | Action lỗi hoặc bị skip (task đang bận) | `automationId`, `projectId`, `runId`, `outcome` (`failed`/`skipped`), `error?`, `taskId?` | `runAction.ts` |
| `entity.created|updated|deleted` (`entity: automation`) | CRUD rule | `id`, `projectId` (+`detail.enabled` khi toggle) | `automations/controller.ts` |

Ghi chú:

- Rule có **nhiều trigger** (OR): timer (once/interval/cron cùng mốc `startAt`) do scheduler tick đánh giá; trigger `kind: event` subscribe wildcard trên bus — **bỏ qua** `automation.*` (chống vòng lặp rule → run → event → rule); chỉ khớp khi `payload.projectId` bằng project của rule.
- Run là **chuỗi action tuần tự chạy nền** (chờ từng job xong, capture stdout/artifacts làm biến `{{steps.N.*}}` cho bước sau — `lib/vars.ts`); event `run_succeeded`/`run_failed` phát khi cả chuỗi kết thúc.
- Runtime state + run history: `registryHome()/automations/<projectKey>/` (`state.json` + `runs/`); config rule ở data root `automations/<id>.yaml`.
- Trigger registry (`registerTrigger`/`listTriggers`) được đồng bộ từ rule đang bật qua `syncTriggerRegistry` — runtime thật là scheduler tick + event subscriber của feature.

---

## 6. Type đã khai báo nhưng chưa / ít wire trên nhánh này

Khai báo trong `DashboardEventType` (`eventBus.ts`); có thể xuất hiện khi feature tương ứng đã emit:

| Event | Ghi chú |
|-------|---------|
| `webhook.received` / `webhook.triggered` | Epic webhook — không nằm emit survey nhánh logs/events hiện tại |
| `usage.recorded` | Token usage — tương tự |
| `entity.*` cho pipeline-editor / agent-editor / knowledge | Follow-up CRUD emit (xem roadmap § checklist) |

`DashboardEventType` còn `| string` — type tùy nghi vẫn emit được; ưu tiên dùng union đã có.

---

## 7. Phân biệt với audit / request log

| Kênh | `type` JSONL | Mục đích |
|------|--------------|----------|
| Domain events | `events` | Bus `emit` / `emitEntity` — automation & quan sát lifecycle |
| Audit | `audit` | Đổi cấu hình (`emitAudit`) — op/entity/identifier |
| Request | `request` | HTTP `/api/*` |
| Jobs (tab) | (không phải JSONL type) | Stdout file job runner |

Cùng một thao tác (vd tạo task) có thể vừa `task.created` (events) vừa dòng `audit` — không thay thế nhau.

---

## 8. Cách cập nhật tài liệu này

Khi thêm / sửa / xoá emit:

1. Thêm / cập nhật / gỡ hàng trong bảng feature tương ứng (event, khi nào, payload, file).
2. Nếu type mới hoặc đổi tên: `DashboardEventType` (`src/core/events/eventBus.ts`) + §5 nếu cần.
3. Giữ nguyên tắc persist → emit; không log secret trong payload.
