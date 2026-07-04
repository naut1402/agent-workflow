# Project Convention Rules

## Rule coding
**Nguồn**: `AGENTS.md` §3
- ESM thuần, TypeScript cho code mới; không dùng `enum`; không default export trừ khi framework yêu cầu.
- Zod là single source of truth cho schema; validate ở mọi biên I/O với `safeParse`.
- Functional + ctx-injection; domain modules không biết HTTP; coupling chỉ đi xuống (`shared/` → domain → `http/`).
- Frontend Vue 3 `<script setup lang="ts">`; logic suy diễn tách ra composable/lib.
- UI strings tiếng Việt.

## Rule viết tài liệu
**Nguồn**: `AGENTS.md` §6 + template write-design
- Tài liệu người dùng/PR bằng tiếng Việt.
- `investigate.md`: mô tả hiện trạng, call chain, blast radius, gap.
- `design.md`: cấu trúc §1–§7 (Tổng quan, Investigation Summary, So sánh giải pháp, Implementation Details, Test Notes, Out of scope, Schedule).
- Đủ chi tiết để implementer code không cần hỏi lại.

## Rule review doc
**Nguồn**: Không tìm thấy rule riêng trong project
- Fallback: đánh giá kỹ thuật (logic, độ chính xác) và trình bày (ngôn ngữ, cấu trúc).

## Rule test
**Nguồn**: `AGENTS.md` §5
- Unit backend: `bun test` mirror `tests/server/**`.
- Unit frontend: `vitest` mirror `tests/src/**`.
- E2E: Playwright `test-e2e/`; module frontend mới bắt buộc capture screenshot.
- Test-first cho logic mới; characterization test trước khi refactor.

## Rule git/PR
**Nguồn**: `AGENTS.md` §6–§7
- Conventional commit prefix; trailer Co-Authored-By.
- PR body: Issue ở đầu (`Part of #n`), bảng mapping file, test checklist tiếng Việt.
- Stage chọn lọc; không `git add -A` mù; mỗi agent instance dùng worktree riêng.
