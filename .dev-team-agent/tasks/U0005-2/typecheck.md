# Verify — U0005-2 (Quick actions trên artifact viewer)

Dashboard app là TypeScript/Vue (không phải PHP), nên thay PHPStan bằng quy trình
`verify-dashboard`: typecheck + test suite. Chạy trong worktree riêng của U0005-2
(đã `bun install` để có vitest/jsdom).

## Typecheck
- Command: `bun run typecheck` (`vue-tsc --noEmit`)
- Result: **pass** (exit 0, 0 lỗi)
- Ghi chú: lần đầu báo `TS2322` ở `server/http/routes/tasks.ts` do `emitAudit`
  không nhận entity mới → đã sửa dùng entity hợp lệ sẵn có `artifact` (không mở
  rộng schema log ngoài scope). Sau đó clean.

## Tests

### Backend (`bun test` — server/mcp)
- Command: `bun run test` (= `bun test tests/server tests/mcp`)
- Result: **pass** — 260 pass / 0 fail / 565 expect, 35 files.
- Test mới (chạy riêng, 19 pass / 0 fail):
  - `tests/server/artifactActions/index.test.ts` — matchPattern (exact + glob `*`),
    matchActions, findAction, artifactBase, substitutePrompt (`{{artifact_name}}`/
    `{{artifact_base}}` + biến thể khoảng trắng), toActionView, loadArtifactActions
    (missing file → builtin default, YAML hợp lệ override + defaults, schema
    mismatch → builtin default).
  - `tests/server/http/artifactActions.route.test.ts` — GET `/api/artifact-actions`
    (match design.md, subset UI không lộ prompt_template; qa.md → []), POST
    `/api/artifact-actions/run` (201 queue job + prompt substitution + metadata;
    400 body sai; 404 action lạ; 400 action không áp dụng; 404 file thiếu; 400 path
    traversal).

### Frontend (`vitest`)
- Command: `./node_modules/.bin/vitest run`
- Result: **pass** — 133 pass / 0 fail, 26 files.
- Test mới: `tests/src/features/monitor/composables/useArtifactAction.test.ts`
  (4 pass) — submit → poll running→succeeded → onReload; job failed → hiện lỗi,
  không reload; submit lỗi → hiện lỗi; chặn chạy trùng khi đang chạy.
- Ghi chú: `npx vitest` ban đầu fail do lấy vitest global thiếu jsdom; đã dùng
  vitest local sau `bun install` → ổn.

### E2E (Playwright)
- Không chạy trong môi trường này (theo skill: tối thiểu server/mcp + fe pass là
  đủ khi không chạy được Playwright). Bỏ qua `bun run test:e2e`.

## Ghi chú thiết kế (seed action)
`.dev-team-agent/` trong repo này là workspace runtime và bị gitignore, nên
`artifact-actions.yaml` không commit được. Theo đúng tiền lệ `DEFAULT_PIPELINE`,
seed `improve-doc` được ship dưới dạng hằng số builtin `DEFAULT_ARTIFACT_ACTIONS`
(`server/artifactActions/default.ts`) làm fallback khi không có YAML; YAML per-task
sẽ override hoàn toàn. Nhờ đó toolbar có action mặc định ngay cả khi chưa cấu hình.
File `.dev-team-agent/artifact-actions.yaml` vẫn được tạo làm ví dụ/dogfood (không
tracked).

## Kết luận
- Typecheck: **pass**
- Backend: **pass** (260)
- Frontend: **pass** (133)
- Status: **CLEAN** — 0 lỗi mới.
