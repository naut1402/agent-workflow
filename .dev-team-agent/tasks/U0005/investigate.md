# Investigation — U0005: Tích hợp agent vào pipeline dashboard

## 1. Mục tiêu

Cho phép người dùng tương tác với pipeline dev-team **trực tiếp trên dashboard** thay vì chỉ qua orchestrator CLI/chat:

1. **HITL trên flow monitor** — click icon node pipeline để duyệt gate.
2. **Build agent từ NL qua runner** — mô tả tự nhiên → draft agent → chạy thử / lưu qua job queue.
3. **Quick actions trên artifact viewer** — nút một-click kích hoạt agent (vd. cải thiện tài liệu).

## 2. Hiện trạng codebase

### 2.1 Monitor + pipeline flow

| Thành phần | Vai trò | Gap |
|---|---|---|
| `PipelineView.vue` | VueFlow render node theo `phasesFromPipeline(task.pipeline)` | Chỉ hiển thị; không có click handler trên node/icon |
| `PipelineNode.vue` | Bubble icon theo `status` (`done/active/waiting/pending`) | Không emit event; không nút approve |
| `phaseStatus()` (`src/api/phase.ts`) | `waiting` khi `task.hitl_pending === phase.hitl` | Logic đúng nhưng **read-only** |
| `MonitorLayout.vue` | Badge `hitl_pending` trên header | Không có UI duyệt |

**State contract**: `.dev-state/<id>.json` do orchestrator ghi; dashboard **chỉ đọc** (`shared/schemas/task.ts` comment, `server/tasks/index.ts`).

→ **Không có** `PUT /api/task-state` hay tương đương. Feature (1) bắt buộc thêm API ghi state an toàn.

### 2.2 Runner + job queue

| Thành phần | Vai trò | Gap |
|---|---|---|
| `POST /api/jobs` (`runners.ts`) | `submitJob({ agentRef, workspace, userPrompt, ... })` | Đã có; workspace resolve từ `.dev-team-agent/` |
| `RunnerConfigPanel.vue` | Smoke test với `agentRef` + `userPrompt` cố định | Chỉ trong mode Runner; không gắn pipeline/monitor |
| `POST /api/custom-agents/generate` | NL → `AgentDraft` (API hoặc heuristic) | Chỉ trong Agent Editor (`AgentNlWizard.vue`) |
| `agentResolver.ts` | Resolve `dev-agent-teams:*` và custom agent file | Sẵn sàng cho job |

→ Job infrastructure **đủ** cho (2) và (3); thiếu **UI entry point** và flow kết nối NL → draft → save → run.

### 2.3 Artifact viewer

| Thành phần | Vai trò | Gap |
|---|---|---|
| `ArtifactPanel.vue` | Đọc/ghi artifact qua `PUT /api/artifact` | Toolbar chỉ có Full/Blocks toggle |
| `workflow-step-templates` | JSON template (`name`, `title`, `body`, `pipeline_step_id`) | Dùng cho pipeline editor builder; **chưa** expose làm quick action trên monitor |

→ Feature (3) có thể tái sử dụng `workflow-step-templates` hoặc catalog mới `artifact-actions`.

### 2.4 Orchestrator ↔ dashboard

- Orchestrator (`dev-team-orchestrator` skill) ghi `hitl_pending`, spawn agent qua `remote-runner-cli.mjs` / Task tool.
- Dashboard remote mode (Luồng B): sync git sau state/step — **dashboard không đẩy pipeline tiếp** khi user approve.
- Sau khi dashboard ghi state (approve), orchestrator `--resume` hoặc runner submit step kế mới chạy phase tiếp.

**Blast radius**: Thay đổi chủ yếu `server/http/routes/tasks.ts`, `server/tasks/`, `src/features/monitor/`, `src/api/`, schema Zod, tests mirror. Không đụng orchestrator plugin trừ khi muốn dashboard-triggered resume tự động.

## 3. Call chain hiện tại

### HITL (orchestrator-only)

```
orchestrator → ghi state (hitl_pending=gate_id)
            → user gõ "approved" trong chat
            → orchestrator clear hitl_pending, next step
```

Dashboard chỉ poll `GET /api/tasks` → hiển thị `waiting` trên node.

### Chạy agent (runner mode)

```
RunnerConfigPanel → POST /api/jobs → jobQueue → claude-code-cli provider
                → resolveAgent(agentRef) → execute → log
```

### NL agent draft

```
AgentNlWizard → POST /api/custom-agents/generate → draft
             → user save trong Agent Editor (không qua runner)
```

## 4. Gap tổng hợp

| # | Yêu cầu | Có sẵn | Thiếu |
|---|---|---|---|
| 1 | Click icon flow để duyệt | Hiển thị status + gate label trên edge | API ghi state; UI approve/reject; optional doc-review prompt; sync git (remote) |
| 2 | Build agent từ NL qua runner | generate API + submit job | Wizard trong monitor/runner; persist custom agent; chọn runner; theo dõi job |
| 3 | Quick actions trên artifact | submit job API; workflow templates (builder) | Action bar theo artifact type; prompt template; poll job + reload artifact |

## 5. Rủi ro & ràng buộc

- **Conflict state**: Dashboard ghi `hitl_pending` trong khi orchestrator CLI cũng chạy cùng task → last-write-wins (skill ghi rõ MVP không có lock).
- **Atomic write**: State file phải ghi temp + rename (giống `saveRegistry`, `PUT /api/artifact`).
- **Path hardening**: Task id regex, sanitize mọi input.
- **Không phá read-only invariant** cho artifact state read — chỉ thêm endpoint state riêng, có audit log.
- Remote `--remote`: cần `orchestrator-remote.json` hoặc env `DEV_TEAM_*` — **chưa cấu hình** trong repo hiện tại; sync sau approve là best-effort.

## 6. Phụ thuộc liên quan

- Issue F0003 / agent-workflow#39: remote dashboard, `dashboard-sync.mjs`.
- `workflow-step-templates` có thể mở rộng thành `artifact-quick-actions` với field `agentRef`, `produces`, `prompt_template`.

## 7. Kết luận điều tra

Ba tính năng **khả thi trên nền dashboard hiện tại** với phạm vi tập trung:

1. **Backend state mutation API** + frontend HITL trên `PipelineNode`.
2. **Compose flow** generate → save custom agent → submit job (tái dùng runner).
3. **Artifact toolbar actions** map tới job submit + artifact reload.

Không cần thay đổi orchestrator plugin ở phase 1; dashboard đóng vai trò **HITL surface** và **agent launcher**. Orchestrator `--resume` hoặc auto-submit step kế là phase 2 tùy chọn.
