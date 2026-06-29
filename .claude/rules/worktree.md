# Worktree — cô lập mỗi instance AI khi code

Nhiều instance AI/agent có thể làm việc **đồng thời** trên cùng repo. Để tránh race condition
(giành working tree, `index.lock`, checkout đè branch của nhau, sửa trùng file, build/test ghi đè),
**mỗi phiên code BẮT BUỘC tạo và làm việc trên một git worktree riêng** — KHÔNG code chung trên cây làm việc chính.

## Bắt buộc
- KHÔNG sửa/commit trực tiếp trên working tree gốc (clone chính). Mỗi task/instance → **1 worktree riêng**.
- Mỗi worktree gắn **1 branch riêng** (git cấm 2 worktree cùng checkout 1 branch → tự nhiên tránh đụng).
- Worktree đặt **NGOÀI** cây repo chính (thư mục anh em, vd `../wt-<task>`) để không lẫn file / không bị tooling quét.

## Tạo worktree
```bash
git fetch origin
# branch mới cho task, tách từ main (hoặc refactor/main nếu còn dùng)
git worktree add -b <branch-name> ../wt-<task> origin/main
cd ../wt-<task>
bun install            # node_modules RIÊNG cho worktree (mỗi worktree tự cài)
```
> Harness Claude Code có sẵn cô lập worktree (Agent `isolation: "worktree"` / EnterWorktree) — dùng được thay cho lệnh tay; nguyên tắc 1-instance-1-worktree vẫn giữ nguyên.

## Làm việc & commit
- Mọi thao tác git / commit / push thực hiện **trong worktree đó**, theo `git-hygiene.md` (soát `git status`, stage chọn lọc, `git mv`…).
- KHÔNG `cd` về cây chính để sửa file của task khác.

## Tránh đụng tài nguyên runtime (khi chạy server/test song song)
- **Cổng cố định** dễ đụng: dev `:5174`, e2e webServer `:4319`. Nếu 2 instance cùng chạy → override khác nhau:
  `DEV_TEAM_DASHBOARD_PORT`, `E2E_PORT` (playwright đọc), hoặc `vite --port`.
- **Registry/jobs store** dùng chung `~/.dev-team-dashboard`. Nếu chạy thao tác ghi (runner/credential/jobs) song song →
  set `DEV_TEAM_DASHBOARD_HOME` riêng per worktree để cô lập (e2e đã làm sẵn trong `playwright.config.ts`).

## Dọn dẹp (sau khi branch đã merge)
```bash
git worktree remove ../wt-<task>     # gỡ worktree
git worktree prune                   # dọn metadata mồ côi
git branch -d <branch-name>          # nếu đã merged
git worktree list                    # kiểm tra các worktree còn mở
```
- KHÔNG `git push` lại branch vừa merged (origin branch có thể đã bị xóa → tạo branch rác — xem `git-hygiene.md`).
