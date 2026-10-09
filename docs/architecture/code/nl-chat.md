# NL Chat — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho feature `src/features/nl-chat/`. Chỉ ghi phần không tự giải thích được qua tên file. Khi sửa, đối chiếu lại với code thật.

---

## 1. Phiên chat builder

- **Session id không phải task id** — `nlchat-<hex>` (`business/nlChatSession.ts`) chỉ là khoá tra cứu cho `submitJob`/`sendTaskFeedback`, không bao giờ ghi `tasks/<id>/` hay `.dev-state/<id>.json`. Vì vậy `POST /api/tasks/:id/feedback` cố ý 404 với id này, và `sendTaskFeedback` không bao giờ trả `queued` — job đang chạy ⇒ `continueNlChatSession` trả 409.
- **Thứ tự prompt từ lượt 2** — `buildTurnPrompt` ghép: nhắc contract → catalog → message, để quy tắc "không khớp thì hỏi lại" còn ràng buộc câu vừa nhận. Caller không cấp catalog (facade `NlChatBusiness`) vẫn nhận câu nhắc chặn bịa ref.
- **`agentStdoutOf` đọc log file** — job cũ không có `job.stdout` thì đọc `logPath`, lấy đoạn giữa `RESPONSE_HEADER` và `RESULT_HEADER`, bỏ dòng `[runner] ` để chat không lặp cả log runner.

## 2. Catalog cho `nl-chat-builder`

- **Bơm vào prompt ở mọi lượt** — workspace của phiên là `nlchat-scratch/<id>` (không thấy `pipeline-profiles/`) và provider API thuần không có tool, nên catalog đi qua prompt. `renderCatalogContext` (`controller.ts`) đọc đĩa lại ở mọi lượt, cho mọi `entityType`, không ném (lỗi chỉ log). Trần số mục (`CAPS`) đặt ở nửa render, không sửa `buildCatalog` vì `GET /api/catalog` dùng chung.
- **Chống chèn dòng giả** — `name`/`description`/`ref` đến từ frontmatter file bên thứ ba (`~/.claude/skills`, plugin cache). `textOf` gộp mọi khoảng trắng về một space ở cả nửa dữ liệu lẫn nửa render (`clampDesc`, `bullet`); thiếu bước này, một mô tả nhiều dòng chèn được dòng `- <ref giả>` hoặc ghi đè khối quy tắc.
- **Nguồn hỏng khác nguồn rỗng** — `unreadable` liệt kê nhóm đọc lỗi; `renderSection` nói "không đọc được" thay vì "chưa có mục nào", nếu không builder khẳng định pipeline người dùng nhắc không tồn tại rồi bỏ trống `profileName`. Không in ref `@global`: `sanitiseProfileName('@global')` ra `global`, không có `pipeline-profiles/global.yaml`, task âm thầm rơi về pipeline mặc định.

## 3. Đính kèm phía server

- **Gửi path, không gửi nội dung** — file ghi dưới data root (`uploads/chat/<uuid>`, hoặc `tasks/<taskId>/attachments/<uuid>` vì thư mục task là cwd của agent CLI); message chỉ mang path để mọi provider CLI tự đọc. Mọi path dựng qua `resolvePathUnder`. `lib/attachmentPrompt.ts` / `lib/knowledgePrompt.ts` sinh text cho agent, không phải UI: giữ tiếng Việt khớp `buildTurnPrompt`, không qua i18n.
- **Kiểm giới hạn trước khi đọc bytes** — `readAttachmentForm` (`controller.ts`) gọi `checkAttachmentLimits` trên metadata `File` trước `arrayBuffer()`, nếu không file quá cỡ nằm trọn trong bộ nhớ rồi mới bị từ chối; `saveChatAttachments` kiểm lại và đó mới là guard. Composer dùng cùng hằng số ở `schemas/nlChat.ts` chỉ để báo sớm. Trình duyệt báo `type` rỗng cho vài đuôi (`.md`) nên `isAllowedAttachment` rơi về `ALLOWED_EXTENSIONS`.
- **Ghi file** — body đọc bằng `c.req.formData()`: parser multipart tự viết ở knowledge/agent-editor ép body thành string, hỏng file nhị phân. `Buffer.from(f.bytes)` copy đúng view (ArrayBuffer phía sau có thể là slice). Audit chỉ ghi tên đã sanitize và kích thước.

## 4. Composer

- **Khoá theo upload** — `canAttach` (`composables/useChatComposer.ts`) false trong lúc `attachments.upload()` chạy: upload chụp danh sách lúc bắt đầu, file thêm giữa chừng không tới server mà vẫn bị xoá khi gửi xong. `ChatAttachmentBar` thì chỉ khoá theo `uploading`, không theo `canAttach` — `canSend` có thể bị server tắt giữa lượt poll, chip đã thêm sẽ không gửi được cũng không xoá được.
- **Knowledge resolve lúc gửi** — `knowledgeIds` là con trỏ; `onSend` mới resolve id → path, nên knowledge sửa giữa hai lượt đi vào lượt sau ở trạng thái mới. Không chọn knowledge thì không thêm `await` nào (UI và test dựa vào số microtask của đường gửi thường). `resolveKnowledge` lỗi thì tin vẫn được gửi, không kèm khối knowledge.
- **Quirk trình duyệt** — Enter khi `e.isComposing` là IME tiếng Việt chốt chữ, không phải gửi. Id chip (`useChatAttachments.ts`) không dùng `crypto.randomUUID()` vì hàm đó chỉ có trong secure context, dashboard chạy http trên IP LAN. `ChatAttachmentBar` thu hồi object URL theo danh sách `items`, không theo sự kiện remove, vì `attachments.clear()` xoá chip không qua `onRemove`.

## 5. Guard draft trước khi lưu

- **Guard phía client là chốt duy nhất** — `CreateTaskPipeline` để `.passthrough()` và server không kiểm `profileName` có tồn tại: `confirm()` (`composables/useNlChatSession.ts`) nạp lại catalog/profile ngay trước khi soát và fail-closed khi lần nạp gần nhất lỗi. So khớp `profileName` chính xác (`pipeline-profiles/` phân biệt hoa thường trên Linux). Danh sách profile nạp theo loại draft lúc nhận (`task`/`automation`), không theo nội dung, nếu không `profileNameError` kẹt ở "đang kiểm tra".
- **Không cache theo phiên** — `loadCatalog`/`loadProfiles` luôn gọi lại để thấy agent/pipeline tạo ở tab khác; `*Inflight` chỉ gộp lời gọi chồng nhau, nằm trong closure của composable (hai instance không dùng chung) và bị `reset()` xoá để lần nạp sau `cancel()` không dùng lại request của phiên cũ.
- **`normalizePipelineDraft`** (`lib/pipelineDraft.ts`) — `POST /api/pipeline-profiles` chỉ kiểm `steps` là mảng, còn Pipeline Editor khoá node theo `step.id` (`buildFlowFromPipeline`; `extractStepPreservedMap` bỏ step không có id) và id trùng làm mất node. Chuẩn hoá trước preview và lần nữa trước khi lưu vì textarea preview sửa được. Draft `agent` lưu theo `agentScope` chọn tường minh; scope `project` mà chưa chọn project thì chặn, vì `saveCustomAgent` với project null rơi về project `default: true`.

## 6. Cửa sổ chat và registry phiên

- **Body của mọi phiên luôn mounted** — `ChatWindow.vue` render mọi phiên, chỉ `v-show` phiên active (đặt trên wrapper vì root của `BuilderChatBody` là fragment); `FloatingChatButton.vue` giữ `ChatWindow` mounted sau lần mở đầu (`everOpened` + `v-show`). Draft chưa gửi nhờ vậy sống qua chuyển phiên và thu nhỏ; body nằm trong DOM nên registry bị chặn ở `MAX_SESSIONS`.
- **Chọn phiên** — `select` (`composables/useChatSurface.ts`) chỉ dời con trỏ, `activate` dời và mở cửa sổ; `closeSession` chỉ `select` để không bật lại cửa sổ vừa ẩn. `openBuilderChat` dùng lại phiên builder đang có. Vượt trần thì bỏ phiên cũ nhất không đang xem, ưu tiên bỏ phiên step trước phiên builder (builder giữ draft chưa gửi).
- **Info popover** — mở bằng hover lẫn click: click ghim (`infoPinned`), rời chuột chỉ đóng thứ hover mở; toggle dựa vào `infoPinned` vì `pointerenter` đã mở popover trước khi click tới. Click ngoài bắt ở capture phase; Escape trả focus về trigger kèm cờ `infoRefocusing` để `focusin` không mở lại. Runner hiển thị là `effectiveDefaultRunnerId` của BE (đúng luật `submitJob`); không có thì bỏ dòng, không đoán bằng runner bật đầu tiên hay `defaultRunnerId`.

## 7. Trợ năng và cuộn

- **Trạng thái không chỉ bằng màu** — title đổi màu theo `status.kind`, nên có thêm `.nl-chat-sr-only` `role="status"` (WCAG 1.4.1). Live region đọc `statusAnnouncement` (theo kind), không đọc `status.text`: text "busy" của builder đếm giây, live region sẽ đọc lại mỗi giây.
- **Bám đuôi danh sách** — `isNearBottom` (`BuilderChatBody.vue`, `TaskChatBody.vue`) đo trước khi DOM được patch (watch mặc định flush `'pre'`); chỉ cuộn xuống khi đang ở đáy, vì turn hoạt động tool tới mỗi 2s lúc step chạy.
- **Menu "+" của composer** — mọi nút trong `ChatComposerMenu.vue` là `type="button"` vì nằm trong `<form>` của composer; không dùng `role="menu"`/`menuitem` vì list không hiện thực roving focus bằng phím mũi tên. `onFileChange` reset `input.value` để chọn lại cùng file vẫn bắn `change`.

## 8. Chat với runner của step

- **`generation` hủy chuỗi poll** — mỗi `start`/`stop` (`composables/useTaskChat.ts`) tăng `generation`; chuỗi poll mang giá trị lúc sinh và tự thoát khi lệch, vì `clearTimeout` không với tới chuỗi đang nằm giữa hai `await`. `start` luôn `stop()` trước (gọi từ mount, watcher đổi phạm vi, watcher `active`); `stop` tự reset `loading` vì chuỗi bị hủy không biết chuỗi mới đã set nó chưa.
- **Echo lạc quan tải lại từ 0** — còn `pendingItems` thì `prepareFetchWindow` không dùng delta: turn fallback từ job dùng index 0-based reset theo shape response, `from=<total cũ>` trả `[]` mãi và "Đang gửi" kẹt. Lần reload do echo ép giữ lại echo; chỉ reload tường minh mới xoá.
- **Thứ tự hiển thị tách khỏi index** — `index`/`total`/`from` của server giữ thứ tự đọc (cursor poll và dedup trong `applyState` dựa vào `index`); `sortedTurns` chỉ sắp lại khi mọi turn có `at` parse được.

## 9. CSS `styles/ChatWindow.scss`

- **Rule nêu lại vì cascade** — `.nl-chat-info .icon-btn:hover` (rule chung `.icon-btn:hover` kéo màu về `--text`) và `.nl-chat-composer-menu button:disabled` (tiền tố `.nl-chat-input-row` thắng rule `button:disabled` chung).
- **Markdown trong bubble** — `.nl-chat-message.md` dùng `white-space: normal` vì `pre-wrap` trên HTML đã render biến newline giữa tag thành dòng trống; `li > p { margin: 0 }` vì marked sinh `<p>` trong `<li>` của loose list. Turn dài kẹp bằng CSS (`.is-clamped`) thay vì cắt source — cắt giữa code fence/list làm hỏng markup.
- **Textarea composer** — `min-height` một dòng là sàn: `autoGrow()` ghi `height` inline mỗi lần nhập và `min-height` thắng inline `height`, nên sau khi gửi ô không tụt dưới một dòng.

## 10. Barrel business

- **Chỉ backend được import** — `business/index.ts` re-export `listAutomations` từ barrel `automations/business`, barrel đó khởi động scheduler/event-trigger ở top-level (chặn bằng `BUN_TEST`). Không file FE nào được import `nl-chat/business/**`.
- **Đồng bộ tay danh sách event** — cũng vì side-effect đó, `AUTOMATION_EVENT_TYPES_HINT` (`nlChatSession.ts`) chép tay `KNOWN_AUTOMATION_EVENT_TYPES` thay vì import.
