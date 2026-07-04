# Test spec — U0005-1

## Module: `server/tasks/state.ts`

- [ ] **Approve HITL** — state `hitl_pending=hitl-1`, `current_phase=investigator`, pipeline 2 step → sau approve: `hitl_pending=null`, `current_phase=designer`, có `dashboard_approved_at`
- [ ] **Reject + feedback** — giữ `current_phase`, ghi `last_feedback`, append `tasks/<id>/hitl-feedback.md`
- [ ] **Conflict mtime** — `mtime` client ≠ file mtime → `{ ok:false, status:409 }`
- [ ] **Gate mismatch** — `gate_id` ≠ `hitl_pending` → 400

## Module: `PUT /api/task-state` (golden)

- [ ] **Happy path approve** — `PUT` với `action=approve`, `gate_id` khớp → 200, state mới trong body
- [ ] **Invalid task id** — `bad/id` → 400

## Module: Frontend monitor

- [ ] **Node waiting clickable** — bubble `waiting` có cursor pointer + tooltip tiếng Việt
- [ ] **Modal approve** — click node → modal hiện → Duyệt → `patchTaskState` → poll refresh, badge `hitl_pending` mất
- [ ] **Modal reject** — Từ chối + feedback → state cập nhật, toast hiện
- [ ] **409 conflict** — hiện lỗi và trigger refresh

## E2E (khuyến nghị PR)

- [ ] Fixture task với `hitl_pending` → mở monitor → screenshot modal → approve → screenshot node chuyển trạng thái (`testInfo.attach`)

## Regression

- [ ] `bun run typecheck` PASS
- [ ] `bun test` PASS (248+)
- [ ] `bun run test:fe` PASS
