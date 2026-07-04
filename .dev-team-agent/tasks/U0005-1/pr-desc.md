# PR — U0005-1: Duyệt HITL trên pipeline flow

## Issue

Part of #56 — sub-issue #57 (U0005-1: click icon pipeline `waiting` để approve/reject HITL qua dashboard)

## Branch

`feat/U0005-1/hitl-task-state` → **target PR:** `feat/U0005/dashboard-agent-integration`

## PR body (copy vào GitHub)

```markdown
## Issue

Part of #56 — sub-issue U0005-1: click icon pipeline `waiting` để approve/reject HITL qua dashboard.

## Module / Phạm vi

`server/tasks`, `server/http/routes/tasks`, `src/features/monitor`, `shared/schemas`

## Nội dung thay đổi

| Trước | Sau | Ghi chú |
|-------|-----|---------|
| — | `server/tasks/state.ts` | Domain: `applyHitlAction`, `writeStateAtomic` |
| `shared/schemas/task.ts` | + `TaskStatePatch` | Zod schema approve/reject |
| `shared/schemas/log.ts` | + audit `task-state` | |
| `server/http/routes/tasks.ts` | + `PUT /api/task-state` | Optimistic lock `mtime` |
| `src/api/client.ts` | + `patchTaskState()` | |
| `PipelineNode.vue` | cursor/tooltip khi `waiting` | |
| `PipelineView.vue` | modal Duyệt/Từ chối + toast | |
| `MonitorLayout.vue`, `App.vue` | poll refresh sau HITL | |
| — | `tests/server/tasks/state.test.ts` | Unit domain |
| `api.golden.test.ts` | + PUT /api/task-state | Golden API |

## Test view point & test case

<details>
<summary>Test view point & test case</summary>

### API `PUT /api/task-state`
- [ ] Approve: `hitl_pending` khớp `gate_id` → phase advance, `hitl_pending=null`
- [ ] Reject: giữ phase, ghi `hitl-feedback.md` + `last_feedback`
- [ ] `mtime` lệch → 409 conflict
- [ ] `gate_id` sai → 400

### Monitor UI
- [ ] Click bubble `waiting` → modal tiếng Việt
- [ ] Duyệt → badge header mất, node cập nhật sau poll
- [ ] Từ chối + feedback → toast, state refresh

### Regression
- [ ] `bun run typecheck` PASS
- [ ] `bun test` PASS
- [ ] `bun run test:fe` PASS

</details>

## Loại test đã thêm/migrate

- [x] Unit (bun test — backend) — `tests/server/tasks/state.test.ts`
- [x] Integration API (Hono golden) — `PUT /api/task-state` trong `api.golden.test.ts`
- [ ] E2E (playwright) — khuyến nghị follow-up: capture modal HITL trên monitor

## Checklist

- [x] Không phá invariant defensive reads / atomic write
- [x] Path traversal: task id sanitize `[^\w\-]`
- [x] Test xanh local (`typecheck` + `bun test` + `test:fe`)
- [x] Tuân thủ AGENTS.md §3
- [ ] Git hygiene: stage chọn lọc file production (chưa commit — xem bước dưới)

## Notes for reviewer

- Reject không validate gate thuộc current step (chỉ approve validate) — chấp nhận theo design.
- Doc-review dialog sau approve — out of scope U0005-1 (U0005 epic).
- Code production **chưa commit** trên branch hiện tại; chỉ `.dev-team-agent/` đã sync remote.

## Related

- Parent: U0005 — `.dev-team-agent/tasks/U0005/design.md` §4.2
- Scope: `.dev-team-agent/tasks/U0005-1/scope.md`
- Review: `.dev-team-agent/tasks/U0005-1/review.md`
```

## Commit message đề xuất

```
feat(monitor): add PUT /api/task-state for dashboard HITL approve

Refs: U0005-1
```

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

## Bước tiếp theo (thủ công)

1. Tạo branch `feat/U0005-1/hitl-task-state` từ `origin/main` (hoặc rebase scope)
2. Stage có chọn lọc 10 file production (không add `.dev-team-agent` nếu đã push riêng)
3. Commit + push → `gh pr create` với body trên
