Closes #58
Part of #56

## Summary

- Thêm **quick-actions khai báo** cho artifact viewer: mở artifact → toolbar hiện nút (vd. "Cải thiện tài liệu") → submit job agent (tái dùng job queue) → poll job → tự reload artifact khi `succeeded`, hiện banner lỗi khi `failed`.
- Vertical slice thuần: schema Zod (single source of truth) + domain module không biết HTTP (`server/artifactActions/`) + 2 route + wiring UI (`ArtifactPanel` + composable poll).
- Seed builtin `improve-doc` (`DEFAULT_ARTIFACT_ACTIONS`) theo tiền lệ `DEFAULT_PIPELINE` → toolbar có action mặc định ngay cả khi chưa cấu hình YAML; YAML per-task override hoàn toàn.

## Background

Epic U0005 bổ sung tương tác trên monitor dashboard. Slice U0005-2 tập trung riêng phần **artifact viewer**: cho phép user kích hoạt một action agent trực tiếp từ tài liệu đang mở, thay vì phải chạy pipeline thủ công. Không lấn slice U0005-1 (task-state) — không đụng `server/tasks/state.ts`, `shared/schemas/task.ts`, `PipelineNode.vue`, `PipelineView.vue`.

## Changes

| File | Trạng thái | Thay đổi |
|---|---|---|
| `shared/schemas/artifactAction.ts` | mới | Zod schema `ArtifactAction`, `ArtifactActionsFile`, `RunArtifactActionRequest` — single source of truth, `safeParse` ở biên. |
| `server/artifactActions/index.ts` | mới | Domain thuần: `matchPattern` (glob `*`/exact), `matchActions`, `findAction`, `artifactBase`, `substitutePrompt` (`{{artifact_name}}`/`{{artifact_base}}`), `loadArtifactActions` (YAML safe → fallback default), `toActionView` (không lộ `prompt_template`/`artifact_patterns`). |
| `server/artifactActions/default.ts` | mới | Builtin seed `DEFAULT_ARTIFACT_ACTIONS` (`improve-doc`) làm fallback khi không có YAML. |
| `server/http/routes/tasks.ts` | sửa | `GET /api/artifact-actions` (list/match theo `?artifact=`) + `POST /api/artifact-actions/run` (build prompt từ template + đọc artifact → `submitJob`). Guard `taskId` + path-traversal, `safeParse` body. |
| `src/api/client.ts` | sửa | Wrappers `fetchArtifactActions()`, `runArtifactAction()`. |
| `src/features/monitor/components/ArtifactPanel.vue` | sửa | Toolbar nút action, disable khi editing/running, spinner "⏳ Đang chạy…", banner lỗi `art-warning` + nút "Ẩn"; đổi artifact → reload actions + clear error. |
| `src/features/monitor/composables/useArtifactAction.ts` | mới | `run()` submit → `pollJob` → `onReload` khi succeeded; xử lý failed/cancelled/timeout; chặn chạy trùng. |
| `tests/server/artifactActions/index.test.ts` | mới | Unit domain (pattern/match/prompt/loader). |
| `tests/server/http/artifactActions.route.test.ts` | mới | Route GET/POST + guards (400 body sai, 404 action lạ, 400 path traversal…). |
| `tests/src/features/monitor/composables/useArtifactAction.test.ts` | mới | Unit composable (poll succeeded/failed, lỗi submit, chặn chạy trùng). |

## Test plan

- [x] Typecheck (`bun run typecheck` / `vue-tsc --noEmit`): **pass** (0 lỗi).
- [x] Backend (`bun test tests/server tests/mcp`): **260/260 pass** (0 fail, 35 files); test mới 19 pass.
- [x] Frontend (`vitest run`): **133/133 pass** (0 fail, 26 files); test mới 4 pass.
- [ ] **E2E Playwright — CHƯA CHẠY** (không chạy được trong môi trường verify). **Bắt buộc chạy thủ công + capture screenshot trước khi merge** (project rule: module FE mới bắt buộc screenshot):
  - [ ] TC-E2E-01: mở artifact `design.md` → click "Cải thiện" → job queued (POST 201) → spinner → succeeded → content reload.
  - [ ] TC-E2E-02: job failed → banner `art-warning` hiện lỗi, nút "Ẩn" ẩn banner, không reload.
  - [ ] Attach `playwright-report` / screenshot monitor + action bar.
- [ ] Regression thủ công: inline-edit (`useInlineMarkdownEdit`) không bị phá khi action disable lúc `isEditing()`; `reloadExternal()` không xung đột banner "File đã thay đổi trên disk".

## Notes for reviewer

Review kết luận **APPROVE** — 0 [must], 2 [should], 4 [nit]. Không blocking. Hai [should] để lại **follow-up** (không xử lý trong slice này):

1. **`useArtifactAction.ts:34` — `maxWaitMs` mặc định 5 phút có thể báo "thất bại" nhầm cho job vẫn đang chạy.** Job agent (vd. doc-reviewer full) có thể vượt 5 phút; khi đó `pollJob` trả `failed`/timeout trong khi job vẫn chạy server-side, artifact không auto-reload và user thấy thông báo sai lệch. Đề xuất: nâng default (15–20′) hoặc phân biệt trạng thái "vẫn đang chạy" (không phải failed) + cho reload thủ công / giữ `lastJobId`.
2. **`ArtifactPanel.vue:60` — composable dùng chung 1 instance qua các lần đổi artifact.** Nếu đổi artifact khi job đang chạy: (a) `runningActionId` (cờ dùng chung) disable nhầm nút của artifact mới; (b) `onReload` tải lại artifact đang mở chứ không phải artifact job đã sửa; (c) `watch` clear error nhưng không huỷ vòng poll. Đề xuất: capture `taskId/name` tại thời điểm `run()`, chỉ `onReload` nếu artifact đó còn mở; hoặc tài liệu hoá giới hạn "một action tại một thời điểm cho artifact đang mở".

[nit] (tuỳ chọn): `artifactBytes` đếm ký tự UTF-16 thay vì byte; client `fetchArtifactActions`/`runArtifactAction` trả `any` (chưa `safeParse` ở biên FE, theo tiền lệ); guard `taskId` regex trùng `resolveArtifact`; `matchPattern` nhiều `*` liền nhau (ReDoS rủi ro rất thấp).

**Security:** path traversal chặn 2 lớp (`taskId` regex + `resolveArtifact` escape check, có test `../../secret`); body POST `safeParse`; `toActionView` không rò rỉ `prompt_template`; label render qua Vue text-interpolation (escaped). Không phát hiện lỗ hổng.

## Related

- Sub-issue: #58 (U0005-2)
- Epic: #56 (U0005)
- Artifacts: `.dev-team-agent/tasks/U0005-2/{review.md,test-spec.md,typecheck.md}`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
