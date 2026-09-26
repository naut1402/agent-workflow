---
name: Feature / Task
about: Tính năng mới, cải tiến, refactor, docs, chore, test
title: "[<TASK>] feat: "
labels: []
---

## Tổng quan
- **Bối cảnh:** …
- **Mong muốn:** …

## Kết quả điều tra
<!-- Điền sau bước investigate / design. Chưa có tài liệu thì vẫn mô tả đủ để tiến hành được. -->
- **Phương châm đối ứng:** …
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
Task lớn: chia thành các issue nhỏ hơn, mỗi issue một dòng — gắn làm sub issue của issue này.
Task nhỏ không cần chia: ghi "Không chia".
Quy trình: docs/agent-rules/git-pr.md §5.2.
-->
- [ ] #… — …

## Tài liệu liên quan
<!--
Không bắt buộc — agent tự quyết có thêm hay không.
Link tài liệu của issue khác, hoặc tài liệu yêu cầu nằm ngoài pipeline (spec, thiết kế UI, trao đổi với khách hàng…).
Tài liệu do pipeline của chính task này sinh ra thì ở "Kết quả điều tra › Chi tiết kỹ thuật", không ở đây.
-->
- …

## Checklist
<!-- Quy trình từng mục: docs/agent-rules/git-pr.md §5. -->
- [ ] Đã gán label theo type (feat→enhancement · fix→bug · docs→documentation · chore→chore · refactor→refactor · test→test)
- [ ] Đã xác định release version — điểm checkout branch chung cho toàn bộ task
- [ ] Đã thiết lập milestone
- [ ] (Task lớn — xoá mục này nếu không chia) Đã chia nhỏ thành các issue nhỏ hơn
  - [ ] Đã tạo branch chung `dev/x.y.z/{issue-slug}`
  - [ ] Đã đặt issue này làm issue cha của các sub issue; PR body của task con ghi `Part of #<issue này>`
  - [ ] Đã đặt các sub issue block issue này
