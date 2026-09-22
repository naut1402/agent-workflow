# Design guideline — giao diện và trình bày tài liệu

Quy tắc trình bày thứ người khác sẽ đọc: nút bấm và vùng cuộn trên dashboard (§1, §2), và markdown viết ra (§3).

---

## 1. Button

### 1.1 Nguyên tắc

1. **Ưu tiên icon button** hơn text button cho action UI (toolbar, row action, toggle, xóa/sửa/đóng).
2. **Default không có viền**: nền trong suốt, không border, không box-shadow.
3. **Hover scale up**: `transform: scale(1.15)` kèm đổi màu (muted → text), transition `0.12s ease`.

### 1.2 Khi nào được dùng text button

Chỉ khi nhãn chữ là bắt buộc để hiểu hành động:

- CTA xác nhận trong modal (`Lưu` / `Hủy`) — `.btn-primary` / `.btn-ghost`
- Submit form dài cần nhãn rõ
- Link-style inline — `.btn-link`
- Quick action có nhãn — `.btn-quick-action` (chi tiết class ở §1.5)

Không thêm border mặc định cho action icon mới; không dùng `.btn-ghost` làm mặc định cho row/toolbar action có thể biểu diễn bằng icon.

### 1.3 Ngoài phạm vi

- `.mode-btn` và rail sidebar: điều hướng layout, không phải row action — giữ pattern riêng.
- Không bắt buộc migrate ngay mọi text button cũ sang icon; quy ước áp dụng cho code mới và khi sửa chỗ liên quan.

### 1.4 Class chuẩn: `.icon-btn`

Class chuẩn nằm ở `src/frontend/styles/_shell.scss` (entry `src/frontend/styles/main.scss`).

Dùng `<button type="button" class="icon-btn">` + SVG bên trong.

| Modifier | Khi dùng |
|----------|----------|
| (không) | Action thường |
| `.active` | Trạng thái bật / được chọn (màu `--accent`) |
| `.danger` | Action phá hủy — hover dùng `--danger` |
| `.icon-btn-inline` | Action trong hàng danh sách (row) — **không** scale khi hover (tránh đẩy layout / hiện scrollbar). Gom cụm nút bằng `.icon-btn-group` (gap 0). |

Hover scale (`scale(1.15)`) chỉ dùng cho toolbar / standalone. Nút nằm cạnh nhau trong list item dùng `.icon-btn-inline`.

#### Accessibility & i18n

- Luôn có `type="button"` (trừ khi đúng là submit form).
- Luôn có `title` và `aria-label` qua `t(...)` — icon-only không có nhãn chữ nên phụ thuộc hai thuộc tính này.
- Icon bên trong dùng component chung `<Icon name="..." />` (`src/frontend/ui/Icon.vue`) — **không** tự vẽ tay `<svg>`/`<path>`. `Icon.vue` tự đặt `aria-hidden="true"` trên `<svg>` gốc.
- Không hardcode chuỗi UI — xem [`docs/convention/i18n.md`](../convention/i18n.md).

#### Ví dụ

```html
<!-- Đúng: icon action trong toolbar / danh sách -->
<button
  type="button"
  class="icon-btn"
  :title="t('runner.panel.deleteRunner')"
  :aria-label="t('runner.panel.deleteRunner')"
  @click="remove(item)"
>
  <Icon name="trash" />
</button>

<!-- Sai: tự vẽ tay SVG thay vì dùng Icon.vue -->
<button type="button" class="icon-btn" :title="..." :aria-label="...">
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <!-- path -->
  </svg>
</button>

<!-- Sai: text ghost khi icon đủ nghĩa -->
<button type="button" class="btn-ghost btn-sm">Xóa</button>
```

### 1.5 Class chuẩn: `.btn-quick-action`

Nút **có nhãn chữ** (label bắt buộc) cho quick action — cùng triết lý borderless + hover scale với `.icon-btn`. Dùng chung Monitor (`ArtifactPanel`) và menu dropdown quick action. Class nằm ở `src/frontend/styles/_shell.scss`.

```html
<button type="button" class="btn-quick-action" :title="..." :aria-label="...">
  {{ label }}
</button>
```

---

## 2. Chiến lược tràn nội dung

### 2.1 Nguyên tắc

1. **Chiến lược tràn là bắt buộc, không phải tuỳ chọn.** Vùng nội dung dài tuỳ dữ liệu phải có vùng cuộn giới hạn chiều cao **ngay từ lúc viết**, không đợi tới lúc có người báo "xem không hết".
2. **Không giả định "dữ liệu chắc là ngắn".** Catalog 7 agent hôm nay là 70 agent sau khi thêm plugin; danh sách rule của project dài ra theo thời gian. Layout đúng phải chịu được cả dữ liệu dài lẫn dữ liệu rỗng.
3. **Cắt cụt tệ hơn cuộn.** Nội dung bị cắt không để lại dấu hiệu nào trên UI — người dùng không biết là còn mục phía dưới. Vùng cuộn ít nhất luôn tự tố cáo bằng thanh cuộn.
4. **Một trục, một thanh cuộn.** Hai scroller lồng nhau trên cùng một trục là lỗi, không phải "cho chắc": chuột lăn rơi nhầm tầng và mục cuối vẫn có thể không tới được.

### 2.2 Chuỗi sizing chuẩn

Class nền nằm ở `src/frontend/styles/_shell.scss` (entry `src/frontend/styles/main.scss`).

Đọc từ ngoài vào, mỗi tầng có đúng một trách nhiệm:

```
container ngoài     overflow: hidden           ← KHÔNG cuộn, chỉ chặn tràn
└── tầng trung gian  display: flex; flex-direction: column
    │                flex: <chia chiều cao>; min-height: 0
    └── lá           flex: 1; min-height: 0; overflow-y: auto   ← DUY NHẤT cuộn
```

Ba cạm bẫy khiến chuỗi này gãy:

- **Thiếu `min-height: 0`.** Flex item mặc định có `min-height: auto` — nó không co nhỏ hơn nội dung, nên `overflow-y: auto` ở lá không bao giờ kích hoạt; phần thừa tràn ra ngoài hoặc bị cắt. `overflow` khác `visible` cũng thoát được ràng buộc này, nhưng đó là hiệu ứng phụ ngầm: cứ khai báo `min-height: 0` tường minh.
- **Trộn basis giữa các anh em cùng cấp.** `flex: 1` (basis `0%`) và `flex: 0 1 auto` (basis = chiều cao nội dung) đứng cạnh nhau thì hệ số co nhân với basis khác nhau: cái khai `flex: 1` bị bóp về 0px thay vì bật thanh cuộn. Các panel cùng cấp phải khai `flex` theo cùng một quy ước.
- **Scroller thứ hai ở container ngoài.** Đặt `overflow-y: auto` cho cả container lẫn lá thì container nuốt mất trách nhiệm cuộn của lá — đúng triệu chứng "kéo mãi không tới mục cuối".
- **Hộp ẩn xen giữa hai tầng.** Chuỗi chỉ liền mạch khi mỗi tầng là flex item *trực tiếp* của tầng trên. `<details>` là ca điển hình: Chrome ≥131 chèn hộp `::details-content` giữa `<details>` và nội dung, nên nội dung không còn là flex item trực tiếp và chuỗi đứt ngay đó — phải khai báo cả `::details-content` (`display: flex; flex: 1 1 0; min-height: 0; overflow: hidden`).

Khi một panel chỉ nên giành chiều cao lúc nội dung của nó đang mở, dùng **class modifier** (`--open`) thay vì để basis 0 cố định — panel đang đóng mà basis 0 vẫn chiếm nửa cột.

### 2.3 Hai ví dụ chuẩn trong repo

**Task list ở Monitor** — `src/features/monitor/styles/TaskList.scss`. `.tasklist-panel` là `flex` + `min-height: 0` + `overflow: hidden`; `.tasklist` là lá mang `overflow-y: auto; flex: 1; min-height: 0`. Hai chế độ sizing là hai class khác nhau: `.tasklist--active` chia phần còn lại, `.tasklist--archived` cap `max-height: min(40vh, 280px)`.

**Dialog `.modal`** — `src/frontend/styles/_shell.scss` ghi thẳng hợp đồng: *dialog dùng `.modal` PHẢI có đúng một `.modal-body` bọc phần nội dung*. `.modal` không khai báo `overflow`; nó dựa vào `.modal-body` (`flex: 1; min-height: 0; overflow-y: auto`) để hút phần cao quá `max-height: 88vh`. Đặt nội dung thẳng vào `.modal` thì khi vượt 88vh, hàng nút `.modal-actions` bị vẽ ra ngoài border dưới.

---

## 3. Trình bày markdown

Scannability là ưu tiên số 1.

Áp dụng cho **mọi** markdown viết ra: artifact, tài liệu trong `docs/`, `README.md`, PR body, file rule. Bố cục artifact `investigate.md` / `design.md`: [`doc-writing.md`](doc-writing.md).

- **Đoạn văn tối đa 3 câu** — dài hơn thì tách đoạn hoặc chuyển thành list.
- **Từ 3 ý trở lên thì bắt buộc dùng bullet** (`-`), tuyệt đối không viết tràn vào một đoạn văn.
- **In đậm từ khoá ở đầu mỗi ý** (`**text**`) để người đọc lướt nhanh nắm được ý chính.
- **Luôn có 1 dòng trống** giữa các đoạn văn, giữa đoạn văn và list, giữa list và heading.
- **Bảng cho dữ liệu đối chiếu** — so sánh phương án, ánh xạ khoá, checklist theo cột. Đừng dùng bảng cho văn xuôi dài.
- **Một đoạn = một ý** — không nhồi nhiều ý vào cùng một đoạn, kể cả khi mỗi ý chỉ một câu.
- **Dùng emoji / ký hiệu làm mỏ neo thị giác** ở đầu dòng cho các mục cần quét nhanh: 📌 điểm chính · ⚠️ cảnh báo · 🚫 cấm · ✅ đạt · 🔍 khảo sát · 🛠️ implement · 🚀 phát hành. Mỗi ký hiệu mang **một** nghĩa cố định trong cùng tài liệu; không rải cho vui.
- **Dùng dấu phân tách `·` cho danh sách ngắn cùng hạng** — vd `coding · doc-writing · test · git-pr`. Danh sách dài hoặc có mô tả thì xuống bullet.
