# Typecheck & Tests — U0005-1

**Task:** U0005-1 — Duyệt HITL trên pipeline flow  
**Date:** 2026-07-04

## Commands

```bash
bun run typecheck   # PASS
bun test            # PASS (248 tests, +golden PUT /api/task-state)
bun run test:fe     # PASS (vitest)
```

## Results

| Gate | Result | Ghi chú |
|------|--------|---------|
| `vue-tsc --noEmit` | ✅ PASS | PipelineView modal + patchTaskState |
| `bun test` | ✅ PASS | `state.test.ts` + `api.golden.test.ts` |
| `vitest run` | ✅ PASS | Không regression frontend |

## Phạm vi thay đổi

### Backend
- `shared/schemas/task.ts` — `TaskStatePatch` schema
- `shared/schemas/log.ts` — audit entity `task-state`
- `server/tasks/state.ts` — `applyHitlAction`, `writeStateAtomic`
- `server/http/routes/tasks.ts` — `PUT /api/task-state`

### Frontend
- `src/api/client.ts` — `patchTaskState()`
- `PipelineNode.vue` — cursor/tooltip khi `waiting`
- `PipelineView.vue` — modal duyệt/từ chối + toast
- `MonitorLayout.vue` / `App.vue` — refresh poll sau HITL

### Tests
- `tests/server/tasks/state.test.ts`
- `tests/server/http/api.golden.test.ts` — PUT /api/task-state

## Done criteria (scope.md)

- [x] Approve advances phase (`current_phase` → step kế)
- [x] Reject ghi feedback (`hitl-feedback.md` + `last_feedback`)
- [x] 409 mtime conflict
- [x] Unit + golden API tests
- [ ] E2E capture monitor (reviewer phase)
