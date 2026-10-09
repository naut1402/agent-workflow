# Orchestrator — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho feature `src/features/orchestrator/`. Chỉ ghi phần không tự giải thích được qua tên file. Khi sửa, đối chiếu lại với code thật. Luồng event, chống tự-kích và lưới chuyển tiếp tất định ở [`../events/orchestrator.md`](../events/orchestrator.md).

---

## 1. Dispatch một step

- **Luôn qua `runTaskStep`** — `dispatchStep` (`business/decisionLoop.ts`) không gọi thẳng `submitJob`: `runTaskStep` giữ khoá task, guard 409 và auto-advance. Truyền `targetStepId` + `skipIntermediate` để job chạy đúng step mà brief soạn cho; không pin thì `runTaskStep` chọn step theo `current_phase`.
- **409 là "thử lại sau"** — task đang có job step chạy thì `dispatchStep` chỉ log rồi thoát, không halt; `sweepStuckTasks` nhặt lại nếu bước kế bị bỏ quên.
- **Import động** — `runStep.js` và barrel runner được nạp bằng `import()`: runner re-export module của monitor, import tĩnh dựng vòng lúc module-eval. Chiều monitor → orchestrator cũng phải dùng `import()` động.

## 2. Resume và respawn

- **`resumeStep`** — gửi tiếp vào session cũ qua `sendTaskFeedback` với `requireStepMatch` (step chưa từng chạy thì lỗi, không rơi vào session step khác). Không dùng `resetPipelineStep*`: đường đó lùi cursor và có thể xoá artifact.
- **`respawnStep`** — phiên mới (`sessionMode: 'new'`), gọi thẳng `submitJob` nên không bị `isRunnableTarget` chặn và không đổi `current_phase`/`hitl_pending`. Metadata bắt buộc: `respawn: true` để `advancePipelineStepChain` (`runner/business/jobQueue.ts`) không đẩy cursor; `orchestratorDispatch: true` để qua `assertStartAllowedSync` của `submitJob`, thiếu thì mọi respawn trên task có orchestrator bị ném "orchestrator owns this task".
- **Gate đang chờ** — `ACTION_HANDLERS.respawn` không đọc `gatePending`/`completed`; `applyStart` thì hạ `start` thành `summary` vì `runTaskStep` từ chối start khi cổng đang chờ người.

## 3. Job quyết định (`askAgent`)

- **Chốt metadata ngay trước `submitJob`** — `mintOrchestratorToken` và `resolveDecisionRoute` chạy ngay trước submit vì job file là snapshot, metadata không sửa được sau. Prompt và runner cùng đọc một giá trị `orchestratorMcpRoute`; job thiếu khoá này ⇒ `undefined` ⇒ runner không gắn MCP.
- **Không đặt `pipelineStepId`** — job orchestrator mang `stepId: ORCHESTRATOR_STEP_ID`; có `pipelineStepId` thì `advancePipelineStepChain` đẩy cursor khi job xong. `sessionMode` luôn `'resume'`: ledger khoá entry theo `stepId`, lượt đầu tự ra phiên mới.
- **Một lượt agent mỗi task** — `hasActiveOrchestratorJob` ⇒ trả 409 `orchestrator busy`: hai job cùng resume một session làm hỏng transcript.

## 4. Đọc quyết định

- **`directDecisionApplied`** — agent đã ra lệnh qua `POST /api/orchestrator/decide` thì `consumeAgentDecision` không đọc sentinel cuối output (tránh thi hành hai lần). `postDecide` (`controller.ts`) đánh dấu job **trước** `applyDecision`: `start` tạo ngay job step mới và `resolveTaskJobId` ưu tiên job mới nhất, đánh dấu sau sẽ gắn cờ nhầm lên job step.
- **Output rỗng khác hội thoại** — `metadata.orchestratorTrigger` phân biệt lượt quyết định với lượt `chat`: lượt quyết định rỗng output đi vào `recoverFromBadTurn`; lượt không có dòng sentinel chỉ là hội thoại.
- **`stepResultOf`** — ưu tiên `metadata.stepSummary` (`jobQueue.withStepSummary` chốt từ stdout đầy đủ, trước khi bị cắt), rồi `STEP_SUMMARY` trong `job.stdout`, cuối cùng đuôi output (`fromTail`); không mang stdout thô. `job.stdout` đã được provider bóc khung JSON — bóc lần nữa có thể vứt mất dòng `STEP_SUMMARY` khi output chứa khối JSON.

## 5. Subscriber (`handleEvent`)

- **`task.advanced` không giữ khoá `inFlight`** — giữ khoá cho nó sẽ chặn mất `job.finished` mà cùng lần chạy job phát ngay sau.
- **`isStepJob`** — loại job approval (`applyTarget`) và lượt chat (`isChatFeedback`, kế thừa `pipelineStepId` của job cha); lượt resume do orchestrator gửi (`orchestratorResume`) vẫn là lượt chạy lại của step.
- **Job thiếu `devTeamRoot`** — job cũ không có `metadata.devTeamRoot` được coi là thuộc root đang xét (`jobBelongsToTask`, `sweepStuckTasks`, `respawnStep`).

## 6. Trạng thái trong process

- **Ring buffer LRU** — `recordObservation` xoá rồi set lại khoá để `Map` giữ thứ tự dùng gần nhất; vượt `OBSERVED_TASK_LIMIT` thì bỏ task im lặng lâu nhất.
- **Giới hạn vòng lặp** — `MAX_FAILURE_ASKS` đếm theo `(task, step)`, `MAX_TURNS_PER_PHASE` theo `(task, phase)`; lượt `chat` / `manual_start` không đếm vì mỗi lượt cần một thao tác tay.

## 7. Quét task treo

- **Lưới cứu event bus** — bus in-process, không bền: restart dashboard là mất tín hiệu chuyển bước. `sweepStuckTasks` tự đẩy cursor bằng `advanceStepOnJobSuccess` khi job của bước hiện tại đã xong mà cursor chưa đi (`runTaskStep` không tự chữa việc này cho dispatch có pin); bỏ qua task đang có job orchestrator chạy.
- **Lọc bằng cờ cache** — `orchestratedCandidates` chỉ đọc `.dev-state/*.json` (`orchestrator_enabled`), không dùng `collectTasks`: không bật orchestrator thì không phát sinh I/O định kỳ. `resolveOrchestration` xác nhận lại từng ứng viên.
- **Timer bật lười** — `ensureSweepScheduled` chỉ hẹn giờ khi đã thấy task được điều phối (lượt quét lúc khởi động, `handleEvent`, đường lưu pipeline), nên bật checkbox giữa chừng không cần restart.

## 8. API REST gọi ngược

- **Header riêng** — `ORCHESTRATOR_TOKEN_HEADER` (`controller.ts`) không dùng `Authorization` để `createJwtMiddleware()` không chặn nhầm; giá trị là env `DASHBOARD_ORCHESTRATOR_TOKEN` mà provider cấp cho tiến trình con.
- **Token theo job** — `business/orchestratorTokens.ts` map token → `TaskRef`; mint khi `askAgent` submit, revoke khi job đó xong/lỗi hoặc khi halt. Không dùng JWT: caller duy nhất là tiến trình con server tự spawn, và token tra thẳng ra scope `root`/`taskId`.
- **Lọc theo root** — `resolveTaskJobId` chỉ so `taskId`; `getOutput` và `currentOrchestratorJobId` tự so lại `metadata.devTeamRoot` để không lộ output chéo giữa hai project trùng task id.

## 9. Tuyến ra lệnh `mcp` / `sentinel`

- **Một nơi quyết** — `resolveDecisionRoute` (`business/mcpRoute.ts`) là nơi duy nhất chọn tuyến; tính lại ở chỗ khác mở cửa sổ "prompt dạy gọi tool mà job không có tool". Không bao giờ ném: lỗi đọc registry ⇒ `sentinel`.
- **Điều kiện `mcp`** — thiếu `DEV_TEAM_SELF_BASE_URL` thì `buildChildEnv` không bơm token xuống tiến trình con, tool chắc chắn 401. Runner được kiểm là `getDefaultRunner()` vì `askAgent` không pin `runnerId`; pin runner thì phải đổi cả hàm này.
- **Fallback trong prompt** — `renderMcpProtocol` (`business/decision.ts`) giữ hướng dẫn in dòng sentinel: `route` chỉ nói job sẽ có tool, CLI có kết nối được MCP hay không thì server không biết. Ví dụ JSON trong đó phải hợp lệ, không dùng placeholder. Nội dung `renderSentinelProtocol` bị test characterization chốt từng ký tự.

## 10. Schema, ngân sách và rule project

- **`OrchestratorDecisionShape`** — raw shape tách riêng để tool MCP `orchestrator_decide` dùng làm `inputSchema` (`ZodEffects` không có `.shape`). Ràng buộc chéo field chỉ nằm trong `.superRefine`; tool MCP đi qua `POST /api/orchestrator/decide` nên `validateDecision` luôn chạy bản đầy đủ.
- **Ngân sách byte** — `MAX_AGENT_CONTEXT_BYTES` giữ dòng quyết định dưới `CHAT_STDOUT_LIMIT` (stdout bị cắt ⇒ JSON đứt); `MAX_STEP_RESULT_BYTES` nhỏ vì phiên điều phối resume qua nhiều lượt, kết quả cộng dồn. `tailOf` lùi điểm cắt qua byte nối UTF-8 để không sinh U+FFFD.
- **`project-rules.md`** — hợp đồng file chung với CLI orchestrator ngoài (skill `read-project-rules`): cùng tên file, cùng format section; file đã có thì đọc nguyên văn, không ghi đè. Thứ tự tìm rule: section trong `AGENTS.md`/`CLAUDE.md` (file đầu tiên đọc được) → `buildRules` → mục "Không tìm thấy".

## 11. Nạp feature và khởi động vòng lặp

- **`api.ts` là điểm nạp** — `registerFeatureRoutes` chỉ quét `src/features/<name>/api.ts`; dòng `import './business/index.js'` trong đó là side-effect gọi `startOrchestratorLoop`, bỏ đi thì vòng lặp điều phối không bao giờ chạy.
- **Không auto-start dưới `bun test`** — `business/index.ts` bỏ qua `startOrchestratorLoop` khi có `BUN_TEST`; test tự gọi `handleEvent` / `sweepStuckTasks`.
