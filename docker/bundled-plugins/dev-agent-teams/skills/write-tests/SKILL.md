---
name: write-tests
description: Quy ước viết test spec từ design. Reference skill — dùng nội bộ bởi reviewer agent.
user-invocable: false
---

# Write Tests

Hướng dẫn tạo `test-spec.md` từ `design.md` và `review.md`.

## Rule từ project (ưu tiên)

Orchestrator đã truyền "Rule test" vào `.dev-team-agent/project-rules.md`. Đọc phần đó trước: nếu có, rule project **ưu tiên hơn** (format test case, phương pháp, coverage yêu cầu...). Nếu phần test trống, dùng hướng dẫn trong skill này làm fallback.

## Cấu trúc `test-spec.md`

```markdown
# Test Spec — <task-id>

## 1. Phạm vi test
<Mô tả ngắn: feature gì, file nào, phương pháp test (manual/unit/integration).>

## 2. Test cases

### TC-01: <tên test case>
- **Type**: Normal / Abnormal / Regression / Boundary
- **Input**: <dữ liệu đầu vào cụ thể>
- **Expected output**: <kết quả mong đợi>
- **Setup**: <điều kiện cần thiết trước khi test>
- **Notes**: <lưu ý đặc biệt>

### TC-02: ...

## 3. Coverage matrix

| Acceptance Criteria | TC liên quan | Trạng thái |
|---|---|---|
| AC-1: ... | TC-01, TC-03 | [ ] |

## 4. Regression risk
<Danh sách chức năng hiện có có thể bị ảnh hưởng — cần test thủ công.>
```

## Phương pháp

### White-box testing
- Dựa vào implementation details từ `design.md §4` để xác định test cases.
- Đảm bảo cover tất cả branch trong logic mới.

### Boundary values
- Tìm boundary trong input validation: min/max, empty, null, đặc biệt.
- Tìm boundary trong DB: record không tồn tại, duplicate, FK constraint.

### Equivalence partitioning
- Nhóm input thành các equivalence class: valid / invalid / edge.
- Đủ 1 test case đại diện mỗi class.

### Decision table
- Dùng khi có nhiều điều kiện kết hợp (A AND B, A OR B).
- Bảng kết hợp điều kiện → expected result.

## Lưu ý

- Mỗi test case phải có input cụ thể, không mơ hồ.
- Abnormal cases quan trọng không kém normal cases.
- Regression risk: lấy từ §6 "Out of scope" của design để nhắc test thủ công.
