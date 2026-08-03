---
name: doc-review
description: Review tài liệu investigate.md hoặc design.md theo tiêu chí chất lượng, tạo file pointout (PO). Dùng khi cần review một tài liệu kỹ thuật cho task cụ thể. Gọi trực tiếp bằng `/doc-review <task-id> --doc=<investigate|design>`.
argument-hint: "<task-id> --doc=<investigate|design>"
user-invocable: true
---

# Doc Review

Review tài liệu kỹ thuật (`investigate.md`, `design.md`) theo rule được thiết lập trong project, tạo file pointout (PO).

## Workflow khi gọi trực tiếp

`$ARGUMENTS` = `<task-id> --doc=<investigate|design>`

### Bước 1 — Lấy review rules

- **Trong pipeline**: orchestrator đã nạp rule và truyền "Rule review doc" vào `.dev-team-agent/project-rules.md`. Đọc phần đó.
- **Chạy trực tiếp** (`/doc-review`): tự nạp qua skill `read-project-rules` với category `doc-review`.

Rule hợp lệ phải có đủ phần **kỹ thuật** và phần **trình bày** (tiêu chí thống nhất tại `read-project-rules`).

**Nếu không có rule review hợp lệ**: thông báo nơi đã tìm, lý do không hợp lệ, và **dừng xử lý** — không tự bịa rule.

### Bước 2 — Đọc tài liệu cần review

Đọc `.dev-team-agent/tasks/<task-id>/<doc>.md` toàn bộ.

### Bước 3 — Áp dụng rules

Dựa trên rules nạp được ở Bước 1:
- Nếu rules có yêu cầu tính điểm / ngưỡng PASS: tính điểm theo trọng số quy định.
- Nếu rules không có yêu cầu tính điểm: bỏ qua phần chấm điểm, chỉ liệt kê PO.

### Bước 4 — Ghi `.dev-team-agent/tasks/<task-id>/<doc>-po.md`

Theo format ở mục **Format output** bên dưới.

### Bước 5 — Báo cáo

Tóm tắt: số PO phần kỹ thuật, số PO phần trình bày, và (nếu có điểm) tổng điểm + ngưỡng.

---

## Format output — `{doc}-po.md`

```markdown
# Pointout — <doc-type> — <task-id>

<!-- Chỉ có phần này nếu rules yêu cầu tính điểm -->
## Tổng điểm: <điểm>/100 — <PASS|PARTIAL|FAIL>

| Tiêu chí | Điểm | Trạng thái |
|---|---|---|
| <tiêu chí 1> | /<trọng số> | PASS/PARTIAL/FAIL |
| ... | | |

---

## Kỹ thuật

<!-- Nếu có vấn đề kỹ thuật -->
### PO-T1: <tiêu chí> — <mô tả ngắn>
**Vị trí**: Section X, dòng Y
**Vấn đề**: <mô tả cụ thể>
**Gợi ý sửa**: <cách sửa>

### PO-T2: ...

<!-- Nếu không có -->
Không có PO kỹ thuật.

---

## Trình bày (ngôn ngữ, câu cú)

<!-- Nếu có vấn đề trình bày -->
### PO-P1: <tiêu chí> — <mô tả ngắn>
**Vị trí**: Section X, dòng Y
**Vấn đề**: <mô tả cụ thể>
**Gợi ý sửa**: <cách sửa>

### PO-P2: ...

<!-- Nếu không có -->
Không có PO trình bày.
```

**Lưu ý format**:
- Prefix PO kỹ thuật: `PO-T<n>`
- Prefix PO trình bày: `PO-P<n>`
- Phần điểm/ngưỡng chỉ xuất hiện khi rules có yêu cầu tính điểm.
