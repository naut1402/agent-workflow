# Monitor — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho feature `src/features/monitor/`. Chỉ ghi phần **không tự giải thích được qua tên file**: quirk, giới hạn đã biết, ràng buộc ẩn. Khi sửa, đối chiếu lại với code thật.

---

## 1. `createQa` tự validate task id

`createQa()` (`business/tasks/qa.ts`) từ chối task id chứa ký tự ngoài `[A-Za-z0-9_-]`, dù route HTTP đã có regex ở controller.

- **Vì sao validate ở business** — MCP tool gọi thẳng `createQa()`, không đi qua controller. `resolveArtifact` chỉ chặn thoát khỏi `root`, không chặn thoát khỏi `root/tasks/<id>` khi chính `id` chứa `..` hay `/` (`../evil` vẫn "nằm dưới root"). Validate tại đây để bất biến *không ghi ra ngoài phạm vi task* đúng cho mọi caller.
- **Chặt hơn `TASK_ID_PATTERN` của MCP** — pattern của MCP (`mcp/tools/TaskTools.ts`) nhận dấu `.`, regex này thì không. Id như `20260927.001` đọc được qua `list_tasks` / `read_artifact` nhưng bị `createQa` từ chối.
- **Thông điệp lỗi nêu đúng ràng buộc** — lỗi trả về ghi rõ tập ký tự được nhận. Thông điệp trống kiểu "invalid task id" làm caller tưởng mình đọc sai id rồi thử lại vô hạn.

## 2. Charset task id khi tạo

- **Chặt hơn guard của route đọc/sửa** — `TASK_ID_PATTERN` (`schemas/taskCreate.ts`) bắt id được tạo phải bắt đầu bằng chữ/số và dài tối đa 64 ký tự, nên không dấu phân cách, dấu `.` hay dấu `-` đầu nào tới được `path.join`. Route đọc/sửa chỉ chặn `/[^\w\-]/`.
- **Một pattern cho cả FE và BE** — `createTask`, `TaskIdSchema` và `validateTaskId` (`lib/createTaskForm.ts`) cùng đọc pattern này; `mintTaskId` (`T` + 8 hex) luôn khớp.

## 3. Tạo task (`createTask`)

- **Kiểm trùng nguyên tử** — `business/tasks/create.ts` tạo `tasks/<id>` bằng `mkdir` không `recursive`, làm nửa nguyên tử của bước kiểm tồn tại: hai lượt tạo đồng thời đua tại đây, bên thua nhận `EEXIST` → 409. Lỗi giữa chừng thì xoá scaffold để lần thử lại không vướng 409.
- **Patch knowledge theo id** — không chọn profile mà có `knowledgeInputs` thì `pipeline.yaml` của task chỉ patch bước đầu theo id, giữ flow kế thừa; `steps_replace` phải tắt, nếu không flow kế thừa bị thay bằng đúng một step.
- **`export_json` theo điều phối** — brief của orchestrator tóm tắt các bước trước từ `pipeline-export.json`, nên bật điều phối thì task bật luôn export (`input.exportJson` tường minh vẫn thắng). Đặt ở đây chứ không ở `loadPipelineConfig` (tầng đọc): sửa giá trị trả về ở đó sẽ bị ghi ngược vào `pipeline.yaml` lần Save kế tiếp qua editor.

## 4. Barrel mỏng (`peers.ts`, `tasks/reads.ts`)

- **`peers.ts`** — chỉ re-export peer pipeline/profile cho `tasks/*`, tránh nạp runner + `cloneProject` (`node:child_process`) khi một module tasks bị kéo vào graph client của Vite. Controller và surface công khai vẫn đi qua `business/index.ts`.
- **`tasks/reads.ts`** — hàm chỉ đọc (`resolveArtifact`, `listArtifacts`, `readState`, `collectTasks`) tách khỏi `tasks/index.ts`, vì barrel đó re-export `runStep.js` (→ runner → job queue + sqlite + `node:child_process`) và ESM re-export nạp eager. Caller chỉ đọc — nhất là tiến trình stdio ở `mcp/` — import thẳng `reads.js`.

## 5. Quyền start step (`tasks/startAuthority.ts`)

- **Đặt ở monitor** — module là nguồn chân lý cho câu hỏi "đường này có được submit job cho step không". Runner và automations đều gọi tới; đặt ở feature `orchestrator` thì hai feature đó phải import ngược và sinh vòng barrel.
- **Hai tầng guard** — `assertStartAllowed` (async, đọc `pipeline.yaml` + state thật) là guard thật. `assertStartAllowedSync` là lưới cuối trong `submitJob`, vốn đồng bộ, không await được `loadPipelineConfig`, nên đọc cờ cache `orchestrator_enabled` trong state — `createTask` ghi lúc tạo, `applyOrchestratorConfigChange` ghi khi lưu pipeline, `resolveOrchestration` tự chữa khi lệch; nguồn chân lý vẫn là `pipeline.yaml`. Lưới này ném lỗi chứ không lọc im lặng: chạm tới nó nghĩa là còn một đường start bị bỏ sót. Chỉ job mang `orchestratorDispatch` (do `runTaskStep` gắn khi `origin: 'orchestrator'`) hoặc `isChatFeedback` được qua.
- **Không await ghi cờ trong khoá** — `resolveOrchestration` mặc định ghi cờ cache chạy nền vì được gọi cả từ trong `withTaskLock`, mà chờ một lượt khoá mới của cùng file là deadlock. Caller không giữ khoá mà sắp `submitJob` (đường chain) phải bật `awaitFlagSync`, nếu không cờ `true` cũ làm `submitJob` throw ngay lúc người dùng vừa tắt điều phối.

## 6. `runTaskStep` — khoá và thứ tự kiểm

- **Guard quyền start ngoài khoá** — `assertStartAllowed` chạy trước `withTaskLock` vì nó đọc (và có thể ghi) state của chính task. Phần còn lại (đọc–kiểm–ghi state, submit job) nằm trọn trong khoá, nếu không hai caller cùng thấy "không job chạy" và cùng submit.
- **Kiểm job đang chạy trước reconcile** — để request bị từ chối không để lại dấu: reconcile ghi file, đổi `state_mtime` làm hỏng kiểm 409 của modal HITL đang mở. Job lọc theo `devTeamRoot` (project khác có thể trùng task id) và bỏ qua job "đang nghĩ" của orchestrator (`orchestratorJob`), nếu không chat với node điều phối chặn luôn step kế.
- **Reconcile gate trước khi kiểm `hitl_pending`** — gate mà pipeline hiện tại không còn khai báo sẽ deadlock (không node nào duyệt được, `applyHitlAction` từ chối). Reconcile phải ghi xuống file vì `jumpToPipelineStepAssumingLock` đọc lại file và cũng chặn theo `hitl_pending`.

## 7. `runTaskStep` — auto-advance và step đích

- **Auto-advance bỏ qua lần chạy cũ** — job `succeeded` của step hiện tại đẩy con trỏ qua step đó để chữa task kẹt, trừ job kết thúc trước `last_reset_at` (lần chạy vừa bị reset). Lượt orchestrator đã pin step đích (`origin: 'orchestrator'` + `targetStepId`) tắt hẳn bước này, nếu không nó advance qua step `review_retry` vừa lùi về.
- **Validate trước khi dời con trỏ** — `chainTarget` và jump target phải nằm trong pipeline và đi tới (`isRunnableTarget`), để id quá khứ/ngoài pipeline không thành `chainTarget` khiến chain chạy quá điểm dừng. Lượt pin của orchestrator trỏ về phía sau nhận 400 và `dispatchStep` halt kèm lý do — brief đã soạn cho step đích. Step chạy thật (agent, `request.md`) được resolve trước khi jump, để lỗi không bỏ con trỏ ở step không ai chạy.

## 8. Đồng bộ `hitl_pending` với pipeline

- **Cùng một định nghĩa ở đọc và ghi** — `collectTasks` (`tasks/reads.ts`) tính lại `hitl_pending` bằng `resolveHitlPending(gateStepsFromConfig(cfg), …)` giống phía ghi (`reconcileGateStateAssumingLock`), nên UI không mâu thuẫn với gate thật. `gateStepsFromConfig` trả null khi pipeline không đọc được → gate được giữ: nhả gate theo phỏng đoán sẽ cho job đi qua một lần duyệt chưa ai duyệt.
- **Chỉ ghi khi đổi** — reconcile chạy mỗi lần run-step / job success. Guard `!before` dùng đúng định nghĩa falsy của `resolveHitlPending` (kể cả `''`), để lần no-op không đổi `state_mtime` (modal HITL đang mở dùng mtime cho kiểm 409) và không emit sự kiện cho gate không tồn tại.
- **Repair là ngoại lệ có chủ ý** — `repairTaskState` truyền `steps` thô thay vì `gateStepsFromConfig(pipeline)`: đây là nút người dùng bấm cho task đang kẹt, nên được phán theo pipeline fallback. Nếu cả fallback vẫn khai gate thì giữ gate, lối ra là lưu lại pipeline để ghi đè file hỏng.

## 9. Reject gate khi điều phối bật (`applyHitlAction`)

- **Không gửi phản hồi hai lần** — điều phối bật (chưa halt) thì `applyHitlAction` không gọi `sendTaskFeedback`: orchestrator nghe `hitl.resolved`, đọc `hitl-feedback.md` và tự quyết resume step nào. Điều kiện tính tại chỗ từ `pipeline` + `state` thay vì gọi `resolveOrchestration`, vì `startAuthority.ts` import ngược `state.ts`.
- **Import động** — `sendTaskFeedback` nằm sau barrel `business/index.ts`, barrel này re-export runner mà runner lại re-export `state.ts`; `import()` lúc chạy để vòng import không chạy lúc nạp module.
- **`source: 'gate'`** — phản hồi phải xếp hàng (job của step còn chạy) mang nhãn này, để lượt resubmit bỏ nó khi orchestrator đã cầm lái.

## 10. Reset step (`resetPipelineStepAssumingLock`)

- **Hai trục rời nhau** — `resetScope` quyết định `removedSteps` (step coi là chưa chạy): nuôi `doc_review_round` và việc đóng session CLI. `deleteScope` chỉ quyết định file bị xoá; reset mà không xoá file vẫn phải đóng session, nếu không lần chạy lại nối vào phiên cũ. `qa.md` / `hitl-feedback.md` là lịch sử toàn task, không bao giờ bị xoá.
- **Đóng session ở controller** — `closeTaskSession` chạy ở `resetTaskStep` (`controller.ts`) cho mọi step trong `removedSteps`, vì gọi từ `state.ts` sẽ tạo vòng import qua `business/index.ts`.
- **`last_reset_at`** — mốc để auto-advance của `runTaskStep` bỏ qua job `succeeded` của lần chạy vừa bị reset (§7).

## 11. Chọn session cho chat task (`resolveChatSession`)

- **Node điều phối tách riêng** — `ORCHESTRATOR_STEP_ID` có session riêng và trả rỗng khi chưa có. Các đường cấp task phía dưới phải loại job/entry điều phối (`isOrchestratorEntry`, `isOrchestratorJobRecord`): entry điều phối tồn tại song song và lâu dài, mà `sendTaskFeedback` đã loại job điều phối khỏi tập parent — không loại thì panel hiện một phiên còn tin nhắn đi tới phiên khác.
- **Session đã bị dismiss** — step đã bấm "+" (entry `closed`, chưa có `open` thay thế) chỉ được thay bằng entry `open` của đúng step đó; không rơi xuống fallback `byStep` vì nó không lọc status và sẽ trả lại chính entry `closed`.

## 12. Dựng state chat (`getTaskChatState`)

- **Panel node điều phối** — chỉ job điều phối được chiếm `running` / bật `queued` (đường gửi của node đi thẳng `chatWithOrchestrator`, không xếp hàng sau job step), và không mượn runner của step khác. Riêng `hasFinished` đọc cả task để node chưa chạy lượt nào vẫn nhắn được.
- **Fallback từ job** — transcript thiếu hoặc chậm hơn các job feedback (Cursor/agent-cli hay không ghi file) thì dựng turns từ stdout/log của job đã xong.
- **Bỏ turn 0** — turn `user` đầu của session mới là `request.md` (prompt của step), không phải tin người dùng gõ; lọc ở chỗ hai nhánh hợp lại. `total` giữ số thật để cursor poll (`fromIndex`) không lệch.

## 13. Transcript của CLI

- **Claude Code CLI** — `sessionTranscript.ts` đọc `<CLAUDE_CONFIG_DIR | ~/.claude>/projects/<cwd, ký tự ngoài [A-Za-z0-9] → '-'>/<sessionId>.jsonl`. Chỉ dòng `type: user | assistant` mang hội thoại (còn lại là bookkeeping của CLI), dòng `isSidechain: true` thuộc subagent. `findTranscriptFile` thử thư mục mã hoá trước rồi quét có giới hạn, bù khác biệt hoa/thường ký tự ổ đĩa và job không còn biết chính xác cwd.
- **Cursor CLI** — `cursorSessionTranscript.ts` tìm `~/.cursor/projects/<slug>/agent-transcripts/<sessionId>.jsonl` hoặc `<uuid>/<uuid>.jsonl`; format không cố định (JSONL kiểu Claude hoặc `{role, message|text, type}`), chỉ đọc phần đuôi file.
- **Không throw** — file thiếu/hỏng trả turns rỗng; dòng JSON cuối ghi dở bị bỏ qua vì CLI còn đang ghi.

## 14. Chạy git (`business/git.ts`)

- **Không `shell: true`** — `runGit` truyền argv thẳng; bật shell thì argv bị nối thành chuỗi, `cloneUrl` / `extraHeader` / path worktree do người dùng cấp thành bề mặt command injection và lộ token.
- **`git.exe` trên Windows** — `resolveGitCommand` ưu tiên `git.exe` ở `GIT_EXEC_PATH` / Program Files vì server chạy từ IDE thường có PATH thiếu git.

## 15. Clone project (`projects/cloneProject.ts`)

- **Chặn SSRF** — `sanitiseGitUrl` chỉ nhận `https://host/owner/repo` không userinfo (`@`) hoặc `git@host:owner/repo.git`, và từ chối host private/loopback qua `isPrivateHostname`.
- **PAT không rời GitHub** — `resolveCloneAuth` kiểm `isGithubGitRemote` trước khi tra token, kể cả khi `parseGithubRepoRef` nhận ra slug từ host khác.
- **Basic thay vì Bearer** — git Smart HTTP của GitHub từ chối `Authorization: Bearer` (`remote: invalid credentials`); `githubGitAuthExtraHeader` dùng Basic với username `x-access-token`, token đi qua `-c http.extraHeader` chứ không nằm trong URL remote.

## 16. Xoá worktree (`business/worktree.ts`)

- **Không xoá branch** — `removeTaskWorktree` chỉ `git worktree remove` + `prune`; branch giữ commit chưa merge nên việc xoá không cần chứng minh task đã merge.
- **Path chỉ lấy từ git** — target resolve từ `git worktree list`, không nhận path từ client. `worktreeGate` (`controller.ts`) validate task id trước khi giá trị nào chạm tới tham số git hay RegExp của `matchWorktreeForTask`; nhiều ứng viên khớp → `ambiguous`, không đoán. `isRemovableWorktreePath` là lớp chặn thứ hai sau git: chỉ nhận worktree trong repo (`<repo>/.claude/worktrees/<name>`) hoặc ngay cạnh repo (`../wt-<task>`), từ chối tổ tiên của repo.
- **Detached và `git status` lỗi** — `findRemovalBlocker` chặn worktree detached trước cả nhánh `!exists`: không có branch thì ref `HEAD` dưới `.git/worktrees/<name>/` là thứ duy nhất giữ commit, và `prune` sẽ xoá nó. `git status` lỗi không được hiểu là "0 thay đổi": đường đọc (`buildWorktreeView`) coi là dirty, đường xoá trả `git_failed`. `readDirtyLines` chạy với `--no-optional-locks` để không ghi `index.lock` vào worktree người khác đang dùng.

## 17. Dọn worktree theo task (`tasks/worktreeCleanup.ts`)

- **Kiểm trong cùng khoá** — `cleanupTaskWorktreeForTask` kiểm "task đã xong" và "không còn job queued/running" bên trong chính `withTaskLock` thực hiện xoá. `runTaskStep` submit job dưới khoá này; kiểm ngoài khoá sẽ hở khe để một job được nhận rồi ghi vào thư mục vừa bị xoá.
- **Fail closed, hai điều kiện độc lập** — state không đọc được (orchestrator ghi ngoài process) coi như task còn chạy. Kiểm job là điều kiện riêng: task `archived` được coi là xong dù job nó khởi chạy còn chạy. Predicate job giống `runStep.ts` — lọc theo `devTeamRoot`, job thiếu `devTeamRoot` vẫn tính.

## 18. Catalog quick action (`artifact-actions.yaml`)

- **Schema cố ý lỏng** — `ArtifactAction` (`schemas/artifactAction.ts`) dùng `.passthrough()` để YAML sửa tay có key thừa vẫn parse; `attach_points` là mảng string thường (không phải enum) để giá trị lạ round-trip thay vì làm hỏng validate — UI chỉ đưa ra `artifact-title` / `artifact-selection`. Thiếu `attach_points` coi như title-only (`normalizeAction`).
- **Default là literal trong code** — `DEFAULT_ARTIFACT_ACTIONS` (`business/artifactActions/index.ts`) để dạng literal vì viewer được copy ra khỏi cây plugin, không đọc được asset đi kèm lúc chạy. YAML hợp lệ thay hoàn toàn default, không merge.
- **`agent_ref` rỗng có chủ ý** — rỗng nghĩa là chạy `prompt_template` nguyên văn như agent ad-hoc. Ref khác rỗng phải trỏ agent có vai trò hợp với prompt: gắn agent pipeline vai hẹp (vd `doc-reviewer` từ chối sửa file nó review) vào action "viết lại tài liệu" khiến runner nhận hai chỉ dẫn mâu thuẫn và hỏi lại thay vì sửa.

## 19. SSE stream (`streamTasks`, `streamTaskChat`)

- **Không lọc theo project của event** — `streamTasks` đẩy lại snapshot khi gặp event trong `TASK_STREAM_EVENTS` mà không lọc `payload.projectId` (nhiều event vòng đời không mang field này); mỗi kết nối tự `collectTasks` đúng `root` của mình.
- **Tự bắt lỗi push** — `safePushSnapshot` bắt rejection tại chỗ: `void pushSnapshot()` bỏ promise nên `run()` của `eventBus.ts` (chỉ bắt khi handler trả promise) không thấy lỗi, và unhandled rejection có thể làm sập process.
- **Chat vẫn cần interval** — transcript/stdout không có event nguồn (CLI ghi thêm dòng không đi qua event bus), nên `streamTaskChat` tail bằng interval; event trong `JOB_LIFECYCLE_EVENTS` chỉ đẩy sớm hơn.

## 20. Node điều phối — route và nút

- **Tạo task có `run` khi điều phối bật** — `createTask` (`controller.ts`) giao task cho `dispatchOrchestrator` thay vì submit step đầu; nếu không step đầu chạy với `request.md` thô và orchestrator mất quyền điều phối các bước sau. `../orchestrator/business` được import động vì nối tĩnh tạo vòng monitor → orchestrator → monitor.
- **Run/Stop** — `putTaskOrchestrator`: Stop không đi qua `haltTask()` của decision loop nên tự `revokeOrchestratorTokensFor` ngay; bỏ halt thì giao ngay một lượt (`startOrchestratorTurn`, không await) vì không còn đường nào khác cấp lượt đầu. Node trên canvas (`PipelineNode.vue`) luôn có một nút — Run khi rảnh, Stop khi bận: chỉ có Stop thì node halted trắng nút trong khi Run/Reset trên mọi step cũng ẩn, người dùng mất lối thoát.
- **Chat với node** — `postTaskFeedback` với `stepId = ORCHESTRATOR_STEP_ID` tự bỏ halt (nhắn với node nghĩa là muốn nó cầm lái tiếp) và đi qua `chatWithOrchestrator`, không qua `sendTaskFeedback` — hàm đó chọn job step xong gần nhất làm cha nên phản hồi sẽ rơi vào session của step.

## 21. Xoá task khi còn job (`lib/taskInFlight.ts`)

- **Status còn sống** — `IN_FLIGHT_JOB_STATUSES` chỉ gồm `running` / `queued`. Không có `awaiting_recovery` vì allow-list của `listOrGetJobs` (`features/runner/controller.ts`) thiếu status này, query sẽ trả 400 — chấp nhận false-negative. `awaiting_approval` bị loại vì job đã dừng, chỉ chờ duyệt proposal.
- **So project lỏng** — `jobBelongsToTask` chỉ loại khi cả hai phía có `projectId` và khác nhau: job submit ở project mặc định ghi `metadata.projectId: undefined`, so chặt sẽ bỏ sót đúng nhóm này.
- **Best-effort, không chặn xoá** — `hasInFlightJob` trả `false` khi lỗi mạng/parse để nút xoá vẫn là lối thoát khi backend lỗi; `allSettled` để một status lỗi không che status còn lại. Handler xoá (`removeTask` ở `TaskListItem.vue`, `deleteSelected` ở `MonitorLayout.vue`) chụp `task_id` ngay đầu (poll có thể thay props giữa các lần `await`) và chạy trong `runDelete` để double-click không mở nhiều hộp confirm.

## 22. Phân loại link trong artifact (`lib/artifactLink.ts`)

- **Bỏ ký tự trắng/điều khiển trước khi dò scheme** — `stripBlanks` tồn tại vì trình duyệt vẫn chạy `java\tscript:alert(1)`; viết bằng vòng lặp vì `no-control-regex` chặn lớp ký tự điều khiển trong regex. `javascript:` / `data:` / `vbscript:` → `unsafe`.
- **Không thoát khỏi thư mục task** — path tuyệt đối (path của web server) và `..` vượt gốc task → `escape`. `isArtifactName` chỉ nhận tên mà `putArtifact` (`controller.ts`) cũng nhận: đuôi `.md`, không segment nào bắt đầu bằng `.`.

## 23. Line range của selection

- **Range nằm giữa các block** — trình duyệt chuẩn hoá container đầu/cuối của `Range` lên tổ tiên chung khi điểm mút rơi "giữa" các con (Ctrl+A, kéo từ trên block đầu tới dưới block cuối); tổ tiên đó nằm trên mọi `[data-block-index]` nên `closest()` trong `findBlockIndex` trả rỗng. `findBlockIndicesInRange` (`composables/useArtifactSelectionToolbar.ts`) quét mọi block dưới root và giữ block mà range giao.
- **Best-effort** — `computeSelectionLines` chỉ chính xác khi selection nằm trong một block và text tìm được nguyên văn trong source của block (render bỏ cú pháp markdown); còn lại dùng line range của block. `blockLineRanges` (`ArtifactPanel.vue`) dựa vào việc `splitMarkdownSections` tách bằng lookahead (không nuốt ký tự): source mỗi block là chuỗi con nguyên văn, đúng thứ tự của `content`, nên tìm tuần tự từ cuối block trước vẫn đúng khi hai block trùng text.

## 24. Trạng thái section trong `ArtifactPanel.vue`

- **Bản sao logic gập** — logic gập section là bản sao độc lập của `frontend/ui/CMarkdownView.vue`; sửa một bên thì sửa cả hai. Accordion đọc reactive từ settings; mở block i thì tập mở chỉ còn {i}, `toggle` vọng lại từ block anh em rơi vào nhánh `delete` (idempotent).
- **Seed một lần mỗi tài liệu** — `applyDefaultSectionState` là nơi duy nhất seed `openBlocks` từ preference, qua cờ `seedSectionsOnNextContent`. `load()` chỉ bật cờ, không bao giờ hạ: đổi artifact làm watcher `openArtifact` và `mtime` cùng gọi `load()` trong một flush, gán đè sẽ nuốt cờ. Seed ngay trong `load()` chứ không đợi `watch(content)`, vì watcher không bắn khi tài liệu mới có nội dung trùng khít tài liệu cũ.
- **Nạp lại cùng tài liệu** — poll `mtime`, lưu inline, 409 chỉ `pruneOpenBlocks`: giữ section đang đọc, bỏ index không còn block.

## 25. Điều hướng link trong `ArtifactPanel.vue`

- **Tự điều hướng** — markdown render qua `v-html`, không có router: để trình duyệt theo href tương đối thì cả SPA đi sang URL rác. `onViewClick` delegate ở `viewRoot` và phân loại qua `classifyArtifactHref` (§22); phím bổ trợ chỉ được nhường trình duyệt với link `external`.
- **Link trong editor và lưu dở** — thẻ `a` trong `.art-editor` / `.toastui-editor-defaultUI` là nội dung đang soạn; bắt chúng sẽ mở artifact khác và mất draft. Click link khi đang sửa chạy blur→save và điều hướng trong cùng một cử chỉ, nên lưu chụp `loadedKey` trước để response không ghi đè artifact mà link vừa mở.
- **Kiểm tồn tại** — `task.artifacts` chỉ liệt kê `.md` phẳng ở gốc task; link tới path subtask (`Tsub/x.md`) bỏ qua bước kiểm, để `GET /api/artifact` quyết định — `load()` là chỗ duy nhất biết nó không mở được.

## 26. Dữ liệu cũ sau `await` trong `MonitorLayout.vue`

- **Danh tính chụp trước `await`** — `loadWorktree` nhận `taskId` + `projectId` làm tham số và bỏ kết quả nếu `selected` / `selectedProjectId` đã đổi (poll 1.5s): task id thôi không định danh được worktree vì hai project có thể trùng id. `cleanWorktreeSelected` chụp cả hai trước `confirm()` (hộp thoại giữ handler lâu tuỳ người đọc) và kiểm lại sau.
- **`watch` theo mảng getter** — watch `[() => task_id, () => projectId]` chứ không phải một getter trả mảng: getter trả mảng tạo mảng mới mỗi lần, `Object.is` luôn báo đổi và callback chạy lại mỗi lượt poll, xoá `worktreeError` trước khi ai kịp đọc.

## 27. Click ra ngoài sub-sidebar (`MonitorLayout.vue`)

- **Không ignore `.sidebar`** — mode icon trên rail chính là nút toggle sub-sidebar, và listener capture của `onClickOutside` chạy trước `@click` của nút: collapse tại đó thì `@click` mở lại ngay. `isFromRailSidebar` chặn riêng nhánh collapse; đưa `.sidebar` vào `ignore` sẽ triệt tiêu cả callback, kéo chết nhánh `collapseTaskExpandOnOutside` (setting độc lập).
- **Ignore modal teleport** — click trong `.modal-backdrop` (FolderPicker, Settings…) nằm ngoài DOM sub-sidebar; không ignore thì collapse làm `v-if` unmount `ProjectBar` và đóng picker giữa chừng.

## 28. Fit view trong `PipelineView.vue`

- **Fit lại theo cấu trúc node** — `fitView-on-init` của VueFlow chỉ chạy một lần rồi khoá (`fitViewOnInitDone`), mà batch SSE đầu chưa có `pipeline` thật (chưa có node điều phối). `nodeStructureKey` đổi khi số lượng/danh tính step hoặc node điều phối đổi — không đổi khi chỉ toạ độ hay trạng thái — và mỗi lần đổi thì tự `fitView()` lại.
- **`setTimeout` và `immediate`** — đợi 100ms (không phải `nextTick`) để VueFlow đo xong dimension node mới; huỷ timer cũ trước khi đặt mới vì component sống xuyên nhiều lần đổi task. Watch cần `immediate: true`: khi pipeline đầy đủ ngay từ render đầu, khoá không đổi sau mount nên watch không bao giờ tự chạy.

## 29. Node điều phối trong `PipelineView.vue`

- **Không nằm trong `steps[]`** — node điều phối không phải một bước, nên `phasesFromPipeline` / `phaseStatus` / `isRunnableTarget` không biết tới nó; toạ độ của nó là phái sinh, không lưu vào flow profile. Node và edge của nó cùng gate theo `orchestratorEnabled` (không phải `orchestrated` = enabled && !halted) để luôn xuất hiện/biến mất cùng nhau; halt chỉ đổi badge và khả năng Run.
- **Job "đang nghĩ" tách riêng** — `orchestratorJobId` tách khỏi `activeJobId` vì job đó không chạy step nào; gộp chung thì spinner hiện nhầm lên node `current_phase`. `syncInFlightRun` watch cả object `props.task` (không chỉ `state_mtime`): vòng đời orchestrator đổi identity task mà không nhất thiết đổi `state_mtime`.

## 30. Chat và reset trên node step (`PipelineView.vue`)

- **Chat theo artifact, không theo status** — node step có chat khi artifact của nó đã tồn tại, để step đã chạy mà FAILED (vẫn `active`, `current_phase` không đổi) vẫn chat được — đúng lúc cần nói với runner nhất.
- **Phạm vi reset** — lựa chọn "onward" hiện khi có step phía sau, không gate theo "step sau còn artifact" vì `resetScope` còn tác dụng ngoài xoá file (§10). Rút `resetScope` về `step` thì watch hạ `deleteScope` theo — cùng ràng buộc `.refine` của `ResetStepRequest` (`schemas/resetStep.ts`), nếu không body nhận 400.

## 31. Containing block cho `CLoadingOverlay`

- **`position: relative` bắt buộc** — `.task-entry`, `.task-head` (`styles/TaskList.scss`), `.qa-panel` (`QaPanel.vue`) và `.project-bar` (`ProjectBar.vue`) khai `position: relative` làm containing block cho `CLoadingOverlay`; thiếu nó overlay leo lên tổ tiên định vị gần nhất và phủ cả trang. Hợp đồng chung của overlay: [`frontend.md`](frontend.md) §1.
