# Writing guideline — trình bày tài liệu và tham chiếu

Áp dụng cho **mọi** markdown viết ra trong repo này: artifact pipeline, tài liệu trong `docs/`, `README.md`, PR body, file rule.

---

## 1. Trình bày markdown

Scannability là ưu tiên số 1.

- **Đoạn văn tối đa 3 câu** — dài hơn thì tách đoạn hoặc chuyển thành list.
- **Từ 3 ý trở lên thì bắt buộc dùng bullet** (`-`), tuyệt đối không viết tràn vào một đoạn văn.
- **In đậm từ khoá ở đầu mỗi ý** (`**text**`) để người đọc lướt nhanh nắm được ý chính.
- **Luôn có 1 dòng trống** giữa các đoạn văn, giữa đoạn văn và list, giữa list và heading.
- **Bảng cho dữ liệu đối chiếu** — so sánh phương án, ánh xạ khoá, checklist theo cột. Đừng dùng bảng cho văn xuôi dài.
- **Một đoạn = một ý** — không nhồi nhiều ý vào cùng một đoạn, kể cả khi mỗi ý chỉ một câu.
- **Dùng callout cho cả khối, emoji cho từng dòng** — callout (GitHub Alerts) đánh dấu một đoạn đứng riêng theo bậc ở bảng dưới; emoji chỉ neo một gạch đầu dòng trong list. Không lồng hai thứ vào nhau.
- **Dùng emoji / ký hiệu làm mỏ neo thị giác** ở đầu dòng cho các mục cần quét nhanh: 📌 điểm chính · ⚠️ cảnh báo · 🚫 cấm · ✅ đạt · 🔍 khảo sát · 🛠️ implement · 🚀 phát hành. Mỗi ký hiệu mang **một** nghĩa cố định trong cùng tài liệu; không rải cho vui.
- **Dùng dấu phân tách `·` cho danh sách ngắn cùng hạng** — vd `coding · doc-writing · test · git-pr`. Danh sách dài hoặc có mô tả thì xuống bullet.
- **Không đặt checkbox trong ô bảng** — GFM chỉ render checkbox khi nó là *list item*. Cần checkbox thì viết thành list.
- **Không đặt ngân sách độ dài bằng số dòng** — số dòng không nói lên độ khó đọc. Dùng tiêu chí định tính, vd *scan được trong ~1 màn hình*.

### 1.1 Bậc callout

Chọn theo **hậu quả khi không tuân**, không theo cảm giác quan trọng. Một section có quá 2 callout là dấu hiệu lạm dụng — phần còn lại viết thành bullet thường.

| Callout | Dùng cho | Hậu quả khi vỡ |
|---|---|---|
| `[!IMPORTANT]` | **Triết lý / phương châm** — lý do tồn tại của cả tài liệu; thứ tự ưu tiên khi xung đột | Mọi quy tắc bên dưới mất nghĩa, người viết tối ưu sai mục tiêu |
| `[!CAUTION]` | **Hợp đồng công cụ** — thứ có code đang parse | Hỏng thật: viewer cắt đôi khối code, control không render, export sai khoá |
| `[!WARNING]` | **Quy tắc cứng** — đúng/sai rõ ràng, không tranh cãi được | Sản phẩm sai khuôn, người duyệt không tìm được mục cần đọc |
| `[!NOTE]` | **Phạm vi áp dụng / ngoại lệ** — rule này áp ở đâu, không áp ở đâu | Áp nhầm rule sang chỗ không thuộc phạm vi |
| `[!TIP]` | **Quy ước** — khuyến nghị về cách trình bày | Không sai, chỉ khó đọc hơn |

---

## 2. Tham chiếu một chiều giữa tài liệu

Chỉ **nơi sử dụng** trỏ tới **tài liệu dùng chung**. Không bao giờ thêm chiều ngược lại.

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

## 3. Anti-pattern

| Hiện tượng | Vì sao hỏng | Thay bằng |
|---|---|---|
| Một đoạn văn 6 câu liệt kê 5 thứ | Không lướt được, phải đọc hết mới biết có gì | 5 bullet, mỗi bullet mở đầu bằng từ khoá in đậm |
| `AGENTS.md` liệt kê `CLAUDE.md` trong bảng tài liệu | Thêm `GEMINI.md` là phải sửa tài liệu chung; bỏ `CLAUDE.md` để lại link chết | Chỉ `CLAUDE.md` trỏ lên `AGENTS.md`, chiều ngược lại bỏ hẳn |
