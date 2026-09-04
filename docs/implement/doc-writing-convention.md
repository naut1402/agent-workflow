# Doc-writing convention — `investigate.md` / `design.md`

Quy ước viết artifact markdown của dev pipeline trong `.dev-team-agent/tasks/<id>/`. Hub: [`AGENTS.md`](../../AGENTS.md) §7 (bản rút gọn, tự đủ để viết doc).

---

## 1. Nguyên tắc — đảo phễu thông tin

Artifact điều tra tồn tại để **ra quyết định**, không phải để lưu trữ mọi thứ đã đọc. Người duyệt (Tech Lead / PM / Designer) phải chốt được sau khi đọc phần đầu; chi tiết định vị code nằm ở cuối cho người trực tiếp implement và review PR.

Thứ tự bắt buộc là thứ tự **giảm dần theo số người cần đọc**:

| Section | Ai cần đọc | Trả lời câu hỏi |
|---|---|---|
| §1 Tổng quan | Mọi vai | Vấn đề gì, định làm gì, chạm tới đâu? |
| §2 Quyết định cần chốt | Người duyệt (Tech Lead / PM / Designer) | Tôi phải quyết những gì để task đi tiếp? |
| §3 Luồng xử lý & UX | Mọi vai | Sau thay đổi thì hệ thống chạy thế nào? |
| §4 Lưu ý kỹ thuật | Developer thực thi | Có cạm bẫy gì phải né khi code? |
| §5 Phạm vi ảnh hưởng & test | Developer, QA | Đụng module nào, test nào phủ? |
| §6 Phụ lục | Người review PR | Bằng chứng cụ thể ở đâu trong code? |

Hệ quả: một mục **chỉ xuất hiện ở đúng một section**. Chủ đề bị tách đôi (rủi ro ở chỗ này, câu hỏi ở chỗ khác) là lỗi cấu trúc — xem §5.

---

## 2. `investigate.md` — 6 section

### 2.1 Skeleton

Nguyên văn theo [`AGENTS.md`](../../AGENTS.md) §7 — khi hai bên lệch, `AGENTS.md` là đúng (đó là nguồn được bước quét rule đọc và được nhúng vào ngữ cảnh agent).

> Các dòng heading trong khối dưới thụt vào 1 space theo đúng quy tắc ở §4 — bỏ space khi áp dụng thật.

```markdown
 ## 7. Rule viết tài liệu — `investigate.md` / `design.md` (doc-writing)

Áp dụng cho artifact markdown trong `.dev-team-agent/tasks/<id>/`. Rule này **thắng** mọi template mặc định đi kèm công cụ sinh tài liệu.

 ### `investigate.md` — decision-first, 6 section

Đúng 6 heading `##`, đúng thứ tự, giữ nguyên tên:

1. `## 1. Tổng quan` — vấn đề, hướng giải quyết, phạm vi (module + số lượng), confidence tổng thể.
2. `## 2. Quyết định cần chốt` — bảng `| # | Nhóm | Vấn đề | Đề xuất mặc định | Nếu chọn khác | Người chốt |`, đánh số `D1…Dn`. Gom **mọi** rủi ro cần người quyết và câu hỏi mở vào đây; mỗi dòng bắt buộc có đề xuất mặc định để người duyệt chỉ việc đồng ý — nếu thật sự chưa có mặc định thì nêu ≥ 2 lựa chọn kèm điều kiện chọn, không để ô trống.
3. `## 3. Luồng xử lý & UX` — chỉ luồng chuẩn (happy path) và ghi chú UX. Chọn text flow / `mermaid sequenceDiagram` / `mermaid flowchart TD` theo độ phức tạp. Không chèn bug hay cạm bẫy kỹ thuật vào đây.
4. `## 4. Lưu ý kỹ thuật` — `G1…Gn`, mỗi mục theo *hiện tượng → nguyên nhân → cách xử lý*: cạm bẫy, xung đột, ràng buộc môi trường/branch. Rủi ro dev tự xử lý được nằm ở đây, không đẩy lên §2.
5. `## 5. Phạm vi ảnh hưởng & test` — một bảng gộp `| Module / File | Thay đổi dự kiến | Test hiện có | Confidence |` ở mức file/hàm/component; kèm vài câu blast radius, kết luận DB/schema và kết luận events (§6).
6. `## 6. Phụ lục` — dành cho người code và review PR: entry points, chi tiết `file:line`, DB/schema chi tiết, test coverage chi tiết, ghi chú khảo sát khác. Mỗi mục con là một `###`.

Bất biến:

- Chỉ `##` mới là section — viewer gập/sửa theo `##`; chi tiết bên trong dùng `###`. Không đặt `##` ở đầu dòng bên trong code fence: viewer cắt section không phân biệt fence nên sẽ cắt đôi khối code (thụt 1 space, hoặc dùng `###` trở xuống).
- `file:line` **chỉ** xuất hiện ở §4 và §6. §1–§3 và §5 nêu tên file/hàm/component, không kèm số dòng.
- §1 + §2 phải đủ để người duyệt chốt mà không cần đọc tiếp.
- Không xoá section vì "không có gì để ghi" — giữ đủ 6 section, ghi empty state tường minh (vd *Không có quyết định cần phê duyệt*, *Không đổi schema*, *Không có khía cạnh UX*).
- Không dùng checkbox `[ ]` trong ô bảng — không render thành control. Mục **blocking** phải đưa sang `qa.md`, mỗi câu một block `## Q<n>` + `**Lựa chọn:**` (list `- A. …`) + `**Trả lời:**`.
- Không đặt ngân sách độ dài bằng số dòng; tiêu chí là "đọc §1–§2 là chốt được".
```

### 2.2 Mục đích và tiêu chí từng section

#### §1. Tổng quan

- **Phải có**: vấn đề đang giải; hướng giải quyết đề xuất; phạm vi ở mức module (kèm số lượng, vd *2 mode có sub-sidebar, 7 mode còn lại giữ nguyên*); confidence tổng thể (High / Medium / Low).
- **Không thuộc về đây**: liệt kê file, số dòng, tên hàm, so sánh phương án chi tiết.
- Tiêu chí: người chưa biết task đọc xong nắm được *đang sửa cái gì và rộng cỡ nào*.

#### §2. Quyết định cần chốt

- **Phải có**: bảng `| # | Nhóm | Vấn đề | Đề xuất mặc định | Nếu chọn khác | Người chốt |`, đánh số `D1…Dn`.
  - `Nhóm`: Kiến trúc / UX / A11y / Scope / Vận hành… — giúp người duyệt bỏ qua nhóm không thuộc vai mình.
  - `Vấn đề`: một câu, nêu đúng cái phải chọn.
  - `Đề xuất mặc định`: phương án + lý do ngắn. Người duyệt chỉ cần trả lời "đồng ý".
  - `Nếu chọn khác`: hệ quả của việc không theo mặc định (thêm scope, thêm rủi ro, phải đợi ai).
  - `Người chốt`: vai cụ thể (Tech Lead / PM / Designer), không ghi "team".
- **Empty state**: task không có gì cần chốt thì **vẫn giữ section**, ghi rõ *Không có quyết định cần phê duyệt — có thể đi tiếp*. Xoá section khiến người duyệt không phân biệt được "không có" với "tác giả quên".
- **Không có đề xuất mặc định thật sự** (phụ thuộc thông tin chỉ PM/khách hàng có): không để ô trống, không ghi "cần thảo luận thêm". Nêu ≥ 2 lựa chọn + trade-off một dòng + điều kiện chọn — *nếu ưu tiên tốc độ → A; nếu ưu tiên đồng bộ UX → B*.
- **Gom theo chủ đề, không theo loại**: một rủi ro và một câu hỏi nói về cùng chuyện thì nằm **cùng một dòng**; cột `#` mang nhãn truy vết cả hai (vd `D3 (UX)`) và nhãn đó tra ngược được xuống §4/§6.
- Tiêu chí: tập quyết định ở §2 = tập quyết định của **toàn doc**. Không mục nào cần người quyết được xuất hiện lần đầu ở §3–§6.

#### §3. Luồng xử lý & UX

- **Phải có**: luồng chuẩn sau thay đổi, ở mức nghiệp vụ. Chọn dạng theo độ phức tạp — flow thẳng → text flow; 3+ bước hoặc có actor tương tác → `mermaid sequenceDiagram`; nhiều nhánh điều kiện → `mermaid flowchart TD`.
- **Được phép**: ghi chú UX về hành vi sản phẩm (vd *đóng panel làm mất state đang nhập vì component bị unmount*) — đó là thứ người duyệt cần biết.
- **Không thuộc về đây**: bug kỹ thuật ngầm, xung đột thư viện, thứ tự bắt sự kiện, selector, số dòng. Chèn chúng vào giữa flowchart làm đứt mạch đọc → đẩy hết sang §4.
- **Task không có mặt UX** (backend, tooling, CI): phần luồng mô tả luồng xử lý; phần UX ghi *Không áp dụng*. Không bịa nội dung UX cho đủ mục.

#### §4. Lưu ý kỹ thuật

- **Phải có**: các mục `G1…Gn`, mỗi mục đủ ba phần *hiện tượng → nguyên nhân → cách xử lý*. Caveat chỉ mô tả vấn đề mà không nói cách xử lý là chưa xong.
- Bao gồm cả ràng buộc phi-code: base branch phải tạo trước khi mở PR, biến môi trường bắt buộc, thứ tự migrate, giới hạn của công cụ.
- **Ranh giới với §2**: xem §2.3.
- Đây là section đầu tiên được phép dùng `file:line`.

#### §5. Phạm vi ảnh hưởng & test

- **Một bảng duy nhất** `| Module / File | Thay đổi dự kiến | Test hiện có | Confidence |` — không tách "files cần sửa" và "test coverage" thành hai bảng lặp lại cùng danh sách file.
  - Cột `Test hiện có`: test đang phủ / test cần thêm / *không có test*.
  - Mức mô tả: đường dẫn file + tên hàm/component. **Không số dòng** — code đổi sau vài commit là tài liệu sai.
- Kèm vài câu blast radius (cái gì ngoài danh sách trên có thể vỡ), kết luận DB/schema, kết luận events theo [`AGENTS.md`](../../AGENTS.md) §6.
- **Empty state**: không chạm schema thì ghi *Không đổi schema*; không đụng event thì ghi *Events: không đổi — vì …*. Bỏ trống im lặng là chưa kết luận.

#### §6. Phụ lục

- Dành cho người trực tiếp code hoặc review PR: entry points, chi tiết `file:line`, DB/schema chi tiết, test coverage chi tiết, ghi chú khảo sát không lên được các section trên.
- Mỗi mục con là một `###`, tiêu đề tự mô tả để tra theo nhãn từ §2/§4.
- **Không** chứa mục cần phê duyệt nào chưa có ở §2.
- Được phép dài — viewer gập sẵn theo `##` nên section này không gây tải cho người duyệt.

#### Ánh xạ sang `pipeline-export.json`

Khi task bật `export_json = true`, phần `phases.investigator` lấy nguồn từ:

| Khoá | Nguồn trong `investigate.md` |
|---|---|
| `overall_confidence` | Confidence tổng thể ở §1 |
| `entry_points` | Mục entry points ở §6 |
| `files_to_modify` | Bảng gộp ở §5 (cột `Module / File` + `Confidence`) |
| `open_questions` | Các dòng §2 chưa chốt (non-blocking) |
| `related_files_count` | Số dòng của bảng §5 |

### 2.3 §2 Quyết định vs §4 Lưu ý kỹ thuật

Cùng là "chuyện có rủi ro", nhưng khác ở chỗ **ai phải xử lý**:

| | §2 Quyết định cần chốt | §4 Lưu ý kỹ thuật |
|---|---|---|
| Ai xử lý | Cần người ngoài dev chốt | Dev tự xử lý trong phạm vi task |
| Dấu hiệu | Ảnh hưởng phạm vi hoặc hành vi sản phẩm; có ≥ 2 phương án hợp lệ | Chỉ có một cách đúng, chỉ là dễ sai nếu không biết trước |
| Ví dụ | Ẩn panel thì thu về 0px hay giữ cột rỗng? | Thư viện bắt sự kiện ở capture phase nên phải thêm selector vào `ignore` |

Một chủ đề chỉ nằm ở đúng một trong hai. Nếu một mục ở §4 kết thúc bằng câu hỏi mở cho người khác → nó thuộc §2, kéo lên.

### 2.4 Câu hỏi blocking → `qa.md`

Bảng §2 là kênh **thông tin và đề xuất**: nó không phải control tương tác, ô "phê duyệt" trong bảng markdown không render thành checkbox (xem §4).

Câu hỏi **blocking** — không trả lời thì không đi tiếp được — vẫn đi qua cơ chế sẵn có: tạo `qa.md`, mỗi câu một block `## Q<n>` + `**Lựa chọn:**` (list `- A. …`) + `**Trả lời:**`, rồi dừng. Đó là dạng duy nhất render thành radio để người duyệt chốt trực tiếp.

Mục non-blocking chốt qua feedback ở HITL gate, không cần `qa.md`.

---

## 3. `design.md` — 7 section

Rule 6 section ở §2 **chỉ áp cho `investigate.md`**. `design.md` giữ nguyên bố cục:

`## §1. Tổng quan` / `§2. Investigation Summary` / `§3. So sánh giải pháp` (ít nhất 2 phương án, kể cả "giữ nguyên hiện trạng") / `§4. Implementation Details` (4.1 Files, 4.2 Logic, 4.3 DB, 4.4 Edge cases) / `§5. Test Notes` / `§6. Out of scope` / `§7. Schedule`.

§4 phải đủ chi tiết để implement mà không phải hỏi lại — đây là section được phép dùng `file:line` thoải mái.

---

## 4. Quy tắc chung

- **Heading cấp 2 là đơn vị gập/sửa của viewer.** Artifact được tách section theo `##`; ở block mode mỗi section là một khối gập/sửa độc lập. Mục muốn gập riêng phải là `##`; chi tiết bên trong dùng `###` trở xuống.
- **Không để `##` ở đầu dòng bên trong code fence.** Bước tách section không phân biệt fence nên sẽ cắt đôi khối code — phần mở và đóng fence rơi vào hai section khác nhau và render vỡ. Thụt heading 1 space, hoặc dùng `###` trở xuống.
- **`file:line` chỉ ở §4 và §6 của `investigate.md`, và §4 của `design.md`.** Chỗ khác nêu tên file + tên hàm/component.
- **Không checkbox trong ô bảng.** Theo GFM, task list chỉ render thành checkbox khi là *list item*; đặt `[ ]` trong ô bảng chỉ ra text tĩnh. Đừng mô tả ô đó như nút bấm được — cần chốt tương tác thì hướng sang `qa.md`.
- **Confidence High / Medium / Low** cho mọi phát hiện chưa chắc, kèm lý do khi Medium/Low.
- **Không đặt ngân sách độ dài bằng số dòng.** Tiêu chí định tính: §1–§2 scan được trong ~1 màn hình; phần dài dồn xuống §5–§6.
- **Rule của project thắng template mặc định** của công cụ sinh tài liệu: số section, tên section và thứ tự lấy từ rule, kể cả khi tài liệu tham khảo khác mô tả bố cục khác.
- Không migrate ngược artifact của task cũ. Quy ước này áp cho task tạo từ thời điểm nó land.

---

## 5. Anti-pattern

| Hiện tượng | Vì sao hỏng | Thay bằng |
|---|---|---|
| Câu hỏi trần trong bảng quyết định, ô đề xuất trống hoặc ghi "cần thảo luận thêm" | Đẩy việc nghĩ giải pháp sang người duyệt — họ có ít ngữ cảnh code nhất | Đề xuất mặc định + lý do một dòng; không có mặc định thì ≥ 2 lựa chọn kèm điều kiện chọn |
| Chèn cạm bẫy kỹ thuật (xung đột thư viện, capture phase, selector) vào giữa flowchart | Đứt mạch đọc luồng nghiệp vụ; người duyệt không phân biệt được "hệ thống chạy vậy" với "chỗ này dễ sai" | Flowchart giữ happy path; cạm bẫy sang §4 dạng *hiện tượng → nguyên nhân → cách xử lý* |
| Số dòng code trong bảng phạm vi (`Foo.vue:139-147`) | Người duyệt không cần; và sai sau vài commit khiến cả tài liệu mất tin cậy | Tên file + tên hàm/component ở §5; số dòng để §6 |
| Hai bảng lặp cùng danh sách file ("files cần sửa" + "test coverage") | Đọc hai lần mới ghép được file nào có test | Một bảng gộp, thêm cột `Test hiện có` |
| Một chủ đề tách đôi: rủi ro ở section này, câu hỏi ở section kia | Người duyệt phải tự ghép mới thấy đó là một quyết định | Một dòng ở §2, nhãn truy vết cả hai, chi tiết ở §4/§6 |
| Xoá section vì "task này không có gì để ghi" | Người đọc không phân biệt "không có" với "tác giả quên" | Giữ section, ghi empty state tường minh |
| Rủi ro chỉ nêu vấn đề, không nói cách xử lý | Người thực thi vẫn phải điều tra lại từ đầu | Mỗi caveat kết thúc bằng hành động cụ thể |
