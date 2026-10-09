# Frontend — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho `src/frontend/`. Chỉ ghi phần không tự giải thích được qua tên file. Khi sửa, đối chiếu lại với code thật.

---

## 1. `CLoadingOverlay` — chỗ neo và thời điểm

- **Chỗ neo phải `position: relative` và không cuộn** — overlay là `position: absolute; inset: 0`, mà padding box của scroll container nằm trong hệ toạ độ đã cuộn: neo vào `.modal-body` thì cuộn xuống rồi bấm action, overlay trôi khỏi khung nhìn. Vùng tự cuộn bọc bằng `.c-loading-host` (`styles/_shell.scss`) đặt ngoài scroller; vùng không cuộn chỉ cần `position: relative` tại chỗ. Trong dialog không đặt vào `.modal`, để `.modal-head` / `.modal-foot` vẫn bấm được (nút ở `.modal-foot` chặn bằng `:disabled`).
- **Chặn và vẽ tách thời điểm** — node chặn con trỏ render ngay khi `active` (`v-if="active || visible"`), scrim + spinner chỉ hiện sau `delayMs` và giữ tối thiểu `minVisibleMs`. Gộp về một `v-if="visible"` là để click lọt xuống trong khoảng `delayMs`. `role="status"` chỉ gắn ở node bên trong để screen reader không đọc cho mọi action ngắn.
- **`z-index: 2` là thang cục bộ** — overlay nằm trong stacking context của dialog; nâng lên thang toàn cục (`.modal-backdrop` 1000, `.nested-backdrop` 1100) làm overlay của dialog dưới phủ lên dialog lồng.

## 2. Markdown và mermaid

- **Sanitize một lần ở `parseMarkdown()`** (`lib/markdownLib.ts`) — output đi thẳng vào `v-html` ở nhiều bề mặt (chat, artifact, QA, log). `DOMPurify.sanitize` chạy trước bước đổi fence mermaid thành `<div class="mermaid">`; DOMPurify giữ `class` nên fence vẫn khớp được sau sanitize.
- **Thân diagram giữ nguyên dạng HTML-escaped** — `renderMermaid()` đọc lại qua `node.textContent` (trình duyệt decode đúng một lần). Tự decode thân fence trong `parseMarkdown()` biến `&lt;img onerror=…&gt;` thành thẻ sống, nằm ngoài tầm sanitizer.
- **`attachMermaidControls()` không chạm attribute của `renderMermaid()`** (`composables/useMermaidControls.ts`) — chỉ bọc thêm `.mermaid-wrap` + toolbar, không đụng `data-mermaid-src` / `data-mermaid-theme` / `data-processed`; đó là cơ chế bỏ qua node đã vẽ để SVG không nháy mỗi nhịp poll.

## 3. Gập section ở viewer markdown

- **Hai bản logic gập section** — `ui/CMarkdownView.vue` và `features/monitor/components/ArtifactPanel.vue` giữ bản sao độc lập của cùng logic block/accordion trên `artifactViewMode` + `artifactSection*`; sửa một bên thì sửa cả bên kia.
- **`toggle` vọng lại khi accordion** — mở block `i` thì tập mở thành `{i}`; các `<details>` anh em bị Vue đóng sẽ bắn `toggle` vọng lại và rơi vào nhánh `delete` (idempotent), không lặp.

## 4. Khung dialog `.modal`

- **Đúng một `.modal-body` bọc nội dung** (`styles/_shell.scss`) — `.modal` không khai `overflow`, nó dựa vào `.modal-body` (`flex: 1; min-height: 0; overflow-y: auto`) để hút phần cao quá `max-height`. Đặt nội dung thẳng vào `.modal` thì khi vượt 88vh, hàng nút bị vẽ ra ngoài viền dưới.

## 5. Style bắt buộc ở tầng global

- **Phần tử sinh lúc chạy không có scope-id** — HTML của `parseMarkdown` qua `v-html` (`styles/_markdown.scss`), toolbar mermaid do `useMermaidControls` tạo, `.vue-flow__*` do VueFlow sinh (`styles/_shell.scss`): `<style scoped>` không với tới, nên style phải là class global.
- **`@keyframes c-spin` khai global vẫn dùng được từ `<style scoped>`** — compiler-sfc chỉ đổi tên keyframes khai trong chính block scoped đó, tên lạ giữ nguyên. `Icon.vue` chỉ vẽ hình; caller (`CLoadingOverlay`, `ChatWindow`) tự gắn `.c-spin`.

## 6. `MarkdownTextEditor`

- **Lối vào duy nhất của Toast UI** (`ui/MarkdownTextEditor.vue`) — nội dung markdown bền (artifact, knowledge, section agent) dùng component này; feature không import `@toast-ui/*` trực tiếp. Text thường / JSON / prompt template giữ `<textarea>`.
- **`blur` chỉ phát khi focus thật sự rời root** — Ctrl/Cmd+V làm Toast UI focus một textarea `pseudo-clipboard` ẩn và bắn `blur` trước khi nội dung dán vào; caller nối `@blur` với auto-save sẽ huỷ editor giữa lúc dán. `handleEditorBlur()` kiểm `document.activeElement` trong microtask; nghe thêm `focusout` vì clipboard rỗng để focus kẹt ở textarea ẩn và Toast không bắn `blur` lần nữa.
- **CSS `.auto-height` dùng `!important` và đặt `overflow` cả hai trục** — stylesheet Toast UI có thể thắng cascade tuỳ thứ tự nạp; `overflow-x` khác `visible` thì `overflow-y: visible` bị tính lại thành `auto`, sinh thanh cuộn thứ hai cạnh scroller của trang.

## 7. `CScreenLayout`

- **`--no-main` dùng `grid-template-columns: 1fr 0`, không `1fr`** (`ui/CScreenLayout.vue`) — `main` luôn được render; lưới một cột đẩy nó xuống hàng thứ hai thay vì ẩn. Cột rộng 0 + `overflow` của `main` cắt nó đi, transition chung của lưới vẫn chạy.
- **`--left-collapsed` thắng `hideMain`** — `hideMainEffective` bỏ `hideMain` khi `left` thu thành rail, để `main` hiện lại mang empty state; quyết ở script nên modifier thua không bao giờ được gắn.

## 8. `CSelect` nằm trong `<label>`

- **`<li>` của menu dùng `.prevent`, không `.stop`** (`ui/CSelect.vue`) — activation behavior của `<label>` dội một click tổng hợp lên `.c-select-trigger` và mở lại menu vừa đóng; behavior đó chỉ chạy khi event chưa bị huỷ nên `preventDefault` là đủ. `.stop` chặn bubbling, làm hỏng `onClickOutside` và handler của component cha.
