---
name: dev-team-orchestrator
description: điều phối pipeline phát triển phần mềm theo cấu hình động pipeline.yaml cho một dev task end-to-end, mặc định investigate → design → implement → review → pr. hỗ trợ remote dashboard (agent-workflow F0003): sync artifact, submit job qua API server, 3 luồng runner local/remote/SSH. dùng khi user bắt đầu hoặc tiếp tục task có mã như B4488, F003, U00281, nhắc đến issue/bug/feature, yêu cầu implement/fix/review/tạo PR, hoặc muốn resume/subtask/auto-review/export-json/remote dashboard. skill quản lý state, artifact, human approval, q&a blocking, rule loading, retry vòng review và mô tả PR trong .dev-team-agent.
argument-hint: "[task-id] [--resume] [--subtask-of=<parent-id>] [--auto-review] [--export-json] [--remote] [--project=<id>] [--project-name=<name>] [--server=<url>] [--runner=<id>] [--runner-mode=<local|remote>]"
user-invocable: true
---

# Dev Team Orchestrator

Điều phối một dev task theo pipeline khai báo trong `pipeline.yaml`. Luôn chạy theo config, không hardcode thứ tự phase, agent, artifact, rule category, HITL gate, hay retry rule.

## Supported invocation

Nhận `$ARGUMENTS` theo dạng:

```text
<task-id> [--resume] [--subtask-of=<parent-id>] [--auto-review] [--export-json]
         [--remote] [--project=<id>] [--project-name=<name>] [--server=<url>]
         [--runner=<id>] [--runner-mode=<local|remote>]
```

- Bắt buộc có `<task-id>`; chấp nhận các dạng phổ biến như `B4488`, `F003`, `U00281`.
- `--resume`: đọc state hiện có và chạy tiếp từ `current_phase` hoặc gate đang pending.
- `--subtask-of=<parent-id>`: tạo workspace subtask, kế thừa artifact nền từ parent khi còn thiếu.
- `--auto-review`: tự chạy doc-reviewer ở các gate `optional_doc_review` không blocking.
- `--export-json`: sau mỗi phase, merge structured summary vào `pipeline-export.json`.
- `--remote`: yêu cầu bật remote dashboard — bắt buộc khi muốn health check + ghi `remote_dashboard` vào state; xem **Khi nào bật remote mode** bên dưới.
- `--project=<id>`: project id trên remote dashboard (optional nếu resolve được từ name/git).
- `--project-name=<name>`: tên project trên UI dashboard (optional; dùng khi không biết opaque id).
- `--server=<url>`: base URL remote dashboard, ví dụ `https://dashboard.example.com` (override `DEV_TEAM_SERVER_URL`).
- `--runner=<id>`: runner preset trên server (`claude-code-server`, `claude-code-ssh`, …).
- `--runner-mode=local|remote`: `local` = chạy CLI trên máy dev + sync artifact (Luồng B); `remote` = submit job qua API server (Luồng A/C).

Nếu thiếu `<task-id>`, dừng và hỏi lại task id. Không tự đặt task id.

## Canonical workspace

Chỉ đọc/ghi dưới root thống nhất `.dev-team-agent/` ở repository root:

```text
.dev-team-agent/
  pipeline.yaml
  project-rules.md
  .dev-state/<task-id>.json
  tasks/<task-id>/
    pipeline.yaml
    investigate.md
    design.md
    investigate-po.md
    design-po.md
    phpstan.md
    review.md
    test-spec.md
    pr-desc.md
    qa.md
    pipeline-export.json
```

Artifact thực tế phụ thuộc `steps[].produces` trong config. Không suy luận phase hoàn tất từ tên phase; suy luận từ artifact được khai báo và tính hợp lệ tối thiểu của nội dung.

## Remote dashboard (F0003 / agent-workflow#39)

Orchestrator tích hợp với **remote dev-team-dashboard** deploy trên server độc lập ([agent-workflow#39](https://github.com/naut1402/agent-workflow/issues/39)). Dashboard đọc `.dev-team-agent/` qua git clone, SSH cache, hoặc sync từ dev machine.

### Ba luồng runner

| Luồng | Mô tả | `runnerMode` | Khi nào dùng |
| --- | --- | --- | --- |
| **A** | Server chạy `claude` headless | `remote` | CI/server có `ANTHROPIC_API_KEY`, repo public HTTPS |
| **B** | Dev chạy CLI local + push git + server sync | `local` (default) | Dev giữ OAuth `cli-session`, artifact commit vào git |
| **C** | Server SSH vào máy dev, pull cache sau job | `remote` + `--runner=claude-code-ssh` | Workspace chỉ trên máy dev, dashboard tập trung |

### Cấu hình remote

Ưu tiên (cao → thấp): CLI flags → `.dev-team-agent/orchestrator-remote.json` → **plugin userConfig / env** (`DEV_TEAM_*`).

**Plugin userConfig (thiết lập 1 lần — khuyến nghị)**

Khi enable plugin `dev-agent-teams`, điền trong UI plugin settings (Claude Code / Cursor):

| userConfig key | Dùng cho | Mô tả |
| --- | --- | --- |
| `dashboardServerUrl` | `--server` / `DEV_TEAM_SERVER_URL` | URL remote dashboard (**bắt buộc** khi `--remote`) |
| `dashboardApiToken` | `--api-token` / `DEV_TEAM_API_TOKEN` | API token (masked) |
| `dashboardProjectId` | `--project` / `DEV_TEAM_PROJECT_ID` | Project id opaque (optional — handshake resolve được) |
| `dashboardProjectName` | `--project-name` / `DEV_TEAM_PROJECT_NAME` | Tên project trên UI (optional) |
| `dashboardApp` | MCP + local runner | Path clone agent-workflow |
| `dashboardHome` | MCP | Registry local (~/.dev-team-dashboard) |

**Quan trọng — materialize config:** Agent **không** tự nhận giá trị plugin settings UI. Khi `--remote`, orchestrator **bắt buộc** gọi `resolve-remote.mjs` trước pipeline; script đọc env/`orchestrator-remote.json`/CLI, health-check, resolve `projectId`, ghi cache file. MCP nhận config qua `.mcp.json` (`${user_config.*}` → env).

Sau khi cấu hình `dashboardServerUrl` (và optionally name/id), chỉ cần:

```text
/dev-team-orchestrator <task-id> --remote
```

**Handshake (`resolve-remote.mjs`) — bắt buộc khi `--remote`**

```bash
node plugins/dev-agent-teams/skills/dev-team-orchestrator/assets/resolve-remote.mjs \
  --dev-team-root .dev-team-agent \
  [--server=<url>] [--project=<id>] [--project-name=<name>] [--api-token=<token>]
```

Luồng resolve (ưu tiên):

1. Explicit `projectId` (CLI / cache / env) → verify `GET /api/projects?id=`
2. `projectName` (CLI / cache / env) → `GET /api/projects?name=` (1 match OK; >1 → lỗi + bảng)
3. Auto từ `git remote get-url origin` + branch hiện tại → `GET /api/projects/resolve?gitUrl=&branch=` (hoặc match client-side). Nếu branch lệch nhưng **đúng 1** project cùng gitUrl → dùng project đó (`resolvedBy: gitUrl`).
4. Server chỉ có 1 project → dùng project đó
5. Không resolve được → **dừng**, in danh sách `id | name | branch | url` — **không** chạy local-only im lặng

Sau resolve thành công, ghi `.dev-team-agent/orchestrator-remote.json` (cache cho lần sau).

**Khi nào bật remote mode**

1. **Nạp config** theo precedence: CLI flags → `.dev-team-agent/orchestrator-remote.json` → plugin userConfig / env (`DEV_TEAM_*`).
2. **Remote mode ON** khi có `--remote` **hoặc** config đã có `serverUrl` (sau handshake sẽ có `projectId`).
3. Nếu truyền `--remote`:
   - Thiếu `serverUrl` sau merge → **dừng**, báo thiếu URL — **không** local-only.
   - Có `serverUrl` thiếu `projectId` → chạy `resolve-remote.mjs`; fail thì in list project và **dừng**.
4. Không truyền `--remote` nhưng đã có `orchestrator-remote.json` đủ URL+id → vẫn sync mirror (Luồng B) sau state/step; health check chỉ bắt buộc khi có `--remote`.

**File config per-repo** (sinh bởi `resolve-remote.mjs`, hoặc copy từ `assets/orchestrator-remote.example.json`):

| Field | Mô tả |
| --- | --- |
| `serverUrl` | Base URL remote dashboard |
| `projectId` | Project id trên server (opaque) |
| `projectName` | Tên hiển thị (audit) |
| `resolvedAt` / `resolvedBy` | Metadata handshake |
| `apiToken` | Override token (null = dùng env/userConfig) |
| `runnerMode` | `local` \| `remote` |
| `runnerId` | Runner preset trên server (Luồng A/C) |
| `syncAfterState` | Gọi `dashboard-sync.mjs` sau mỗi lần ghi state |
| `syncAfterStep` | Gọi sync sau mỗi step hoàn tất |
| `syncMessage` | Commit message cho git push → map sang `dashboard-sync.mjs --message` |

```json
{
  "serverUrl": "https://dashboard.example.com",
  "projectId": "my-repo-a1b2c3d4",
  "projectName": "my-repo",
  "apiToken": null,
  "runnerMode": "local",
  "runnerId": null,
  "syncAfterState": true,
  "syncAfterStep": true,
  "syncMessage": "chore(dev-team): sync orchestrator artifacts",
  "resolvedAt": "2026-07-04T12:00:00.000Z",
  "resolvedBy": "gitUrl+branch"
}
```

**Biến môi trường** (export tay, MCP inject từ userConfig, hoặc đọc từ cache sau handshake):

| Biến | Mô tả |
| --- | --- |
| `DEV_TEAM_SERVER_URL` | Base URL remote dashboard |
| `DEV_TEAM_PROJECT_ID` | Project id trên server (optional nếu resolve được) |
| `DEV_TEAM_PROJECT_NAME` | Tên project trên UI (optional) |
| `DEV_TEAM_API_TOKEN` | Bearer token khi server bật auth |

**Onboard project trên server** (một lần):

- UI: Projects → Git URL hoặc SSH path
- API: `POST /api/projects` với `gitUrl` hoặc SSH config
- MCP: tool `add_project` trên server agent-workflow

Chi tiết deploy: [agent-workflow docs/deploy.md](https://github.com/naut1402/agent-workflow/blob/main/docs/deploy.md).

### Sync workspace (Luồng B)

Sau **mỗi lần ghi state** và **sau mỗi step hoàn tất**, nếu remote config bật `syncAfterState` / `syncAfterStep`:

```bash
node plugins/dev-agent-teams/skills/dev-team-orchestrator/assets/dashboard-sync.mjs \
  --dev-team-root .dev-team-agent \
  --project <project-id> \
  --server <server-url> \
  --message "<syncMessage from config, optional>"
```

Script này: `git add .dev-team-agent/**` → commit (nếu có thay đổi) → push origin → `POST /api/projects/:id/sync` trên server.

- Push chỉ stage/commit `.dev-team-agent/**` — không đụng code nguồn.
- Repo phải có remote `origin` và branch không detached HEAD.
- Nếu chỉ cần trigger server pull (đã push tay): thêm `--no-push`.

### Submit job — chọn runner theo mode

**Luồng B — local runner + sync** (mặc định khi `runnerMode=local`):

Runner CLI nằm trong app dashboard ([agent-workflow](https://github.com/naut1402/agent-workflow)), clone tại `$DEV_TEAM_DASHBOARD_APP` (mặc định `~/.dev-team-dashboard/app`). Chạy `/dev-dashboard` một lần nếu chưa có.

```bash
node plugins/dev-agent-teams/skills/dev-team-orchestrator/assets/remote-runner-cli.mjs submit \
  --local \
  --task-id <task-id> --step-id <step.id> \
  --agent <step.agent> \
  --workspace .dev-team-agent/tasks/<task-id> \
  --project-root <repo-root> \
  --dev-team-root .dev-team-agent \
  --prompt-file .dev-team-agent/tasks/<task-id>/.prompt-<step-id>.txt \
  --produces <comma-separated step.produces> \
  --wait
```

(`--local` wrap `bun $DEV_TEAM_DASHBOARD_APP/server/runner-cli.mjs`.)

Sau job thành công → gọi `dashboard-sync.mjs` để server mirror cập nhật.

**Luồng A/C — remote runner qua API**:

```bash
node plugins/dev-agent-teams/skills/dev-team-orchestrator/assets/remote-runner-cli.mjs submit \
  --server <server-url> \
  --project <project-id> \
  --runner <runner-id> \
  --task-id <task-id> --step-id <step.id> \
  --agent <step.agent> \
  --workspace tasks/<task-id> \
  --prompt-file .dev-team-agent/tasks/<task-id>/.prompt-<step-id>.txt \
  --produces <comma-separated step.produces> \
  --wait
```

- `workspace` là path **relative** tới `.dev-team-agent/` trên server (hoặc remote path cho SSH kind).
- Server resolve `devTeamRoot` từ project registry — không cần truyền absolute path dev machine.
- Luồng C: sau job, server tự pull cache SSH; orchestrator **không** cần sync thêm.

**Fallback:** nếu remote API lỗi và không có `--no-fallback`, `remote-runner-cli.mjs` tự fallback sang local `runner-cli.mjs`.

### Health check trước pipeline

Khi truyền `--remote`, `resolve-remote.mjs` luôn gọi health trước khi resolve project:

```bash
# thực hiện bên trong resolve-remote.mjs
GET <server-url>/api/health
# → { "ok": true, "version": "...", "env": "staging" }
```

Nếu health fail → **dừng**, báo user. Không chuyển local-only im lặng. User có thể bỏ `--remote` để chạy local có chủ đích.

### Conflict policy

- **Một task chỉ nên có một runner active** (dev local hoặc server headless).
- MVP không có distributed lock — tránh chạy cùng task-id trên dev và server đồng thời.
- Push dev và server job ghi cùng artifact: last-write-wins trên git.
- `active_runner` heartbeat trong state file là **future work** (ngoài scope PR này); hiện dựa vào quy tắc vận hành ở trên.

## Load and merge pipeline config

Luôn nạp config theo thứ tự sau:

1. Built-in default: `assets/pipeline.default.yaml` trong skill này.
2. Global override: `.dev-team-agent/pipeline.yaml` nếu tồn tại.
3. Per-task override: `.dev-team-agent/tasks/<task-id>/pipeline.yaml` nếu tồn tại.

Merge rules:

- Global config có `steps` thì thay toàn bộ danh sách built-in `steps`.
- Per-task config patch theo `step.id` trên danh sách hiện hành.
- Với per-task patch: step trùng `id` thì merge field; `hitl` merge một cấp; `id` mới thêm vào cuối; `remove: true` xoá step.
- `defaults` và `doc_reviewer` merge theo từng key ở cả global và per-task.
- Nếu không có override, dùng nguyên `assets/pipeline.default.yaml`.

Khi đọc YAML, ưu tiên parser nếu môi trường có sẵn. Nếu không có parser, đọc như tài liệu cấu trúc và vẫn phải tôn trọng schema trong `assets/pipeline.default.yaml`.

## State contract

State file: `.dev-team-agent/.dev-state/<task-id>.json`.

Tạo mới khi chưa có:

```json
{
  "task_id": "<task-id>",
  "parent_task_id": null,
  "current_phase": "<first step.id>",
  "hitl_pending": null,
  "review_round": 0,
  "auto_review": false,
  "export_json": false,
  "doc_review_round": {},
  "inherit_from_parent": [],
  "remote_dashboard": null
}
```

`remote_dashboard` (optional): snapshot config remote đang dùng — `{ "serverUrl", "projectId", "projectName", "runnerMode" }`. Ghi sau handshake thành công khi bật `--remote`.

Rules:

- Chỉ orchestrator cập nhật state.
- `current_phase` luôn là `steps[].id`, không phải tên agent cứng.
- `hitl_pending` là `null`, một `gate_id`, `"hitl-doc"`, hoặc `"qa"` (khi đang chờ trả lời Q&A blocking).
- Khi có `--resume`, không reset phase; chỉ cập nhật `auto_review/export_json` nếu flag được truyền.
- Ghi state trước khi spawn agent và sau mỗi gate để resume an toàn.
- Khi remote config bật `syncAfterState`: sau mỗi lần ghi state → gọi `dashboard-sync.mjs` (best-effort; lỗi sync không rollback pipeline, chỉ warn).

## Project rules loading

Ở đầu pipeline, gọi skill `read-project-rules` một lần để lấy toàn bộ rule project và ghi vào `.dev-team-agent/project-rules.md`.

Trên `--resume`, nếu file này đã tồn tại thì dùng lại. Không yêu cầu agent con tự gọi `read-project-rules`.

Validate trước khi chạy step:

- Với mỗi `step.rule_required: true`, nếu mọi `rule_category` của step nằm trong phần không tìm thấy hoặc trống, dừng pipeline và báo rõ step, category thiếu, đường dẫn đã kiểm tra.
- Với `rule_required: false`, cho phép tiếp tục; prompt agent dùng `rule_fallback_skill` nếu section tương ứng trống.
- Với `doc_reviewer.rule_required: true`, nếu rule review thiếu thì bỏ qua doc-reviewer có giải thích, không chặn toàn bộ pipeline trừ khi config yêu cầu blocking riêng.

## Execution loop

Khi có `--remote` (hoặc remote mode ON): **trước** vòng step, chạy `resolve-remote.mjs` (xem Handshake ở trên). Ghi `remote_dashboard` vào state từ kết quả handshake. Nếu script exit ≠ 0 → dừng pipeline.

Duyệt `steps` theo thứ tự config, bắt đầu từ `current_phase`.

Với mỗi step:

1. Cập nhật state: `current_phase = step.id`, `hitl_pending = null` → sync remote nếu remote mode ON và `syncAfterState` bật.
2. **Thực thi agent qua Runner** (ưu tiên) hoặc Task tool (fallback):
   - Ghi prompt theo template (mục Agent prompt template) vào `.dev-team-agent/tasks/<task-id>/.prompt-<step-id>.txt`.
   - Nếu remote mode ON (xem **Khi nào bật remote mode**): nạp config merged, xác định `runnerMode`:
     - **`local`** (Luồng B, default): submit qua `remote-runner-cli.mjs --local` — wrap `bun $DEV_TEAM_DASHBOARD_APP/server/runner-cli.mjs`. App dashboard clone tại `$DEV_TEAM_DASHBOARD_APP` (mặc định `~/.dev-team-dashboard/app`, repo [agent-workflow](https://github.com/naut1402/agent-workflow)); chạy `/dev-dashboard` một lần nếu chưa có.
     - **`remote`** (Luồng A/C): submit qua `remote-runner-cli.mjs --server ... --project ...`.
   - Lệnh mẫu — xem section **Remote dashboard** cho đầy đủ flags.
   - Local runner đọc default runner từ `~/.dev-team-dashboard/runners.json`, enqueue job, gọi `RunnerProvider` (`claude-code-cli`).
   - Remote runner submit `POST /api/jobs?project=<id>`; server enqueue qua provider tương ứng (`claude-code-cli`, `claude-code-ssh`).
   - Nếu job `failed` và lỗi là runner disabled / CLI không tìm thấy / API unreachable → **fallback** spawn `step.agent` qua Task tool với cùng prompt (trừ khi `--no-fallback`).
   - Prompt phải chứa: task id, parent id nếu có, `step.skills`, `rule_category`, `rule_required`, fallback rule, artifact `step.produces`, **`knowledge_inputs`** (nếu có), `export_json`, artifact context hiện có.
3. Sau khi agent kết thúc, kiểm tra `qa.md`. Nếu file mới hoặc thay đổi, chuyển sang Q&A HITL.
4. Kiểm tra `step.produces` artifacts tồn tại và hợp lệ tối thiểu.
5. Nếu `export_json = true`, merge structured summary vào `pipeline-export.json` dưới `phases[step.export_key]`.
6. **Sync remote** nếu remote mode ON, `syncAfterStep` bật và `runnerMode=local` (Luồng B) — truyền `syncMessage` thành `--message` nếu có.
7. Xử lý `step.hitl` theo section bên dưới.
8. Chuyển sang step kế tiếp khi gate cho phép.

Không bỏ qua step chỉ vì tên step quen thuộc. Chỉ bỏ qua khi config hoặc subtask inheritance cho phép rõ ràng.

## Agent prompt template

Dùng template này khi spawn từng agent:

```text
Task: <step.agent> <task-id>

Context:
- Workspace: .dev-team-agent/tasks/<task-id>/
- State: .dev-team-agent/.dev-state/<task-id>.json
- Project rules: .dev-team-agent/project-rules.md
- Pipeline step id: <step.id>
- Step name: <step.name>
- Required artifacts: <step.produces>
- Export JSON: <true|false>
- Knowledge inputs: <step.knowledge_inputs or "none">

Instructions:
- Apply skills: <step.skills>
- If `knowledge_inputs` is non-empty: read each entry from `.dev-team-agent/knowledge/<id>.md` (id format `project/slug` or `system/slug`), inject a `## Knowledge inputs` section into the prompt with title + full markdown body per entry. Skip missing entries with a note.
- Apply project-rules section(s): <step.rule_category>
- If rule_required=true, treat missing rules as already validated by orchestrator.
- If rule_required=false and section is missing/empty, apply fallback skill: <step.rule_fallback_skill>.
- Write only the artifacts declared for this step unless a blocking question requires qa.md.
- If blocked by ambiguity, write qa.md using the Q&A format and stop.
- If Export JSON is true, return a concise structured summary for export_key=<step.export_key>.
```

## HITL gates

Supported `hitl.mode`:

- `none`: không có gate; chuyển step kế.
- `auto`: tự duyệt; nếu có `optional_doc_review` và `auto_review=true`, chạy HITL-doc trước khi chuyển step kế.
- `manual`: cập nhật `hitl_pending = gate_id`, rồi chờ human trừ khi đủ điều kiện auto doc-review không blocking.

Manual gate message:

```text
✅ <step.name> xong. Vui lòng đọc <produces> và xác nhận.
Gõ "approved" để tiếp tục, hoặc gửi feedback cần sửa.
<nếu optional_doc_review=true> Bạn có muốn chạy doc-reviewer không? (yes/no)
```

Nếu user gửi feedback cần sửa, gọi lại cùng `step.agent` với feedback và lặp gate.

Nếu `blocking: true`, luôn cần human approval dù `--auto-review` bật.

## Retry handling

Nếu `step.hitl.retry` tồn tại, chỉ áp dụng sau gate của step đó.

- Khi artifact hoặc human feedback còn điều kiện `retry.on` (ví dụ `must_fix`), tăng `review_round`.
- Nếu `review_round <= retry.max`, set `current_phase = retry.restart_from` và chạy lại từ step đó theo thứ tự config.
- Nếu vượt `retry.max`, dừng và báo user cần can thiệp thủ công.
- Khi không còn điều kiện retry, reset hoặc giữ `review_round` theo config; mặc định giữ để audit.

## Q&A HITL

Nếu agent tạo/cập nhật `.dev-team-agent/tasks/<task-id>/qa.md`:

1. Dừng pipeline ngay.
2. Đặt `hitl_pending = "qa"`.
3. Thông báo:

```text
⚠️ Agent có câu hỏi blocking. Vui lòng đọc .dev-team-agent/tasks/<task-id>/qa.md, điền Answer, rồi gõ "done".
```

Khi user xác nhận `done`, đọc lại state, set `hitl_pending = null`, spawn lại step có `id == current_phase`.

Q&A format:

```markdown
# Q&A — <task-id>

## Q1: <câu hỏi ngắn gọn>
**Context**: <vì sao cần hỏi>
**Options**:
- A: ...
- B: ...
**Answer**: <user điền>
```

## HITL-doc

Chỉ chạy khi gate có `optional_doc_review: true` và user chọn `yes`, hoặc khi `auto_review=true` và gate không `blocking`.

Procedure:

1. Set `hitl_pending = "hitl-doc"`.
2. Tăng `doc_review_round[<artifact-base>]`.
3. Validate `doc_reviewer.rule_category` nếu required.
4. Spawn `doc_reviewer.agent` với `--doc=<artifact-base>`.
5. Agent ghi `{doc}-po.md`.
6. Nếu PO rỗng/không có issue, tiếp tục pipeline.
7. Nếu PO có issue, gọi lại agent nguồn để sửa artifact gốc, rồi chạy doc-review lại theo giới hạn hợp lý hoặc chờ human nếu lặp.

## Subtask inheritance

Khi dùng `--subtask-of=<parent-id>`:

- Set `parent_task_id` trong state.
- Mặc định `inherit_from_parent = ["investigate.md", "design.md"]`, trừ khi per-task config khai khác.
- Trước step đầu, nếu artifact kế thừa chưa có trong subtask và tồn tại ở parent, copy vào `.dev-team-agent/tasks/<task-id>/` hoặc truyền path parent cho agent đọc.
- Nếu artifact kế thừa đã hợp lệ và step hiện tại chỉ sinh artifact đó, có thể skip step đó.
- Không ghi artifact vào workspace parent.

## Export JSON

Khi `export_json = true`, merge không phá dữ liệu cũ:

```json
{
  "task_id": "<task-id>",
  "version": 1,
  "phases": {
    "<export_key>": { "...": "structured summary" }
  }
}
```

Merge algorithm:

1. Nếu file tồn tại, đọc JSON hiện tại.
2. Cập nhật hoặc thêm `phases[step.export_key]` bằng summary mới nhất.
3. Ghi atomic nếu có thể: ghi file tạm rồi rename.
4. Không xoá key của phase khác.

## Completion

Khi chạy hết mọi step:

- Set `current_phase = "completed"` nếu cần dashboard đọc trạng thái cuối.
- Set `hitl_pending = null`.
- Báo hoàn tất và liệt kê artifact chính đã tạo theo `steps[].produces`.
- Nếu có PR artifact hoặc PR URL từ agent, đặt nó ở cuối phản hồi.

## Bundled references

- `assets/pipeline.default.yaml`: default pipeline 6 bước.
- `assets/pipeline.task-override.example.yaml`: ví dụ patch per-task.
- `assets/orchestrator-remote.example.json`: mẫu config remote dashboard.
- `assets/resolve-remote.mjs`: handshake — health + resolve projectId + cache `orchestrator-remote.json` (cc-plugin#39).
- `assets/dashboard-sync.mjs`: push `.dev-team-agent/` lên git + trigger server sync (Luồng B).
- `assets/remote-runner-cli.mjs`: submit job local hoặc remote API (Luồng A/B/C).
- Remote dashboard repo: [naut1402/agent-workflow](https://github.com/naut1402/agent-workflow) — docs tại `docs/deploy.md`, `docs/ssh-remote.md`, `docs/multi-env.md`. API resolve: agent-workflow#53.
