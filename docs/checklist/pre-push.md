# Checklist — tự kiểm trước khi push

1. **`git status`** — chỉ còn file đúng phạm vi PR?
2. **`git diff --staged`** — không generated/export/lockfile lạ/file ngoài phạm vi?
3. **Có rename/migrate?** → không còn bản cũ trùng.
4. **File mới cần bỏ qua?** → cập nhật `.gitignore` trước khi commit.

**Không `git push` lại branch đã merged** (origin có thể đã xoá → tạo branch rác). Luôn tạo branch mới từ base mới nhất — `origin/main`, hoặc `origin/dev/x.y.z/main` nếu task gắn version release.

Quy ước: [`docs/convention/git-hygiene.md`](../convention/git-hygiene.md). Chi tiết branch naming: [`docs/agent-rules/git-pr.md`](../agent-rules/git-pr.md) §4.
