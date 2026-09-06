# Git & PR

Quy tắc branch, commit và pull request. Bản đầy đủ cho người đọc: `docs/implement/git-convention.md`, `docs/implement/pr-docs-convention.md`.

- Branch mới luôn cắt từ `origin/<base>`, đặt tên `<type>/<TASK>/<slug>`. Cấm commit / push thẳng vào `main`.
- Một task gồm nhiều hạng mục → **tách commit ngay lúc commit**, không dồn lại rồi chia khi mở PR.
- Commit message và PR title theo `docs/implement/pr-docs-convention.md` §6; PR body theo §1.1–§1.2 (nhóm theo cây feature, phần chung core/peer, blast radius).
- **Cấm** trailer đồng-tác-giả trong commit message.
- Mỗi instance làm việc trên một git worktree riêng, không code chung trên cây chính.

Nguồn: `docs/implement/git-convention.md`, `docs/implement/pr-docs-convention.md`, `docs/implement/worktree-convention.md`.
