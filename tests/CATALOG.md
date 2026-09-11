# Danh mục suite test

Bảng **sinh tự động** — đừng sửa tay:

```bash
bun run test:scope --catalog > tests/CATALOG.md
```

Sinh **sau khi đã overlay** cây test: `--catalog` cần đồng thời `package.json` /
`vitest.config.ts` của dòng source và cây `tests/` của dòng test.

- **Runner** — theo `tests/runners.json` (khoá `bunTest`); phần còn lại là vitest.
- **Vùng source phủ** — lấy từ import **trực tiếp** của test trong suite: nó nói
  suite đó *của* module nào, không phải toàn bộ closure.
- **Suite không có mặt trong bảng** = vùng đó chưa ai test. `bun run test:scope`
  chọn ra 0 file **không** phải "đã xanh".

Quy ước: [`docs/agent-rules/testing.md`](../docs/agent-rules/testing.md) §3–§4.

| Suite | Runner | Vùng source phủ | Số file | Lệnh chạy |
|---|---|---|---|---|
| `tests/architecture` | bun | — | 1 | `bun test tests/architecture` |
| `tests/mcp` | bun | `mcp` | 1 | `bun test tests/mcp` |
| `tests/src` | vitest | — | 1 | `npx vitest run tests/src/*.test.ts` |
| `tests/src/backend/configs` | vitest | `backend/configs` | 1 | `npx vitest run tests/src/backend/configs` |
| `tests/src/backend/events` | bun | `backend/events` | 1 | `bun test tests/src/backend/events` |
| `tests/src/backend/http` | vitest | `backend/http` | 1 | `npx vitest run tests/src/backend/http` |
| `tests/src/backend/lib` | vitest | `backend/lib`, `shared/lib` | 3 | `npx vitest run tests/src/backend/lib` |
| `tests/src/backend/log` | bun | `backend/log`, `features/logs/business`, `backend/events` | 3 | `bun test tests/src/backend/log` |
| `tests/src/features/agent-editor/business` | bun | `features/agent-editor/business` | 3 | `bun test tests/src/features/agent-editor/business` |
| `tests/src/features/agent-editor/components` | vitest | `features/agent-editor/components`, `features/agent-editor/business`, `frontend/lib` | 3 | `npx vitest run tests/src/features/agent-editor/components` |
| `tests/src/features/agent-editor/composables` | vitest | `features/agent-editor/composables` | 1 | `npx vitest run tests/src/features/agent-editor/composables` |
| `tests/src/features/agent-editor/scripts` | vitest | `features/agent-editor/scripts` | 1 | `npx vitest run tests/src/features/agent-editor/scripts` |
| `tests/src/features/automations/components` | vitest | `features/automations/components`, `features/automations/scripts` | 2 | `npx vitest run tests/src/features/automations/components` |
| `tests/src/features/automations/composables` | vitest | `features/automations/composables`, `features/automations/scripts` | 1 | `npx vitest run tests/src/features/automations/composables` |
| `tests/src/features/automations/scripts` | vitest | `features/automations/scripts` | 1 | `npx vitest run tests/src/features/automations/scripts` |
| `tests/src/features/knowledge/business` | bun | `features/knowledge/business`, `features/knowledge/schemas` | 3 | `bun test tests/src/features/knowledge/business` |
| `tests/src/features/knowledge/components` | vitest | `features/knowledge/components` | 1 | `npx vitest run tests/src/features/knowledge/components` |
| `tests/src/features/logs/business` | bun | `features/logs/business`, `features/runner/business`, `backend/log` | 3 | `bun test tests/src/features/logs/business` |
| `tests/src/features/logs/components` | vitest | `features/logs/components`, `features/settings/scripts` | 1 | `npx vitest run tests/src/features/logs/components` |
| `tests/src/features/logs/composables` | vitest | `features/logs/composables`, `shared/log`, `backend/log` | 3 | `npx vitest run tests/src/features/logs/composables` |
| `tests/src/features/logs/scripts` | vitest | `features/logs/scripts` | 1 | `npx vitest run tests/src/features/logs/scripts` |
| `tests/src/features/monitor` | vitest | `features/monitor/composables` | 1 | `npx vitest run tests/src/features/monitor/*.test.ts` |
| `tests/src/features/monitor/business` | bun | `features/monitor/business`, `backend/lib`, `features/runner/business` | 5 | `bun test tests/src/features/monitor/business` |
| `tests/src/features/monitor/components` | vitest | `features/monitor/components`, `features/monitor/locales`, `features/monitor/scripts` | 10 | `npx vitest run tests/src/features/monitor/components` |
| `tests/src/features/monitor/composables` | vitest | `features/monitor/composables`, `features/runner/scripts` | 6 | `npx vitest run tests/src/features/monitor/composables` |
| `tests/src/features/monitor/lib` | vitest | `features/monitor/lib` | 5 | `npx vitest run tests/src/features/monitor/lib` |
| `tests/src/features/monitor/schemas` | vitest | `features/monitor/schemas` | 1 | `npx vitest run tests/src/features/monitor/schemas` |
| `tests/src/features/nl-chat/components` | vitest | `features/nl-chat/components`, `features/nl-chat/composables`, `frontend/composables` | 4 | `npx vitest run tests/src/features/nl-chat/components` |
| `tests/src/features/nl-chat/composables` | vitest | `features/nl-chat/composables` | 3 | `npx vitest run tests/src/features/nl-chat/composables` |
| `tests/src/features/nl-chat/lib` | vitest | `features/nl-chat/lib` | 3 | `npx vitest run tests/src/features/nl-chat/lib` |
| `tests/src/features/notifications/components` | vitest | `features/notifications/components`, `features/notifications/lib` | 3 | `npx vitest run tests/src/features/notifications/components` |
| `tests/src/features/notifications/composables` | vitest | `features/notifications/lib`, `features/notifications/composables`, `frontend/composables` | 1 | `npx vitest run tests/src/features/notifications/composables` |
| `tests/src/features/notifications/lib` | vitest | `features/notifications/lib` | 2 | `npx vitest run tests/src/features/notifications/lib` |
| `tests/src/features/pipeline-editor/business` | bun | `features/pipeline-editor/business` | 3 | `bun test tests/src/features/pipeline-editor/business` |
| `tests/src/features/pipeline-editor/components` | vitest | `features/pipeline-editor/components`, `features/pipeline-editor/scripts` | 6 | `npx vitest run tests/src/features/pipeline-editor/components` |
| `tests/src/features/pipeline-editor/composables` | vitest | `features/pipeline-editor/composables`, `features/pipeline-editor/scripts` | 1 | `npx vitest run tests/src/features/pipeline-editor/composables` |
| `tests/src/features/pipeline-editor/lib` | vitest | `features/pipeline-editor/lib` | 3 | `npx vitest run tests/src/features/pipeline-editor/lib` |
| `tests/src/features/pipeline-editor/scripts` | vitest | `features/pipeline-editor/scripts` | 2 | `npx vitest run tests/src/features/pipeline-editor/scripts` |
| `tests/src/features/quick-action/components` | vitest | `features/quick-action/components`, `features/quick-action/scripts`, `features/runner/scripts` | 1 | `npx vitest run tests/src/features/quick-action/components` |
| `tests/src/features/quick-action/composables` | vitest | `features/quick-action/composables` | 1 | `npx vitest run tests/src/features/quick-action/composables` |
| `tests/src/features/quick-action/lib` | vitest | `features/quick-action/lib` | 1 | `npx vitest run tests/src/features/quick-action/lib` |
| `tests/src/features/runner/business` | bun | `features/runner/business` | 8 | `bun test tests/src/features/runner/business` |
| `tests/src/features/runner/components` | vitest | `features/runner/components`, `features/runner/scripts`, `features/runner/locales` | 2 | `npx vitest run tests/src/features/runner/components` |
| `tests/src/features/runner/scripts` | vitest | `features/runner/scripts` | 1 | `npx vitest run tests/src/features/runner/scripts` |
| `tests/src/features/running-jobs/components` | vitest | `features/running-jobs/components`, `features/running-jobs/lib` | 1 | `npx vitest run tests/src/features/running-jobs/components` |
| `tests/src/features/running-jobs/composables` | vitest | `features/runner/scripts`, `features/running-jobs/composables` | 1 | `npx vitest run tests/src/features/running-jobs/composables` |
| `tests/src/features/running-jobs/lib` | vitest | `features/running-jobs/lib` | 1 | `npx vitest run tests/src/features/running-jobs/lib` |
| `tests/src/features/settings/components` | vitest | `features/settings/components`, `features/settings/scripts`, `frontend/composables` | 2 | `npx vitest run tests/src/features/settings/components` |
| `tests/src/features/settings/schemas` | vitest | `features/settings/schemas` | 6 | `npx vitest run tests/src/features/settings/schemas` |
| `tests/src/features/settings/scripts` | vitest | `features/settings/scripts`, `frontend/shell` | 1 | `npx vitest run tests/src/features/settings/scripts` |
| `tests/src/features/statistics/business` | bun | `features/statistics/business`, `shared/log` | 1 | `bun test tests/src/features/statistics/business` |
| `tests/src/features/statistics/components` | vitest | `features/statistics/components`, `features/statistics/lib` | 2 | `npx vitest run tests/src/features/statistics/components` |
| `tests/src/features/statistics/lib` | vitest | `features/statistics/lib` | 2 | `npx vitest run tests/src/features/statistics/lib` |
| `tests/src/frontend` | vitest | `frontend/shell`, `features/logs/components`, `features/monitor/components` | 2 | `npx vitest run tests/src/frontend/*.test.ts` |
| `tests/src/frontend/composables` | vitest | `frontend/composables` | 5 | `npx vitest run tests/src/frontend/composables` |
| `tests/src/frontend/configs` | vitest | `frontend/configs` | 1 | `npx vitest run tests/src/frontend/configs` |
| `tests/src/frontend/container` | vitest | `frontend/container` | 1 | `npx vitest run tests/src/frontend/container` |
| `tests/src/frontend/lib` | vitest | `frontend/lib` | 5 | `npx vitest run tests/src/frontend/lib` |
| `tests/src/frontend/plugins` | vitest | `frontend/composables`, `frontend/configs`, `frontend/plugins` | 1 | `npx vitest run tests/src/frontend/plugins` |
| `tests/src/frontend/shell` | vitest | `frontend/shell` | 3 | `npx vitest run tests/src/frontend/shell` |
| `tests/src/frontend/ui` | vitest | `frontend/ui` | 4 | `npx vitest run tests/src/frontend/ui` |
| `tests/src/server` | bun | `features/settings/business`, `backend/registry.ts`, `backend/apiServer.ts` | 3 | `bun test tests/src/server/*.test.ts` |
| `tests/src/server/agents` | bun | `features/agent-editor/business` | 5 | `bun test tests/src/server/agents` |
| `tests/src/server/artifactActions` | bun | `features/monitor/business`, `features/monitor/schemas` | 1 | `bun test tests/src/server/artifactActions` |
| `tests/src/server/automations` | bun | `features/automations/business`, `features/automations/schemas`, `backend/events` | 9 | `bun test tests/src/server/automations` |
| `tests/src/server/catalog` | bun | `features/pipeline-editor/business` | 4 | `bun test tests/src/server/catalog` |
| `tests/src/server/chat` | bun | `features/nl-chat/business`, `features/runner/business`, `features/monitor/business` | 7 | `bun test tests/src/server/chat` |
| `tests/src/server/github` | bun | `features/monitor/business`, `backend/apiServer.ts`, `backend/registry.ts` | 2 | `bun test tests/src/server/github` |
| `tests/src/server/http` | bun | `backend/apiServer.ts`, `backend/http`, `features/runner/business` | 27 | `bun test tests/src/server/http` |
| `tests/src/server/knowledge` | bun | `backend/apiServer.ts`, `backend/events`, `backend/http` | 1 | `bun test tests/src/server/knowledge` |
| `tests/src/server/lib` | bun | `backend/lib` | 1 | `bun test tests/src/server/lib` |
| `tests/src/server/pipeline` | bun | `features/pipeline-editor/business` | 2 | `bun test tests/src/server/pipeline` |
| `tests/src/server/rules` | bun | `features/pipeline-editor/business` | 1 | `bun test tests/src/server/rules` |
| `tests/src/server/runners` | bun | `features/runner/business`, `backend/events`, `backend/log` | 20 | `bun test tests/src/server/runners` |
| `tests/src/server/settings` | bun | `features/settings/business` | 2 | `bun test tests/src/server/settings` |
| `tests/src/server/tasks` | bun | `features/monitor/business`, `features/runner/business`, `backend/events` | 4 | `bun test tests/src/server/tasks` |
| `tests/src/shared/lib` | bun | `frontend/http`, `shared/lib` | 1 | `bun test tests/src/shared/lib` |
| `tests/src/shared/log` | vitest | `shared/log` | 1 | `npx vitest run tests/src/shared/log` |
| `tests/tools` | bun | `tooling` | 9 | `bun test tests/tools` |
