# Monitor — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho feature `src/features/monitor/`. Chỉ ghi phần **không tự giải thích được qua tên file**: quirk, giới hạn đã biết, ràng buộc ẩn. Khi sửa, đối chiếu lại với code thật.

---

## 1. `createQa` tự validate task id

`createQa()` (`business/tasks/qa.ts`) từ chối task id chứa ký tự ngoài `[A-Za-z0-9_-]`, dù route HTTP đã có regex ở controller.

- **Vì sao validate ở business** — MCP tool gọi thẳng `createQa()`, không đi qua controller. `resolveArtifact` chỉ chặn thoát khỏi `root`, không chặn thoát khỏi `root/tasks/<id>` khi chính `id` chứa `..` hay `/` (`../evil` vẫn "nằm dưới root"). Validate tại đây để bất biến *không ghi ra ngoài phạm vi task* đúng cho mọi caller.
- **Chặt hơn `TASK_ID_PATTERN` của MCP** — pattern của MCP (`mcp/tools/TaskTools.ts`) nhận dấu `.`, regex này thì không. Id như `20260927.001` đọc được qua `list_tasks` / `read_artifact` nhưng bị `createQa` từ chối.
- **Thông điệp lỗi nêu đúng ràng buộc** — lỗi trả về ghi rõ tập ký tự được nhận. Thông điệp trống kiểu "invalid task id" làm caller tưởng mình đọc sai id rồi thử lại vô hạn.

## 2. Clone project bằng PAT GitHub

`resolveCloneAuth()` (`business/projects/cloneProject.ts`) chọn PAT từ Settings / `GITHUB_TOKEN` cho `git clone`.

- **PAT chỉ đi tới github.com** — `resolveCloneAuth` kiểm `isGithubGitRemote` trước cả khi parse slug: URL host khác mà slug vẫn parse ra `owner/repo` cũng không nhận token.
- **Basic, không Bearer** — git Smart HTTP của GitHub từ chối `Authorization: Bearer` (`remote: invalid credentials`). `githubGitAuthExtraHeader` dựng `Authorization: Basic` với username `x-access-token`, truyền qua `git -c http.extraHeader=…` nên token không nằm trong remote URL ghi vào `.git/config`.
- **URL clone dựng lại từ `owner/repo` đã parse** — `normaliseGithubCloneUrl` nhận owner/repo từ `parseGithubRepoRef`, không match lại path bằng regex: regex không neo, non-greedy sẽ cắt tên repo (`agent-workflow` → `a`).
- **`sanitiseGitUrl` chặn SSRF** — chỉ nhận `https://host/owner/repo` không có userinfo (`@`) hoặc `git@host:owner/repo.git`, và loại host private/loopback qua `isPrivateHostname` (cùng chính sách với `fetchUrlSafe`).

## 3. Chat với runner — chọn phiên (`resolveChatSession`)

`business/taskChat.ts` dựng trạng thái panel "chat trực tiếp với runner": lịch sử lấy từ transcript phiên CLI (CLI ghi nối trong lúc chạy, nên cùng endpoint cũng là màn theo dõi step đang chạy). Việc gửi vẫn là `sendTaskFeedback()`; module này chỉ phản chiếu guard để UI giải thích vì sao ô nhập bị khoá.

Thứ tự chọn phiên cho (task, step): job đang chạy → job mới nhất của step → entry ledger của step → entry `open` mới nhất của task → job bất kỳ có session.

- **Node điều phối có nhánh riêng ở đầu hàm** — chỉ nhận job `orchestratorJob` hoặc entry ledger của `ORCHESTRATOR_STEP_ID`; không tìm thấy thì trả `sessionId: null`. Rơi về entry `open` mới nhất là hiển thị khung chat của một step khác.
- **Mọi đường cấp task phía dưới loại phiên điều phối** (`isOrchestratorEntry`, `isOrchestratorJobRecord`) — entry điều phối tồn tại song song và lâu dài trong ledger, nên fallback có thể trả về nó; mà `sendTaskFeedback` đã loại job điều phối khỏi tập parent ⇒ panel hiện một phiên, tin nhắn lại đi tới phiên khác.
- **Phiên step đã bị đóng (nút "+") thì chỉ entry `open` mới của đúng step đó được thắng** — không rơi xuống fallback `byStep` vì nhánh đó không lọc theo status và sẽ trả lại chính entry `closed` vừa loại. Không có entry mới ⇒ `dismissedForStep: true`, panel rỗng (không dựng lại lượt từ job cũ).

## 4. Chat với runner — dựng lượt (`getTaskChatState`)

- **Panel node điều phối chỉ nói về node** — `running` / `queued` chỉ xét job `orchestratorJob`: đường gửi của node đi thẳng qua `chatWithOrchestrator`, không xếp hàng sau job của step. Runner hiển thị cũng không mượn từ job step gần nhất.
- **`hasFinished` vẫn xét cả task** — node chưa chạy lượt nào vẫn phải nhắn được, vì lượt đầu chính là thứ mở session cho nó.
- **Dựng lượt từ job khi transcript thiếu** — Cursor / agent CLI thường không để transcript trên đĩa, hoặc file tụt sau các job feedback. Khi không có job đang chạy và transcript thiếu / rỗng / không chứa lượt của job mới nhất, lấy toàn bộ dòng thời gian job đã xong (stdout, hoặc phần phản hồi trong log job) thay cho file. Job feedback giữ step id của parent nên cũng được nhận theo `sessionId`.
- **Lượt 0 vai `user` bị lọc** — đó là system prompt của step (`request.md`, nạp làm `job.userPrompt` ở `tasks/runStep.ts`), không phải tin người dùng gõ. Lọc ở chỗ hai nhánh hợp lại để cả transcript thật lẫn nhánh dựng từ job không lộ nó; `total` giữ số thật để con trỏ poll `fromIndex` (`nl-chat/composables/useTaskChat.ts`) không lệch.
- **Job điều phối bị cắt dòng sentinel** — dòng `DECISION_SENTINEL` máy đọc được bỏ trước khi hiển thị.
