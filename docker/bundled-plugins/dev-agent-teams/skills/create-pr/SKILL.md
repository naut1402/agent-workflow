---
name: create-pr
description: Convention git và PR template cho hanbai-product. Reference skill — dùng nội bộ bởi pr-creator agent.
user-invocable: false
---

# Create PR

Quy ước tạo branch, commit, và PR description cho dự án 楽楽販売.

## Rule từ project (ưu tiên)

Orchestrator đã truyền "Rule git/PR" vào `.dev-team-agent/project-rules.md`. Đọc phần đó trước: nếu có, convention project **ưu tiên hơn**. Nếu phần git-pr trống, dùng convention trong skill này làm fallback.

## Branch naming

```
feat/<task-id>-<short-description>
fix/<task-id>-<short-description>
hotfix/<task-id>-<short-description>
```

Ví dụ:
- `fix/B4488-null-pointer-order-detail`
- `feat/F003-export-csv`

## Commit message format

```
<type>(<scope>): <subject>

<body — optional>

<footer — task reference>
```

- `type`: `feat` / `fix` / `refactor` / `docs` / `test` / `chore`
- `scope`: tên module hoặc màn hình (ví dụ: `order`, `invoice`, `auth`)
- `subject`: động từ nguyên mẫu, tiếng Anh, không quá 72 ký tự, không có dấu chấm cuối
- `footer`: `Refs: #<issue-number>` hoặc `Closes: #<issue-number>`

Ví dụ:
```
fix(order): prevent null pointer when order has no items

Refs: #B4488
```

**Không thêm AI trailer** vào commit message (không có "Co-Authored-By: Claude").

## PR description template (`pr-desc.md`)

```markdown
## Summary

<1–3 bullet points mô tả thay đổi chính>

## Root cause / Background

<Mô tả ngắn vấn đề và tại sao cần fix — từ investigate.md>

## Changes

| File | Thay đổi |
|---|---|
| path/to/file.php | Mô tả thay đổi |

## Test plan

- [ ] TC-01: <tên test case>
- [ ] TC-02: <tên test case>
- [ ] Regression: <chức năng liên quan cần test thủ công>

## Notes for reviewer

<Điểm cần reviewer chú ý đặc biệt — từ review.md>

## Related

- Issue: #<task-id>
- Design doc: .dev-team-agent/tasks/<task-id>/design.md
```

## Lưu ý

- `pr-creator` agent ghi `pr-desc.md` nhưng **không tự tạo PR** trên GitHub/GitLab.
- Orchestrator hoặc user sẽ tạo PR thủ công sau khi đọc và confirm `pr-desc.md`.
