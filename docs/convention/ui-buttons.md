# Quy ước — UI button

Áp dụng khi thêm/sửa nút trên dashboard.

1. **Ưu tiên icon button** hơn text button cho action UI (toolbar, row action, toggle, xóa/sửa/đóng).
2. **Default không có viền**: nền trong suốt, không border, không box-shadow.
3. **Hover scale up**: `transform: scale(1.15)` kèm đổi màu (muted → text), transition `0.12s ease`.

## Khi nào được dùng text button

Chỉ khi nhãn chữ là bắt buộc để hiểu hành động:

- CTA xác nhận trong modal (`Lưu` / `Hủy`) — `.btn-primary` / `.btn-ghost`
- Submit form dài cần nhãn rõ
- Link-style inline — `.btn-link`
- Quick action có nhãn — `.btn-quick-action` (xem chi tiết class ở cấp Code)

Không thêm border mặc định cho action icon mới; không dùng `.btn-ghost` làm mặc định cho row/toolbar action có thể biểu diễn bằng icon.

## Ngoài phạm vi

- `.mode-btn` và rail sidebar: điều hướng layout, không phải row action — giữ pattern riêng.
- Không bắt buộc migrate ngay mọi text button cũ sang icon; quy ước áp dụng cho code mới và khi sửa chỗ liên quan.

Chi tiết class/implementation: [`docs/architecture/4-code/ui-buttons.md`](../architecture/4-code/ui-buttons.md).
