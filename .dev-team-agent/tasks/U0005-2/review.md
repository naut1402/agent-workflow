# Review — U0005-2 (Quick actions trên artifact viewer)

Reviewed commit: bd59928 (diff `2e6a753..bd59928`, 10 files, +723/-3)
Worktree: `.claude/worktrees/agent-a8fd44865051e150b`
Verify: typecheck pass; backend 260 pass; frontend 133 pass; E2E Playwright bỏ qua (xem test-spec §E2E).

## Đánh giá tổng quan

Vertical slice đúng scope U0005-2: schema Zod mới, domain module thuần
(`server/artifactActions/`), 2 route (`GET`/`POST /api/artifact-actions*`),
toolbar `ArtifactPanel` + composable poll job. **Không lấn U0005-1** (không đụng
`server/tasks/state.ts`, `shared/schemas/task.ts`, `PipelineNode.vue`,
`PipelineView.vue`). Convention tốt: ESM+TS, không enum, không default export
(trừ SFC do framework), Zod `safeParse` ở biên POST, domain không biết HTTP
(nhận `root` injected), UI strings tiếng Việt, fallback builtin theo tiền lệ
`DEFAULT_PIPELINE`.

**Security:** path traversal được chặn 2 lớp (`taskId` regex `/[^\w\-]/` + 400,
`resolveArtifact` chặn escape task dir → 400); có test `../../secret`. Body POST
validate bằng `RunArtifactActionRequest.safeParse`. `toActionView` không rò rỉ
`prompt_template`/`artifact_patterns` ra UI (có test). Không có SQL; label render
qua text-interpolation Vue nên escaped (không XSS). Không phát hiện lỗ hổng.

Không có finding **[must]** → **không blocking retry**.

## Findings

### [should]

[should] src/features/monitor/composables/useArtifactAction.ts:34 —
`maxWaitMs` mặc định 5 phút có thể báo "thất bại" nhầm cho job vẫn đang chạy.
  Vấn đề: `pollJob` khi quá `maxWaitMs` trả về `{ status: 'failed', error: 'Hết
  thời gian chờ job' }` và `run()` hiện lỗi + reset `runningActionId`. Nhưng job
  agent (doc-reviewer chạy full) hoàn toàn có thể vượt 5 phút; khi đó job vẫn
  chạy server-side, sau đó `succeeded` nhưng artifact **không auto-reload** và
  user thấy thông báo thất bại sai lệch.
  Đề xuất: nâng default (vd. 15–20 phút) hoặc phân biệt trạng thái "vẫn đang
  chạy" (không phải failed) + cho phép reload thủ công / để lại `lastJobId` cho
  user tra cứu log.

[should] src/features/monitor/components/ArtifactPanel.vue:60 —
Composable dùng chung 1 instance qua các lần đổi artifact → reload/stuck sai
ngữ cảnh khi đổi artifact lúc job đang chạy.
  Vấn đề: mở `design.md` → chạy action → chuyển sang `review.md` trước khi job
  settle: (a) `runningActionId` vẫn set (cờ dùng chung) nên nút của artifact mới
  cũng bị disable; (b) khi `succeeded`, `onReload → reloadExternal()` tải lại
  artifact **đang mở** (review.md) chứ không phải artifact job đã sửa
  (design.md); (c) `watch` gọi `clearError()` khi đổi artifact nhưng không huỷ
  vòng poll đang chạy.
  Đề xuất: capture `taskId/name` tại thời điểm `run()` và chỉ `onReload` nếu
  artifact đó còn mở; hoặc tài liệu hoá giới hạn "một action tại một thời điểm
  cho artifact đang mở".

### [nit]

[nit] server/http/routes/tasks.ts:~232 — `artifactBytes: content.length` đếm
số ký tự UTF-16, không phải byte; với nội dung tiếng Việt/emoji sẽ lệch số byte.
  Đề xuất: `Buffer.byteLength(content, 'utf8')` hoặc đổi tên `artifactChars`.

[nit] src/api/client.ts:152,158 — `fetchArtifactActions`/`runArtifactAction`
trả `any` (không `safeParse` ở biên I/O frontend).
  Bối cảnh: rule "Zod safeParse ở mọi biên I/O". Component đã phòng thủ bằng
  `Array.isArray(res.actions)`, và các helper client hiện có cũng chưa validate
  (theo tiền lệ) → hạ mức xuống [nit].
  Đề xuất (khi có schema client chung): parse response bằng schema shared.

[nit] server/http/routes/tasks.ts — `if (/[^\w\-]/.test(taskId))` trùng lặp với
guard sẵn có trong `resolveArtifact` (path.resolve escape check); `\-` trong
char class là escape thừa. Vô hại, có thể gộp để giảm nhiễu.

[nit] server/artifactActions/index.ts:22 (`matchPattern`) — pattern nhiều `*`
liền nhau sinh regex `[^/\\]*[^/\\]*` (backtracking bậc cao). Rủi ro ReDoS rất
thấp (config tin cậy, tên file ngắn) — chỉ nêu để lưu ý nếu sau này pattern đến
từ input không tin cậy.

## Summary
- [must]: 0
- [should]: 2
- [nit]: 4

Recommendation: **APPROVE** (không blocking retry). Xử lý [should] trước khi
merge nếu job agent thực tế chạy dài; [nit] tuỳ chọn. Lưu ý test-spec: E2E
Playwright + screenshot (bắt buộc theo project rule cho module FE mới) chưa chạy
được trong môi trường verify — cần chạy thủ công trước merge.
