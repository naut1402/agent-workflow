Reviewed commit: 31a17c52e9d57e967caa2ced91dee9af18b9f156

# Review — U0004: Pipeline Editor — profile scope & round-trip schema

## Phạm vi đã review

- Commit `31a17c5` trên branch `feat/U0004/pipeline-profile-roundtrip` (worktree `wt-U0004`)
- Đối chiếu `design.md` §4–§5, `investigate.md` acceptance criteria, `typecheck.md`
- Project rules: coding + test

---

## Findings

### [should] ProfileManager.vue:30 — Đổi project không reset `selected` profile

  Context: `watch(projectId)` chỉ gọi `loadProfiles()`. Tên profile đang chọn có thể trùng giữa hai project → user Load nhầm profile project cũ (cùng tên) mà không để ý.
  Suggestion: Trong watch `projectId`, set `selected.value = ''` và `error.value = ''`.

### [should] PipelineEditor.vue:189-193 — Clear canvas task scope không reset `pipelineMeta`

  Context: Khi `scope === 'task'` và `taskId` rỗng, editor xóa nodes/edges nhưng `pipelineMeta` / `stepPreserved` vẫn giữ config project trước. Lần chọn task sau có thể serialize meta cũ nếu loadConfig fail.
  Suggestion: Khi clear canvas, reset `pipelineMeta` và `stepPreserved` về `{}`.

### [should] tests/ — Thiếu test end-to-end acceptance #3 (load profile → save to file → GET config)

  Context: Design §5 acceptance #3 yêu cầu chuỗi load profile → save to file → `GET /api/pipeline-config?project=B` tương đương. Hiện có golden test riêng cho profile scope và config-write, chưa có một test nối hai bước.
  Suggestion: Thêm golden test: POST profile scoped → POST pipeline-config-write cùng body → GET config deep-equal.

### [imo] pipelineRoundTrip.ts:42-45 — `mergeHitl` khi `mode: 'none'` drop toàn bộ preserved retry

  Context: Đúng theo design §4.2.3 (UI ghi đè mode). Nếu user vô tình set HITL none rồi đổi lại manual, `retry` đã mất khỏi node data.
  Suggestion: Chấp nhận MVP; ghi chú trong test-spec là known limitation.

### [imo] tests/src/api/client.pipeline.test.ts — Chỉ assert URL string, không assert body `writePipelineConfig`

  Context: Regression nhỏ nếu ai đổi thứ tự tham số `writePipelineConfig`.
  Suggestion: Assert `JSON.parse(body).scope` trong test POST (optional follow-up).

---

## Điểm tích cực

- Khớp design Bug A: `projectId` thread `App.vue` → `PipelineEditor` → `ProfileManager`; 5 API client dùng `qs()`.
- Khớp design Bug B: `pipelineRoundTrip.ts` pure, test vitest 97%+ coverage module; `applyLoadedPipeline` / `buildFullPipeline` thay `buildPipelineFromFlow` lossy.
- Server không đổi — đúng investigate blast radius.
- Golden tests mới cover `?project=` profile path và config-write preserve `defaults`/`doc_reviewer`/`export_key`.
- `watch(projectId)` reload config + profile list — đúng acceptance đổi project.
- Typecheck + bun test + vitest PASS (theo `typecheck.md`).

## PHPStan / Typecheck

Không áp dụng PHP. `vue-tsc --noEmit` **PASS**.

## Security

- Không thêm endpoint; chỉ query param `project` đã có sẵn resolution `resolveProjectRoot` — không mở path traversal mới.

## Scope discipline

Thay đổi nằm trong file list design §4.1. Không e2e (đúng design §6 out of scope).

---

## Summary

- [must]: 0 findings
- [should]: 3 findings
- [imo]: 2 findings

Recommendation: **APPROVE**
