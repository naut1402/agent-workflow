# Test Spec — U0004

## 1. Phạm vi test

Bug fix **Pipeline Editor**: (A) scope profile/pipeline-config-write theo `?project=`; (B) round-trip `defaults`, `doc_reviewer`, step extras (`export_key`, `hitl.retry`, …).

| Tầng | Runner | File chính |
|---|---|---|
| Round-trip pure logic | vitest | `tests/src/features/pipeline-editor/lib/pipelineRoundTrip.test.ts` |
| API client URL | vitest | `tests/src/api/client.pipeline.test.ts` |
| HTTP scope + meta preserve | bun test | `tests/server/http/api.golden.test.ts` |

**Manual (dashboard):** multi-project chọn B → Save profile → kiểm tra file dưới `B/.dev-team-agent/pipeline-profiles/`.

---

## 2. Test cases

### TC-01: extractPipelineMeta — defaults + doc_reviewer
- **Type**: Normal
- **Input**: Pipeline object đầy đủ meta
- **Expected**: Meta tách đúng 3 field
- **Notes**: ✅ `pipelineRoundTrip.test.ts`

### TC-02: extractStepPreservedMap — export_key, rule_fallback_skill
- **Type**: Normal
- **Input**: Step có field ngoài canvas keys
- **Expected**: Map keyed by step id, không gồm `hitl` (canvas key)
- **Notes**: ✅ covered

### TC-03: buildStepFromNode — merge hitl.retry từ preserved
- **Type**: Normal
- **Input**: Node hitl manual + preserved retry
- **Expected**: `hitl` có cả `retry` và `gate_id`
- **Notes**: ✅ covered

### TC-04: buildStepFromNode — mode none bỏ retry
- **Type**: Boundary
- **Input**: Node `hitl.mode: 'none'` dù preserved có retry
- **Expected**: `{ mode: 'none' }` only
- **Notes**: ✅ covered — known limitation (review imo)

### TC-05: assemblePipeline — round-trip meta + steps
- **Type**: Normal
- **Input**: Meta + steps array
- **Expected**: Object YAML-ready đủ field
- **Notes**: ✅ covered

### TC-06: assemblePipeline — meta rỗng
- **Type**: Boundary
- **Input**: `{}` meta
- **Expected**: `{ version: 1, steps: [...] }` không có defaults/doc_reviewer
- **Notes**: ✅ covered

### TC-07: fetchPipelineProfiles — có projectId
- **Type**: Normal
- **Input**: `projectId = 'proj-b'`
- **Expected**: GET `/api/pipeline-profiles?project=proj-b`
- **Notes**: ✅ `client.pipeline.test.ts`

### TC-08: fetchPipelineProfiles — không projectId
- **Type**: Regression
- **Input**: undefined
- **Expected**: GET `/api/pipeline-profiles` (không query)
- **Notes**: ✅ covered

### TC-09: save/delete/profile/write — project query
- **Type**: Normal
- **Input**: Các API với `projectId`
- **Expected**: URL có `?project=` hoặc `&project=`
- **Notes**: ✅ covered (5 tests)

### TC-10: POST pipeline-config-write scoped — preserve meta
- **Type**: Normal
- **Setup**: Đăng ký project B qua API
- **Input**: POST body có `defaults`, `doc_reviewer`, step `export_key`
- **Expected**: GET `/api/pipeline-config?project=B` khớp
- **Notes**: ✅ `api.golden.test.ts`

### TC-11: POST pipeline-profiles scoped — file đúng project
- **Type**: Normal
- **Setup**: Project B riêng default root
- **Input**: POST profile `scoped`
- **Expected**: File tồn tại under `B/.dev-team-agent/pipeline-profiles/`; **không** tồn tại trên default root
- **Notes**: ✅ covered

### TC-12: Load profile → Save to file → GET config (acceptance #3)
- **Type**: Integration
- **Input**: Chuỗi profile save + config-write cùng project
- **Expected**: GET config deep-equal pipeline gốc
- **Notes**: ⚠️ Chưa có — đề xuất golden test (review should)

### TC-13: Đổi project — reload profile list
- **Type**: Manual / component
- **Input**: Chọn project A → B trên dashboard
- **Expected**: Dropdown profile khớp B; canvas reload config B
- **Notes**: Manual hoặc component test follow-up

### TC-14: Single-project regression
- **Type**: Regression
- **Input**: Không chọn project (default)
- **Expected**: API không `?project=`; hành vi như trước fix
- **Notes**: TC-08 + manual

---

## 3. Chạy test

```bash
cd wt-U0004
bun run typecheck
bun test
bun run test:fe
```

## 4. Kết quả thực tế (typecheck.md)

| Gate | Kết quả |
|---|---|
| vue-tsc | PASS |
| bun test | PASS |
| vitest | PASS (22 files) |
| e2e | Không chạy (out of scope design) |
