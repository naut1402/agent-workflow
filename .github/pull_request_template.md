<!--
PR template cho quá trình refactor TS. Điền đầy đủ các mục.
Mỗi PR module nên bám theo .claude/rules/refactor-workflow.md.
-->

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
- [ ] Unit (bun test — backend) co-located `*.test.ts`
- [ ] Unit (vitest — frontend) co-located `*.test.ts`
- [ ] Integration API (Hono `app.request`)
- [ ] E2E (playwright) — *chỉ migrate code, chưa cần xác nhận chạy*

## Checklist
- [ ] Không thay đổi hành vi public (hoặc đã ghi rõ thay đổi)
- [ ] Test xanh local
- [ ] CI/CD xanh
- [ ] Tuân thủ `.claude/rules/coding-conventions.md`

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
