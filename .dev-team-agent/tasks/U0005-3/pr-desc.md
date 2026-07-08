# PR Description — U0005-3: Build agent từ NL qua runner

## Issue

Part of #59  
Part of #56 (epic U0005)

## Module / Phạm vi

`src/api/client.ts`, `src/features/monitor/` (wizard đã có từ implement trước), `tests/src/api/`, `test-e2e/`

Feature 2 (design §4.3): wizard monitor — NL → preview → lưu custom agent → smoke job qua runner.

## Summary

- Sửa `buildAndRunAgent`: `agentRef` dùng `dashboard:<name>` (khớp `agentResolver`), không còn `custom:` gây job fail.
- Đồng bộ project scope: `saveCustomAgent` và `submitJob` nhận `projectId?`, append `?project=` — save và job cùng root.
- Bổ sung E2E `agent-build-wizard.spec.ts` (describe → preview + screenshot) theo Rule test module frontend mới.
- Cập nhật unit test `client.buildAndRunAgent.test.ts` (agentRef + query project).

## Nội dung thay đổi

| Trước | Sau | Ghi chú |
|-------|-----|---------|
| `saveCustomAgent(draft)` | `saveCustomAgent(draft, projectId?)` | Query `?project=` khi có id |
| `submitJob(payload)` | `submitJob(payload, projectId?)` | Query `?project=` đồng bộ với save |
| `agentRef: custom:${name}` | `agentRef: dashboard:${name}` | Fix smoke job resolver |
| — | `test-e2e/agent-build-wizard.spec.ts` | E2E capture wizard preview |
| `client.buildAndRunAgent.test.ts` | Cập nhật assertion | TC-01, TC-02 |

## Root cause / Background

Review round 1 phát hiện smoke job luôn fail vì `custom:` không tồn tại trong `resolveAgentFilePath`; đồng thời save agent không truyền project trong khi submit job có `metadata.projectId` → lệch root multi-project.

## Test plan

<details>
<summary>Test view point & test case</summary>

- [x] **TC-01**: `buildAndRunAgent` submit `dashboard:code-reviewer` — vitest pass
- [x] **TC-02**: save + job URL chứa `?project=proj-b` khi có projectId — vitest pass
- [x] **TC-E2E-01**: Monitor → ⚡ Build agent → mô tả → preview → screenshot — Playwright pass
- [x] Regression: `useAgentBuild.test.ts` 9/9 pass
- [x] `bun run typecheck` pass
- [x] `bun run test` (269) + `bun run test:fe` (150) pass

</details>

## Loại test đã thêm/migrate

- [ ] Unit (bun test — backend)
- [x] Unit (vitest — frontend) — cập nhật `client.buildAndRunAgent.test.ts`
- [ ] Integration API
- [x] E2E (playwright) — `test-e2e/agent-build-wizard.spec.ts`

## Notes for reviewer

- `[should]` còn lại (không chặn merge): guard nút Build agent khi chưa chọn project; test composable project scope (TC-02b); poll timeout/transient.
- `null` selectedProjectId = default project (by design) — không disable nút theo semantics App.vue.
- Merge target đề xuất: `feat/U0005/dashboard-agent-integration` (theo issue #59).

## Related

- Issue: #59, epic #56
- Design: `.dev-team-agent/tasks/U0005-3/design.md`
- Review: `.dev-team-agent/tasks/U0005-3/review.md` (round 2 — PASS)

## Lệnh tạo PR (sau khi push)

```bash
git push -u origin feat/U0005-3/agent-build-wizard
gh pr create --base feat/U0005/dashboard-agent-integration --title "[U0005-3] Fix agentRef + project scope + E2E wizard" --body-file .dev-team-agent/tasks/U0005-3/pr-desc.md
```

(Lưu ý: body PR nên copy nội dung từ các section Issue → Notes ở trên, bỏ phần lệnh shell.)
