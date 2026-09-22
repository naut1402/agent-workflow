# Writing guideline — trình bày tài liệu và tham chiếu

Áp dụng cho **mọi** markdown viết ra trong repo này: artifact pipeline, tài liệu trong `docs/`, `README.md`, PR body, file rule.

§1 là tiền đề: nó quy định cách đánh dấu mức độ ràng buộc, và chính tài liệu này viết theo nó.

---

## 1. Quy ước màu sắc

> [!NOTE]
> <span style="color:#4493f8">Màu chọn theo câu hỏi **"vi phạm thì sao?"**, không theo cảm giác quan trọng.</span>

Xếp từ hậu quả nặng xuống nhẹ:

| Màu | Callout | Loại | Vi phạm thì sao |
|---|---|---|---|
| 🔴 Đỏ | `[!CAUTION]` | **Quy tắc** — đúng/sai máy móc, thường có code đang parse | **Hỏng thật**: công cụ đọc sai, viewer cắt đôi khối code, control không render |
| 🟡 Vàng | `[!WARNING]` | **Nguyên tắc** — ràng buộc nền suy ra từ triết lý, cần đọc hiểu mới áp được | Sản phẩm sai cấu trúc; người duyệt không tìm được thứ cần đọc |
| 🟣 Tím | `[!IMPORTANT]` | **Triết lý** — lý do tồn tại của cả tài liệu | Làm đúng hết mọi rule mà vẫn ra sản phẩm vô dụng: sai mục tiêu ngay từ đầu |
| 🔵 Xanh dương | `[!NOTE]` | **Phương châm** — chọn thế nào khi hai cái cùng đúng, hoặc khi xung đột | Không hỏng ngay, nhưng đi sai hướng ở mỗi ngã ba |
| 🟢 Xanh lá | `[!TIP]` | **Quy ước** — thống nhất cho dễ đọc | Không sai, chỉ khó đọc và thiếu nhất quán |

> [!TIP]
> <span style="color:#3fb950">Quá 2 callout trong một section là lạm dụng — phần còn lại viết thành bullet thường. Và không phải file nào cũng dùng đủ 5 màu: chỉ tô cái thật sự thuộc loại đó, không tô cho đủ bộ.</span>

### 1.1 Fallback khi renderer không hỗ trợ callout

Cú pháp `> [!CAUTION]` chỉ thành khối màu ở GitHub, VS Code và Obsidian. Dashboard render markdown bằng `marked` (`src/frontend/lib/markdownLib.ts`) — không hiểu cú pháp này nên hiện nguyên chữ `[!CAUTION]` trong một blockquote không màu.

Bọc **chính nội dung** callout trong `<span style>` cùng màu. Không thêm nhãn chữ kiểu `QUY TẮC —`: khi callout render được thì nhãn thành thừa.

```markdown
> [!CAUTION]
> <span style="color:#e5534b">Nội dung ràng buộc.</span>
```

| Renderer | Người đọc thấy |
|---|---|
| GitHub | Khối đỏ; `style` bị lọc nên chữ bên trong màu thường |
| Dashboard | Blockquote thường, chữ bên trong màu đỏ |
| VS Code · Obsidian | Khối đỏ, chữ bên trong cũng đỏ |

Hai lưu ý khi bọc:

- **Callout chứa list thì bọc từng gạch đầu dòng**, không bọc cả khối — `<span>` là thẻ inline, không ôm được block.
- **Markdown bên trong `<span>` vẫn parse** — `**đậm**` và `` `code` `` giữ nguyên tác dụng.

Mã màu chọn tông trung tính để đọc được trên cả nền sáng lẫn nền tối (dashboard mặc định nền tối):

| Loại | Mã màu |
|---|---|
| Quy tắc | `#e5534b` |
| Nguyên tắc | `#d29922` |
| Triết lý | `#a371f7` |
| Phương châm | `#4493f8` |
| Quy ước | `#3fb950` |

Dùng `<span style>`, không dùng `<font color>`: `font` là thẻ đã bỏ từ HTML5, và cả hai đều bị GitHub lọc như nhau nên không được gì thêm.

---

## 2. Trình bày markdown

> [!IMPORTANT]
> <span style="color:#a371f7">Scannability là ưu tiên số 1. Người đọc lướt trước rồi mới đọc kỹ — mọi quy ước dưới đây phục vụ lần lướt đó.</span>

- **Đoạn văn tối đa 3 câu** — dài hơn thì tách đoạn hoặc chuyển thành list.
- **Từ 3 ý trở lên thì bắt buộc dùng bullet** (`-`), tuyệt đối không viết tràn vào một đoạn văn.
- **In đậm từ khoá ở đầu mỗi ý** (`**text**`) để người đọc lướt nhanh nắm được ý chính.
- **Luôn có 1 dòng trống** giữa các đoạn văn, giữa đoạn văn và list, giữa list và heading.
- **Bảng cho dữ liệu đối chiếu** — so sánh phương án, ánh xạ khoá, checklist theo cột. Đừng dùng bảng cho văn xuôi dài.
- **Một đoạn = một ý** — không nhồi nhiều ý vào cùng một đoạn, kể cả khi mỗi ý chỉ một câu.
- **Dùng callout cho cả khối, emoji cho từng dòng** — callout đánh dấu một đoạn đứng riêng theo bậc ở §1; emoji chỉ neo một gạch đầu dòng trong list. Không lồng hai thứ vào nhau.
- **Dùng emoji / ký hiệu làm mỏ neo thị giác** ở đầu dòng cho các mục cần quét nhanh: 📌 điểm chính · ⚠️ cảnh báo · 🚫 cấm · ✅ đạt · 🔍 khảo sát · 🛠️ implement · 🚀 phát hành. Mỗi ký hiệu mang **một** nghĩa cố định trong cùng tài liệu; không rải cho vui.
- **Dùng dấu phân tách `·` cho danh sách ngắn cùng hạng** — vd `coding · doc-writing · test · git-pr`. Danh sách dài hoặc có mô tả thì xuống bullet.
- **Không đặt ngân sách độ dài bằng số dòng** — số dòng không nói lên độ khó đọc. Dùng tiêu chí định tính, vd *scan được trong ~1 màn hình*.

> [!CAUTION]
> <span style="color:#e5534b">Không đặt checkbox trong ô bảng — GFM chỉ render checkbox khi nó là *list item*. Cần checkbox thì viết thành list.</span>

---

## 3. Tham chiếu một chiều giữa tài liệu

> [!WARNING]
> <span style="color:#d29922">Chỉ **nơi sử dụng** trỏ tới **tài liệu dùng chung**. Không bao giờ thêm chiều ngược lại.</span>

- ✅ **Đúng** — `CLAUDE.md` → `AGENTS.md`; `docs/agent-rules/*` → `docs/architecture/`.
- 🚫 **Sai** — `AGENTS.md` liệt kê `CLAUDE.md`; `docs/architecture/` trỏ ngược lên rule.

**Vì sao:** tài liệu dùng chung không được biết ai đang dùng mình.

- **Bỏ một file chỉ dẫn** (vd không dùng `CLAUDE.md` nữa) → không phải sửa tài liệu chung.
- **Thêm file chỉ dẫn của provider khác** (vd `GEMINI.md`, `.cursorrules`) → chỉ thêm file mới, tài liệu chung đứng yên.
- **Tài liệu chung không phình ra** theo số công cụ đang dùng nó.

Cách áp dụng:

- **File chỉ dẫn của một công cụ** khai báo phụ thuộc bằng một dòng trỏ lên tài liệu chung, rồi chỉ viết phần đặc thù của mình.
- **Tài liệu chung** chỉ trỏ xuống nội dung nó sở hữu (rule, kiến trúc), không trỏ ngang sang file của công cụ khác.
- **Cùng một quy tắc chỉ viết ở một nơi** — nơi còn lại trỏ tới, không chép lại.

---

## 4. Anti-pattern

| Hiện tượng | Vì sao hỏng | Thay bằng |
|---|---|---|
| Một đoạn văn 6 câu liệt kê 5 thứ | Không lướt được, phải đọc hết mới biết có gì | 5 bullet, mỗi bullet mở đầu bằng từ khoá in đậm |
| `AGENTS.md` liệt kê `CLAUDE.md` trong bảng tài liệu | Thêm `GEMINI.md` là phải sửa tài liệu chung; bỏ `CLAUDE.md` để lại link chết | Chỉ `CLAUDE.md` trỏ lên `AGENTS.md`, chiều ngược lại bỏ hẳn |
| Tô callout cho mọi mục trong một section | Màu mất tác dụng phân biệt, đọc như không tô | Giữ tối đa 2, phần còn lại là bullet thường |
