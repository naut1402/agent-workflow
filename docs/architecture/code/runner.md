# Runner — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho feature `src/features/runner/`. Chỉ ghi phần **không tự giải thích được qua tên file**: quirk, giới hạn đã biết, lý do giữ một hành vi trông như thừa. Khi sửa, đối chiếu lại với code thật.

---

## 1. Id runner / connection

- **Id suy từ tên** — FE dựng id bằng `slugify(tên)` (`RunnerDialog.vue`, `ConnectionDialog.vue`), backend chỉ sanitize (`sanitiseRunnerId`). Hai runner cùng tên ⇒ cùng id.
- **Tạo mới trùng id trả 409** — request mang `create: true` mà id đã có thì `upsertRunner` / `upsertConnection` trả `409` **trước** mọi side effect, không ghi đè im lặng. Request không mang `create` (sửa, caller lập trình: test, migration, automation) vẫn upsert như cũ.
- **Guard đặt trước `ensureLegacyConnection`** — hàm đó ghi đĩa, nên guard đặt sau sẽ để lại một connection mới rồi mới trả 409; 409 phải là no-op hoàn toàn.
- **Ở connection còn nguy hiểm hơn** — connection trùng slug đổi hẳn provider / model / credential mà runner mặc định thật sự chạy.
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

`providerFamilyOf(providerId)` (`business/providers/providerRegistry.ts`) quyết định runner nào chạy được agent (default AI, pin step, reader transcript). Thứ tự:

1. **`family` của bản dựng sẵn** — provider lắp ráp bằng `builtin(...)` trong `providerRegistry.ts`.
2. **`family` provider tự khai** khi đăng ký qua `registerProvider`.
3. **Quy tắc theo id** `providerFamilyFromId` (cùng file) — chỉ cho id không có khai báo nào: `console-command` · đuôi `-api` ⇒ `ai-api` · id agent CLI có sẵn ⇒ `agent-cli` · còn lại ⇒ `console-command`.

`transcriptFormatOf(providerId)` theo cùng thứ tự; id lạ họ `ai-api` ⇒ `agent-sdk`, còn lại ⇒ `none`.

- **FE dùng cùng thứ tự** — `familyOfProviderId` (`lib/runnerModelOptions.ts`) nhận catalog từ `GET /api/runners` (`providers`), rồi mới tới quy tắc theo id. Provider đăng ký runtime không có trong catalog FE nên ở FE nó rơi về quy tắc theo id.
- **Id lạ vẫn rơi về `console-command`** — runner mặc định dùng provider như vậy nhận `reason: 'not-ai'` và hiện banner, không im lặng chạy runner khác.

## 4. Bố cục `business/providers/`

| File | Vai |
|---|---|
| `RunnerProvider.ts` | «interface» `RunnerProvider` + `ProviderDescriptor`, `ProviderFamily`, `TranscriptFormat` — hợp đồng, không chứa chi tiết nhà cung cấp |
| `providerRegistry.ts` | Chỗ lắp ráp duy nhất: dựng provider, gắn cách giao MCP, đăng ký `CredentialResolver` cho `mcp`; tra cứu `getProvider` · `providerFamilyOf` · `transcriptFormatOf` · `listProviderCatalog` |
| `AbstractAgentCliProvider.ts` | Template method cho Agent CLI — hiện thực chỉ khai `buildInvocation` |
| `ClaudeCliProvider.ts` · `CursorCliProvider.ts` · `CodexCliProvider.ts` | Hiện thực Agent CLI |
| `ConsoleCommandProvider.ts` | Lệnh shell, `acceptsAgent: false`, mang `NoMcpDelivery` |
| `cliProcess.ts` | Spawn tiến trình con + dựng thông điệp lỗi — Agent CLI và console dùng chung |
| `providerJobReport.ts` | Ghi log job: header từ metadata, nhãn agent, footer kết quả, dò artifact — cả ba họ provider |
| `AgenticApiProvider.ts` (+ `agenticWorkspaceTools.ts`) | Vòng tool-use chung cho họ `ai-api` |
| `AbstractCompatibleApiProvider.ts` | Lớp cha của hai hiện thực API: constructor + catalog, `listModels`, timeout, toolset + system prompt |
| `AnthropicCompatibleProvider.ts` · `OpenAiCompatibleProvider.ts` | Hiện thực API theo giao thức |
| `agentTranscriptStore.ts` | Transcript runner tự ghi cho họ `ai-api`; đọc lại bằng `agentTranscriptFile()` |

Ngoài `providers/`: `jobRecords.ts` giữ đọc/ghi `JobRecord` (`loadJob` · `saveJob` · `mergeJobUsage` · `stepIdOf`) — `jobQueue.ts` và `usageCapture.ts` cùng dùng, nên hai file không import vòng nhau.

- **Thêm provider** = một file hiện thực + một dòng `builtin(...)` trong `providerRegistry.ts`; thứ tự các dòng `builtin(...)` là thứ tự catalog UI. FE đọc nhãn, kind, lệnh CLI từ `ProviderDescriptor` trong catalog.
- **Hợp đồng không mang chi tiết** — `RunnerProvider.ts` không chứa tên binary, env var, path hay tên nhà cung cấp; mỗi hiện thực tự khai qua các trường / hook.
- **Cổng của feature khác** — `providerRegistry.ts` đăng ký `RunnerCredentialResolver` vào cổng `useCredentialResolver` của `mcp` lúc nạp module; `mcp` không import `runner` (cạnh ngược là vòng import). Cách giao MCP lắp ở đây: [`docs/mcp/client.md`](../../mcp/client.md) §7.
- **Hook tuỳ chọn** — `listModels` (danh sách model), `captureUsage` (usage từ nguồn riêng, vd transcript CLI), `complete` (một lượt hỏi-đáp ngoài job, chỉ provider API), `transcriptFormat`.
- **Bù trường khi đăng ký** — `registerProvider` bù `family` / `acceptsAgent` / `mcpDelivery` (và hook của bản dựng sẵn cùng id) qua Proxy, không ghi lên object được đăng ký: stub test chép bằng `{ ...stub }` không mang theo giá trị suy của stub trước. Ưu tiên bản dựng sẵn cùng id (stub thay `claude-code-cli` vẫn ghi usage transcript), rồi mới tới luật theo id. `listModels` chỉ mượn khi bản dựng sẵn liệt kê tĩnh (`modelListing: 'static'`) — provider API thay thế phải tự gọi được endpoint của nó.

## 5. `jobQueue.ts` — stdout persist và stdout chức năng

- **`persistStdout`** — `jobs/<id>.json` không 0600 và lộ qua `GET /api/jobs`, nên mọi chỗ ghi `stdout` lên job (cả `metadata.stepSummary`) dùng `result.maskedStdout` khi có. `foldProposalIntoScratch` và `tryDispatchOrchestratorDecision` phải nhận `result.stdout` thô: mask là split/join mù, cắt ngang artifact đang fold và dòng `ORCHESTRATOR_DECISION`.
- **`shouldPersistStdout`** — job `metadata.orchestratorJob` luôn persist stdout vì đó là kênh truyền `ORCHESTRATOR_DECISION`; bỏ đi thì connection `*-api` / `console-command` làm quyết định biến mất và pipeline đứng im.
- **Chat đọc `JobRecord.stdout`, không đọc log job** — log còn chứa khung payload/prompt, không bao giờ được hiện như câu trả lời.
- **`withStepSummary`** — `STEP_SUMMARY` của nút con đọc từ stdout đầy đủ của lần chạy, không từ `job.stdout` (có thể không persist, hoặc bị `CHAT_STDOUT_LIMIT` cắt mất phần đuôi). Không có tóm tắt thì không ghi field, để phía cha phân biệt được "nút con không in `STEP_SUMMARY`".

## 6. `jobQueue.ts` — `tryDispatchOrchestratorDecision`

Cầu nối "chat → dispatch step": job chat-feedback thành công mà stdout có dòng `ORCHESTRATOR_DECISION` (chỉ dòng cuối cùng được tính) thì chuyển cho `runTaskStep` — lock / HITL / validate dùng lại nguyên.

- **Task `completed`** — dùng `resetPipelineStep` (`resetScope`/`deleteScope` = `'step'`), không dùng `jumpToPipelineStep`: jump chỉ dời `current_phase`, nhánh "heal phase kẹt" của `runTaskStep` thấy job `succeeded` cũ của step và đẩy phase vượt qua trước khi submit job. Reset đặt `last_reset_at` và chỉ xoá artifact của đúng step đó.
- **Import động sang `monitor`** — `readState`, `resetPipelineStep`, `runTaskStep` được `import()` động để tránh vòng import tĩnh runner → monitor (business index của monitor re-export runner).
- **Không ném lỗi** — `runJob` gọi `resubmitPendingFeedback` ngay sau hàm này; lỗi lọt ra sẽ nuốt mất phản hồi đang xếp hàng.

## 7. `jobQueue.ts` — dọn rác khi module nạp

- **Chạy một lần lúc import** — `reapOrphanedRunningJobs` và `cleanupOrphanedMcpDeliveries` bù cho `dispose()` / `finally` không chạy được khi tiến trình bị kill.
- **Lý do an toàn** — file cấu hình MCP bỏ lại chứa token đã giải ở dạng plaintext; nhánh cursor còn để file trong repo người dùng kèm bản sao `.cursor/mcp.json` gốc của họ. Từng cách giao dọn ra sao: §22, §26 và [`docs/mcp/client.md`](../../mcp/client.md) §7.

## 8. `jobQueue.ts` — `runJob` chọn runner

- **Tiền tố lỗi cố định** — thông điệp bắt đầu bằng `runner not found or disabled` vì FE/log khớp chuỗi này; chỉ nối thêm lý do phía sau.
- **Ghi lại `runnerId: runner.id`** — `job.runnerId` có thể trỏ runner đã xoá rồi rơi về default; Running Jobs, panel chat và vòng chat kế tiếp (kế thừa `parent.runnerId`) phải thấy runner thật sự chạy.

## 9. `jobQueue.ts` — `runJob` và session ledger

- **Ghi quyền sở hữu phiên lúc start** — nhánh `resume` gọi `recordSessionUsage` (không `forceNew`) ngay khi bắt đầu, để trong suốt lượt chạy ledger có entry mang `stepId` của node; ghi lúc xong thì lookup bắt nhầm entry `open` của node khác.
- **`sessionId` lên job trước khi CLI chạy** — chat tìm transcript live theo session id, còn ledger chỉ cập nhật sau khi job xong.

## 10. `jobQueue.ts` — `runJob` kết thúc job

- **Huỷ** — session + usage được ghi trước, rồi mới kiểm `status === 'cancelled'` và return (token đã tiêu kể cả khi huỷ); thiếu guard này thì `result.ok === false` do SIGTERM/abort ghi đè `cancelled` thành `failed`.
- **Advance trước `succeeded`** — `advancePipelineStepChain` chạy khi job còn `running`, để UI không submit run-step trên phase cũ giữa "job xong" và "phase đã đi". Lỗi chain không được chặn `saveJob` / `emit('job.finished')` (nằm trong `finally`) — UI lẫn orchestrator đều chờ tín hiệu này.
- **Ai được advance** — job chat-feedback không advance, trừ lượt `orchestratorResume` (lượt chạy lại của chính step đó, không advance thì pipeline đứng sau lần resume đầu); job `respawn` (phiên mới cho step đã xong) không bao giờ advance, kể cả khi `pipelineStepId` trùng `current_phase`.

## 11. `jobQueue.ts` — `advancePipelineStepChain` và `submitJob`

Job "run step" gắn `metadata.pipelineStepId` (và `metadata.chainTarget` khi người dùng bấm tới một node). Thành công thì `advanceStepOnJobSuccess` đẩy `current_phase` qua step không có gate, hoặc mở gate HITL. Chain tự chạy tiếp qua mọi step không gate; `chainTarget` chỉ làm nó dừng đúng ở đó. Gate HITL, step / agent lạ hoặc thiếu `request.md` luôn dừng chain.

- **Orchestrator active thì dừng sau advance** — kiểm sau `advanceStepOnJobSuccess` (đặt trước thì orchestrator không nhận được `task.advanced` / `hitl.pending`). Dùng `awaitFlagSync` vì `submitJob` đọc lại cờ cache trong `assertStartAllowedSync`; cờ cũ chưa ghi kịp gây throw giữa chain.
- **Metadata một lượt** — `isChatFeedback`, `orchestratorDispatch`, `orchestratorResume` bị bỏ trước khi spread metadata sang job sau (cả ở `sendTaskFeedback`); mang sang là tắt advance cho cả chain hoặc cấp quyền start cho đường không xin.
- **Runner theo step, phiên mới theo step** — mỗi step trong chain tự giải runner qua `resolveStepRunnerId(nextStep)` (kế thừa `job.runnerId` làm pin của một step lây sang mọi step sau) và chạy `sessionMode: 'new'`.
- **`submitJob` là lưới an toàn cuối cho quyền start** — guard thật là `assertStartAllowed` ở tầng async của từng call site; chạm tới `assertStartAllowedSync` mà bị chặn nghĩa là còn một đường start bị bỏ sót, nên nó ném lỗi thay vì lọc im lặng.

## 12. `jobQueue.ts` — `sendTaskFeedback` / `resubmitPendingFeedback`

- **Bỏ qua job `orchestratorJob`** — khi tìm job đang bận (không thì chat với step bị xếp hàng suốt lúc orchestrator nghĩ) và khi chọn job cha (không thì phản hồi rơi vào session của orchestrator, lượt đó không advance và bị đọc như một quyết định rỗng).
- **Xếp hàng chỉ cho task thật** — `queuePendingFeedback` chỉ thành công khi task có file `.dev-state`; nl-chat dùng chung hàm này nhưng không có, nên giữ lỗi `409 step already running` thay vì `queued: true` không bao giờ được gửi lại. Job vừa xong giữa lúc kiểm và lúc ghi hàng đợi thì lấy lại mục vừa xếp và gửi ngay.
- **`mode: 'immediate'`** — huỷ job đang chạy (chỉ khi cùng step, hoặc job đó không gắn step) rồi resume chính phiên của nó.
- **Chọn job cha theo step** — chat từ popover của step phải vào đúng phiên của step đó: ưu tiên job xong mới nhất của `opts.stepId`; `requireStepMatch` (orchestrator resume step chưa từng chạy) trả 400 thay vì rơi về job xong gần nhất. `agentRef` giải lại từ pipeline hiện hành, vì step có thể đã đổi agent.
- **Phiên mở theo step** — `hasOpenSession` chỉ tính entry `open` có `stepIds` chứa step của job cha, tránh hai node dùng chung một phiên CLI. Runner của job cha được giữ để resume đúng phiên; chỉ giải lại khi runner đó bị xoá/tắt, không xét eligibility.
- **Phản hồi từ cổng HITL** — `resubmitPendingFeedback` bỏ mục `source === 'gate'` khi orchestrator đang active: orchestrator tự quyết định gửi gì cho step bị reject, gửi tiếp là step nhận phản hồi hai lần.

## 13. `registry.ts` — runner store

- **`loadRunners` bỏ UTF-8 BOM** — `runners.json` sửa tay bằng PowerShell `Set-Content -Encoding utf8` có BOM; không bỏ thì parse lỗi và danh sách runner rỗng trong im lặng.
- **`resolveStepRunnerId` so id thô với bản đã sanitise** — `getRunner` sanitise bên trong, nên id rác như `gem.ini` sẽ khớp nhầm `gemini`, và id dài hơn 64 ký tự bị cắt rồi khớp sang runner khác.
- **Pin hỏng không fail cứng** — runner pin đã xoá / tắt / không phải runner AI thì trả `undefined` để `submitJob` rơi về runner mặc định: dọn danh sách runner không được làm đứng pipeline đang chạy. Log nằm trong `warnStepRunner` để mọi đường start cùng một thông điệp; log runner mặc định hỏng (`getDefaultRunner`) throttle theo cặp (id, reason) vì chạy ở mọi lần submit.
- **`setDefaultRunner` chỉ chặn provider tự khai `acceptsAgent: false`** — connection trỏ provider chưa đăng ký vẫn đặt được làm default (hành vi cũ), khác `defaultRunnerIssueOf`.

## 14. Agent CLI — prompt

- **Prompt đi qua stdin, không qua argv** — `buildClaudeInvocation` / `buildCursorJsonInvocation` trả `stdinInput`, `runCliProcess` ghi vào stdin rồi đóng. Trên Windows phải `spawn(..., { shell: true })` để chạy shim `.cmd` (CVE-2024-27980), mà Node không quote argv khi `shell: true` nên cmd.exe tách prompt nhiều dòng và `claude -p` chỉ nhận token đầu. Mọi phần tử argv còn lại không chứa khoảng trắng.
- **`PATH_CONVENTION_PREAMBLE`** (`AbstractAgentCliProvider.ts`) — cwd của CLI là thư mục task, không phải root repo; thiếu câu này model làm theo path `.dev-team-agent/tasks/<task-id>/…` trong hướng dẫn và ghi artifact sâu thêm một cấp.
- **`shouldSendAgentInstructions`** (`RunnerProvider.ts`) — chỉ bỏ system prompt khi resume và `metadata.isChatFeedback` (cùng agent). Không dựa vào `parentJobId`: field này lây sang step sau trong chain, mà step sau resume phiên của step trước lại chạy agent khác.

## 15. Agent CLI — cờ CLI và tiến trình con

- **`--strict-mcp-config` luôn đi kèm `--mcp-config`** — không có thì job nạp thêm MCP server cấu hình sẵn trên máy. Hệ quả: job điều phối chỉ có entry tự gắn sẽ không nạp MCP của `~/.claude.json`; `ConfigFlagMcpDelivery.extraServers` ghi một dòng log báo việc này.
- **Đường dẫn file chỉ vào argv khi `handle.kind === 'config-file-flag'`** — cách giao `workspace-config-file` dùng cùng kiểu handle nhưng CLI tự đọc theo cwd. `mcpDelivery` truyền cho provider phải khớp cách hiện thực dựng argv; provider dựng sẵn luôn khớp.
- **`--dangerously-skip-permissions` mặc định bật** ở `ClaudeCliProvider` — `-p` không TTY treo vĩnh viễn nếu Claude chờ hỏi quyền tool; chỉ tắt khi runner config đặt `false`. `effectiveFlags` bỏ `--bare` khi credential là `cli-session` (`--bare` chỉ nhận `ANTHROPIC_API_KEY`).
- **Windows** (`cliProcess.ts`) — `shell: true` nên `child.pid` là `cmd.exe`; `cancelJob` phải `taskkill /T` cả cây. `stdin` có handler `error` để EPIPE (CLI thoát trước khi đọc hết) không treo Promise.

## 16. Agent CLI — secret MCP trong log và kết quả

- **`try/finally` ôm toàn bộ phần sau khi chọn delivery** (`AbstractAgentCliProvider.execute`) — kể cả lời gọi sinh file cấu hình và các nhánh return sớm, để `mcpHandle.dispose()` luôn xoá file 0600 chứa secret. Sinh file lỗi thì fail job, không chạy tiếp thiếu tool. Log chỉ ghi id server + đường dẫn, không ghi nội dung file.
- **Bộ lọc stream có trạng thái** — `masker.stream()` thay vì mask từng chunk (secret bị chia hai chunk sẽ lọt). Log trễ `max(len(secret)) - 1` ký tự nên `flushStream()` bắt buộc ở cả nhánh thành công lẫn lỗi, và gọi ngay sau khi tiến trình kết thúc, trước footer kết quả.
- **`error` và `stdout` của `ExecuteResult`** — `error` dựng từ stderr thô nên đi qua mask (`redactPayload` của events chỉ lọc theo tên khoá, mà `error` chảy vào `jobs/<id>.json` và `job.failed`). `stdout` giữ thô cho đường chức năng; bản mask đi riêng ở `maskedStdout` (§5). Không mask thẳng `stdout`.

## 17. Agent CLI — job điều phối gọi lại dashboard

- **`buildChildEnv`** — job `orchestratorJob` nhận token + base URL của dashboard qua env (`SelfMcpServer.childEnv`), không qua argv/prompt: `curl` chạy từ tool Bash của CLI kế thừa env, model chỉ viết tên biến nên giá trị token không vào context/transcript.
- **Entry MCP tự gắn dùng cùng guard** — `SelfMcpServer.forJob` và `childEnv` đọc chung một guard: env không được bơm thì không có entry, nên không có job mang tool `orchestrator_decide` mà thiếu token của nó. Chi tiết entry: [`mcp.md`](mcp.md) §8.

## 18. `CursorCliProvider.ts` — `buildCursorJsonInvocation`

- **Prompt qua stdin** — cùng lỗi tách argv khi `shell: true` trên Windows như nhánh claude (§14); cursor nhận prompt qua pipe với `-p` / `--print`.
- **Cờ headless mặc định** — `--sandbox disabled` (trong Docker/CI sandbox của Cursor thường không khởi động được, Shell lỗi "Sandbox mode is enabled but not available on this system"; cô lập là việc của container), `--force`, `--trust`. Mỗi cờ chỉ thêm khi người dùng chưa tự đặt.
- **`--approve-mcps` chỉ khi job có MCP** — headless cursor chờ phê duyệt từng MCP server tới khi timeout; job không bật MCP thì argv giữ nguyên từng byte.

## 19. Provider API — sandbox tool

- **Không ra ngoài workspace** — mọi file-op của `agenticWorkspaceTools.ts` đi qua `resolvePathUnder(workspace, …)`; đây là bất biến an toàn, không phải thiếu sót. Vì vậy `buildProjectContextPreamble` nhúng sẵn `AGENTS.md` / `CLAUDE.md` ở project root (cắt theo `PROJECT_CONTEXT_FILE_LIMIT`) vào system prompt thay vì để model đọc qua tool.
- **Extra tools** — `run_command` chỉ nhận binary trong `SHELL_ALLOWLIST`, argv array, không shell; allowlist chỉ gồm binary mà image `docker/Dockerfile` bảo đảm có, vì danh sách vào thẳng tool description (bin project-local gọi qua `npx`). `search_files` so chuỗi con, không regex (tránh ReDoS). `fetch_url` / `web_search` đi qua `fetchUrlSafe`; git tools chỉ đọc.
- **Preamble tool** — `buildToolUsagePreamble` tuyên bố danh sách là duy nhất; tool MCP của bridge bắt buộc phải liệt kê ở đây, nếu không model được bảo là chúng không tồn tại và sẽ không gọi.

## 20. `AgenticApiProvider.ts` — `execute`

- **MCP bridge** — mở trước vòng hội thoại và `close()` trong `finally` của cùng khối: transport stdio là tiến trình con, một đường thoát quên đóng là rò tiến trình theo từng job. Mở ở lớp cha để mọi job `ai-api` dùng chung một chỗ đóng. Mở hụt chỉ ghi warning, job vẫn chạy (mất tool).
- **Lịch sử khi lỗi** — `AgenticRunError.partialMessages` được lưu (chỉ khi khác rỗng, tránh đè session đã có bằng `[]`) để resume không bắt đầu từ phiên rỗng; buffer assistant được flush trước để không mất turn đang stream dở.

## 21. `OpenAiCompatibleProvider.ts` / `AnthropicCompatibleProvider.ts` — quirk của endpoint

- **Không dùng `@openai/agents`** — converter Chat Completions của SDK đó gửi field ngoài spec ở request tiếp theo (`type`/`function` của tool_call dàn phẳng lên message assistant, `strict: true` chỉ OpenAI có); backend OpenAI-compat chặt như Gemini từ chối, hỏng mọi turn gọi tool sau turn đầu. Vòng tool-use chạy thẳng trên SDK `openai`, message assistant được dựng lại chỉ với field đúng spec.
- **System prompt không nằm trong `messages` persist** — nó được chèn lại ở đầu mỗi request, nên `rawMessages` lưu lại resume được mà không nhân đôi system prompt.
- **Gateway trả 200 kèm `error`** — một số gateway OpenAI-compat (vd OpenRouter free-tier khi quá tải) trả `200 OK` có field `error` và không có `choices`; SDK không ném nên phải kiểm `error` trước khi đọc `choices[0]`.
- **Anthropic không nhận message assistant rỗng** — API từ chối mọi message không-cuối có content rỗng, nên nhánh nhắc lại (`EMPTY_REPLY_NUDGE_TEXT`) không push lượt trả lời rỗng của model vào `messages`.

## 22. `ConfigFlagMcpDelivery.ts` — file cấu hình MCP của claude

Vị trí, quyền và cờ đi kèm: [`docs/mcp/client.md`](../../mcp/client.md) §7. Thêm:

- **Win32** — `chmod` gần như vô nghĩa; vị trí file dưới hồ sơ người dùng (`registryHome()/mcp-runtime/`) mới là rào. Trên POSIX rào chính là `0600`, đặt bằng `mode` ngay lúc tạo; `chmodSafe` sau đó là lưới cho ca file đã tồn tại (ghi đè giữ mode cũ).
- **Entry tự gắn là lý do duy nhất sinh file** — job điều phối không còn nạp MCP của `~/.claude.json` (§15). Thay đổi này im lặng và không tất định (chỉ khi tuyến ra `mcp`), nên log job ghi một dòng để truy ngược.
- **`cleanupOrphans` xoá sạch `job-*.json`, không so mtime** — không job nào của tiến trình mới dùng lại file của tiến trình cũ.

## 23. `ToolBridgeMcpDelivery.ts` — tool MCP cho họ `ai-api`

- **Dashboard chính là vòng tool-use** — không có CLI ở giữa, nên bridge tự mở client MCP, khai tool với SDK và route lời gọi. Bridge mở ở `AgenticApiProvider.execute` (§20).
- **`credentials` bắt buộc khi mở phiên** — thiếu thì server có `credentialId` bị bỏ hẳn header xác thực, trả 401, và model mất sạch tool. Secret của credential cũng vào danh sách mask của thông điệp lỗi (server từ xa hay vọng lại token trong body 401).
- **Mask và không ném** — kết quả tool đi vào log job và `messages` được persist nên `maskDeep` thay secret trước khi trả; `call` không bao giờ ném (lỗi thành `is_error` cho model), một server mở hỏng chỉ mất tool của nó. Tên tool `mcp__<key>__<tool>` chống trùng với tool sandbox và giữa các server.

## 24. `WorkspaceFileMcpDelivery.ts` — cấu hình MCP nằm trong workspace

- **`cursor-agent` không có cờ kiểu `--mcp-config`** — chỉ đọc `<cwd>/.cursor/mcp.json`, nên file chứa secret đã giải nằm trong repo người dùng suốt vòng đời job (khác nhánh claude, file nằm dưới `registryHome()`).
- **Trả lại nguyên trạng** — file `mcp.json` sẵn có được rename sang `.dashboard-backup-<jobId>` rồi khôi phục, không hợp nhất nội dung. `.cursor/.gitignore` (`*`) được tạo khi chưa có, vì `.cursor/` thường không nằm trong `.gitignore` của project.
- **Quyền** — chỉ `chmod 0700` thư mục `.cursor/` do chính lượt này tạo (`dirExisted` chụp trước `mkdir`); thư mục sẵn có giữ nguyên mode vì `restoreWorkspace` không khôi phục mode được (chuỗi i18n `mcpWorkspaceFile` hứa điều này). Rào thật là `0600` trên `mcp.json`.

## 25. `WorkspaceFileMcpDelivery.ts` — khoá workspace và ledger

- **`acquireWorkspaceLock`** — `mkdir` không `recursive` (nguyên tử, ném `EEXIST`); lockfile thay vì `Map` để chặn được cả hai tiến trình dashboard và còn dấu vết khi tiến trình chết. Hai task cùng project chạy song song dùng chung `.cursor/`; không khoá thì A-start → B-start → A-dispose → B-dispose xoá mất file gốc và bỏ lại secret. Không giành được khoá thì không ghi gì, job chạy không MCP.
- **Ledger ghi trước khi chạm file** — entry `stage: 'locked'` ghi ngay sau khi giành khoá, entry `'written'` đầy đủ ghi trước khi rename/ghi; `kill -9` ở bất kỳ điểm nào cũng để lại dấu vết cho `cleanupOrphans`. Ledger chỉ lưu `sha256`, không lưu nội dung (có secret).
- **Chỉ quên entry khi dọn sạch** — `dispose`, nhánh lỗi ghi và `cleanupOrphans` giữ entry khi `restoreWorkspace` trả `false`. Bootstrap (`cleanupOrphans`) là đường duy nhất gỡ khoá treo sau `kill -9`.

## 26. `WorkspaceFileMcpDelivery.ts` — `restoreWorkspace`

- **Đảo ngược thứ tự ghi, mỗi bước bọc `attempt`** — idempotent (`dispose` và đường dọn mồ côi có thể cùng chạy trên một entry); dọn hụt một bước không chặn bước sau và không làm hỏng kết quả job.
- **Kiểm hash trước khi xoá** — chỉ xoá `mcp.json` khi `isOurConfig` (Cursor IDE có thể ghi lại file này giữa job). Rẽ theo `stage !== 'locked'`, không `=== 'written'`, để entry thiếu/lạ (ledger sửa tay, build cũ) rơi về nhánh thận trọng. Hash lệch ⇒ `clean = false`: giữ `.gitignore`, không đè bản backup, giữ entry và `console.warn`.
- **Nhả khoá vô điều kiện, sau cùng** — rồi mới xoá `.cursor/` nếu chính lượt này tạo và thư mục đang rỗng.

## 27. `RunnerConfigPanel.vue` — runner mặc định

- **`effectiveDefaultRunnerId` phân biệt vắng mặt với `null`** — `undefined` (payload cũ chưa có trường dẫn xuất) rơi về `defaultRunnerId`; `null` (BE báo không runner nào chạy được) phải để trống, không gộp bằng `??`, nếu không ngôi sao vẫn sáng trên runner mà job sẽ fail. Giá trị này điều khiển cả ngôi sao lẫn `:disabled` của nút đặt default, để người dùng bấm lại được chính runner đó sau khi sửa.
- **`uniqueRunnerId`** — cắt base trước khi nối hậu tố `-copy[-n]`, vì `sanitiseRunnerId` cắt ở 64 ký tự sẽ cắt mất hậu tố và trùng id trở lại.
- **Tab dùng `v-if`, không `v-show`** — chưa mở tab MCP thì không gọi `/api/mcp-servers`. `.runner-config` là gốc nội dung tab Runner mà e2e bám vào; độ phức tạp template đến từ nhánh `v-if` theo tab và provider, nên file mang `fallow-ignore-file complexity`.

## 28. `ConnectionDialog.vue`

- **MCP theo cách giao trong catalog** — `mcpUnsupported` so `mcpDelivery === 'unsupported'` (không so "khác `config-file-flag`", vì cursor dùng `workspace-config-file` và họ `ai-api` dùng `bridge-tools`).
- **`mcpWorkspaceFile`** — với cursor, người dùng phải thấy trước khi bật: file cấu hình nằm trong repo suốt job, và `--approve-mcps` ghi vào `~/.cursor` một tác dụng phụ sống sau job.
- **`mcpChoices` giữ id đã tắt/xoá** — lọc đi thì người dùng không bỏ chọn được, mà `save` vẫn ghi lại nguyên si và job chạy thiếu tool.
- **Connection tự chứa** — `providerId`, `credentialId`, `baseURL` được chép từ provider config vào Connection để execution plane không phải đọc provider config; `config.providerConfigId` chỉ để UI nhớ liên kết. `config.model` (phần tử đầu) vẫn ghi song song `config.models` vì provider đọc `model`.
- **Connection cũ** — connection lưu trước khi tách provider config (hoặc mất liên kết `providerConfigId`) được `migrateLegacyToProviderConfig` tạo provider config tương ứng khi mở sửa, khớp theo provider; người dùng lưu bình thường mà không mất cấu hình.
- **`secretRefPlaceholder` chỉ là placeholder** — điền sẵn giá trị gợi ý thì không phân biệt được "ô để trống" với "ô đã điền đúng gợi ý".
