# Typecheck & Tests — U0004

**Worktree:** `c:\Users\tuan1\workspace\wt-U0004`  
**Branch:** `feat/U0004/pipeline-profile-roundtrip`  
**Date:** 2026-07-02

## Commands

```bash
bun run typecheck   # PASS
bun test            # PASS (tests/server + tests/mcp)
bun run test:fe     # PASS (vitest)
```

## Results

| Gate | Result | Ghi chú |
|------|--------|---------|
| `vue-tsc --noEmit` | ✅ PASS | Fix `currentSteps` computed type trong `PipelineEditor.vue` |
| `bun test` | ✅ PASS | Golden tests project scope chuyển sau registry empty test |
| `vitest run` | ✅ PASS | 22 files, import path `pipelineRoundTrip.test.ts` sửa 5 levels |

## Phạm vi thay đổi

- `src/api/client.ts` — `projectId?` cho pipeline profile APIs
- `src/App.vue` — pass `project-id`
- `PipelineEditor.vue`, `ProfileManager.vue` — Bug A + B
- `src/features/pipeline-editor/lib/pipelineRoundTrip.ts` — round-trip pure lib
- Tests: `pipelineRoundTrip.test.ts`, `client.pipeline.test.ts`, `api.golden.test.ts`

## Không chạy

- `bun run test:e2e` — không bắt buộc theo design §6
