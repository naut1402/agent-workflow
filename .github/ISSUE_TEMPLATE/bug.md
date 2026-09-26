---
name: Bug
about: Lỗi trên chức năng đã có
title: "[<TASK>] fix: "
labels: [bug]
---

## Tổng quan
- **Hiện trạng:** …
- **Trình tự tái hiện:**
  1. …

## Kết quả điều tra
<!-- Điền sau bước investigate / design. Chưa có tài liệu thì vẫn mô tả đủ để tiến hành được. -->
- **Phương án đối ứng:** …
- **Phạm vi thay đổi:** …
- **Ngoài phạm vi:** …

### Chi tiết kỹ thuật
<!--
Nơi các step pipeline publish tài liệu (investigate · design · test-spec · review-result · whitebox),
mỗi tài liệu một thẻ <details> giữa cặp marker task-doc — xem docs/agent-rules/git-pr.md §11.
Không sửa tay nội dung giữa hai marker: lượt publish sau sẽ ghi đè.
-->

## Kế hoạch
<!--
Phạm vi lớn: chia thành nhiều PR chỉnh sửa, mỗi PR một dòng — body mỗi PR ghi `Part of #<issue này>`.
Phạm vi nhỏ: ghi "Một PR".
Quy trình: docs/agent-rules/git-pr.md §5.2.
-->
- [ ] PR … — …

## Tài liệu liên quan
<!--
Không bắt buộc — agent tự quyết có thêm hay không.
Link tài liệu của issue khác, hoặc tài liệu yêu cầu nằm ngoài pipeline (spec, thiết kế UI, trao đổi với khách hàng…).
Tài liệu do pipeline của chính task này sinh ra thì ở "Kết quả điều tra › Chi tiết kỹ thuật", không ở đây.
-->
- …

## Checklist
<!-- Quy trình từng mục: docs/agent-rules/git-pr.md §5. -->
- [ ] Đã xác định release version — điểm checkout branch chung cho toàn bộ task
- [ ] Đã thiết lập milestone
- [ ] Đã thực hiện whitebox
- [ ] Đã thực hiện blackbox
