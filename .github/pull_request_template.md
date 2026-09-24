<!--
PR template. Điền đầy đủ các mục.
Title PR theo prefix: [<TASK>] <type>: <desc>  (type ∈ feat|fix|chore|docs|refactor|test) — gán label theo type.
Quy ước hub: AGENTS.md. Chi tiết PR body: docs/agent-rules/git-pr.md §9.
PR phát hành (main ← dev/x.y.z/main): dùng .github/PULL_REQUEST_TEMPLATE/release.md (mở PR kèm ?template=release.md) — bố cục ở docs/agent-rules/git-pr.md §8.
PR dòng test (test/x.y.z/main ← test/x.y.z/{taskID}_{slug}): dùng .github/PULL_REQUEST_TEMPLATE/test.md (?template=test.md) — quy ước dòng test ở docs/agent-rules/git-pr.md §4.3.
Kiến trúc + cấu trúc thư mục: docs/architecture/ · feature map: docs/agent-rules/feature-architecture-guideline.md.
-->

## Issue
<!--
Liên kết issue tracking ở ĐẦU PR body.
DÙNG từ khoá KHÔNG auto-close: "Refs #<n>" / "Part of #<n>".
KHÔNG dùng Closes/Fixes/Resolves — merge PR KHÔNG được đóng issue tracking chung.
-->
Part of #

## Tổng quan
<!--
Giữ đúng MỘT khối theo loại task, xoá khối còn lại.
Task feature: Bối cảnh · Mong muốn · Phương châm thực hiện.
Task fix bug: Hiện trạng · Trình tự tái hiện · Phương án chỉnh sửa.
Chore / docs / refactor: chọn khối gần nhất.
-->
**Task feature**
- **Bối cảnh:** …
- **Mong muốn:** …
- **Phương châm thực hiện:** …

**Task fix bug**
- **Hiện trạng:** …
- **Trình tự tái hiện:**
  1. …
- **Phương án chỉnh sửa:** …

## Module / Phạm vi
<!-- Feature / module chính, vd: src/features/settings, src/backend/log -->

## Nội dung thay đổi
<!--
Mỗi thay đổi nghiệp vụ / logic quan trọng một mục, đánh số ①, ②, ③, …
Mỗi mục: Logic thay đổi, rồi NGAY DƯỚI là thẻ <details> chi tiết chỉnh sửa của riêng mục đó — không gom chi tiết các mục về một chỗ.
Logic — fix/refactor: bắt buộc Trước → Sau; feat thuần chưa có hành vi cũ: chỉ ghi Sau.
Chi tiết — nhóm theo lớp của feature (chỉ lớp có đổi):
api/controller · business · schemas · components/composables/scripts/locales/styles;
đụng src/backend · src/frontend · src/shared hay feature khác thì ghi luôn trong mục đó.
Các mục ngăn cách bằng đường kẻ ngang `---` (để trống 1 dòng phía trên, nếu không `---` biến dòng trước thành heading).
Test KHÔNG thuộc PR này — nó ở PR dòng test.
-->
**① …**
- Trước: …
- Sau: …

<details>
<summary>Chi tiết chỉnh sửa</summary>

- `src/features/<feature>/…` — …

</details>

---

**② …**
- Trước: …
- Sau: …

<details>
<summary>Chi tiết chỉnh sửa</summary>

- `src/features/<feature>/…` — …

</details>

## Tài liệu liên quan
<!--
Link tài liệu đã publish ở mục "Kết quả điều tra › Chi tiết kỹ thuật" của issue: investigate · design · test-spec · whitebox · review-result.
CHỈ liệt kê tài liệu đã publish — xoá dòng chưa có, không để link trống.
-->
- **Investigate:** …
- **Design:** …
- **Test spec:** …
- **Whitebox:** …
- **Review result:** …

## Checklist
<!-- Chi tiết từng mục: AGENTS.md §4 (Review · PR). -->
- [ ] Đã thực hiện checklist theo chỉ dẫn dành cho agent
- [ ] Chưa thực kiểm thử thì đã dán nhãn `test-pending`
