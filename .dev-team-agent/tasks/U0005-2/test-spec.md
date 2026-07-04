# Test Spec — U0005-2 (Quick actions trên artifact viewer)

## 1. Phạm vi test

Feature: toolbar quick-action trên `ArtifactPanel` → submit job agent → poll →
reload artifact. Files: `shared/schemas/artifactAction.ts`,
`server/artifactActions/{index,default}.ts`, `server/http/routes/tasks.ts`
(2 route), `src/api/client.ts`, `ArtifactPanel.vue`,
`useArtifactAction.ts`. Phương pháp: unit backend (`bun test`), unit frontend
(`vitest`), E2E (`Playwright`).

Đối chiếu với design §5 Test Notes (chỉ mục thuộc U0005-2; các mục
`applyHitlAction`/`writeStateAtomic`/`PipelineNode`/`phaseStatus`/task-state
golden thuộc U0005-1 → **N/A** cho slice này).

## 2. Test đã có (pass)

Backend `tests/server/artifactActions/index.test.ts` (domain):
`matchPattern` (exact/glob `*`/empty), `matchActions`, `findAction`,
`artifactBase`, `substitutePrompt` (kèm biến thể whitespace), `toActionView`,
`loadArtifactActions` (missing→default, YAML hợp lệ override + defaults, schema
mismatch→default).

Backend `tests/server/http/artifactActions.route.test.ts` (route):
GET match design.md (subset, không lộ template) + non-match `qa.md`→[];
POST 201 queue + substitution + metadata, 400 body sai schema, 404 action lạ,
400 action không áp dụng, 404 file thiếu, 400 path traversal `../../secret`.

Frontend `tests/src/features/monitor/composables/useArtifactAction.test.ts`:
submit→poll running→succeeded→onReload; failed→hiện lỗi, không reload; submit
lỗi→hiện lỗi; chặn chạy trùng khi đang chạy.

## 3. Test cases còn thiếu

### TC-01 (should): GET `/api/artifact-actions` không có `?artifact=` → trả tất cả action
- **Type**: Normal / Boundary
- **Input**: `GET /api/artifact-actions` (không query)
- **Expected**: 200, `artifact: null`, `actions` = toàn bộ (đã `toActionView`)
- **Notes**: Nhánh `artifact ? matchActions : actions` chưa có test cho vế else.

### TC-02 (should): POST body không phải JSON hợp lệ → 400 "invalid JSON body"
- **Type**: Abnormal
- **Input**: `POST /api/artifact-actions/run` body = `"{ not json"`
- **Expected**: 400, `{ error: 'invalid JSON body' }`
- **Notes**: Hiện chỉ test JSON hợp lệ nhưng sai schema; nhánh `parseBody` fail
  (khác nhánh `safeParse` fail) chưa cover.

### TC-03 (should): Composable — timeout poll → thông báo "Hết thời gian chờ job", không reload
- **Type**: Boundary / Abnormal
- **Input**: `useArtifactAction({ pollMs:1, maxWaitMs:0 })`, job luôn `running`
- **Expected**: `error.value` chứa "Hết thời gian chờ", `onReload` không gọi,
  `runningActionId` về null
- **Notes**: Liên quan finding [should] về maxWaitMs; nhánh deadline chưa test.

### TC-04 (should): ArtifactPanel component — render nút từ actions, disable khi editing/running, banner lỗi
- **Type**: Normal
- **Setup**: mount `ArtifactPanel` với `openArtifact`, stub `fetchArtifactActions`
- **Expected**: nút hiện đúng `label`; `:disabled` khi `isEditing()` hoặc
  `runningActionId`; spinner "⏳ Đang chạy…" cho action đang chạy; `art-warning`
  hiện `actionError` + nút "Ẩn" gọi `clearError`; đổi artifact → `clearError` +
  `loadActions` lại
- **Notes**: Hiện chỉ test composable; wiring component (§4.4 FE) chưa có test.

### TC-05 (nit): Composable — job `cancelled` → "Job đã bị huỷ.", không reload
- **Type**: Abnormal
- **Input**: jobStates = `[{ status:'cancelled' }]`
- **Expected**: `error.value` = "Job đã bị huỷ.", `onReload` không gọi

### TC-06 (nit): Composable — response run thiếu `job.id` → "Không nhận được job id từ server"
- **Type**: Abnormal
- **Input**: run trả `{ job: {} }`
- **Expected**: `error.value` chứa "Không nhận được job id"

### TC-07 (nit): Composable — `GET jobs` trả không có `job` → throw "Job không tồn tại"
- **Type**: Abnormal
- **Expected**: `error.value` chứa "Job không tồn tại"

### TC-08 (nit): Route khi không resolve được project (no root) → unknownProject
- **Type**: Abnormal
- **Input**: GET/POST với project id không tồn tại
- **Expected**: mã lỗi của `unknownProject` (404)

### TC-09 (nit): matchPattern với separator backslash Windows
- **Type**: Boundary
- **Input**: `matchPattern('*.md', 'sub\\design.md')`
- **Expected**: `false` (regex `[^/\\]*` chặn cả `\`); hiện chỉ test `/`.

## 4. E2E (Playwright) — CHƯA CHẠY (bắt buộc theo project rule)

Design §5 + project rule "module FE mới bắt buộc capture screenshot". Bị bỏ qua
trong verify (`typecheck.md`: Playwright không chạy được trong môi trường này).
**Cần chạy thủ công trước merge:**

### TC-E2E-01 (required): Mở artifact → click "Cải thiện" → job queued
- **Setup**: fixture task có `design.md`; runner mock hoặc CLI
- **Steps**: mở monitor → chọn artifact `design.md` → toolbar hiện nút → click →
  (confirm nếu bật) → job queued (`POST /api/artifact-actions/run` 201)
- **Expected**: nút chuyển spinner "Đang chạy…"; poll → succeeded → nội dung
  reload; nếu no CLI → mock job succeeded
- **Screenshot**: monitor + action bar → attach `playwright-report`

### TC-E2E-02 (should): Job failed → hiện banner lỗi, không reload
- **Expected**: `art-warning` hiện thông báo lỗi; nút "Ẩn" ẩn banner.

## 5. Coverage matrix (Done-when của U0005-2)

| Acceptance (design §7) | TC liên quan | Trạng thái |
|---|---|---|
| Seed `improve-doc` match investigate/design | route.test (GET/POST), index.test | [x] |
| Click → job queued | route POST 201 + TC-E2E-01 | [x] unit / [ ] e2e |
| Poll succeeded → content reload | composable test #1 + TC-E2E-01 | [x] unit / [ ] e2e |
| Fail → hiện lỗi | composable test #2, TC-02/03/05, TC-E2E-02 | [x] cơ bản / [ ] mở rộng |
| Unit pattern/prompt | index.test | [x] |
| E2E (job mock nếu no CLI) | TC-E2E-01/02 | [ ] chưa chạy |

## 6. Regression risk (test thủ công)

- `ArtifactPanel` inline-edit (`useInlineMarkdownEdit`): quick-action bị disable
  khi `isEditing()` — kiểm tra không phá luồng edit/save section hiện có.
- `reloadExternal()` dùng chung với banner "File đã thay đổi trên disk" — đảm bảo
  reload sau job không xung đột với `externalChange`.
- `server/http/routes/tasks.ts` là file nóng (nhiều route) — chạy lại full
  `bun test tests/server` để chắc không hồi quy route khác (đã pass 260).
- Golden snapshot API (`api.golden.test.ts`): route mới có thể cần cập nhật
  snapshot nếu golden liệt kê danh sách endpoint — xác nhận đã pass.
