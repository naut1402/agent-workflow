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
| `tests/mcp` | bun | `mcp` | 1 | `bun test tests/mcp` |
| `tests/src` | vitest | `core/shell`, `App.vue`, `core/container` | 1 | `npx vitest run tests/src/*.test.ts` |
| `tests/src/api` | vitest | `features/pipeline-editor/scripts`, `features/agent-editor/scripts` | 2 | `npx vitest run tests/src/api` |
| `tests/src/core/composables` | vitest | `core/composables` | 5 | `npx vitest run tests/src/core/composables` |
| `tests/src/core/configs` | vitest | `core/configs` | 3 | `npx vitest run tests/src/core/configs` |
| `tests/src/core/container` | vitest | `core/container` | 1 | `npx vitest run tests/src/core/container` |
| `tests/src/core/events` | bun | `core/events` | 1 | `bun test tests/src/core/events` |
| `tests/src/core/http` | vitest | `core/http` | 1 | `npx vitest run tests/src/core/http` |
| `tests/src/core/i18n` | vitest | `core/composables`, `core/configs`, `plugins/i18n` | 1 | `npx vitest run tests/src/core/i18n` |
| `tests/src/core/lib` | vitest | `core/lib`, `core/http` | 9 | `npx vitest run tests/src/core/lib` |
| `tests/src/core/log` | bun | `core/log`, `features/logs/business`, `core/events` | 4 | `bun test tests/src/core/log` |
| `tests/src/core/shell` | vitest | `core/shell` | 2 | `npx vitest run tests/src/core/shell` |
| `tests/src/core/ui` | vitest | `core/ui` | 4 | `npx vitest run tests/src/core/ui` |
| `tests/src/features/agent-editor/business` | bun | `features/agent-editor/business` | 2 | `bun test tests/src/features/agent-editor/business` |
| `tests/src/features/agent-editor/components` | vitest | `features/agent-editor/components`, `core/lib`, `features/agent-editor/business` | 3 | `npx vitest run tests/src/features/agent-editor/components` |
| `tests/src/features/agent-editor/composables` | vitest | `features/agent-editor/composables` | 1 | `npx vitest run tests/src/features/agent-editor/composables` |
| `tests/src/features/automations/components` | vitest | `features/automations/components`, `features/automations/scripts` | 2 | `npx vitest run tests/src/features/automations/components` |
| `tests/src/features/automations/composables` | vitest | `features/automations/composables`, `features/automations/scripts` | 1 | `npx vitest run tests/src/features/automations/composables` |
| `tests/src/features/automations/scripts` | vitest | `features/automations/scripts` | 1 | `npx vitest run tests/src/features/automations/scripts` |
| `tests/src/features/knowledge/business` | bun | `features/knowledge/business` | 3 | `bun test tests/src/features/knowledge/business` |
| `tests/src/features/knowledge/components` | vitest | `features/knowledge/components` | 1 | `npx vitest run tests/src/features/knowledge/components` |
| `tests/src/features/logs/business` | bun | `features/logs/business`, `features/runner/business`, `core/log` | 3 | `bun test tests/src/features/logs/business` |
| `tests/src/features/logs/components` | vitest | `features/logs/components`, `features/settings/scripts` | 1 | `npx vitest run tests/src/features/logs/components` |
| `tests/src/features/logs/composables` | vitest | `core/log`, `features/logs/composables` | 3 | `npx vitest run tests/src/features/logs/composables` |
| `tests/src/features/logs/scripts` | vitest | `features/logs/scripts` | 1 | `npx vitest run tests/src/features/logs/scripts` |
| `tests/src/features/monitor` | vitest | `features/monitor/composables` | 1 | `npx vitest run tests/src/features/monitor/*.test.ts` |
| `tests/src/features/monitor/business` | bun | `features/monitor/business`, `core/lib`, `features/runner/business` | 5 | `bun test tests/src/features/monitor/business` |
| `tests/src/features/monitor/components` | vitest | `features/monitor/components`, `features/monitor/locales`, `features/monitor/scripts` | 10 | `npx vitest run tests/src/features/monitor/components` |
| `tests/src/features/monitor/composables` | vitest | `features/monitor/composables`, `features/runner/scripts` | 6 | `npx vitest run tests/src/features/monitor/composables` |
| `tests/src/features/monitor/lib` | vitest | `features/monitor/lib` | 5 | `npx vitest run tests/src/features/monitor/lib` |
| `tests/src/features/monitor/schemas` | vitest | `features/monitor/schemas` | 1 | `npx vitest run tests/src/features/monitor/schemas` |
| `tests/src/features/nl-chat/components` | vitest | `features/nl-chat/components`, `features/nl-chat/composables`, `core/composables` | 4 | `npx vitest run tests/src/features/nl-chat/components` |
| `tests/src/features/nl-chat/composables` | vitest | `features/nl-chat/composables` | 3 | `npx vitest run tests/src/features/nl-chat/composables` |
| `tests/src/features/nl-chat/lib` | vitest | `features/nl-chat/lib` | 2 | `npx vitest run tests/src/features/nl-chat/lib` |
| `tests/src/features/notifications/components` | vitest | `features/notifications/components`, `features/notifications/lib` | 3 | `npx vitest run tests/src/features/notifications/components` |
| `tests/src/features/notifications/composables` | vitest | `features/notifications/lib`, `core/composables`, `features/notifications/composables` | 1 | `npx vitest run tests/src/features/notifications/composables` |
| `tests/src/features/notifications/lib` | vitest | `features/notifications/lib` | 2 | `npx vitest run tests/src/features/notifications/lib` |
| `tests/src/features/pipeline-editor/business` | bun | `features/pipeline-editor/business` | 3 | `bun test tests/src/features/pipeline-editor/business` |
| `tests/src/features/pipeline-editor/components` | vitest | `features/pipeline-editor/components`, `features/pipeline-editor/scripts` | 6 | `npx vitest run tests/src/features/pipeline-editor/components` |
| `tests/src/features/pipeline-editor/composables` | vitest | `features/pipeline-editor/composables`, `features/pipeline-editor/scripts` | 1 | `npx vitest run tests/src/features/pipeline-editor/composables` |
| `tests/src/features/pipeline-editor/lib` | vitest | `features/pipeline-editor/lib` | 3 | `npx vitest run tests/src/features/pipeline-editor/lib` |
| `tests/src/features/pipeline-editor/scripts` | vitest | `features/pipeline-editor/scripts` | 1 | `npx vitest run tests/src/features/pipeline-editor/scripts` |
| `tests/src/features/quick-action/components` | vitest | `features/quick-action/components`, `features/quick-action/scripts`, `features/runner/scripts` | 1 | `npx vitest run tests/src/features/quick-action/components` |
| `tests/src/features/quick-action/composables` | vitest | `features/quick-action/composables` | 1 | `npx vitest run tests/src/features/quick-action/composables` |
| `tests/src/features/quick-action/lib` | vitest | `features/quick-action/lib` | 1 | `npx vitest run tests/src/features/quick-action/lib` |
| `tests/src/features/runner/business` | bun | `features/runner/business` | 8 | `bun test tests/src/features/runner/business` |
| `tests/src/features/runner/components` | vitest | `features/runner/components`, `features/runner/scripts`, `features/runner/locales` | 2 | `npx vitest run tests/src/features/runner/components` |
| `tests/src/features/runner/scripts` | vitest | `features/runner/scripts` | 1 | `npx vitest run tests/src/features/runner/scripts` |
| `tests/src/features/running-jobs/components` | vitest | `features/running-jobs/components`, `features/running-jobs/lib` | 1 | `npx vitest run tests/src/features/running-jobs/components` |
| `tests/src/features/running-jobs/composables` | vitest | `features/runner/scripts`, `features/running-jobs/composables` | 1 | `npx vitest run tests/src/features/running-jobs/composables` |
| `tests/src/features/running-jobs/lib` | vitest | `features/running-jobs/lib` | 1 | `npx vitest run tests/src/features/running-jobs/lib` |
| `tests/src/features/settings/components` | vitest | `core/composables`, `features/settings/components`, `features/settings/scripts` | 1 | `npx vitest run tests/src/features/settings/components` |
| `tests/src/features/settings/schemas` | vitest | `features/settings/schemas` | 5 | `npx vitest run tests/src/features/settings/schemas` |
| `tests/src/features/statistics/business` | bun | `core/log`, `features/statistics/business` | 1 | `bun test tests/src/features/statistics/business` |
| `tests/src/features/statistics/components` | vitest | `features/statistics/components`, `features/statistics/lib` | 2 | `npx vitest run tests/src/features/statistics/components` |
| `tests/src/features/statistics/lib` | vitest | `features/statistics/lib` | 2 | `npx vitest run tests/src/features/statistics/lib` |
| `tests/src/server` | bun | `features/settings/business`, `core/registry.ts`, `api/apiServer.ts` | 3 | `bun test tests/src/server/*.test.ts` |
| `tests/src/server/agents` | bun | `features/agent-editor/business` | 5 | `bun test tests/src/server/agents` |
| `tests/src/server/artifactActions` | bun | `features/monitor/business`, `features/monitor/schemas` | 1 | `bun test tests/src/server/artifactActions` |
| `tests/src/server/automations` | bun | `features/automations/business`, `features/automations/schemas`, `core/events` | 9 | `bun test tests/src/server/automations` |
| `tests/src/server/catalog` | bun | `features/pipeline-editor/business` | 4 | `bun test tests/src/server/catalog` |
| `tests/src/server/chat` | bun | `features/runner/business`, `features/nl-chat/business`, `features/monitor/business` | 6 | `bun test tests/src/server/chat` |
| `tests/src/server/github` | bun | `features/monitor/business`, `api/apiServer.ts`, `core/registry.ts` | 2 | `bun test tests/src/server/github` |
| `tests/src/server/http` | bun | `api/apiServer.ts`, `core/http`, `features/runner/business` | 25 | `bun test tests/src/server/http` |
| `tests/src/server/lib` | bun | `core/lib` | 1 | `bun test tests/src/server/lib` |
| `tests/src/server/pipeline` | bun | `features/pipeline-editor/business` | 2 | `bun test tests/src/server/pipeline` |
| `tests/src/server/rules` | bun | `features/pipeline-editor/business` | 1 | `bun test tests/src/server/rules` |
| `tests/src/server/runners` | bun | `features/runner/business`, `core/events`, `core/log` | 20 | `bun test tests/src/server/runners` |
| `tests/src/server/settings` | bun | `features/settings/business` | 2 | `bun test tests/src/server/settings` |
| `tests/src/server/tasks` | bun | `features/monitor/business`, `features/runner/business`, `core/events` | 4 | `bun test tests/src/server/tasks` |
| `tests/tools` | bun | `tooling` | 7 | `bun test tests/tools` |
