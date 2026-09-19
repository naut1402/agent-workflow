<!--
Template PR phát hành: base `main` ← head `dev/x.y.z/main`.
Title: Release version x.y.z
4 section mô tả dưới đây KHÔNG bắt buộc — chỉ giữ section thật sự có nội dung, XOÁ HẲN section rỗng.
Không viết "Không có", không bịa nội dung để lấp chỗ trống.
Riêng `## PR đã merge` ở cuối body là BẮT BUỘC, luôn giữ lại.
Viết hướng người dùng cuối (tiếng Việt): người dùng thấy gì đổi — không nêu tên file/hàm.
⚠️ Tính năng lần đầu phát hành ở version này chỉ được mô tả ở `## Tính năng mới`.
   Fix/tinh chỉnh trong lúc làm ra nó KHÔNG tách dòng riêng ở `## Cải tiến` / `## Sửa lỗi`
   (người dùng chưa từng thấy bản lỗi) — gộp vào mô tả tính năng theo hành vi cuối cùng,
   dấu vết từng PR đã nằm ở `## PR đã merge`.
Chi tiết: docs/agent-rules/git-pr.md §8
-->

## Tính năng mới
<!-- **Tên tính năng** — hành vi mới (mô tả trạng thái cuối, không kể quá trình sửa);
     nêu cả mặc định khi bỏ trống và cách báo lỗi nếu có. -->
-

## Cải tiến
<!-- **Điểm cải thiện**: chức năng ĐÃ release ở version trước, nay dùng tốt hơn. -->
-

## Sửa lỗi
<!-- **Hiện tượng lỗi** ở màn hình / chức năng nào — lỗi người dùng có thể gặp trên bản ĐÃ release. -->
-

## Nội bộ & công cụ dev
<!-- Không tác động người dùng cuối: tooling, quy ước, CI. -->
-

## PR đã merge
<!--
Bắt buộc. Mọi PR đã merge vào dòng version, gồm cả PR sửa/tinh chỉnh cho tính năng mới.
Sinh danh sách:
  gh pr list --base dev/x.y.z/main --state merged --limit 300 \
    --json number,title --jq 'reverse | .[] | "- #\(.number) — \(.title)"'
Dài quá ~20 dòng thì bọc trong <details><summary>Danh sách PR</summary> … </details>.
-->
-

<!-- Trước khi mở PR: KHÔNG còn thư mục docs/todo/ (gate CI Todo debt chặn đúng loại PR này). -->
