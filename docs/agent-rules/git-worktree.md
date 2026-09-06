# Git worktree — cô lập mỗi instance agent

Nhiều instance agent có thể làm việc đồng thời trên cùng repo. Mỗi phiên code dùng **một git worktree riêng** để tránh race condition (giành working tree, `index.lock`, checkout đè branch, sửa trùng file, build/test ghi đè).

Git hygiene và commit: [`git-pr.md`](git-pr.md).

---

## 1. Bắt buộc

- **Không sửa/commit trực tiếp trên working tree gốc.**
- **Mỗi task/instance một worktree riêng**, gắn một branch riêng (git đã cấm 2 worktree cùng checkout 1 branch).
- **Đặt worktree ngoài cây repo chính** — vd `../wt-<task>`.

---

## 2. Tạo worktree

```bash
git fetch origin
git worktree add -b <branch-name> ../wt-<task> origin/main
cd ../wt-<task>
bun install            # node_modules riêng cho worktree
```

Harness có sẵn cơ chế cô lập worktree thì dùng luôn — nguyên tắc 1-instance-1-worktree vẫn giữ.

---

## 3. Làm việc & commit

- **Mọi git / commit / push thực hiện trong worktree đó.**
- **Không `cd` về cây chính để sửa file task khác.**

---

## 4. Tránh đụng tài nguyên runtime

- **Cổng cố định dễ đụng** — dev `:5174`, e2e webServer `:4319`. Hai instance chạy song song thì override khác nhau (`DEV_TEAM_DASHBOARD_PORT`, `E2E_PORT`, hoặc `vite --port`).
- **Registry / jobs store dùng chung `~/.dev-team-dashboard`** — ghi song song thì set riêng `DEV_TEAM_DASHBOARD_HOME` mỗi worktree (e2e đã làm sẵn trong `playwright.config.ts`).

---

## 5. Dọn dẹp sau khi merge

```bash
git worktree remove ../wt-<task>
git worktree prune
git branch -d <branch-name>
git worktree list
```

**Đừng `git push` lại branch vừa merge** — origin có thể đã xoá, push lại sẽ tạo branch rác.
