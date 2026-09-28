# MCP — vai client (dashboard gọi server khác)
← [`./README.md`](./README.md) (MCP — tài liệu chủ đề)

Dashboard **gọi** MCP server bên ngoài (playwright, serena…) để job của runner có thêm tool. Cấu hình ở tab **MCP** của Runner Config (`src/features/mcp/components/McpPanel.vue`).

🚫 Vai này **không liên quan** `bun run mcp` — đó là vai ngược lại (dashboard *làm* MCP server), ở [`server.md`](server.md).

---

## 1. Dùng khi nào

Khi một job cần tool không có sẵn trong CLI: điều khiển browser, đọc codebase bằng LSP, gọi một dịch vụ nội bộ… Bạn khai server ở tab **MCP**, chọn nó trong Connection, và runner sinh file cấu hình `mcpServers` riêng cho từng job (§7).

Không Connection nào bật MCP thì đường này **hoàn toàn không chạy** — argv của CLI không đổi và không file nào chạm đĩa.

---

## 2. Nơi lưu cấu hình

Store là `mcp-servers.json` dưới `registryHome()` (`src/features/mcp/business/registry.ts`).

- `registryHome()` mặc định `~/.dev-team-dashboard/`, override bằng biến môi trường `DEV_TEAM_DASHBOARD_HOME` (`src/backend/registry.ts`).
- Shape: `{ version, servers[] }` với `MCP_SERVERS_VERSION = 2`.
- File ghi mode **`0600`**: `env` / `headers` ở đây có thể là secret literal người dùng gõ tay. Đây là chỗ **duy nhất** trong repo persist secret dạng thô — `credentials.json` chỉ giữ ref, giá trị thật nằm trong `secret-vault.json` đã mã hoá.
- Record không hợp lệ bị **bỏ im lặng** lúc đọc: file registry là dữ liệu ngoài, không phải contract.

---

## 3. Trường cấu hình theo transport

Đúng **3** transport: `stdio` · `http` · `sse` (`MCP_TRANSPORTS`).

### 3.1 Trường chung

| Field | Kiểu | Bắt buộc | Ràng buộc |
|---|---|---|---|
| `id` | string | ✅ | `min(1)`; sanitise về `[a-zA-Z0-9_-]`, cắt **64** ký tự. Upsert chỉ nhận id **đã ở dạng canonical** |
| `label` | string | — | tối đa **128** ký tự; mặc định = `id` |
| `enabled` | boolean | — | mặc định `true`; server tắt thì job không nhận |
| `timeoutMs` | number | — | integer dương, trần `MCP_MAX_TIMEOUT_MS` = **600 000 ms**; mặc định `MCP_DEFAULT_TIMEOUT_MS` = **120 000 ms** |
| `lastCheck` | object | — | Tóm tắt lần *Kiểm tra kết nối* gần nhất: `at`, `ok`, `toolCount`, `toolNames`, `error?` |

**Sàn timeout `MCP_MIN_TIMEOUT_MS` = 5 000 ms cố ý KHÔNG áp ở API.** Schema `schemas/mcpServer.ts` chỉ có `.max()`, 🚫 không có `.min()` — bản ghi v1 có thể giữ giá trị dưới sàn của CLI, chặn ở endpoint là biến một cú bấm Lưu thành lỗi khó hiểu. Việc **kẹp về miền `[5s, 600s]` xảy ra lúc sinh file config** (`business/serialize.ts`, §7). 🚫 Đừng kết luận "API từ chối giá trị nhỏ" — nó nhận, rồi kẹp sau.

`lastCheck.toolNames` giữ tối đa **50** tên (`MCP_MAX_TOOL_NAMES`), mỗi tên cắt **120** ký tự; mô tả tool lưu lại cắt ở **200** ký tự (`MCP_MAX_TOOL_DESCRIPTION_LENGTH`).

### 3.2 `stdio`

| Field | Kiểu | Bắt buộc | Ràng buộc |
|---|---|---|---|
| `command` | string | ✅ | `min(1)`; rỗng ⇒ record bị loại |
| `args` | string[] | — | mặc định `[]` |
| `env` | Record<string, string> | — | Giá trị literal **hoặc** tham chiếu `env:NAME` (`MCP_ENV_REF_PATTERN` = `/^env:([A-Za-z_][A-Za-z0-9_]*)$/`) |
| `cwd` | string | — | **Chỉ dùng cho probe** — xem dưới |

⚠️ **`cwd` không đi vào file config.** Cấu hình `mcpServers` của Claude Code 🚫 **không có** khoá `cwd`; serializer bỏ qua nó và server con **kế thừa cwd của tiến trình `claude`**. Khai `cwd` khác workspace của job thì sinh một cảnh báo, không phải một hành vi.

### 3.3 `http` / `sse`

| Field | Kiểu | Bắt buộc | Ràng buộc |
|---|---|---|---|
| `url` | string | ✅ | `min(1)`; đi qua `assertMcpEndpoint` (§4) |
| `credentialId` | string \| null | — | Ref tới credential profile; giải lúc sinh file job |
| `authHeader` | string | — | mặc định `Authorization` (`MCP_DEFAULT_AUTH_HEADER`) |
| `authScheme` | string | — | mặc định `Bearer` (`MCP_DEFAULT_AUTH_SCHEME`) |
| `headers` | Record<string, string> | — | Như `env` của `stdio`: literal hoặc `env:NAME` |

Dialog gợi ý sẵn path khi đổi transport — `MCP_DEFAULT_HTTP_PATH` = `/mcp`, `MCP_DEFAULT_SSE_PATH` = `/sse`. Đây là tiện ích nhập liệu của `McpServerDialog.vue`, 🚫 không phải path server tự thêm.

---

## 4. Chốt endpoint

`assertMcpEndpoint` (`business/endpointGuard.ts`) chạy ở cả `upsertServer` lẫn `testServer` cho mọi transport khác `stdio`:

- **`https`** — chấp nhận **mọi host**.
- **`http`** — **chỉ** loopback / private: `isPrivateHostname(host)` hoặc một trong các literal `::1` · `[::1]` · `0.0.0.0`.
- Protocol khác, hoặc URL không parse được → ném `Error`, controller trả `400`.

> [!NOTE]
> <span style="color:#4493f8">Chốt này **cố ý không dùng `fetchUrlSafe`**: MCP server cục bộ (playwright, serena) chạy trên loopback qua `http` — đúng thứ `fetchUrlSafe` chặn. Nới `fetchUrlSafe` để lọt ca này sẽ mở bề mặt SSRF ở **mọi** call site khác của nó, nên bài toán được giải bằng một chốt riêng, hẹp.</span>

---

## 5. Secret và masking

Ba luật, áp cùng lúc:

1. **Mọi cấu hình trả về từ API đều mask** — `publicView` gọi `maskSecretValues`, thay giá trị `env` / `headers` bằng `MCP_MASK` = `***`.
2. **`***` gửi ngược lên là sentinel "giữ nguyên"** — `mergeMaskedSecrets` khôi phục giá trị từ bản đã lưu. Không có luật này thì một cú bấm bật/tắt là ghi đè secret thật bằng `***`. Khoá mang `***` mà bản cũ **không có** thì **bỏ hẳn**: không có gì để khôi phục, và ghi literal `***` xuống server con còn tệ hơn thiếu khoá.
3. **`env:NAME` 🚫 không bị mask** — đó là **tên biến**, không phải giá trị, và người dùng còn phải sửa được nó trên UI.

Thêm hai chi tiết:

- Chuỗi ngắn hơn **8** ký tự không được coi là secret khi mask log — chuỗi ngắn trùng ngẫu nhiên với text thường, mask vào là hỏng log.
- Nút *Kiểm tra kết nối* trên bản nháp đã đổi đích (`url` / `command` khác bản đã lưu) mà còn ô `***` thì bị **từ chối** kèm thông điệp rõ, 🚫 không âm thầm bỏ khoá: ghép theo mỗi `id` sẽ cho phép đổi `url` sang host của mình rồi đọc secret mà UI vẫn đang che.

---

## 6. API `/api/mcp-servers`

Đúng **4** route (`src/features/mcp/api.ts`):

| Method + path | Input | Output |
|---|---|---|
| `POST /api/mcp-servers/test` | `{ server, listTools? }` | `{ ok, serverInfo, tools, warnings, error, durationMs }` — probe thật, spawn tiến trình hoặc gọi mạng |
| `GET /api/mcp-servers` | — | `{ servers: McpServerConfig[] }`, đã mask |
| `POST /api/mcp-servers` | `{ server }` (hoặc body là chính server) | `{ saved: true, server }`, đã mask |
| `DELETE /api/mcp-servers` | query `?id=<id>` | `{ deleted: boolean, id }` — **idempotent**, id lạ vẫn `ok` |

**Event**: `upsertServer` / `deleteServer` phát `entity.updated` / `entity.deleted` cho entity `mcp-server`, **sau** mutation thành công.

⚠️ Payload **chỉ** `{ id, projectId: null }` — `env` / `headers` có thể chứa token, mà event đi thẳng vào `events.jsonl`.

*Kiểm tra kết nối* 🚫 **không** phát domain event (đó là phép đo, không đổi trạng thái nghiệp vụ) — chỉ ghi audit `detail: { action: 'test', ok }`. Nó cũng chỉ ghi `lastCheck` khi bản nháp còn trỏ đúng đích đã lưu.

---

## 7. Tiêu thụ ở runner

`prepareMcpConfigForJob` (`src/features/runner/business/providers/mcpJobConfig.ts`) sinh file `mcpServers` cho **từng job**:

- **Vị trí**: `registryHome()/mcp-runtime/job-<jobId>.json` — 🚫 **không** trong workspace người dùng. File chứa secret đã giải; nằm trong repo thì lọt `git status` của chính agent.
- **Quyền**: thư mục `0700`, file `0600` — `mode` set ngay lúc tạo chứ không `chmod` sau, vì chmod ở dòng kế tiếp vẫn để lại một cửa sổ file `0644` chứa token đã giải.
- **Truyền vào CLI**: `claude-code-cli.ts` thêm `--mcp-config <path>` **và** `--strict-mcp-config`. Cờ thứ hai là bắt buộc đi kèm — không có nó, job còn ăn thêm MCP từ cấu hình khác.
- **Dọn**: `dispose()` xoá file trong `finally` của job; `cleanupOrphanedMcpConfigs()` quét sạch lúc bootstrap cho ca dashboard bị kill giữa chừng.
- **`startupTimeoutSec`** chỉ ghi cho entry `stdio` (schema CLI gắn khoá này sau predicate `transport === 'stdio'`), kẹp về `[5, 600]` **giây** và làm tròn về số nguyên giây. Server không khai `timeoutMs` ⇒ 🚫 không khai khoá ⇒ CLI dùng mặc định 120s của nó.
- **Không Connection nào bật MCP** ⇒ hàm trả `null`, argv không đổi, 🚫 không file nào chạm đĩa. Mọi server được chọn đều rụng (tắt / đã xoá) cũng vẫn trả `null` để giữ đúng bất biến đó.

---

## 8. Giới hạn đã biết

- **Server bị tắt hoặc bị xoá sau khi Connection đã chọn** thì job chạy **thiếu tool**, và chỉ có một dòng cảnh báo trong log job: `mcp <id>: không tìm thấy hoặc đang tắt — job chạy không có server này`. 🚫 Job không fail.
- **`sanitiseMcpServerId` là ánh xạ nhiều-một** (`my.server` và `my server` cùng ra `myserver`). Upsert vì thế chỉ nhận id đã canonical — nếu không, tạo mới `my.server` khi `myserver` đã tồn tại sẽ xoá sổ cấu hình kia trong im lặng.
- **Migrate v1 → v2 bỏ `timeoutMs` dưới 120 000 ms.** Ở v1 trường này chỉ tác động nút *Kiểm tra kết nối*; ở v2 nó còn xuống `startupTimeoutSec` của job. Giữ lại giá trị v1 là im lặng rút thời gian khởi động của job — bỏ trường là trả về mặc định, không phải mất dữ liệu.
- **Mô tả tool lưu lại cắt 200 ký tự**, danh sách tên tool cắt 50 phần tử — `lastCheck` là tóm tắt, 🚫 không phải bản sao schema tool.
