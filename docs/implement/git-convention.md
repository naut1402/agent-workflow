# Git convention — staging & cleanup

Quy ước git hygiene **hiện hành**. Hub: [`AGENTS.md`](../../AGENTS.md). Worktree: [`worktree-convention.md`](worktree-convention.md).

Ngăn 2 sự cố đã gặp: commit file ngoài phạm vi/generated/export, và xóa thiếu khi move/rename/migrate.

---

## 1. Staging — không add mù

Cấm `git add -A`/`git add .` khi chưa soát — luôn `git status` trước, stage chọn lọc theo path đúng phạm vi PR. Trước mọi commit, soát `git status` + `git diff --staged`, đảm bảo không dính: generated/build (`dist/`, `coverage/`, `playwright-report/`, `test-results/`), export/scratch (`*.export.txt`, `*.log`, file tạm), lockfile khác `bun.lock`, hay file module khác ngoài phạm vi PR. File rác lặp lại → thêm `.gitignore` ngay.

---

## 2. Rename/move/migrate — không để lại bản cũ

Đổi tên/di chuyển dùng `git mv` (giữ history, tránh sót bản cũ). Migrate `.js→.ts` thì xóa `.js` cũ ngay — không để 2 bản cùng tồn tại. Sau khi move, `git status` phải toàn rename (R), không thừa "Added" không thiếu "Deleted". Test chỉ ở `tests/`/`test-e2e/`, không co-locate.

---

## 3. Tự kiểm trước khi push

1. `git status` — chỉ còn file đúng phạm vi PR?
2. `git diff --staged` — không generated/export/lockfile lạ/file ngoài phạm vi?
3. Có rename/migrate? → không còn bản cũ trùng.
4. File mới cần bỏ qua? → cập nhật `.gitignore` trước khi commit.

Lưu ý: `git checkout`/`reset` sang branch đã merged (origin có thể đã xóa) thì **đừng** `git push` lại — sẽ tạo branch rác. Luôn tạo branch mới từ `origin/main` mới nhất.

---

## 4. Không commit/push thẳng `main`

Cấm commit/push trực tiếp lên `main` — mọi thay đổi qua feature branch → PR → review → merge. Branch mới từ `origin/main`, đặt tên `<type>/<TASK>/<slug>` (vd `feat/U0005/dashboard-agent-integration`). `main` chỉ nhận qua merge PR; không amend/rebase/force-push lên `main`. (Khuyến nghị ngoài repo: bật branch protection cho `main`.)

---

## 5. Feature lớn — issue → branch → breakdown → plan

Feature/epic lớn: không code trước khi có issue + plan.

1. **Issue**: tạo GitHub issue mô tả mục tiêu + scope (template `.github/ISSUE_TEMPLATE/`).
2. **Feature branch**: tạo branch chung cho epic từ `origin/main`.
3. **Breakdown**: chẻ sub-task/vertical slice, mỗi sub có issue + branch riêng, PR target **branch epic** (`Part of #<epic>`); chỉ epic PR cuối merge vào `main`.
4. **Plan**: có artifact kế hoạch (investigate/design/scope) trước khi code.

Tiền lệ: epic U0005 (`.dev-team-agent/tasks/U0005/epic-tracking.md`).

---

## 6. Tách commit theo xử lý (một commit ≈ một concern)

Khi PR lớn hoặc gom nhiều hạng mục độc lập trên cùng branch: **không gộp hết vào một commit**. Tách theo từng xử lý / concern để review và bisect dễ hơn.

### Khi nào tách

- Nhiều loại thay đổi cùng lúc: `feat` / `fix` / `refactor` / `docs` / `test` / `chore` — mỗi loại (hoặc mỗi vertical slice) một commit.
- Cùng loại nhưng độc lập về phạm vi (vd sửa Docker script vs CRUD connection vs rule git) — tách commit riêng.
- Hotfix nhỏ trên cùng branch với refactor lớn — tách để có thể cherry-pick / revert riêng.

### Quy tắc

1. **Một commit ≈ một concern**: mô tả được bằng một câu subject (format commit: [`pr-docs-convention.md`](pr-docs-convention.md) §6).
2. **Không trộn** refactor lớn với fix hành vi, hoặc docs quy ước với code feature — trừ khi không tách được an toàn (migration atomic).
3. **Thứ tự hợp lý**: nền (refactor/chore) → feat/fix → docs/test bổ sung nếu test không đi kèm cùng commit feature.
4. Stage chọn lọc theo path (`git add <path>`), không `git add -A` khi working tree còn file ngoài concern hiện tại (xem §1).
5. Subject commit nêu *vì sao / xử lý nào*, không liệt kê hết file.

### Ví dụ

| Tách tốt | Tránh |
|----------|--------|
| `chore(docker): thêm bun script compose` rồi `feat(runner): sửa/xoá connection` | Một commit “cập nhật 1.0.2” gồm Docker + runner + docs |
| `docs(git): quy ước tách commit theo xử lý` riêng | Nhét rule docs vào commit feature không liên quan |
| `refactor(runner): …` rồi `fix(runner): …` | Refactor + đổi hành vi user trong cùng commit khó review |

Agent/người: khi user hoặc task yêu cầu nhiều hạng mục — **áp dụng tách commit ngay lúc commit**, không chờ đến lúc mở PR mới chia.
