# Quy ước UI button

Quy ước dùng chung cho người và AI agent khi thêm/sửa nút trên dashboard. Class chuẩn nằm ở `src/styles/_shell.scss` (entry `src/styles/main.scss`).

## Nguyên tắc

1. **Ưu tiên icon button** hơn text button cho action UI (toolbar, row action, toggle, xóa/sửa/đóng).
2. **Default không có viền**: nền trong suốt, không border, không box-shadow.
3. **Hover scale up**: `transform: scale(1.15)` kèm đổi màu (muted → text), transition `0.12s ease`.

## Class chuẩn: `.icon-btn`

Dùng `<button type="button" class="icon-btn">` + SVG bên trong.

| Modifier | Khi dùng |
|----------|----------|
| (không) | Action thường |
| `.active` | Trạng thái bật / được chọn (màu `--accent`) |
| `.danger` | Action phá hủy — hover dùng `--danger` |

### Accessibility & i18n

- Luôn có `type="button"` (trừ khi đúng là submit form).
- Luôn có `title` và `aria-label` qua `t(...)` — icon-only không có nhãn chữ nên phụ thuộc hai thuộc tính này.
- SVG trang trí: `aria-hidden="true"`.
- Không hardcode chuỗi UI (xem quy ước i18n trong `AGENTS.md` §3.6).

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
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <!-- path -->
  </svg>
</button>

<!-- Sai: text ghost khi icon đủ nghĩa -->
<button type="button" class="btn-ghost btn-sm">Xóa</button>
```

## Khi nào được dùng text button

Chỉ khi nhãn chữ là bắt buộc để hiểu hành động:

- CTA xác nhận trong modal (`Lưu` / `Hủy`) — `.btn-primary` / `.btn-ghost`
- Submit form dài cần nhãn rõ
- Link-style inline — `.btn-link`

Không thêm border mặc định cho action icon mới; không dùng `.btn-ghost` làm mặc định cho row/toolbar action có thể biểu diễn bằng icon.

## Ngoài phạm vi

- `.mode-btn` và rail sidebar: điều hướng layout, không phải row action — giữ pattern riêng.
- Không bắt buộc migrate ngay mọi text button cũ sang icon; quy ước áp dụng cho code mới và khi sửa chỗ liên quan.
