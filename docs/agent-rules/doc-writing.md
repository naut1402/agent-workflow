# Doc writing — artifact `investigate.md` / `design.md`

Áp dụng cho artifact markdown của pipeline trong `.dev-team-agent/tasks/<id>/`.

Rule này **thắng** mọi template mặc định đi kèm công cụ sinh tài liệu: số section, tên section và thứ tự lấy từ đây.

---

## 1. Nguyên tắc — đảo phễu thông tin

Artifact tồn tại để **ra quyết định**, không phải để lưu trữ mọi thứ đã đọc.

- **Người duyệt chốt ở phần đầu** — Tech Lead / PM / Designer đọc §1–§2 là quyết được.
- **Người code đọc phần cuối** — chi tiết định vị code dồn xuống section sau.
- **Thứ tự = giảm dần số người cần đọc** — không đảo, không chèn.
- **Một mục chỉ nằm ở đúng một section** — chủ đề bị tách đôi (rủi ro ở đây, câu hỏi ở kia) là lỗi cấu trúc.

| Section | Ai cần đọc | Trả lời câu hỏi |
|---|---|---|
| §1 Tổng quan | Mọi vai | Vấn đề gì, định làm gì, chạm tới đâu? |
| §2 Quyết định cần chốt | Người duyệt | Tôi phải quyết gì để task đi tiếp? |
| §3 Luồng xử lý & UX | Mọi vai | Sau thay đổi thì hệ thống chạy thế nào? |
| §4 Lưu ý kỹ thuật | Developer | Có cạm bẫy gì phải né khi code? |
| §5 Phạm vi ảnh hưởng & test | Developer, QA | Đụng module nào, test nào phủ? |
| §6 Phụ lục | Người review PR | Bằng chứng cụ thể ở đâu trong code? |

---

## 2. `investigate.md` — 6 section decision-first

Đúng 6 heading `##`, đúng thứ tự, giữ nguyên tên.

1. **`## 1. Tổng quan`** — vấn đề đang giải, hướng giải quyết, phạm vi ở mức module (kèm số lượng), confidence tổng thể.
2. **`## 2. Quyết định cần chốt`** — bảng `| # | Nhóm | Vấn đề | Đề xuất mặc định | Nếu chọn khác | Người chốt |`, đánh số `D1…Dn`.
3. **`## 3. Luồng xử lý & UX`** — chỉ happy path và ghi chú UX.
4. **`## 4. Lưu ý kỹ thuật`** — `G1…Gn`, mỗi mục theo *hiện tượng → nguyên nhân → cách xử lý*.
5. **`## 5. Phạm vi ảnh hưởng & test`** — một bảng gộp `| Module / File | Thay đổi dự kiến | Test hiện có | Confidence |`.
6. **`## 6. Phụ lục`** — entry point, `file:line`, DB/schema chi tiết, test coverage chi tiết. Mỗi mục con là một `###`.

### 2.1 §1 Tổng quan

- **Phải có** — vấn đề đang giải; hướng giải quyết đề xuất; phạm vi mức module kèm số lượng (vd *2 mode có sub-sidebar, 7 mode giữ nguyên*); confidence tổng thể (High / Medium / Low).
- **Không thuộc về đây** — liệt kê file, số dòng, tên hàm, so sánh phương án chi tiết.
- **Tiêu chí** — người chưa biết task đọc xong nắm được *đang sửa cái gì, rộng cỡ nào*.

### 2.2 §2 Quyết định cần chốt

Ý nghĩa từng cột:

- **`Nhóm`** — Kiến trúc / UX / A11y / Scope / Vận hành… để người duyệt bỏ qua nhóm không thuộc vai mình.
- **`Vấn đề`** — một câu, nêu đúng cái phải chọn.
- **`Đề xuất mặc định`** — phương án + lý do ngắn; người duyệt chỉ cần trả lời "đồng ý".
- **`Nếu chọn khác`** — hệ quả khi không theo mặc định (thêm scope, thêm rủi ro, phải đợi ai).
- **`Người chốt`** — vai cụ thể (Tech Lead / PM / Designer), không ghi "team".

Ràng buộc:

- **Không để ô trống** — chưa có mặc định thật sự thì nêu ≥ 2 lựa chọn + trade-off một dòng + điều kiện chọn (*ưu tiên tốc độ → A; ưu tiên đồng bộ UX → B*).
- **Gom theo chủ đề, không theo loại** — một rủi ro và một câu hỏi cùng chuyện thì nằm **cùng một dòng**; nhãn ở cột `#` (vd `D3 (UX)`) tra ngược được xuống §4/§6.
- **Empty state tường minh** — không có gì cần chốt thì vẫn giữ section, ghi *Không có quyết định cần phê duyệt — có thể đi tiếp*.
- **Tập quyết định ở §2 = tập quyết định của toàn doc** — không mục nào cần người quyết được xuất hiện lần đầu ở §3–§6.

### 2.3 §3 Luồng xử lý & UX

- **Phải có** — luồng chuẩn sau thay đổi, ở mức nghiệp vụ.
- **Chọn dạng theo độ phức tạp** — flow thẳng → text flow; 3+ bước hoặc có actor → `mermaid sequenceDiagram`; nhiều nhánh điều kiện → `mermaid flowchart TD`.
- **Được phép** — ghi chú UX về hành vi sản phẩm (vd *đóng panel làm mất state đang nhập vì component bị unmount*).
- **Không thuộc về đây** — bug kỹ thuật ngầm, xung đột thư viện, thứ tự bắt sự kiện, selector, số dòng. Đẩy hết sang §4.
- **Task không có mặt UX** (backend, tooling, CI) — phần UX ghi *Không áp dụng*, không bịa cho đủ mục.

### 2.4 §4 Lưu ý kỹ thuật

- **Đủ ba phần mỗi mục** — *hiện tượng → nguyên nhân → cách xử lý*. Caveat chỉ nêu vấn đề mà không nói cách xử lý là chưa xong.
- **Gồm cả ràng buộc phi-code** — base branch phải tạo trước khi mở PR, biến môi trường bắt buộc, thứ tự migrate, giới hạn công cụ.
- **Đây là section đầu tiên được phép dùng `file:line`.**

### 2.5 §5 Phạm vi ảnh hưởng & test

- **Một bảng duy nhất** — không tách "files cần sửa" và "test coverage" thành hai bảng lặp cùng danh sách file.
- **Cột `Test hiện có`** — test đang phủ / test cần thêm / *không có test*.
- **Mức mô tả** — đường dẫn file + tên hàm/component, **không** số dòng.
- **Kèm kết luận** — vài câu blast radius, kết luận DB/schema, kết luận events (thêm / sửa / xoá emit, hoặc *không đổi* kèm lý do).
- **Empty state** — *Không đổi schema* / *Events: không đổi — vì …*. Bỏ trống im lặng là chưa kết luận.

### 2.6 §6 Phụ lục

- **Dành cho người code và review PR** — entry point, `file:line`, DB/schema chi tiết, test coverage chi tiết, ghi chú khảo sát còn lại.
- **Mỗi mục con là một `###`**, tiêu đề tự mô tả để tra theo nhãn từ §2/§4.
- **Không** chứa mục cần phê duyệt nào chưa có ở §2.
- **Được phép dài** — viewer gập sẵn theo `##` nên section này không gây tải cho người duyệt.

### 2.7 Ranh giới §2 và §4

Cùng là "chuyện có rủi ro", khác ở chỗ **ai phải xử lý**:

| | §2 Quyết định cần chốt | §4 Lưu ý kỹ thuật |
|---|---|---|
| Ai xử lý | Cần người ngoài dev chốt | Dev tự xử lý trong phạm vi task |
| Dấu hiệu | Ảnh hưởng phạm vi / hành vi sản phẩm; có ≥ 2 phương án hợp lệ | Chỉ có một cách đúng, chỉ là dễ sai nếu không biết trước |
| Ví dụ | Ẩn panel thì thu về 0px hay giữ cột rỗng? | Thư viện bắt sự kiện ở capture phase nên phải thêm selector vào `ignore` |

Một mục ở §4 mà kết thúc bằng câu hỏi mở cho người khác → nó thuộc §2, kéo lên.

### 2.8 Câu hỏi blocking → `qa.md`

- **Bảng §2 là kênh thông tin**, không phải control tương tác — ô "phê duyệt" trong bảng markdown không render thành checkbox.
- **Câu hỏi blocking** (không trả lời thì không đi tiếp được) tạo `qa.md` rồi dừng.
- **Mỗi câu một block** — `## Q<n>` + `**Lựa chọn:**` (list `- A. …`) + `**Trả lời:**`. Đó là dạng duy nhất render thành radio.
- **Mục non-blocking** chốt qua feedback ở HITL gate, không cần `qa.md`.

### 2.9 Ánh xạ sang `pipeline-export.json`

Khi task bật `export_json = true`, phần `phases.investigator` lấy nguồn từ:

| Khoá | Nguồn trong `investigate.md` |
|---|---|
| `overall_confidence` | Confidence tổng thể ở §1 |
| `entry_points` | Mục entry points ở §6 |
| `files_to_modify` | Bảng gộp ở §5 (cột `Module / File` + `Confidence`) |
| `open_questions` | Các dòng §2 chưa chốt (non-blocking) |
| `related_files_count` | Số dòng của bảng §5 |

---

## 3. `design.md` — 7 section

Rule 6 section ở §2 **chỉ áp cho `investigate.md`**. `design.md` giữ bố cục riêng:

1. `## §1. Tổng quan`
2. `## §2. Investigation Summary`
3. `## §3. So sánh giải pháp` — ít nhất 2 phương án, kể cả "giữ nguyên hiện trạng"
4. `## §4. Implementation Details` — 4.1 Files, 4.2 Logic, 4.3 DB, 4.4 Edge cases
5. `## §5. Test Notes`
6. `## §6. Out of scope`
7. `## §7. Schedule`

§4 phải đủ chi tiết để implement mà không phải hỏi lại — đây là section được phép dùng `file:line` thoải mái.

---

## 4. Bất biến chung mọi artifact

- **Chỉ `##` mới là section** — viewer gập/sửa theo `##`; chi tiết bên trong dùng `###` trở xuống.
- **Không để `##` ở đầu dòng bên trong code fence** — bước tách section không phân biệt fence nên sẽ cắt đôi khối code. Thụt 1 space, hoặc dùng `###` trở xuống.
- **`file:line` chỉ ở §4 và §6 của `investigate.md`, và §4 của `design.md`** — chỗ khác nêu tên file + tên hàm/component.
- **Không checkbox trong ô bảng** — GFM chỉ render checkbox khi là *list item*. Cần chốt tương tác thì hướng sang `qa.md`.
- **Confidence High / Medium / Low** cho mọi phát hiện chưa chắc, kèm lý do khi Medium/Low.
- **Không đặt ngân sách độ dài bằng số dòng** — tiêu chí định tính: §1–§2 scan được trong ~1 màn hình.
- **Không xoá section vì "không có gì để ghi"** — giữ đủ section, ghi empty state tường minh.
- **Không migrate ngược artifact của task cũ** — quy ước áp cho task tạo từ thời điểm nó land.

---

## 5. Trình bày — scannability là ưu tiên số 1

Áp dụng cho **mọi** markdown viết ra: artifact, tài liệu trong `docs/`, `README.md`, PR body, file rule.

- **Đoạn văn tối đa 3 câu** — dài hơn thì tách đoạn hoặc chuyển thành list.
- **Từ 3 ý trở lên thì bắt buộc dùng bullet** (`-`), tuyệt đối không viết tràn vào một đoạn văn.
- **In đậm từ khoá ở đầu mỗi ý** (`**text**`) để người đọc lướt nhanh nắm được ý chính.
- **Luôn có 1 dòng trống** giữa các đoạn văn, giữa đoạn văn và list, giữa list và heading.
- **Bảng cho dữ liệu đối chiếu** — so sánh phương án, ánh xạ khoá, checklist theo cột. Đừng dùng bảng cho văn xuôi dài.
- **Một đoạn = một ý** — không nhồi nhiều ý vào cùng một đoạn, kể cả khi mỗi ý chỉ một câu.
- **Dùng emoji / ký hiệu làm mỏ neo thị giác** ở đầu dòng cho các mục cần quét nhanh: 📌 điểm chính · ⚠️ cảnh báo · 🚫 cấm · ✅ đạt · 🔍 khảo sát · 🛠️ implement · 🚀 phát hành. Mỗi ký hiệu mang **một** nghĩa cố định trong cùng tài liệu; không rải cho vui.
- **Dùng dấu phân tách `·` cho danh sách ngắn cùng hạng** — vd `coding · doc-writing · test · git-pr`. Danh sách dài hoặc có mô tả thì xuống bullet.

---

## 6. Tham chiếu một chiều

Chỉ **nơi sử dụng** trỏ tới **tài liệu dùng chung**. Không bao giờ thêm chiều ngược lại.

- ✅ **Đúng** — `CLAUDE.md` → `AGENTS.md`; `docs/agent-rules/*` → `docs/architecture.md`.
- 🚫 **Sai** — `AGENTS.md` liệt kê `CLAUDE.md`; `docs/architecture.md` trỏ ngược lên rule.

**Vì sao:** tài liệu dùng chung không được biết ai đang dùng mình.

- **Bỏ một file chỉ dẫn** (vd không dùng `CLAUDE.md` nữa) → không phải sửa tài liệu chung.
- **Thêm file chỉ dẫn của provider khác** (vd `GEMINI.md`, `.cursorrules`) → chỉ thêm file mới, tài liệu chung đứng yên.
- **Tài liệu chung không phình ra** theo số công cụ đang dùng nó.

Cách áp dụng:

- **File chỉ dẫn của một công cụ** khai báo phụ thuộc bằng một dòng trỏ lên tài liệu chung, rồi chỉ viết phần đặc thù của mình.
- **Tài liệu chung** chỉ trỏ xuống nội dung nó sở hữu (rule, kiến trúc), không trỏ ngang sang file của công cụ khác.
- **Cùng một quy tắc chỉ viết ở một nơi** — nơi còn lại trỏ tới, không chép lại.

---

## 7. Anti-pattern

| Hiện tượng | Vì sao hỏng | Thay bằng |
|---|---|---|
| Câu hỏi trần trong bảng quyết định, ô đề xuất trống hoặc "cần thảo luận thêm" | Đẩy việc nghĩ giải pháp sang người có ít ngữ cảnh code nhất | Đề xuất mặc định + lý do một dòng; hoặc ≥ 2 lựa chọn kèm điều kiện chọn |
| Chèn cạm bẫy kỹ thuật vào giữa flowchart | Đứt mạch đọc luồng nghiệp vụ | Flowchart giữ happy path; cạm bẫy sang §4 |
| Số dòng code trong bảng phạm vi (`Foo.vue:139-147`) | Sai sau vài commit, làm cả tài liệu mất tin cậy | Tên file + tên hàm/component ở §5; số dòng để §6 |
| Hai bảng lặp cùng danh sách file | Đọc hai lần mới ghép được file nào có test | Một bảng gộp, thêm cột `Test hiện có` |
| Một chủ đề tách đôi ở hai section | Người duyệt phải tự ghép mới thấy đó là một quyết định | Một dòng ở §2, nhãn truy vết, chi tiết ở §4/§6 |
| Xoá section vì "task này không có gì để ghi" | Không phân biệt được "không có" với "tác giả quên" | Giữ section, ghi empty state tường minh |
| Rủi ro chỉ nêu vấn đề, không nói cách xử lý | Người thực thi phải điều tra lại từ đầu | Mỗi caveat kết thúc bằng hành động cụ thể |
| Một đoạn văn 6 câu liệt kê 5 thứ | Không lướt được, phải đọc hết mới biết có gì | 5 bullet, mỗi bullet mở đầu bằng từ khoá in đậm |
| `AGENTS.md` liệt kê `CLAUDE.md` trong bảng tài liệu | Thêm `GEMINI.md` là phải sửa tài liệu chung; bỏ `CLAUDE.md` để lại link chết | Chỉ `CLAUDE.md` trỏ lên `AGENTS.md`, chiều ngược lại bỏ hẳn |
