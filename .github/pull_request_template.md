<!--
PR template cho quá trình refactor TS. Điền đầy đủ các mục.
Mỗi PR module nên bám theo .claude/rules/refactor-workflow.md.
-->

## Issue
<!--
Liên kết issue tracking ở ĐẦU PR body.
DÙNG từ khoá KHÔNG auto-close: "Refs #<n>" / "Part of #<n>".
KHÔNG dùng Closes/Fixes/Resolves — merge PR KHÔNG được đóng issue tracking chung.
-->
Part of #

## Module / Phạm vi
<!-- Tên module đang refactor, vd: server/pipeline, src/features/monitor -->

## Nội dung thay đổi
<!-- Tóm tắt các file TRƯỚC và SAU khi thay đổi (bảng mapping nếu có rename/split) -->

| Trước | Sau | Ghi chú |
|-------|-----|---------|
|       |     |         |

## Test view point & test case
<!-- Liệt kê quan điểm test + test case. Nếu quá dài, bọc trong <details>. -->
<details>
<summary>Test view point & test case</summary>

- [ ] ...

</details>

## Loại test đã thêm/migrate
- [ ] Unit (bun test — backend) ở `tests/server` · `tests/mcp`
- [ ] Unit (vitest — frontend) ở `tests/src` · `tests/shared`
- [ ] Integration API (Hono `app.request`)
- [ ] E2E (playwright) ở `test-e2e/` — chạy thật + gate CI; ảnh capture đính vào comment (không commit `docs/`)

## Checklist
- [ ] Không thay đổi hành vi public (hoặc đã ghi rõ thay đổi)
- [ ] Test xanh local · CI/CD xanh
- [ ] Tuân thủ `.claude/rules/coding-conventions.md`
- [ ] **Git hygiene** (`.claude/rules/git-hygiene.md`): đã soát `git status` / `git diff --staged` — KHÔNG commit file ngoài phạm vi / generated / export / lockfile lạ
- [ ] Rename/move dùng `git mv`; KHÔNG còn bản cũ trùng (vd `.js` lẫn `.ts`); test không lạc khỏi `tests/`·`test-e2e/`

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
