# Review — U0005-3: Build agent từ NL qua runner (round 2)

Reviewed diff: working tree trên branch `feat/U0005-3/agent-build-wizard` (chưa commit; base implement `d872b99`)

## Phạm vi review

Retry sau 3 finding `[must]` từ review round 1. Files thay đổi trong diff:

- `src/api/client.ts` — `saveCustomAgent(draft, projectId?)`, `submitJob(payload, projectId?)`, `buildAndRunAgent` dùng `dashboard:<name>` + cùng project scope
- `tests/src/api/client.buildAndRunAgent.test.ts` — assertion agentRef + query `?project=`
- `test-e2e/agent-build-wizard.spec.ts` (mới) — E2E screenshot bước preview

## Xác minh must_fix (round 1)

| # | Finding | Trạng thái |
|---|---|---|
| 1 | `agentRef: custom:` → `dashboard:` | ✅ Đã sửa — `buildAndRunAgent` submit `dashboard:${name}`; test assert đúng |
| 2 | Project scope mismatch save vs job | ✅ Đã sửa — cả `saveCustomAgent` và `submitJob` nhận `projectId?`, append `?project=`; `buildAndRunAgent` truyền `input.projectId` xuống cả hai |
| 3 | Thiếu E2E screenshot module mới | ✅ Đã thêm `test-e2e/agent-build-wizard.spec.ts` — mock generate, capture preview qua `_capture` |

## Kết quả verify (reviewer chạy lại)

| Lệnh | Kết quả |
|---|---|
| `bun run typecheck` | pass (exit 0) |
| `bun run test:fe -- tests/src/api/client.buildAndRunAgent.test.ts` | 4/4 pass |
| `bun run test:fe -- tests/src/features/monitor/composables/useAgentBuild.test.ts` | 9/9 pass |
| `bun run test:e2e -- test-e2e/agent-build-wizard.spec.ts` | 1/1 pass |

## Findings

### [should] src/features/monitor/components/MonitorLayout.vue:48 — Nút "Build agent" không guard khi chưa chọn project

Context: Nút luôn hiện và mở wizard kể cả `selectedProjectId === null`. Khi không chọn project, save/submit chạy trên default root (DEV_TEAM_ROOT) — hành vi âm thầm, dễ gây nhầm lẫn multi-project. Fix project scope đã đúng khi có `projectId`, nhưng UX chưa cảnh báo.

Suggestion: disable nút hoặc hiện toast "Chọn project trước" khi `!selectedProjectId`; hoặc wizard hiển thị rõ project đích.

### [should] tests/src/features/monitor/composables/useAgentBuild.test.ts — Chưa assert project scope qua composable

Context: `useAgentBuild.buildAndRun()` truyền `projectId: opts.getProjectId() ?? undefined` xuống `buildAndRunAgent`, nhưng stub test không kiểm tra URL save/job có `?project=`. Regression project-scope có thể lọt nếu chỉ sửa client mà composable wiring sai.

Suggestion: thêm test `getProjectId: () => 'proj-x'` → assert fetch URL chứa `project=proj-x` cho cả save và submit (TC-02b trong test-spec).

### [should] src/features/monitor/composables/useAgentBuild.ts:137-159 — Poll timeout / transient error chưa có test trực tiếp

Context: Nhánh `deadline` và `consecutiveErrors > maxPollErrors` trong `pollJob` chưa được cover (useAgentBuild coverage ~88% lines, thiếu 148-152, 196). Không chặn merge nhưng là gap test theo design §5.

Suggestion: bổ sung TC-03/04/05 (xem test-spec.md).

### [should] Rule coding — Zod chưa validate response API client

Context: `buildAndRunAgent`/`generateAgentDraft` vẫn `r.json()` không qua schema. Đồng nhất pattern sẵn có của `client.ts`; ghi nhận cải thiện dần, không chặn PR.

### [nice_to_have] src/features/monitor/composables/useAgentBuild.ts — generate() khi response thiếu `draft`

Context: `draft.value = { ...(data?.draft ?? {}) }` vẫn chuyển sang preview với form trống nếu server không trả draft. UX mơ hồ; `buildAndRun` có guard tên nên không crash.

Suggestion: nếu `!data?.draft` thì set error và giữ bước `describe`.

### [nice_to_have] test-e2e/agent-build-wizard.spec.ts — Chỉ cover describe → preview

Context: E2E đáp ứng Rule test (screenshot module mới) nhưng chưa cover bước "Lưu & chạy thử" / job status. Chấp nhận được vì mock runner phức tạp hơn; unit test đã cover compose + poll.

Suggestion: follow-up spec mock `/api/jobs` + `/api/runners` cho bước run (optional).

### [nice_to_have] src/api/client.ts — `BuildAndRunAgentResult.job` vẫn index signature rộng

Context: Đã thay `job: any` bằng interface có index signature — cải thiện so round 1. Có thể siết thêm bằng type job từ shared schema khi có.

## Summary

- [must]: 0 findings (3 must_fix round 1 đã resolved)
- [should]: 4 findings
- [nice_to_have]: 3 findings

Recommendation: **APPROVE** (PASS)

Ghi chú triển khai: diff fix chưa commit — implementer nên stage + commit trước khi merge PR (`src/api/client.ts`, tests, `test-e2e/agent-build-wizard.spec.ts`).
