# Verify — U0005-3 (review round 1 retry)

Feature: Build agent từ NL qua runner — sửa findings [must] từ review.md.

## Thay đổi

- `saveCustomAgent(draft, projectId?)` — truyền `?project=` khi có projectId
- `submitJob(payload, projectId?)` — truyền `?project=` đồng bộ scope với save
- `buildAndRunAgent` — `agentRef: dashboard:<name>` (thay `custom:`); save + submit cùng project
- `tests/src/api/client.buildAndRunAgent.test.ts` — assertion agentRef + project query
- `test-e2e/agent-build-wizard.spec.ts` — E2E screenshot wizard preview (TC-E2E-01)

## Typecheck
- Command: `bun run typecheck`
- Result: **pass** (exit 0)

## Tests

### Server + MCP
- Command: `bun run test`
- Result: **pass**

### Frontend (vitest)
- Command: `bun run test:fe`
- Result: **pass** (150+ tests, gồm 4 test buildAndRunAgent cập nhật)

### E2E (Playwright)
- Command: `bun run test:e2e -- test-e2e/agent-build-wizard.spec.ts`
- Result: **pass** — 1 passed (agent-build-wizard describe → preview capture)

## Kết luận
- Status: **CLEAN** — typecheck + unit + E2E wizard pass.
- must_fix đã xử lý: agentRef `dashboard:`, project scope save/job, E2E screenshot module mới.
