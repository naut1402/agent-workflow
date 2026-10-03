# MCP server — vai inbound
← [`./README.md`](./README.md) (MCP — tài liệu chủ đề)

Dashboard **làm** MCP server: Claude Code spawn `bun run mcp` qua stdio và gọi vào bộ tool đọc project / task / artifact / knowledge, cộng 3 tool ghi khi mở mode `full`. Vai ngược lại — dashboard **gọi** MCP server khác — ở [`client.md`](client.md), không liên quan file này.

Nguồn của mọi con số trong trang này là code: `mcp/modes.ts` · `mcp/schemas.ts` · `mcp/envelope.ts` · `mcp/server.ts` · `mcp/tools/tasks.ts`.

---

## 1. Bảng tool

| Tool | Mode | Input | Output | Chi tiết |
|---|---|---|---|---|
| `list_projects` | mọi mode | `{}` | `{ projects, defaultId }` | [§4.1](#41-list_projects) |
| `get_project` | mọi mode | `{ id }` | `{ project }` | [§4.2](#42-get_project) |
| `get_knowledge_bundle` | mọi mode | `{ ids, project? }` | `{ bundle }` | [§4.3](#43-get_knowledge_bundle) |
| `list_tasks` | mọi mode | `{ project?, status?, limit? }` | `{ tasks, total }` | [§4.4](#44-list_tasks) |
| `get_task_state` | mọi mode | `{ taskId, project? }` | `{ state }` | [§4.5](#45-get_task_state) |
| `get_task_context` | mọi mode | `{ taskId, project?, include? }` | `{ taskId, task, request, pipeline, artifacts, subtasks, state, rules }` | [§4.12](#412-get_task_context) |
| `list_artifacts` | mọi mode | `{ taskId, project? }` | `{ artifacts, subtasks }` | [§4.6](#46-list_artifacts) |
| `read_artifact` | mọi mode | `{ taskId, name, project? }` | `{ name, content, mtime }` | [§4.7](#47-read_artifact) |
| `add_project` | chỉ `full` | `{ path, name? }` | `{ project }` | [§4.8](#48-add_project) |
| `remove_project` | chỉ `full` | `{ id }` | `{ removed: true }` | [§4.9](#49-remove_project) |
| `create_qa` | chỉ `full` | `{ taskId, questions, project? }` | `{ ok, path, created }` | [§4.10](#410-create_qa) |

---

## 2. Chạy và khai báo ở client

### 2.1 Chạy

```bash
bun run mcp
```

- Script `mcp` trỏ `mcp/server.ts` (`package.json`).
- Transport là **stdio** — 🚫 không cần HTTP server của dashboard chạy. MCP server thao tác thẳng trên `projects.json` dùng chung với REST.
- Dòng banner lúc khởi động ghi ra **`stderr`**, 🚫 không phải `stdout` (`stdout` là kênh JSON-RPC của stdio transport, một dòng log lạc vào đó hỏng cả phiên):

  ```text
  [dev-team-dashboard mcp] mode=<mode> version=<APP_VERSION>
  ```

### 2.2 Khai `mcpServers`

```json
{
  "mcpServers": {
    "dev-team-dashboard": {
      "command": "bun",
      "args": ["run", "mcp"],
      "cwd": "/duong/dan/toi/agent-workflow",
      "env": { "DEVTEAM_MCP_MODE": "full" }
    }
  }
}
```

- `env` là chỗ đặt mode. `--mode=<x>` trên argv **ghi đè** `env` — xem §3.
- Root của project resolve theo thứ tự (`src/backend/registry.ts` `resolveProjectRoot`): (1) entry `default: true` trong registry → (2) env `DEV_TEAM_ROOT` → (3) không có ⇒ `not_found` kèm thông điệp ở [§4.11](#411-thiếu-project-mặc-định). Khai `project` tường minh thì bỏ qua cả chuỗi này.
- `DEV_TEAM_DASHBOARD_HOME` đổi nơi đặt registry (`~/.dev-team-dashboard/` → path khác), 🚫 không phải đổi root của project.

### 2.3 Bật tool ghi — `DEVTEAM_MCP_MODE=full`

> [!CAUTION]
> <span style="color:#e5534b">`create_qa` nằm trong `WRITE_TOOLS` (`mcp/modes.ts`) nên **vắng mặt hoàn toàn** ở mode mặc định `readonly`.</span>
> <span style="color:#e5534b">🚫 **Không chỗ nào trong `src/` đặt `DEVTEAM_MCP_MODE`** — dashboard **không** tự bật `full` khi spawn agent của chính nó. Chạy pipeline agent thì phải tự khai `env` như §2.2.</span>
> <span style="color:#e5534b">Triệu chứng khi quên: agent được `docs/template/agents/*` dạy gọi `create_qa` nhưng `tools/list` không có tool này; `instructions` ở mode `readonly` ([§3.1](#31-instructions)) bảo agent báo `BLOCKED` kèm câu hỏi trong kết quả trả về.</span>

Dòng cảnh báo để `grep` trong log job (`mcp/server.ts`, ghi **`stderr`**):

```text
[dev-team-dashboard mcp] mode=<mode>: create_qa KHÔNG được đăng ký, nhưng docs/template/agents/* hướng dẫn agent gọi nó. Đặt DEVTEAM_MCP_MODE=full nếu chạy pipeline agent.
```

Điều kiện phát cảnh báo bám `isToolEnabled(mode, 'create_qa')` chứ không bám tên mode — thứ đang cảnh báo là "tool không được đăng ký".

---

## 3. Mode vận hành

| Mode | Tool được đăng ký |
|---|---|
| `readonly` (mặc định) | 8 tool đọc — `list_projects` · `get_project` · `get_knowledge_bundle` · `list_tasks` · `get_task_state` · `get_task_context` · `list_artifacts` · `read_artifact` |
| `full` | 8 tool trên + 3 tool ghi — `add_project` · `create_qa` · `remove_project` |

> ⚠️ **Nâng từ 1.1.x**: mặc định đổi thành `readonly`, nên `add_project` / `create_qa` / `remove_project` biến khỏi `tools/list` nếu không khai gì. Riêng `create_qa` là tool mà template agent của 1.1.8 được dạy gọi — ở mặc định mới agent sẽ **không nhìn thấy** nó. Giữ hành vi cũ bằng `"env": { "DEVTEAM_MCP_MODE": "full" }` trong entry `mcpServers` của client (§2.2).

- **Mặc định là `readonly`** — `DEFAULT_MODE` (`mcp/modes.ts`). An toàn theo mặc định; `full` phải bật chủ động.
- **Biến môi trường**: `DEVTEAM_MCP_MODE` (`MODE_ENV_VAR`).
- **Thứ tự ưu tiên**: CLI `--mode=<x>` (hoặc `--mode <x>`) → env `DEVTEAM_MCP_MODE` → `readonly`.
- **CLI sai KHÔNG rơi ngược về env.** Giá trị không thuộc `MCP_MODES` — kể cả chuỗi rỗng và sai hoa thường — chỉ sinh một dòng cảnh báo ra `stderr` rồi lùi về `readonly`. Một lỗi gõ phím không được lặng lẽ nâng quyền lên `full`. Ngược lại, **không khai `--mode`** thì mới rơi về env: `parseModeArg` trả `null` khi vắng flag và chuỗi rỗng khi có flag mà thiếu giá trị.
- **Lọc ở khâu đăng ký**, không phải lúc gọi (`mcp/server.ts`): tool ngoài quyền **biến khỏi `tools/list`**. Agent không thấy thì không thử, không tiêu token, và bề mặt tấn công thu nhỏ thật — 🚫 không phải hiện ra rồi bị từ chối lúc gọi.
- `isToolEnabled` là **allowlist**, không phải denylist: tên lạ luôn `false`.

### 3.1 `instructions`

Server trả `instructions` trong kết quả `initialize`, sinh bởi `buildServerInstructions(mode)` (`mcp/server.ts`).

| Mode | Nội dung |
|---|---|
| `readonly` | Câu "có tool tương đương thì gọi nó thay vì Bash" + 1 dòng cho mỗi nhóm `get_task_context` · `read_artifact`/`list_artifacts` · `get_task_state`/`list_tasks` · `get_knowledge_bundle` + câu "`create_qa` KHÔNG có ở mode `readonly` — báo `BLOCKED`, không tự viết `qa.md`" |
| `full` | Như `readonly`, thay câu cuối bằng dòng `create_qa` |

- **Danh sách tool** lấy từ `TOOL_HINTS`, lọc qua `isToolEnabled(mode, …)`.
- **Template `docs/template/agents/*`** không liệt kê tool MCP — chỉ gọi tên tool ở bước cần dùng (vd `create_qa`).

---

## 4. Tham chiếu từng tool

Mỗi tool gồm 5 phần: mô tả · bảng input · output · mã lỗi thực sự phát ra trong handler của chính nó · annotations nguyên văn.

### 4.1 `list_projects`

Liệt kê mọi workspace dev-team đã đăng ký trong project registry của dashboard.

| Field | Kiểu | Bắt buộc | Ràng buộc | Mô tả |
|---|---|---|---|---|
| — | — | — | — | Input rỗng `{}` |

- **Output** — `{ projects: ProjectOut[], defaultId: string | null }`. Có `outputSchema`.
- **Mã lỗi** — không phát mã nào.
- **Annotations** — `{ readOnlyHint: true, openWorldHint: false }`

`ProjectOut` **nới lỏng có chủ đích**: chỉ `id` / `name` / `path` bắt buộc, `kind` / `addedAt` / `default` optional, và schema `.passthrough()` cho field thừa. Lý do: `list_projects` là tool discovery **duy nhất** — một entry `projects.json` sửa tay thiếu field mà làm nó ném `McpError` là khoá agent ra khỏi **toàn bộ** MCP, trong khi REST vẫn phục vụ đúng dữ liệu đó.

### 4.2 `get_project`

Lấy một project đã đăng ký theo `id`.

| Field | Kiểu | Bắt buộc | Ràng buộc | Mô tả |
|---|---|---|---|---|
| `id` | string | ✅ | `min(1)` | Project id lấy từ `list_projects` |

- **Output** — `{ project }`. Có `outputSchema`.
- **Mã lỗi** — `not_found` · `unknown project: <id>`.
- **Annotations** — `{ readOnlyHint: true, openWorldHint: false }`

### 4.3 `get_knowledge_bundle`

Đọc các entry knowledge theo id (`<scope>/<slug>`, ví dụ `global/coding-convention`). Dùng để giải đúng danh sách id khai ở `knowledge_inputs` của task.

| Field | Kiểu | Bắt buộc | Ràng buộc | Mô tả |
|---|---|---|---|---|
| `ids` | string[] | ✅ | tối đa **50** phần tử (`MAX_BUNDLE_IDS`) | Danh sách entry id cần đọc |
| `project` | string | — | `min(1)` | Bỏ trống ⇒ project mặc định |

- **Output** — `{ bundle }`. 🚫 **Không** khai `outputSchema`, 🚫 **không** phát `structuredContent` — xem [§5.3](#53-ba-tool-không-phát-structuredcontent).
- **Mã lỗi** — `not_found` (qua `rootOrFail`: project lạ, hoặc không có project mặc định).
- **Annotations** — `{ readOnlyHint: true, openWorldHint: false }`

**Id hỏng không làm hỏng cả lời gọi.** Entry không đọc được trả về `{ id, error: 'not found' }` **trong** bundle, phần còn lại vẫn tới tay agent. Vượt trần kích thước bundle thì entry đó là `{ id, error: 'bundle size limit' }` — tổng byte cộng **sau** khi nhận từng entry, nên một entry to không đẩy mọi entry đứng sau nó vào lỗi.

### 4.4 `list_tasks`

Liệt kê task trong một workspace dev-team, kèm phase hiện tại và HITL gate đang chờ.

| Field | Kiểu | Bắt buộc | Ràng buộc | Mô tả |
|---|---|---|---|---|
| `project` | string | — | `min(1)` | Bỏ trống ⇒ project mặc định |
| `status` | enum | — | `running` · `waiting` · `completed` | Lọc theo status suy ra; `waiting` = có HITL gate đang chờ |
| `limit` | number | — | integer, **min 1**, **max 200**, **mặc định 50** | Số task trả về |

- **Output** — `{ tasks: [{ id, name, phase, hitlPending, updatedAt }], total }`; 4 field sau đều nullable, `updatedAt` là number. Có `outputSchema`.
- **Mã lỗi** — `not_found` (qua `rootOrFail`).
- **Annotations** — `{ readOnlyHint: true, openWorldHint: false }`

**`total` đếm SAU khi lọc `status`, TRƯỚC khi cắt `limit`** — agent cần biết còn bao nhiêu ngoài trang này. Ghi ngược thứ tự này là client phân trang sai mà không có gì báo.

**Sắp xếp**: mới nhất trước theo `updatedAt`; task chưa có state file (`updatedAt === null`) xuống cuối.

**Suy `status`**: `waiting` **thắng** `completed` — có `hitlPending` thì luôn là `waiting`, kể cả khi `phase === 'completed'`. HITL đang chờ là trạng thái người vận hành cần thấy.

### 4.5 `get_task_state`

Đọc file state máy đọc (`.dev-state/<taskId>.json`) của một task.

| Field | Kiểu | Bắt buộc | Ràng buộc | Mô tả |
|---|---|---|---|---|
| `taskId` | string | ✅ | 1–200 ký tự, regex `^(?!\.+$)[A-Za-z0-9._-]+$` | Task id lấy từ `list_tasks`, ví dụ `20260927_001` |
| `project` | string | — | `min(1)` | Bỏ trống ⇒ project mặc định |

- **Output** — `{ state }` (object). Có `outputSchema`.
- **Mã lỗi** — `invalid_input` (`taskId` sai khuôn · path thoát khỏi project root) · `not_found` (không có project mặc định · state file không đọc được · state file không phải JSON object).
- **Annotations** — `{ readOnlyHint: true, openWorldHint: false }`

Regex là **lớp phòng thủ thứ hai** cho path traversal, cộng thêm `resolvePathUnder`. `(?!\.+$)` loại `.` và `..` và mọi chuỗi toàn dấu chấm; lớp ký tự loại `/`, `\`, `%` nên không dựng được separator dưới mọi dạng mã hoá. Nó vẫn nhận mọi định dạng id đang dùng thật — `20260927_001` · `Tb4241005` · `auto-0bdc9595`.

### 4.6 `list_artifacts`

Liệt kê artifact markdown của một task (kể cả artifact known chưa được tạo) cộng danh sách thư mục subtask.

| Field | Kiểu | Bắt buộc | Ràng buộc | Mô tả |
|---|---|---|---|---|
| `taskId` | string | ✅ | như [§4.5](#45-get_task_state) | Task id |
| `project` | string | — | `min(1)` | Bỏ trống ⇒ project mặc định |

- **Output** — `{ artifacts: Record<string, { exists, mtime, size }>, subtasks: string[] }`. Có `outputSchema`.
- **Mã lỗi** — `invalid_input` (`taskId` sai khuôn · path thoát khỏi project root) · `not_found` (qua `rootOrFail`).
- **Annotations** — `{ readOnlyHint: true, openWorldHint: false }`

**Task chưa có thư mục artifact KHÔNG phải lỗi** — 🚫 không phát `not_found`. Nhưng nó cũng 🚫 **không** trả danh sách artifact known: `listArtifacts` thoát sớm ngay khi `readDir` ném, nên thứ đi ra là map **rỗng**. Agent phân biệt "task chưa có gì" với "task có artifact" qua chính việc map rỗng.

### 4.7 `read_artifact`

Đọc một file artifact của task (ví dụ `design.md`).

| Field | Kiểu | Bắt buộc | Ràng buộc | Mô tả |
|---|---|---|---|---|
| `taskId` | string | ✅ | như [§4.5](#45-get_task_state) | Task id |
| `name` | string | ✅ | `min(1)`, 🚫 **không chứa null byte** | Tên file artifact, ví dụ `design.md` |
| `project` | string | — | `min(1)` | Bỏ trống ⇒ project mặc định |

- **Output** — `{ name, content, mtime }`. 🚫 **Không** khai `outputSchema`, 🚫 **không** phát `structuredContent` — xem [§5.3](#53-ba-tool-không-phát-structuredcontent).
- **Mã lỗi** — `invalid_input` (`taskId` sai khuôn · `name` rỗng hoặc chứa null byte · path thoát khỏi thư mục task) · `not_found` (qua `rootOrFail` · artifact không tồn tại · không đọc được, ví dụ `name` trỏ vào một thư mục).
- **Annotations** — `{ readOnlyHint: true, openWorldHint: false }`

⚠️ `name` rỗng và null byte phát **`invalid_input`**, 🚫 không phải `not_found` — hai ca đó là input sai, không phải file vắng. Path thoát thư mục task (`name = '../../.dev-state/x.json'`) bị `resolveArtifact` chặn và cũng là `invalid_input`.

### 4.8 `add_project`

*(chỉ mode `full`)* Đăng ký một workspace dev-team vào registry. Thao tác idempotent.

| Field | Kiểu | Bắt buộc | Ràng buộc | Mô tả |
|---|---|---|---|---|
| `path` | string | ✅ | `min(1)`, **đường dẫn tuyệt đối** | Trỏ tới thư mục `.dev-team-agent`, hoặc project root chứa nó |
| `name` | string | — | — | Tên hiển thị; **mặc định = tên thư mục project** |

- **Output** — `{ project }`. Có `outputSchema`.
- **Mã lỗi** — `invalid_input` (business layer từ chối).
- **Annotations** — `{ idempotentHint: true, destructiveHint: false, openWorldHint: false }`

**Phát event SAU khi persist thành công**: `emitAudit({ op: 'create', entity: 'project' })` + `emitEntity('created', 'project')`. Nhánh lỗi ở trên 🚫 không phát gì.

### 4.9 `remove_project`

*(chỉ mode `full`)* Gỡ một project khỏi registry theo `id`.

| Field | Kiểu | Bắt buộc | Ràng buộc | Mô tả |
|---|---|---|---|---|
| `id` | string | ✅ | `min(1)` | Project id cần gỡ |

- **Output** — `{ removed: true }`. Có `outputSchema`.
- **Mã lỗi** — `not_found`.
- **Annotations** — `{ destructiveHint: true, idempotentHint: true, openWorldHint: false }`

🚫 **KHÔNG xoá file nào trên đĩa** — chỉ gỡ entry khỏi registry. Gỡ project đang là mặc định thì project còn lại kế tiếp (nếu có) được promote lên làm mặc định.

**Phát event SAU khi persist thành công**: `emitAudit({ op: 'delete', entity: 'project' })` + `emitEntity('deleted', 'project')`. Nhánh lỗi 🚫 không phát gì.

### 4.10 `create_qa`

*(chỉ mode `full`)* Tạo hoặc bổ sung câu hỏi blocking vào `qa.md` của một task, theo khuôn chọn-đáp-án chuẩn mà `QaPanel` render được thành radio. Đánh số tiếp từ block `Q` lớn nhất đang có.

| Field | Kiểu | Bắt buộc | Ràng buộc | Mô tả |
|---|---|---|---|---|
| `taskId` | string | ✅ | như [§4.5](#45-get_task_state) | Task id |
| `questions` | object[] | ✅ | **1–20** phần tử | Danh sách câu hỏi blocking |
| `questions[].prompt` | string | ✅ | `min(1)` | Nội dung câu hỏi |
| `questions[].choices` | string[] | ✅ | **2–10** phần tử, mỗi phần tử `min(1)` | Danh sách đáp án |
| `project` | string | — | `min(1)` | Bỏ trống ⇒ project mặc định |

- **Output** — `{ ok: true, path, created }`. Có `outputSchema`.
- **Mã lỗi** — `invalid_input` (`taskId` sai khuôn · `createQa` từ chối input) · `not_found` (qua `rootOrFail`).
- **Annotations** — `{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }`

Cùng gọi `createQa()` với `POST /api/tasks/:id/qa` nên hai đường không lệch khuôn `qa.md`.

### 4.11 Thiếu project mặc định

Mọi tool nhóm task đi qua `rootOrFail`. Khi không resolve được root và lời gọi **không** khai `project`, thông điệp tự nêu cách phục hồi:

```text
no default project — call list_projects, or set DEV_TEAM_ROOT / DEV_TEAM_DASHBOARD_HOME for this process
```

Khai `project` mà id lạ thì thông điệp là `unknown project: <project>`. Cả hai đều mang mã `not_found`.

### 4.12 `get_task_context`

Đọc toàn bộ context của một task trong **một** lượt gọi: `request.md`, pipeline (bước hiện tại + bước kế), danh sách artifact và machine state. Thay cho chuỗi `cd <task-dir> && cat request.md && cat pipeline.yaml && ls -la` đầu phiên — tool nhận `taskId` nên không cần `cd`, không cần biết cwd.

| Field | Kiểu | Bắt buộc | Ràng buộc | Mô tả |
|---|---|---|---|---|
| `taskId` | string | ✅ | như [§4.5](#45-get_task_state) | Task id |
| `project` | string | — | `min(1)` | Bỏ trống ⇒ project mặc định |
| `include` | enum[] | — | phần tử thuộc `request` · `pipeline` · `artifacts` · `state` · `rules` (`TASK_CONTEXT_SECTIONS`) | Thu hẹp phần trả về; **mặc định** `['request','pipeline','artifacts','state']` — `rules` là opt-in |

- **Output** — `{ taskId, task, request, pipeline, artifacts, subtasks, state, rules }`; section không được hỏi hoặc không đọc được là `null`. 🚫 **Không** khai `outputSchema`, 🚫 **không** phát `structuredContent` — xem [§5.3](#53-ba-tool-không-phát-structuredcontent).
  - `task` — `{ id, name, phase, hitlPending }`, `null` khi state không đọc được.
  - `pipeline` — `{ steps: [{ id, name, agent, produces }], currentStepId, nextStepId }`; `currentStepId` lấy từ `current_phase` của state. `pipeline.yaml` có mà không đọc được (`untrusted`) thì trả `null`, 🚫 không trả pipeline mặc định như thể là của task.
  - `request` — `{ name: 'request.md', mtime, content, truncated }`; `rules` — `{ name: 'project-rules.md', content, truncated }`. Nội dung cắt ở **64 KiB** ký tự (`TASK_CONTEXT_MAX_CHARS`) và `truncated` nói rõ có cắt hay không.
- **Mã lỗi** — `invalid_input` (`taskId` sai khuôn · `include` chứa section lạ · `project-rules.md` resolve — kể cả qua symlink — ra ngoài project root) · `not_found` (qua `rootOrFail`).
- **Annotations** — `{ readOnlyHint: true, openWorldHint: false }`

**Một section hỏng không làm hỏng cả lời gọi.** Các section đọc song song, mỗi nhánh tự nuốt lỗi của mình và về `null` — task chưa có `request.md` hay `pipeline.yaml` hỏng là trạng thái hợp lệ. `rules` mặc định tắt vì orchestrator đã tiêm `project-rules.md` vào prompt từng bước.

---

## 5. Hợp đồng kết quả (envelope)

### 5.1 Kết quả thành công

`ok()` trả **song song** `content[0].text` (payload đã `JSON.stringify(payload, null, 2)`) và `structuredContent` (`mcp/envelope.ts`):

```json
{
  "content": [{ "type": "text", "text": "{ …JSON… }" }],
  "structuredContent": { }
}
```

Giữ cả hai là cố ý: bỏ `content` là breaking — client cũ đang `JSON.parse` nó; còn tool nào khai `outputSchema` mà **thiếu** `structuredContent` thì SDK ném `McpError` runtime chứ không chỉ cảnh báo.

### 5.2 Kết quả lỗi và mã lỗi

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "unknown project: foo" }],
  "_meta": { "error": { "code": "not_found", "message": "unknown project: foo" } }
}
```

> [!CAUTION]
> <span style="color:#e5534b">Đường lấy mã lỗi là **`_meta.error.code`** — 🚫 **không** phải `structuredContent`.</span>
> <span style="color:#e5534b">Lý do: SDK 1.29.0 lệch nhau giữa hai phía. `server/mcp.js` miễn validate nhánh lỗi (`if (result.isError) return`), còn `client/index.js` chỉ hỏi `if (result.structuredContent)` mà **không** loại trừ `isError`. Đặt mã ở `structuredContent` làm mọi client đã gọi `tools/list` — Claude Code luôn gọi — ném `McpError -32602 Structured content does not match the tool's output schema`.</span>
> <span style="color:#e5534b">`_meta` nằm ở `Result` base của MCP và là `.passthrough()`, không bị đối chiếu với `outputSchema` ở bất kỳ phía nào.</span>

Mã lỗi **thực sự phát ra**:

| Mã | Khi nào |
|---|---|
| `not_found` | Project / task / artifact không tồn tại; không có project mặc định; state file không đọc được hoặc không phải JSON object |
| `invalid_input` | `taskId` sai khuôn; path thoát khỏi project root hoặc thư mục task; `name` rỗng hoặc chứa null byte; `add_project` / `create_qa` bị business layer từ chối |

Kiểu `McpErrorCode` (`mcp/envelope.ts`) còn khai **2 mã dự phòng chưa nơi nào phát ra**: `forbidden_in_mode` — không phát vì mode lọc ngay ở khâu đăng ký, tool ngoài quyền biến khỏi `tools/list` chứ không bị từ chối lúc gọi (§3) — và `internal`, hiện chỉ xuất hiện trong comment của `envelope.ts`. 🚫 Đừng viết client bám vào hai mã này.

### 5.3 Ba tool không phát `structuredContent`

Đúng **ba** tool: `get_knowledge_bundle`, `read_artifact` và `get_task_context`.

- **Hợp đồng cho client**: đọc `content[0].text` rồi `JSON.parse`.
- `structuredContent` là **khoá bị bỏ hẳn** khỏi object trả về — 🚫 không phải gán `undefined`.
- Ba tool này cũng cố ý 🚫 **không** khai `outputSchema`, nhất quán với bảng ở [§4.3](#43-get_knowledge_bundle), [§4.7](#47-read_artifact) và [§4.12](#412-get_task_context).
- Lý do: payload mang nội dung file — bundle có trần 1 MiB, nhân đôi qua stdio là 2 MiB cho một lời gọi.

8 tool còn lại phát đủ cả `content` lẫn `structuredContent`.

---

## 6. Ví dụ — nhóm tool task

**Thành công** — `tools/call` `list_tasks`:

```json
{
  "method": "tools/call",
  "params": { "name": "list_tasks", "arguments": { "status": "waiting", "limit": 5 } }
}
```

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"tasks\": [\n    {\n      \"id\": \"T56adaaa1\",\n      \"name\": \"Viết tài liệu công cụ MCP\",\n      \"phase\": \"implement\",\n      \"hitlPending\": \"design-review\",\n      \"updatedAt\": 1759046400000\n    }\n  ],\n  \"total\": 3\n}"
    }
  ],
  "structuredContent": {
    "tasks": [
      {
        "id": "T56adaaa1",
        "name": "Viết tài liệu công cụ MCP",
        "phase": "implement",
        "hitlPending": "design-review",
        "updatedAt": 1759046400000
      }
    ],
    "total": 3
  }
}
```

`total: 3` với `tasks` chỉ 1 phần tử là đúng hợp đồng: `total` đếm sau lọc `status`, trước khi cắt `limit` ([§4.4](#44-list_tasks)).

**Lỗi** — `tools/call` `get_task_state` với `taskId` sai khuôn:

```json
{
  "method": "tools/call",
  "params": { "name": "get_task_state", "arguments": { "taskId": "../secrets" } }
}
```

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "invalid task id: \"../secrets\"" }],
  "_meta": { "error": { "code": "invalid_input", "message": "invalid task id: \"../secrets\"" } }
}
```

Mã nằm ở `_meta.error.code`. Object trả về 🚫 không có khoá `structuredContent` nào để đọc mã ra ([§5.2](#52-kết-quả-lỗi-và-mã-lỗi)).

---

## 7. Giới hạn đã biết

- **Chỉ transport stdio.** HTTP / SSE chưa hỗ trợ ở vai server. (Vai client thì có — xem [`client.md`](client.md) §3.3.)
- **Thao tác ghi không tới SSE của dashboard.** `add_project` / `remove_project` **có** vào audit log và `events.jsonl` (`installEventLogSubscriber` chạy trong `main()`), nhưng event bus là **in-process** và MCP server là tiến trình khác với dashboard. Dashboard đang mở phải refresh tay.
- **Danh sách tool tồn tại ở nhiều bản sao.** Nguồn cho máy là `mcp/modes.ts`; nguồn cho người là trang này. Thêm / đổi / xoá một tool phải sửa [§1](#1-bảng-tool), §3 của trang này **và** bảng mode ở [`README.md`](README.md) của chủ đề; 🚫 không có test nào bắt được lệch. Root `README.md` 🚫 không chép bảng tool — chỉ trỏ về `docs/mcp/`.
