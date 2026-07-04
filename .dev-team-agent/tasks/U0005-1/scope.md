# Scope — U0005-1: Duyệt HITL trên pipeline flow

**Parent:** U0005  
**Phụ thuộc:** Không.

## Outcome

Click icon node `waiting` → approve/reject → `PUT /api/task-state` → UI cập nhật.

## File chính

`server/tasks/state.ts`, `server/http/routes/tasks.ts`, `PipelineNode.vue`, `PipelineView.vue`, `src/api/client.ts`

## Done criteria

- Approve advances phase; reject ghi feedback
- 409 mtime conflict; unit + e2e
