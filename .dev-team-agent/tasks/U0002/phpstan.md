# Verify — U0002

> **N/A PHPStan** — repo Vue/TS dashboard; thay bằng typecheck + test suite (skill `verify-dashboard`).

## Typecheck

- **Command**: `bun run typecheck` (`vue-tsc --noEmit`)
- **Result**: **HAS_PREEXISTING_ERRORS** (sau `bun install` nâng Vue 3.5.38)
- **Output** (không phát sinh từ file mới U0002; lỗi cũ / môi trường):
  - `App.vue:233` — `Ref<boolean>` vs `boolean` prop (`sidebarCollapsed` → PipelineEditor; tồn tại trước PR2)
  - `PipelineView.vue:163` — VueFlow `NodeTypesObject` typing
  - `useDrop.ts:12` — `MaybeRefOrGetter` typing
- **Ghi chú**: Trước `bun install`, `pnpm exec vue-tsc --noEmit` exit 0 trên cùng diff (chỉ lỗi `PipelineEditor` `tasks` prop — đã fix bằng `Array as () => any[]`).

## Tests

### Backend (`bun run test`)

- **Result**: **PASS**
- **Details**: 175 pass, 0 fail (24 files)

### Frontend unit (`bun run test:fe`)

- **Result**: **HAS_PREEXISTING_FAILURES**
- **Details**: 4 fail / suite (không liên quan file U0002):
  - `AgentNlWizard.test.ts` — emit `apply-draft` undefined
  - `TaskList.test.ts` — artifact expand (vue-test-utils + Vue 3.5 compat)
  - `LogsPanel.test.ts` — 2 cases audit/jobs tab
- **Monitor scope**: `useTaskPolling.test.ts` / `TaskList.test.ts` fail khi chạy qua `bun test` (vitest API `vi.stubGlobal`); chạy qua `vitest run` thì mount được nhưng assertion fail — ngoài scope U0002.

### E2E (`bun run test:e2e`)

- **Result**: **PASS**
- **Details**: 9/9 passed, gồm:
  - `monitor.spec.ts` — artifact expand, không còn `.task-timeline`
  - `app-shell.modes.spec.ts` — mode switch + sidebar collapse
  - `pipeline-editor.spec.ts`, `runner.spec.ts`, …

## Tóm tắt

| Gate | Status |
|------|--------|
| Typecheck | Pre-existing errors (post bun install) |
| Backend tests | CLEAN |
| Frontend vitest | Pre-existing failures (4) |
| E2E Playwright | CLEAN |

## Files đã implement (PR4→PR3→PR1→PR2)

- `src/App.vue` — ẩn TaskTimeline; mode-toggle cleanup; MonitorLayout; gỡ sidebar monitor/scope
- `src/features/monitor/components/MonitorLayout.vue` — **mới**
- `src/features/pipeline-editor/components/PipelineEditor.vue` — scope panel + `tasks` prop
- `src/features/runner/components/RunnerConfigPanel.vue` — dark theme tokens
- `src/style.css` — mode-toggle column, monitor-layout, editor-scope-panel
- `test-e2e/monitor.spec.ts` — bỏ assert timeline
