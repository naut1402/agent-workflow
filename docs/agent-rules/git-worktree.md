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
# base: origin/main — task gắn version release thì dùng origin/dev/x.y.z/main
git worktree add -b <branch-name> ../wt-<task> origin/main
cd ../wt-<task>
bun install            # node_modules riêng cho worktree
```

Tên branch và base lấy theo [`git-pr.md`](git-pr.md) §4 (§4.2 khi task gắn version release).

**Một task có cả worktree dòng source và dòng test** (`dev/x.y.z/{taskID}_{slug}` + `test/x.y.z/{taskID}_{slug}`) thì **đặt tên thư mục worktree đúng bằng taskID** cho cái đang làm việc chính:

```bash
git worktree add -b dev/1.1.4/T0000abcd_ten-task  ../T0000abcd       origin/dev/1.1.4/main
git worktree add -b test/1.1.4/T0000abcd_ten-task ../T0000abcd-test  origin/test/1.1.4/main
```

Vì sao: dashboard map task → worktree theo **hai tầng** — tên thư mục trước, rồi mới tới taskID trong tên branch. Hai worktree cùng mang taskID trong tên branch mà không có thư mục nào tên đúng bằng taskID thì tầng hai thấy **hai** ứng viên và **từ chối đoán** (không remove gì cả). Đặt đúng một thư mục tên `<taskID>` là tầng một khớp ngay, tầng hai không phải chạy.

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
