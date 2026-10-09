# Runner — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho feature `src/features/runner/`. Chỉ ghi phần **không tự giải thích được qua tên file**: quirk, giới hạn đã biết, lý do giữ một hành vi trông như thừa. Khi sửa, đối chiếu lại với code thật.

---

## 1. Id runner / connection

- **Id suy từ tên** — FE dựng id bằng `slugify(tên)` (`RunnerDialog.vue`, `ConnectionDialog.vue`), backend chỉ sanitize (`sanitiseRunnerId`). Hai runner cùng tên ⇒ cùng id.
- **Tạo mới trùng id trả 409** — request mang `create: true` mà id đã có thì `upsertRunner` / `upsertConnection` trả `409` **trước** mọi side effect, không ghi đè im lặng. Request không mang `create` (sửa, caller lập trình) vẫn upsert như cũ.
- **409 chỉ chặn va chạm, không diệt nó** — cách triệt để là đổi id sang UUID kèm migration dữ liệu: #473.

## 2. `defaultRunnerId` có thể là giá trị suy ra

`loadRunners()` (`business/registry.ts`) không trả nguyên `defaultRunnerId` trong `runners.json`:

| Trên đĩa | Giá trị `loadRunners()` trả |
|---|---|
| Có, trỏ runner còn tồn tại | Đúng giá trị đó |
| Thiếu, hoặc trỏ runner đã xoá | `runners[0].id` — runner **đầu mảng**, không xét đủ điều kiện chạy AI |
| `runners` rỗng | `null` |

- **Vì sao giữ** — store tạo trước khi có `defaultRunnerId` chưa từng ghi field này. Bỏ dòng suy là những máy đó mất default và phải chọn lại một lần.
- **Không gây chạy sai runner vừa thêm** — runner mới luôn được `push` vào **cuối** mảng, nên `runners[0]` không thể là nó.
- **Hệ quả cho `resolveDefaultRunner`** — hai nhánh `unset` / `missing` không chạm được từ đĩa (giá trị đã được suy trước khi tới đây); chỉ store dựng tay trong test mới vào được.
- **Phơi bày thay vì sửa** — runner được suy ra mà không đủ điều kiện (tắt, mất connection, không phải họ AI) hiện qua `defaultRunnerIssue` của `GET /api/runners` và banner ở Runner Config; job không pin **không** tự rơi sang runner khác.
- **Lần ghi kế tiếp chốt giá trị suy xuống đĩa** — `upsertRunner` / `deleteRunner` lưu lại cả store vừa load, nên `runners[0]` được suy ra trở thành `defaultRunnerId` thật trong `runners.json`.
- **Chọn lại theo điều kiện chỉ ở hai ca** — xoá đúng runner đang là default (`deleteRunner`), hoặc thêm runner vào store đang rỗng (`upsertRunner`): khi đó lấy runner **đủ điều kiện chạy AI** đầu tiên.

## 3. Phân loại family của provider

`providerFamilyOf(providerId)` (`business/registry.ts`) quyết định runner nào chạy được agent (default AI, pin step, reader transcript). Thứ tự:

1. **`PROVIDER_CATALOG.family`** (`business/connections.ts`) — provider có sẵn.
2. **`family` provider tự khai** khi đăng ký qua `registerProvider`.
3. **Quy tắc theo id** `providerFamilyFromId` (`business/providers/agentCli.ts`) — chỉ cho id không có khai báo nào: `console-command` · đuôi `-api` ⇒ `ai-api` · id agent CLI có sẵn ⇒ `agent-cli` · còn lại ⇒ `console-command`.

- **FE dùng cùng thứ tự** — `familyOfProviderId` (`lib/runnerModelOptions.ts`) nhận catalog từ `GET /api/runners` (`providers`), rồi mới tới quy tắc theo id. Provider đăng ký runtime không có trong catalog FE nên ở FE nó rơi về quy tắc theo id.
- **Id lạ vẫn rơi về `console-command`** — runner mặc định dùng provider như vậy nhận `reason: 'not-ai'` và hiện banner, không im lặng chạy runner khác.

## 4. `jobQueue.ts` — stdout persist và stdout chức năng

- **`persistStdout`** — `jobs/<id>.json` không 0600 và lộ qua `GET /api/jobs`, nên mọi chỗ ghi `stdout` lên job dùng `result.maskedStdout` khi có. `foldProposalIntoScratch` và `tryDispatchOrchestratorDecision` phải nhận `result.stdout` thô: mask là split/join mù, cắt ngang artifact đang fold và dòng `ORCHESTRATOR_DECISION`.
- **`shouldPersistStdout`** — job `metadata.orchestratorJob` luôn persist stdout vì đó là kênh truyền `ORCHESTRATOR_DECISION`; bỏ đi thì connection `*-api` / `console-command` làm quyết định biến mất và pipeline đứng im.
- **`withStepSummary`** — `STEP_SUMMARY` của nút con đọc từ `result.stdout` đầy đủ, không từ `job.stdout` (có thể không persist, hoặc bị `CHAT_STDOUT_LIMIT` cắt mất phần đuôi). Không có tóm tắt thì không ghi field, để phía cha phân biệt được "nút con không in `STEP_SUMMARY`".

## 5. `jobQueue.ts` — `tryDispatchOrchestratorDecision`

- **Task `completed`** — dùng `resetPipelineStep` (`resetScope`/`deleteScope` = `'step'`), không dùng `jumpToPipelineStep`: jump chỉ dời `current_phase`, nhánh "heal phase kẹt" của `runTaskStep` thấy job `succeeded` cũ của step và đẩy phase vượt qua trước khi submit job. Reset đặt `last_reset_at` và chỉ xoá artifact của đúng step đó.
- **Import động sang `monitor`** — `readState`, `resetPipelineStep`, `runTaskStep` được `import()` động để tránh vòng import tĩnh runner → monitor (business index của monitor re-export runner); cùng mẫu với `usageCapture.ts`.
- **Không ném lỗi** — `runJob` gọi `resubmitPendingFeedback` ngay sau hàm này; lỗi lọt ra sẽ nuốt mất phản hồi đang xếp hàng.

## 6. `jobQueue.ts` — dọn rác khi module nạp

- **Chạy một lần lúc import** — `reapOrphanedRunningJobs`, `cleanupOrphanedMcpConfigs`, `cleanupOrphanedCursorMcpWorkspaces` bù cho `dispose()` không chạy được khi tiến trình bị kill.
- **Lý do an toàn** — file cấu hình MCP bỏ lại chứa token đã giải ở dạng plaintext; nhánh cursor còn để file trong repo người dùng kèm bản sao `.cursor/mcp.json` gốc của họ (ledger giữ đủ thông tin để hoàn tác). `cleanupOrphanedMcpConfigs` xoá sạch `job-*.json` không so mtime, vì không job nào của tiến trình mới dùng lại file của tiến trình cũ.

## 7. `jobQueue.ts` — `runJob` chọn runner

- **Tiền tố lỗi cố định** — thông điệp bắt đầu bằng `runner not found or disabled` vì FE/log khớp chuỗi này; chỉ nối thêm lý do phía sau.
- **Ghi lại `runnerId: runner.id`** — `job.runnerId` có thể trỏ runner đã xoá rồi rơi về default; Running Jobs, panel chat và vòng chat kế tiếp (kế thừa `parent.runnerId`) phải thấy runner thật sự chạy.

## 8. `jobQueue.ts` — `runJob` và session ledger

- **Ghi quyền sở hữu phiên lúc start** — nhánh `resume` gọi `recordSessionUsage` (không `forceNew`) ngay khi bắt đầu, để trong suốt lượt chạy ledger có entry mang `stepId` của node; ghi lúc xong thì lookup bắt nhầm entry `open` của node khác.
- **`sessionId` lên job trước khi CLI chạy** — chat tìm transcript live theo session id, còn ledger chỉ cập nhật sau khi job xong.

## 9. `jobQueue.ts` — `runJob` kết thúc job

- **Huỷ** — session + usage được ghi trước, rồi mới kiểm `status === 'cancelled'` và return (token đã tiêu kể cả khi huỷ); thiếu guard này thì `result.ok === false` do SIGTERM/abort ghi đè `cancelled` thành `failed`.
- **Advance trước `succeeded`** — `advancePipelineStepChain` chạy khi job còn `running`, để UI không submit run-step trên phase cũ giữa "job xong" và "phase đã đi". Lỗi chain không được chặn `saveJob` / `emit('job.finished')` (nằm trong `finally`) — UI lẫn orchestrator đều chờ tín hiệu này.
- **Ai được advance** — job chat-feedback không advance, trừ lượt `orchestratorResume` (lượt chạy lại của chính step đó); job `respawn` không bao giờ advance.

## 10. `jobQueue.ts` — `advancePipelineStepChain`

- **Orchestrator active thì dừng sau advance** — kiểm sau `advanceStepOnJobSuccess` (đặt trước thì orchestrator không nhận được `task.advanced` / `hitl.pending`). Dùng `awaitFlagSync` vì `submitJob` đọc lại cờ cache trong `assertStartAllowedSync`; cờ cũ chưa ghi kịp gây throw giữa chain.
- **Metadata một lượt** — `isChatFeedback`, `orchestratorDispatch`, `orchestratorResume` bị bỏ trước khi spread metadata sang job sau (cả ở `sendTaskFeedback`); mang sang là tắt advance cho cả chain hoặc cấp quyền start cho đường không xin.
- **Runner theo step** — mỗi step trong chain tự giải runner qua `resolveStepRunnerId(nextStep)`; kế thừa `job.runnerId` làm pin của một step lây sang mọi step sau.

## 11. `jobQueue.ts` — `sendTaskFeedback` / `resubmitPendingFeedback`

- **Bỏ qua job `orchestratorJob`** — khi tìm job đang bận (không thì chat với step bị xếp hàng suốt lúc orchestrator nghĩ) và khi chọn job cha (không thì phản hồi rơi vào session của orchestrator, lượt đó không advance và bị đọc như một quyết định rỗng).
- **Phiên mở theo step** — `hasOpenSession` chỉ tính entry `open` có `stepIds` chứa step của job cha, tránh hai node dùng chung một phiên CLI. Runner của job cha được giữ để resume đúng phiên; chỉ giải lại khi runner đó bị xoá/tắt, không xét eligibility.
- **Phản hồi từ cổng HITL** — `resubmitPendingFeedback` bỏ mục `source === 'gate'` khi orchestrator đang active: orchestrator tự quyết định gửi gì cho step bị reject, gửi tiếp là step nhận phản hồi hai lần.

## 12. `cursorMcpWorkspace.ts` — cấu hình MCP nằm trong workspace

- **`cursor-agent` không có cờ kiểu `--mcp-config`** — chỉ đọc `<cwd>/.cursor/mcp.json`, nên file chứa secret đã giải nằm trong repo người dùng suốt vòng đời job (khác nhánh claude, file nằm dưới `registryHome()`).
- **Trả lại nguyên trạng** — file `mcp.json` sẵn có được rename sang `.dashboard-backup-<jobId>` rồi khôi phục, không hợp nhất nội dung. `.cursor/.gitignore` (`*`) được tạo khi chưa có, vì `.cursor/` thường không nằm trong `.gitignore` của project.
- **Quyền** — chỉ `chmod 0700` thư mục `.cursor/` do chính lượt này tạo; thư mục sẵn có giữ nguyên mode vì `restoreWorkspace` không khôi phục mode được (chuỗi i18n `mcpWorkspaceFile` hứa điều này). Rào thật là `0600` trên `mcp.json`.

## 13. `cursorMcpWorkspace.ts` — khoá workspace và ledger

- **`acquireWorkspaceLock`** — `mkdir` không `recursive` (nguyên tử, ném `EEXIST`); lockfile thay vì `Map` để chặn được cả hai tiến trình dashboard và còn dấu vết khi tiến trình chết. Hai task cùng project chạy song song dùng chung `.cursor/`; không khoá thì A-start → B-start → A-dispose → B-dispose xoá mất file gốc và bỏ lại secret. Không giành được khoá thì không ghi gì, job chạy không MCP.
- **Ledger ghi trước khi chạm file** — entry `stage: 'locked'` ghi ngay sau khi giành khoá, entry `'written'` đầy đủ ghi trước khi rename/ghi; `kill -9` ở bất kỳ điểm nào cũng để lại dấu vết cho `cleanupOrphanedCursorMcpWorkspaces`. Ledger chỉ lưu `sha256`, không lưu nội dung (có secret).
- **Chỉ quên entry khi dọn sạch** — `dispose`, nhánh lỗi ghi và `cleanupOrphanedCursorMcpWorkspaces` giữ entry khi `restoreWorkspace` trả `false`. Bootstrap là đường duy nhất gỡ khoá treo sau `kill -9`.

## 14. `cursorMcpWorkspace.ts` — `restoreWorkspace`

- **Đảo ngược thứ tự ghi, mỗi bước bọc `attempt`** — idempotent (`dispose` và đường dọn mồ côi có thể cùng chạy trên một entry); dọn hụt một bước không chặn bước sau và không làm hỏng kết quả job.
- **Kiểm hash trước khi xoá** — chỉ xoá `mcp.json` khi `isOurConfig` (Cursor IDE có thể ghi lại file này giữa job). Rẽ theo `stage !== 'locked'`, không `=== 'written'`, để entry thiếu/lạ rơi về nhánh thận trọng. Hash lệch ⇒ `clean = false`: giữ `.gitignore`, không đè bản backup, giữ entry và `console.warn`.
- **Nhả khoá vô điều kiện, sau cùng** — rồi mới xoá `.cursor/` nếu chính lượt này tạo và thư mục đang rỗng.

## 15. `claude-code-cli.ts` — prompt của agent CLI

- **Prompt đi qua stdin, không qua argv** — `buildClaudeInvocation` / `buildCursorJsonInvocation` (`RunProcessOptions.stdinInput`): trên Windows phải `spawn(..., { shell: true })` để chạy shim `.cmd` (CVE-2024-27980), mà Node không quote argv khi `shell: true` nên cmd.exe tách prompt nhiều dòng và `claude -p` chỉ nhận token đầu. Mọi phần tử argv còn lại không chứa khoảng trắng.
- **`PATH_CONVENTION_PREAMBLE`** — cwd của CLI là thư mục task, không phải root repo; thiếu câu này model làm theo path `.dev-team-agent/tasks/<task-id>/…` trong hướng dẫn và ghi artifact sâu thêm một cấp.
- **`shouldSendAgentInstructions`** — chỉ bỏ system prompt khi resume và `metadata.isChatFeedback` (cùng agent). Không dựa vào `parentJobId`: field này lây sang step sau trong chain, mà step sau resume phiên của step trước lại chạy agent khác.

## 16. `claude-code-cli.ts` — cờ CLI và tiến trình con

- **`--strict-mcp-config` luôn đi kèm `--mcp-config`** — không có thì job nạp thêm MCP server cấu hình sẵn trên máy. Hệ quả: job điều phối chỉ có entry tự gắn sẽ không nạp MCP của `~/.claude.json` (job log ghi một dòng báo).
- **`--dangerously-skip-permissions` mặc định bật** ở nhánh claude-style — `-p` không TTY treo vĩnh viễn nếu Claude chờ hỏi quyền tool; chỉ tắt khi runner config đặt `false`. `resolveEffectiveFlags` bỏ `--bare` khi credential là `cli-session` (`--bare` chỉ nhận `ANTHROPIC_API_KEY`).
- **Windows** — `shell: true` nên `child.pid` là `cmd.exe`; `cancelJob` phải `taskkill /T` cả cây. `stdin` có handler `error` để EPIPE (CLI thoát trước khi đọc hết) không treo Promise.

## 17. `claude-code-cli.ts` — secret MCP trong log và kết quả

- **`try/finally` ôm toàn bộ phần sau khi chọn delivery** — kể cả lời gọi sinh file cấu hình và các nhánh return sớm, để `mcpHandle.dispose()` luôn xoá file 0600 chứa secret. Sinh file lỗi thì fail job, không chạy tiếp thiếu tool. Log chỉ ghi id server + đường dẫn, không ghi nội dung file.
- **Bộ lọc stream có trạng thái** — `createSecretStreamMasker` thay vì `maskLog` từng chunk (secret bị chia hai chunk sẽ lọt). Log trễ `max(len(secret)) - 1` ký tự nên `flushStream()` bắt buộc ở cả nhánh thành công lẫn lỗi, và gọi trước `describeResult`.
- **`error` và `stdout` của `ExecuteResult`** — `error` dựng từ stderr thô nên đi qua `maskLog` (`redactPayload` của events chỉ lọc theo tên khoá). `stdout` giữ thô cho đường chức năng; bản mask đi riêng ở `maskedStdout` (§4). Không mask thẳng `stdout`.

## 18. `claude-code-cli.ts` — job điều phối gọi lại dashboard

- **`buildChildEnv`** — job `orchestratorJob` nhận `DASHBOARD_ORCHESTRATOR_TOKEN` / `DASHBOARD_ORCHESTRATOR_BASE_URL` qua env, không qua argv/prompt: `curl` chạy từ tool Bash của CLI kế thừa env, model chỉ viết tên biến nên giá trị token không vào context/transcript.
- **`selfEntry` dùng đúng guard của `buildChildEnv`** — env không được bơm thì entry `null`; không có job mang tool `orchestrator_decide` mà thiếu token của nó.

## 19. `selfMcpConfig.ts` — `buildSelfMcpEntry`

- **`command: process.execPath`** — không dùng chuỗi `'bun'` vì job có thể chạy với PATH khác tiến trình dashboard. Entrypoint `mcp/stdio.ts` định vị tương đối từ module (nằm cạnh `src/` cả trong repo lẫn image Docker); không thấy thì trả `null`, và `resolveDecisionRoute` đọc `canAttachSelfMcp` nên prompt không dạy agent gọi tool không tồn tại.
- **`--mode=full` trên argv, `DEVTEAM_MCP_MODE` trong env** — `resolveMode` đọc argv trước env, nên mode không phụ thuộc CLI bên thứ ba có để `env` của entry thắng env kế thừa hay không. Thiếu `full` thì `orchestrator_decide` (access `write`) vắng khỏi `tools/list` và tuyến mcp hỏng im lặng.
- **`env` tối thiểu** — mọi giá trị env của entry stdio bị `collectSecretValues` coi là secret (heuristic dài ≥ 8 ký tự) và bị mask khỏi log job. Không khai `DEV_TEAM_ROOT` / `DEV_TEAM_DASHBOARD_HOME` (kế thừa qua `buildChildEnv`); chỉ hai biến token/base URL đổi tên nên phải khai.

## 20. `mcpJobConfig.ts` — file cấu hình MCP của job

- **`null` là đường mặc định** — không `ids` và không `extraServers` (hoặc mọi id đều rụng) thì `resolveJobMcpServers` trả `null`: argv CLI không đổi, không file nào chạm đĩa. Nhánh cursor (`cursorMcpWorkspace.ts`) dùng lại nguyên hàm này.
- **Vị trí và quyền** — `prepareMcpConfigForJob` ghi dưới `registryHome()/mcp-runtime/`, không trong workspace (file chứa secret đã giải). Ghi với `mode: 0o600` ngay lúc tạo (chmod sau để lại cửa sổ 0644), `tryChmod` là lưới khi file đã tồn tại; trên win32 vị trí trong hồ sơ người dùng mới là rào.
- **Entry tự gắn thắng và `names`** — `extraServers` ghi sau `ids` nên trùng khoá (so trên id đã sanitise) thì entry của dashboard thắng, kèm warning. `names` hiển thị id người dùng gõ chứ không phải khoá đã sanitise, mỗi entry thật trong file một tên, để khớp tab MCP.

## 21. `agenticApiProvider.ts` — sandbox tool của provider API

- **Không ra ngoài workspace** — mọi file-op đi qua `resolvePathUnder(workspace, …)`; đây là bất biến an toàn, không phải thiếu sót. Vì vậy `buildProjectContextPreamble` nhúng sẵn `AGENTS.md` / `CLAUDE.md` ở project root (cắt theo `PROJECT_CONTEXT_FILE_LIMIT`) vào system prompt thay vì để model đọc qua tool.
- **Extra tools** — `run_command` chỉ nhận binary trong `SHELL_ALLOWLIST`, argv array, không shell; allowlist chỉ gồm binary mà image `docker/Dockerfile` bảo đảm có, vì danh sách vào thẳng tool description (bin project-local gọi qua `npx`). `search_files` so chuỗi con, không regex (tránh ReDoS). `fetch_url` / `web_search` đi qua `fetchUrlSafe`; git tools chỉ đọc.
- **Preamble tool** — `buildToolUsagePreamble` tuyên bố danh sách là duy nhất; tool MCP của bridge bắt buộc phải liệt kê ở đây, nếu không model được bảo là chúng không tồn tại và sẽ không gọi.

## 22. `agenticApiProvider.ts` — `execute`

- **MCP bridge** — mở trước vòng hội thoại và `close()` trong `finally` của cùng khối: transport stdio là tiến trình con, một đường thoát quên đóng là rò tiến trình theo từng job. Mở hụt chỉ ghi warning, job vẫn chạy (mất tool).
- **Lịch sử khi lỗi** — `AgenticRunError.partialMessages` được lưu (chỉ khi khác rỗng, tránh đè session đã có bằng `[]`) để resume không bắt đầu từ phiên rỗng; buffer assistant được flush trước để không mất turn đang stream dở.

## 23. `sessionLedger.ts` — mỗi node một phiên

- **Đọc permissive, ghi strict** — `findOpenEntry` (đường đọc của `resolveSessionPlan`): có `stepId` thì chỉ nhận entry của node đó, không có thì entry `open` mới nhất (chat cấp task, nl-chat, job ad-hoc). `findOwnedOpenEntry` (đường ghi của `recordSessionUsage`): chỉ entry caller sở hữu — chứa `stepId`, hoặc entry vô chủ / đúng `sessionId` khi không có `stepId`; không thấy thì tạo entry mới, không mượn entry `open` của node khác (đó là cách `sessionId` của nút điều phối bị job step ghi đè).
- **`forceNew` / `staleReason` chỉ đóng phiên của chính node** — đối xứng với `findOwnedOpenEntry`: có `stepId` thì chỉ chạm entry cùng node, không có thì chỉ chạm entry vô chủ. Quét chéo sẽ đóng luôn phiên của nút điều phối khi một step respawn.
- **`sanitizeLedger`** — entry `open` vừa mang `ORCHESTRATOR_STEP_ID` vừa mang step khác bị đánh `stale` (`MIXED_SESSION_REASON`) chỉ trong bộ nhớ: `loadTaskSessionLedger` là hàm đọc thuần dùng ở nhiều nơi, trạng thái sạch được ghi ở lần `recordSessionUsage` kế tiếp.

## 24. `sessionLedger.ts` — `buildCursorJsonInvocation`

- **Prompt qua stdin** — cùng lỗi tách argv khi `shell: true` trên Windows như nhánh claude (§15); cursor nhận prompt qua pipe với `-p` / `--print`.
- **Cờ headless mặc định** — `--sandbox disabled` (trong Docker/CI sandbox của Cursor thường không khởi động được, Shell lỗi "Sandbox mode is enabled but not available on this system"; cô lập là việc của container), `--force`, `--trust`. Mỗi cờ chỉ thêm khi người dùng chưa tự đặt.
- **`--approve-mcps` chỉ khi `mcpEnabled`** — headless cursor chờ phê duyệt từng MCP server tới khi timeout; job không bật MCP thì argv giữ nguyên từng byte.

## 25. `ConnectionDialog.vue` — hiển thị MCP theo provider

- **`mcpViaToolBridge`** — `mcpDeliveryOf` cố ý trả `'unsupported'` cho họ `ai-api` (tool MCP nạp qua `mcpToolBridge`, không qua file cấu hình). Câu hỏi của dialog là "bật có tác dụng không", nên `mcpUnsupported` so với `'unsupported'` (không so "khác `config-file-flag`", vì cursor dùng `workspace-config-file`) rồi trừ họ `ai-api`.
- **`mcpWorkspaceFile`** — với cursor, người dùng phải thấy trước khi bật: file cấu hình nằm trong repo suốt job, và `--approve-mcps` ghi vào `~/.cursor` một tác dụng phụ sống sau job.
- **`mcpChoices` giữ id đã tắt/xoá** — lọc đi thì người dùng không bỏ chọn được, mà `save` vẫn ghi lại nguyên si và job chạy thiếu tool.

## 26. `ConnectionDialog.vue` — lưu connection `ai-provider`

- **Connection tự chứa** — `providerId`, `credentialId`, `baseURL` được chép từ provider config vào Connection để execution plane không phải đọc provider config; `config.providerConfigId` chỉ để UI nhớ liên kết.
- **`config.model` song song `config.models`** — provider wrapper đọc `model` (phần tử đầu), nên dialog vẫn ghi cả hai.
- **`secretRefPlaceholder` chỉ là placeholder** — điền sẵn giá trị gợi ý thì không phân biệt được "ô để trống" với "ô đã điền đúng gợi ý".

## 27. `registry.ts` — runner store

- **`create: true` chặn trùng id trước mọi tác dụng phụ** — chỉ dialog "tạo mới" của FE gửi cờ này; caller lập trình (test, migration) giữ upsert-merge. Id suy từ slugify tên nên trùng tên là trùng id; guard đặt trước `ensureLegacyConnection` (có ghi đĩa) để 409 là no-op hoàn toàn. `upsertConnection` dùng cùng cờ — ở đây ghi đè còn nguy hiểm hơn vì connection trùng slug đổi hẳn provider/model/credential mà runner mặc định thật sự chạy.
- **`resolveStepRunnerId` so id thô với bản đã sanitise** — `getRunner` sanitise bên trong, nên id rác như `gem.ini` sẽ khớp nhầm `gemini`, và id dài hơn 64 ký tự bị cắt rồi khớp sang runner khác.
- **`loadRunners` bỏ UTF-8 BOM** — `runners.json` sửa tay bằng PowerShell `Set-Content -Encoding utf8` có BOM; không bỏ thì parse lỗi và danh sách runner rỗng trong im lặng.

## 28. `mcpToolBridge.ts` — tool MCP cho họ `ai-api`

- **Dashboard chính là vòng tool-use** — không có CLI ở giữa, nên `openMcpToolBridge` tự mở client MCP, khai tool với SDK và route lời gọi. Bridge mở ở `AgenticApiProvider.execute` (§22) để mọi job `ai-api` dùng chung một chỗ `close()`.
- **Secret của credential** — `resolveCredentialSecret` giải y hệt đường CLI (`secretFor` trong `mcpJobConfig.ts`) và truyền vào `openMcpSession({ secret })`; thiếu thì `resolveHeaders` bỏ hẳn header xác thực, server trả 401 và model mất sạch tool. Secret này cũng vào danh sách mask của thông điệp lỗi (server từ xa hay vọng lại token trong body 401).
- **Mask và không ném** — kết quả tool đi vào log job và `messages` được persist nên `maskDeep` thay secret trước khi trả; `call` không bao giờ ném (lỗi thành `is_error` cho model), một server mở hỏng chỉ mất tool của nó. Tên tool `mcp__<key>__<tool>` chống trùng với tool sandbox và giữa các server.

## 29. `openai-compatible-api.ts` / `anthropic-compatible-api.ts` — quirk của endpoint

- **Không dùng `@openai/agents`** — converter Chat Completions của SDK đó gửi field ngoài spec ở request tiếp theo (`type`/`function` của tool_call dàn phẳng lên message assistant, `strict: true` chỉ OpenAI có); backend OpenAI-compat chặt như Gemini từ chối, hỏng mọi turn gọi tool sau turn đầu. Vòng tool-use chạy thẳng trên SDK `openai`, message assistant được dựng lại chỉ với field đúng spec.
- **Gateway trả 200 kèm `error`** — một số gateway OpenAI-compat (vd OpenRouter free-tier khi quá tải) trả `200 OK` có field `error` và không có `choices`; SDK không ném nên phải kiểm `error` trước khi đọc `choices[0]`.
- **Anthropic không nhận message assistant rỗng** — API từ chối mọi message không-cuối có content rỗng, nên nhánh nhắc lại (`EMPTY_REPLY_NUDGE_TEXT`) không push lượt trả lời rỗng của model vào `messages`.

## 30. `RunnerConfigPanel.vue` — runner mặc định

- **`effectiveDefaultRunnerId` phân biệt vắng mặt với `null`** — `undefined` (payload cũ chưa có trường dẫn xuất) rơi về `defaultRunnerId`; `null` (BE báo không runner nào chạy được) phải để trống, không gộp bằng `??`, nếu không ngôi sao vẫn sáng trên runner mà job sẽ fail. Giá trị này điều khiển cả ngôi sao lẫn `:disabled` của nút đặt default, để người dùng bấm lại được chính runner đó sau khi sửa.
- **`uniqueRunnerId`** — cắt base trước khi nối hậu tố `-copy[-n]`, vì `sanitiseRunnerId` cắt ở 64 ký tự sẽ cắt mất hậu tố và trùng id trở lại.
- **Tab dùng `v-if`, không `v-show`** — chưa mở tab MCP thì không gọi `/api/mcp-servers`. `.runner-config` là gốc nội dung tab Runner mà e2e bám vào.

## 31. `usageCapture.ts` / `claudeUsageTranscript.ts` — ghi token usage

- **Import động `jobQueue.js`** — `jobQueue.ts` import tĩnh `usageCapture.ts`; import tĩnh chiều ngược lại tạo vòng khởi tạo module.
- **`listNewSubagentFiles` nhận cả đường dẫn đầy đủ** — cursor usage cũ trong session ledger lưu full path của file `agent-*.jsonl` thay vì basename, nên phải bỏ qua cả hai dạng.

## 32. `controller.ts` — `POST /api/jobs`

- **Là một đường start step đầy đủ** — route spread nguyên `metadata` của caller, nên job có `pipelineStepId` phải qua cùng cửa quyền `assertStartAllowed` như run-step/chain/automation.
- **Áp `steps[].runner_id`** — giống các đường start step khác (caller truyền `runnerId` thì thắng pin); thiếu thì cùng một pipeline chạy ra model khác nhau tuỳ ai bấm nút.
