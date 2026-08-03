---
name: write-design
description: Template viết design.md §1–§7 cho task phát triển. Reference skill — dùng nội bộ bởi designer agent.
user-invocable: false
---

# Write Design

Template và hướng dẫn viết tài liệu thiết kế `design.md` theo chuẩn dự án.

## Format từ project rule (bắt buộc)

Format của `design.md` **phải** lấy từ "Rule viết tài liệu" (doc-writing) mà orchestrator đã nạp và truyền vào `.dev-team-agent/project-rules.md`. Đọc phần đó và tuân theo cấu trúc section, văn phong, ngôn ngữ quy định ở đó.

**Nếu phần doc-writing trống / không có rule**: dừng xử lý, báo orchestrator — **không** dùng template bên dưới làm fallback. (Orchestrator đã validate doc-writing ở đầu pipeline nên trường hợp này hiếm.)

Template §1–§7 bên dưới chỉ là **ví dụ tham khảo cấu trúc**, không phải format chuẩn để áp dụng khi thiếu rule.

> Khi chạy độc lập không qua orchestrator: tự nạp doc-writing rule qua skill `read-project-rules` trước; vẫn áp dụng quy tắc bắt buộc ở trên.

## Cấu trúc `design.md`

```markdown
# Design — <task-id>: <tên task>

## §1. Tổng quan
<Mô tả ngắn gọn vấn đề cần giải quyết và giải pháp được chọn. 3–5 câu.>

## §2. Investigation Summary
<Tóm tắt những phát hiện quan trọng từ investigate.md.
Không copy toàn bộ — chỉ những điểm ảnh hưởng đến design decision.>

## §3. So sánh giải pháp

| Giải pháp | Ưu điểm | Nhược điểm | Lý do chọn/loại |
|---|---|---|---|
| Giải pháp A | ... | ... | ✅ Được chọn |
| Giải pháp B | ... | ... | ❌ Vì ... |

## §4. Implementation Details

### 4.1 Files cần sửa
| File | Thay đổi | Lý do |
|---|---|---|

### 4.2 Logic thay đổi
<Mô tả chi tiết logic mới. Dùng pseudocode nếu cần.>

### 4.3 DB changes (nếu có)
<Schema changes, migration plan.>

### 4.4 Edge cases
<Liệt kê các trường hợp đặc biệt và cách xử lý.>

## §5. Test Notes
<Các điểm cần test: normal flow, abnormal flow, regression risk.>

## §6. Out of scope
<Những thứ KHÔNG làm trong task này — để tránh scope creep.>

## §7. Schedule
| Phase | Ước tính | Ghi chú |
|---|---|---|
| Investigation | TBD | |
| Implementation | TBD | |
| Review | TBD | |
```

## Hướng dẫn viết

- **§1**: Viết sau cùng khi đã rõ toàn bộ design — tóm tắt cho người đọc lần đầu.
- **§3**: Luôn so sánh ít nhất 2 giải pháp, dù giải pháp thứ 2 là "giữ nguyên hiện tại".
- **§4.2**: Đủ chi tiết để implementer code mà không cần hỏi lại. Nếu không chắc → ghi câu hỏi vào `qa.md`.
- **§5**: Designer viết test notes, reviewer sẽ expand thành `test-spec.md` đầy đủ.

## Knowhow

Trước khi viết design, đọc `knowhow` để kiểm tra:
- Có pattern tương tự đã được giải quyết trước không?
- Có gotcha nào về tech stack của dự án liên quan đến task này không?
