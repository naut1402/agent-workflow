# Git Hygiene — ràng buộc staging & cleanup

Ngăn 2 sự cố đã gặp: (1) commit file **ngoài phạm vi / generated / export**, (2) **xóa thiếu** khi move/rename/migrate.

## Staging — KHÔNG add mù
- **CẤM `git add -A` / `git add .` khi chưa soát.** Luôn chạy `git status` trước, **stage có chọn lọc theo path** thuộc đúng phạm vi thay đổi của PR.
- Trước MỌI commit: soát `git status` + `git diff --staged`, đảm bảo KHÔNG dính:
  - generated/build: `dist/`, `coverage/`, `playwright-report/`, `test-results/`
  - export/transcript/scratch: `ts-migration.txt`, `*.export.txt`, `*.log`, file tạm
  - lockfile của package manager khác (chỉ giữ `bun.lock`)
  - file thuộc module/feature KHÁC (ngoài phạm vi PR hiện tại)
- File rác xuất hiện lặp lại → **thêm vào `.gitignore` ngay**, không dựa vào trí nhớ.

## Rename / move / migrate — KHÔNG để lại bản cũ
- Đổi tên / di chuyển → dùng **`git mv`** (giữ history + tránh sót bản cũ).
- Migrate `*.js → *.ts` → **xóa bản `.js` cũ ngay**; KHÔNG để `X.js` và `X.ts` cùng tồn tại trong một thư mục.
- Sau khi move một nhóm file → `git status` phải cho thấy **toàn rename (R)**; không có "Added" thừa cũng không thiếu "Deleted".
- Test chỉ nằm ở `tests/` (unit) hoặc `test-e2e/` (e2e) — không co-locate, không lạc chỗ.

## Tự kiểm trước khi push (bắt buộc)
1. `git status` — chỉ còn file đúng phạm vi PR?
2. `git diff --staged` — không có generated / export / lockfile lạ / file ngoài phạm vi?
3. Có rename/migrate? → xác nhận **không còn bản cũ trùng**.
4. Có file mới cần bỏ qua? → cập nhật `.gitignore` trước khi commit.

> Khi `git checkout`/`reset` sang branch đã merged (origin branch có thể đã bị xóa), KHÔNG `git push` lại branch đó — sẽ tạo lại branch rác. Luôn tạo branch mới từ `origin/main` mới nhất cho việc dọn dẹp hậu-merge.
