<!--
PR template. Điền đầy đủ các mục.
Title PR theo prefix: [<TASK>] <type>: <desc>  (type ∈ feat|fix|chore|docs|refactor|test) — gán label theo type.
Quy ước hub: AGENTS.md. Chi tiết: docs/implement/pr-docs-convention.md (§1.1–§1.2), docs/implement/*-rule.md.
Kiến trúc + cấu trúc thư mục: docs/architecture.md · feature map: docs/implement/feature-organization-rule.md.
-->

## Issue
<!--
Liên kết issue tracking ở ĐẦU PR body.
DÙNG từ khoá KHÔNG auto-close: "Refs #<n>" / "Part of #<n>".
KHÔNG dùng Closes/Fixes/Resolves — merge PR KHÔNG được đóng issue tracking chung.
-->
Part of #

## Module / Phạm vi
<!-- Feature / module chính, vd: src/features/settings, src/core/log -->

## Nội dung thay đổi
<!-- Tóm tắt 1–3 câu mục tiêu PR. Chi tiết theo § dưới — bám cây thư mục, không liệt kê phẳng. -->

### Chi tiết chỉnh sửa (phần riêng)
<!--
Nhóm theo lớp của feature chính (chỉ mục có đổi):
api/controller · business · schemas · components/composables/scripts/locales/styles · tests
Fix/refactor: bắt buộc Logic trước → sau.
-->

#### `src/features/<feature>/`
- …

**Logic trước → sau** (bắt buộc với fix/refactor; feat thuần có thể bỏ):
- Trước: …
- Sau: …

### Chi tiết chỉnh sửa (phần chung)
<!-- Luôn điền. Ghi "Không" nếu không đụng. -->
- **Core** (`src/core/…`): …
- **Feature khác**: … / Không

### Mapping file (khi rename / split / migrate path)
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
- [ ] Unit (bun test — backend) ở `tests/server` · `tests/mcp` · `tests/src` (bun)
- [ ] Unit (vitest — frontend) ở `tests/src` · `tests/shared`
- [ ] Integration API (Hono `app.request`)
- [ ] E2E (playwright) ở `test-e2e/` — chạy thật + gate CI; ảnh capture đính vào comment (không commit `docs/`)

## Todo debt (nếu PR `dev/x.y.z/main` → `main`)
<!-- docs/implement/todo-debt-convention.md — CI Todo debt chỉ gate promote lên main. -->
- [ ] Không còn thư mục `docs/todo/` (đã đối ứng và xóa hết)
- [ ] PR feature → `dev/x.y.z/main`: được mang nợ; không áp checklist này
## Checklist
- [ ] Không thay đổi hành vi public (hoặc đã ghi rõ thay đổi)
- [ ] PR body: phần riêng theo cấu trúc thư mục; phần chung nêu Core / feature khác (hoặc *Không*)
- [ ] Fix/refactor: đã có Logic trước → sau
- [ ] Test xanh local · CI/CD xanh
- [ ] Tuân thủ `docs/implement/coding-convention.md` + `feature-organization-rule.md`
- [ ] Icon mới/sửa dùng `<Icon name="..." />` (`src/core/ui/Icon.vue`) — không tự vẽ tay `<svg>`/`<path>`
- [ ] Dropdown mới dùng `CSelect`/`CComboSelect` (`src/core/ui/`) — không dùng `<select>` native
- [ ] **Git hygiene** (`docs/implement/git-convention.md`): đã soát `git status` / `git diff --staged` — KHÔNG commit file ngoài phạm vi / generated / export / lockfile lạ
- [ ] Rename/move dùng `git mv`; KHÔNG còn bản cũ trùng (vd `.js` lẫn `.ts`); test không lạc khỏi `tests/`·`test-e2e/`
