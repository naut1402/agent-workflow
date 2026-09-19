# UI button — class chuẩn

← [`README.md`](README.md) (Cấp 4 · Code)

Chi tiết implementation cho quy ước nút. Quy ước: [`docs/convention/ui-buttons.md`](../../convention/ui-buttons.md).

Class chuẩn nằm ở `src/frontend/styles/_shell.scss` (entry `src/frontend/styles/main.scss`).

## Class chuẩn: `.icon-btn`

Dùng `<button type="button" class="icon-btn">` + SVG bên trong.

| Modifier | Khi dùng |
|----------|----------|
| (không) | Action thường |
| `.active` | Trạng thái bật / được chọn (màu `--accent`) |
| `.danger` | Action phá hủy — hover dùng `--danger` |
| `.icon-btn-inline` | Action trong hàng danh sách (row) — **không** scale khi hover (tránh đẩy layout / hiện scrollbar). Gom cụm nút bằng `.icon-btn-group` (gap 0). |

Hover scale (`scale(1.15)`) chỉ dùng cho toolbar / standalone. Nút nằm cạnh nhau trong list item dùng `.icon-btn-inline`.

### Accessibility & i18n

- Luôn có `type="button"` (trừ khi đúng là submit form).
- Luôn có `title` và `aria-label` qua `t(...)` — icon-only không có nhãn chữ nên phụ thuộc hai thuộc tính này.
- Icon bên trong dùng component chung `<Icon name="..." />` (`src/frontend/ui/Icon.vue`) — **không** tự vẽ tay `<svg>`/`<path>`. `Icon.vue` tự đặt `aria-hidden="true"` trên `<svg>` gốc.
- Không hardcode chuỗi UI — xem [`i18n.md`](i18n.md).

### Ví dụ

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

## Class chuẩn: `.btn-quick-action`

Nút **có nhãn chữ** (label bắt buộc) cho quick action — cùng triết lý borderless + hover scale với `.icon-btn`. Dùng chung Monitor (`ArtifactPanel`) và menu dropdown quick action. Class nằm ở `src/frontend/styles/_shell.scss`.

```html
<button type="button" class="btn-quick-action" :title="..." :aria-label="...">
  {{ label }}
</button>
```
