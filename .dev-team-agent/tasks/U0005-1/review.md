# Review — U0005-1: Duyệt HITL trên pipeline flow

## Tổng quan

Implementation đúng scope vertical slice: API ghi state an toàn + UI click node `waiting` trên monitor. Kiến trúc tuân thủ layering (`shared/` schema → `server/tasks/state.ts` domain → `http/routes` mỏng → `src/api` wrapper).

## Điểm tốt

- **Zod single source**: `TaskStatePatch` trong `shared/schemas/task.ts`, validate tại HTTP biên.
- **Optimistic concurrency**: pattern `mtime` giống `PUT /api/artifact`, trả 409 + state hiện tại.
- **Defensive reads**: `readState` không throw; gate mismatch → 400 rõ ràng.
- **Atomic write**: temp + rename trong `writeStateAtomic`.
- **Audit**: `emitAudit` entity `task-state` (đã thêm vào `AUDIT_ENTITIES`).
- **UI**: modal tiếng Việt, refresh poll sau action, tooltip "Click để duyệt".
- **Tests**: unit `state.test.ts` + golden `PUT /api/task-state` — đủ characterization.

## Findings

### [must] Không có

Không phát hiện blocker bảo mật hoặc logic sai trong phạm vi U0005-1.

### [nice] Cải thiện sau (không chặn merge)

1. **E2E Playwright**: chưa có spec capture modal HITL trên monitor — nên bổ sung ở PR hoặc follow-up.
2. **`phaseStatus` khi approve step cuối**: `current_phase = completed` — UI `phaseStatus` có thể cần case `completed` rõ hơn (hiện vẫn hoạt động qua artifact done).
3. **Reject không có pipeline.yaml gate validation**: reject chỉ check `hitl_pending === gate_id`, không verify gate thuộc current step (approve có check) — chấp nhận được vì reject không advance.
4. **Doc-review optional sau approve**: design §4.2 đề cập dialog doc-review — defer phase 1b (out of scope U0005-1).

## Kết luận

**Approve review** — sẵn sàng PR với test-spec kèm theo. E2E capture có thể land cùng PR nếu có thời gian.
