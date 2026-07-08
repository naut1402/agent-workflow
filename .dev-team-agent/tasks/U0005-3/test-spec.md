# Test Spec — U0005-3: Build agent từ NL qua runner

## 1. Phạm vi test

Feature 2 (design §4.3): wizard 3 bước trên monitor — mô tả NL → preview/sửa draft → lưu custom agent → smoke job qua runner.

Đơn vị test:
- `buildAndRunAgent()` (`src/api/client.ts`) — compose save + submit, agentRef `dashboard:<name>`, project scope.
- `useAgentBuild` (`src/features/monitor/composables/useAgentBuild.ts`) — state machine, runner, poll job, guard lỗi.
- `AgentBuildWizard.vue` — render bước, `skillsText`/`jobBadge` (chưa có component test).
- E2E Playwright — screenshot wizard (Rule test module frontend mới).

Phương pháp: unit vitest (mock fetch), component vitest + @vue/test-utils (gap), e2e Playwright (mock generate).

## 2. Test cases

### TC-01: agentRef đúng `dashboard:<name>`
- **Type**: Normal / Regression
- **Input**: `buildAndRunAgent({ draft: { name: 'Code Reviewer' }, userPrompt: 'smoke', workspace: 'tasks/T1', runnerId: 'r1', projectId: 'proj-b' })`, save trả `{ name: 'code-reviewer' }`.
- **Expected output**: `jobBody.agentRef === 'dashboard:code-reviewer'`; save chạy trước submit.
- **Setup**: `tests/src/api/client.buildAndRunAgent.test.ts`.
- **Notes**: Đã pass sau fix round 2.

### TC-02: save và job dùng cùng project scope (client)
- **Type**: Abnormal / Boundary (multi-project)
- **Input**: `buildAndRunAgent({ …, projectId: 'proj-b' })`.
- **Expected output**: `POST /api/custom-agents?project=proj-b` và `POST /api/jobs?project=proj-b`; `metadata.projectId === 'proj-b'`.
- **Setup**: stub fetch ghi URL cả 2 call.
- **Notes**: Đã pass sau fix round 2.

### TC-02b: composable truyền projectId xuống client
- **Type**: Regression
- **Input**: `useAgentBuild({ getProjectId: () => 'proj-x', … })` → `buildAndRun()` với draft hợp lệ.
- **Expected output**: fetch save + submit URL chứa `project=proj-x`.
- **Setup**: mở rộng `useAgentBuild.test.ts` stub ghi URL.
- **Notes**: Gap — chưa có test.

### TC-03: poll timeout → failed có message
- **Type**: Boundary
- **Input**: `jobStates` luôn `running`, `maxWaitMs: 5`, `pollMs: 1`.
- **Expected output**: `jobStatus='failed'`, `jobError` chứa "Hết thời gian chờ job", không treo.
- **Setup**: `make({ maxWaitMs: 5, pollMs: 1, jobStates: [{ status: 'running' }] })`.
- **Notes**: Gap — nhánh deadline chưa cover.

### TC-04: transient poll error dưới ngưỡng vẫn hồi phục
- **Type**: Abnormal
- **Input**: `fetchJob` fail 2 lần rồi `succeeded`; `maxPollErrors=3`.
- **Expected output**: `jobStatus='succeeded'`, không throw.
- **Setup**: fetch mock đếm lần gọi `/api/jobs/`.
- **Notes**: Gap.

### TC-05: transient poll error vượt ngưỡng → surface lỗi
- **Type**: Abnormal
- **Input**: `fetchJob` luôn ném; `maxPollErrors=3`.
- **Expected output**: `jobError` set, `running=false`, không throw ra ngoài.
- **Notes**: Gap.

### TC-06: loadRunners thất bại set error
- **Type**: Abnormal
- **Input**: `fetchRunners` ném.
- **Expected output**: `error` chứa "Không tải được danh sách runner"; `hasUsableRunner=false`.
- **Setup**: đã cover một phần trong useAgentBuild tests (no-runner); thiếu case fetch throw.
- **Notes**: Gap nhẹ.

### TC-07: generate khi response thiếu `draft`
- **Type**: Abnormal
- **Input**: `/api/custom-agents/generate` trả `{}`.
- **Expected output**: (mong muốn) ở lại bước `describe` + error; (hiện tại) draft rỗng → preview.
- **Notes**: nice_to_have UX.

### TC-08: AgentBuildWizard component render + computed
- **Type**: Normal
- **Input**: mount với mock composable; draft `{ skills: ['a','b'] }`.
- **Expected output**:
  - `skillsText` getter → `"a, b"`; set `"x, y\nz"` → `['x','y','z']`.
  - `jobBadge`: null→pending; succeeded→ok; failed→err.
  - Step indicator `current`/`done` theo `step`.
  - Nút "Lưu & chạy thử" disabled khi `!hasUsableRunner`.
- **Setup**: vitest + @vue/test-utils — chưa có file.
- **Notes**: Gap component test.

### TC-E2E-01: screenshot luồng wizard describe → preview
- **Type**: Normal (smoke UI)
- **Input**: mở `/` → click "⚡ Build agent" → nhập mô tả → "Tạo draft →".
- **Expected output**: modal `.agent-build-wizard` hiện; step 2 active; draft name `e2e-wizard-agent`; screenshot attach `agent-build-wizard-preview`.
- **Setup**: `test-e2e/agent-build-wizard.spec.ts`, mock `POST /api/custom-agents/generate`.
- **Notes**: Đã pass (1/1). Rule test satisfied.

### TC-E2E-02 (optional): wizard bước run với mock job
- **Type**: Normal
- **Input**: preview → "Lưu & chạy thử" với mock runners + jobs.
- **Expected output**: step 3 hiện job status; screenshot bước run.
- **Setup**: mock `/api/runners`, `/api/custom-agents`, `/api/jobs`, poll `/api/jobs/:id`.
- **Notes**: Follow-up; unit đã cover compose + poll.

## 3. Coverage matrix

| Done criteria / AC | TC liên quan | Trạng thái |
|---|---|---|
| Generate draft từ NL | useAgentBuild generate tests, TC-07 | [x] (edge TC-07 chưa fix UX) |
| Save custom agent cùng project | TC-01, TC-02 | [x] |
| Smoke job qua runner (agent resolve) | TC-01 | [x] |
| Runner disabled/no-runner message | useAgentBuild no-runner tests | [x] |
| Poll job terminal + timeout | success/failed tests, TC-03/04/05 | [~] timeout/transient gap |
| UI module mới e2e screenshot | TC-E2E-01 | [x] |
| Multi-project qua composable | TC-02b | [ ] |

## 4. Regression risk

- `saveCustomAgent`/`submitJob` thêm param optional `projectId?` — caller cũ (`AgentEditor.vue`, `RunnerConfigPanel.vue`) không truyền vẫn OK; chạy lại agent-editor/runner tests nếu sửa thêm.
- `MonitorLayout.vue` toolbar + wizard — kiểm tra layout monitor (`monitor.spec.ts`) không xô lệch.
- Nút "Build agent" khi chưa chọn project — test thủ công hoặc TC guard project (should fix).
- E2E mock generate — không phụ thuộc `ANTHROPIC_API_KEY`; smoke job thật vẫn cần runner CLI (out of scope e2e hiện tại).
