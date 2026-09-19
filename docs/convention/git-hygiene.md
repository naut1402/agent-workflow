# Quy ước — Git hygiene

Áp dụng khi stage, rename/move, hoặc migrate file trong repo.

## Staging — không add mù

- **Cấm `git add -A` / `git add .` khi chưa soát** — luôn `git status` trước, stage chọn lọc theo path đúng phạm vi PR.
- **Soát `git status` + `git diff --staged` trước mọi commit** — không để dính generated/build (`dist/`, `coverage/`, `playwright-report/`, `test-results/`), export/scratch (`*.export.txt`, `*.log`), lockfile khác `bun.lock`, hay file module ngoài phạm vi PR.
- **File rác lặp lại → thêm `.gitignore` ngay.**

## Rename / move / migrate — không để lại bản cũ

- **Dùng `git mv`** để giữ history và tránh sót bản cũ.
- **Migrate `.js` → `.ts` thì xoá `.js` ngay** — không để 2 bản cùng tồn tại.
- **Sau khi move, `git status` phải toàn rename (R)** — không thừa "Added", không thiếu "Deleted".
- **Test chỉ ở `tests/` / `test-e2e/`**, không co-locate.

Chi tiết cơ chế CI/branching: [`docs/agent-rules/git-pr.md`](../agent-rules/git-pr.md).
