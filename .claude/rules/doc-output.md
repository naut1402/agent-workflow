# Documentation Output Rules

Quy ước xuất tài liệu trong quá trình refactor — để mọi agent/session tạo ra tài liệu nhất quán.

## PR body
- Theo `.github/pull_request_template.md`.
- Bắt buộc mục **Nội dung thay đổi**: bảng mapping file TRƯỚC → SAU (rename/split/new/delete).
- Liệt kê loại test đã thêm/migrate.

## Test view point & test case
- Viết bằng tiếng Việt, dạng checklist phân theo module/chức năng.
- **Comment lên PR** (không chỉ để trong code). Nếu dài → bọc `<details><summary>…</summary>`.
- Mỗi test case nêu: điều kiện đầu vào → hành vi mong đợi.

## Evidence
- E2E/verify evidence ghi vào `docs/<task>-evidence/` (screenshot + `verify-results.json`) — giữ quy ước hiện có.
- Coverage report: `coverage/frontend/` (vitest). CI upload artifact `test-evidence`.

## Ngôn ngữ
- Tài liệu & comment hướng người dùng/PR: **tiếng Việt**.
- Comment kỹ thuật trong code: ngắn gọn, theo mật độ comment của code xung quanh.

## Commit message
- Conventional-style prefix (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`).
- Kết thúc bằng trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
