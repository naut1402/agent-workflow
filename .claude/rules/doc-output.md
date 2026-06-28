# Documentation Output Rules

Quy ước xuất tài liệu trong quá trình refactor — để mọi agent/session tạo ra tài liệu nhất quán.

## PR body
- Theo `.github/pull_request_template.md`.
- **Mục `## Issue` đặt ở ĐẦU PR body**, liên kết tới issue tracking chung (vd #2).
  - **DÙNG từ khoá KHÔNG auto-close**: `Part of #<n>` / `Refs #<n>`.
  - **KHÔNG dùng** `Closes` / `Fixes` / `Resolves` — **merge PR KHÔNG được đóng issue tracking chung** (issue sống suốt cả quá trình refactor, chỉ đóng khi toàn bộ migration xong).
- Bắt buộc mục **Nội dung thay đổi**: bảng mapping file TRƯỚC → SAU (rename/split/new/delete).
- Liệt kê loại test đã thêm/migrate.

## Test view point & test case
- Viết bằng tiếng Việt, dạng checklist phân theo module/chức năng.
- **Comment lên PR** (không chỉ để trong code). Nếu dài → bọc `<details><summary>…</summary>`.
- Mỗi test case nêu: điều kiện đầu vào → hành vi mong đợi.

## Kết quả test (khi có chạy test)
- **Khi đã CHẠY test thật** (unit/integration/CI), **comment kết quả lên PR**: tổng số pass/fail, coverage nếu có, link tới CI run.
- Nội dung dài → bọc `<details><summary>…</summary>`.
- Không comment kết quả cho bước chỉ migrate code mà chưa chạy (vd e2e hoãn).

## Evidence (ảnh e2e)
- **Ảnh screenshot e2e KHÔNG commit vào `docs/`.** Thay vào đó **đính kèm vào comment kết quả test trên PR** (kéo-thả ảnh vào comment, hoặc link tới artifact `test-evidence` / playwright-report của CI run).
- Spec Playwright chụp vào **thư mục output của test (gitignored)** + `testInfo.attach(...)` để ảnh nằm trong **playwright-report** (CI upload artifact), KHÔNG ghi `docs/`.
- Coverage report: `coverage/frontend/` (vitest). CI upload artifact `test-evidence` (coverage + playwright-report).

## Ngôn ngữ
- Tài liệu & comment hướng người dùng/PR: **tiếng Việt**.
- Comment kỹ thuật trong code: ngắn gọn, theo mật độ comment của code xung quanh.

## Commit message
- Conventional-style prefix (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`).
- Kết thúc bằng trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
