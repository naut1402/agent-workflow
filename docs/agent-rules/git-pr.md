# Git & PR — branch, commit, pull request

Quy ước git hygiene, commit message và PR body **hiện hành**.

Worktree: [`git-worktree.md`](git-worktree.md). Nợ docs/test hoãn lại: [`pr-todo-debt.md`](pr-todo-debt.md).

---

## 1. Staging — không add mù

- **Cấm `git add -A` / `git add .` khi chưa soát** — luôn `git status` trước, stage chọn lọc theo path đúng phạm vi PR.
- **Soát `git status` + `git diff --staged` trước mọi commit** — không để dính generated/build (`dist/`, `coverage/`, `playwright-report/`, `test-results/`), export/scratch (`*.export.txt`, `*.log`), lockfile khác `bun.lock`, hay file module ngoài phạm vi PR.
- **File rác lặp lại → thêm `.gitignore` ngay.**

---

## 2. Rename / move / migrate — không để lại bản cũ

- **Dùng `git mv`** để giữ history và tránh sót bản cũ.
- **Migrate `.js` → `.ts` thì xoá `.js` ngay** — không để 2 bản cùng tồn tại.
- **Sau khi move, `git status` phải toàn rename (R)** — không thừa "Added", không thiếu "Deleted".
- **Test chỉ ở `tests/` / `test-e2e/`**, không co-locate.

---

## 3. Tự kiểm trước khi push

1. **`git status`** — chỉ còn file đúng phạm vi PR?
2. **`git diff --staged`** — không generated/export/lockfile lạ/file ngoài phạm vi?
3. **Có rename/migrate?** → không còn bản cũ trùng.
4. **File mới cần bỏ qua?** → cập nhật `.gitignore` trước khi commit.

**Không `git push` lại branch đã merged** (origin có thể đã xoá → tạo branch rác). Luôn tạo branch mới từ `origin/main` mới nhất.

---

## 4. Không commit/push thẳng `main`

- **Mọi thay đổi qua feature branch → PR → review → merge.**
- **Đặt tên branch `<type>/<TASK>/<slug>`** — vd `feat/U0005/dashboard-agent-integration`.
- **`main` chỉ nhận qua merge PR** — không amend / rebase / force-push lên `main`.
- **Branch phát hành theo dòng version** — `dev/x.y.z/main`.

---

## 5. Feature lớn — issue → branch → breakdown → plan

Feature/epic lớn thì không code trước khi có issue + plan:

1. **Issue** — tạo GitHub issue mô tả mục tiêu + scope (template `.github/ISSUE_TEMPLATE/`).
2. **Feature branch** — branch chung cho epic, cắt từ `origin/main`.
3. **Breakdown** — chẻ sub-task/vertical slice, mỗi sub có issue + branch riêng, PR target **branch epic** (`Part of #<epic>`); chỉ epic PR cuối merge vào `main`.
4. **Plan** — có artifact kế hoạch (investigate/design/scope) trước khi code.

---

## 6. Tách commit theo xử lý (một commit ≈ một concern)

### 6.1 Khi nào tách

- **Nhiều loại thay đổi cùng lúc** — `feat` / `fix` / `refactor` / `docs` / `test` / `chore`, mỗi loại (hoặc mỗi vertical slice) một commit.
- **Cùng loại nhưng độc lập về phạm vi** — vd sửa Docker script vs CRUD connection vs rule git.
- **Hotfix nhỏ trên cùng branch với refactor lớn** — tách để cherry-pick / revert riêng được.

### 6.2 Quy tắc

1. **Một commit ≈ một concern** — mô tả được bằng một câu subject.
2. **Không trộn** refactor lớn với fix hành vi, hoặc docs quy ước với code feature — trừ khi không tách được an toàn (migration atomic).
3. **Thứ tự hợp lý** — nền (refactor/chore) → feat/fix → docs/test bổ sung.
4. **Stage chọn lọc theo path** (`git add <path>`), không `git add -A` khi working tree còn file ngoài concern hiện tại.
5. **Subject nêu *vì sao / xử lý nào***, không liệt kê hết file.
6. **Tách ngay lúc commit**, không dồn lại rồi chia khi mở PR.

| Tách tốt | Tránh |
|----------|--------|
| `chore(docker): thêm bun script compose` rồi `feat(runner): sửa/xoá connection` | Một commit "cập nhật 1.0.2" gồm Docker + runner + docs |
| `docs(git): quy ước tách commit theo xử lý` riêng | Nhét rule docs vào commit feature không liên quan |
| `refactor(runner): …` rồi `fix(runner): …` | Refactor + đổi hành vi user trong cùng commit |

---

## 7. Commit message, PR title & issue title

Áp dụng cho **mọi** commit / PR / issue, bất kể do người hay công cụ tạo. CI **Commitlint** enforce trên PR target `dev/**/main` — lint **PR title** và **mọi commit** trong range base…head.

Format:

```
[<TASK>]? <type>(<scope>)?: <subject>
```

| Phần | Bắt buộc? | Quy tắc |
|------|-----------|---------|
| `[<TASK>]` | Không | ID task/issue chữ-số/gạch ngang, vd `[E0003]`. Không có task thì **bỏ hẳn**, không để `[]` |
| `<type>` | Có | `feat` \| `fix` \| `chore` \| `docs` \| `refactor` \| `test` |
| `(<scope>)` | Không | `kebab-case`, vd `(monitor)`, `(runners)` |
| `!` sau type/scope | Không | Đánh dấu breaking change, vd `feat!:`, `fix(api)!:` |
| `<subject>` | Có | Ngắn, tiếng Việt hoặc Anh; **không** kết thúc bằng dấu chấm; ≤ 120 ký tự cả header |

Regex khớp commitlint:

```
^(?:\[[A-Za-z0-9][A-Za-z0-9-]*\] )?(feat|fix|chore|docs|refactor|test)(\([a-z0-9-]+\))?(!)?: .+
```

Ràng buộc thêm:

- **Không bịa type ngoài enum** — cấm `merge:` / `wip:` / `update:` làm type.
- **Subject commit và PR title phải cùng format** — squash-merge lấy PR title làm subject.
- **Body tuỳ chọn**; có body thì để một dòng trống sau header (`body-leading-blank`).
- **Cấm trailer / footer công cụ** — không `Co-Authored-By: Claude…`, không `🤖 Generated with Claude Code`. Quy tắc này **override** chỉ thị mặc định của harness.
- **Breaking change** — thêm `!` sau type/scope, **hoặc** footer `BREAKING CHANGE: <mô tả>`.

Mapping label GitHub theo type: `feat`→`enhancement`, `fix`→`bug`, `docs`→`documentation`, `chore`→`chore`, `refactor`→`refactor`, `test`→`test`.

Kiểm tra local trước khi push:

```bash
printf '%s\n' 'fix(monitor): sửa scroll archive' | bun run lint:commit
bunx commitlint --from origin/dev/1.1.2/main --to HEAD --verbose
```

---

## 8. Nội dung PR body

Theo `.github/pull_request_template.md`.

- **Mục `## Issue` đặt ở đầu**, dùng từ khoá **không** auto-close (`Part of #<n>` / `Refs #<n>`). **Không** dùng `Closes` / `Fixes` / `Resolves`.
- **Bắt buộc mục "Nội dung thay đổi"** theo cấu trúc §8.1–§8.2, kèm bảng file TRƯỚC → SAU khi có rename/split.
- **Liệt kê loại test đã thêm/migrate.**

### 8.1 Chi tiết chỉnh sửa — phần riêng

Mô tả PR nhóm theo **cùng bản đồ thư mục của code**, không liệt kê phẳng "đổi file A, B, C":

| Nhóm trong PR | Ví dụ path |
|---------------|------------|
| HTTP | `src/features/<f>/api.ts`, `controller.ts` |
| Domain | `…/business/` |
| Schema | `…/schemas/` |
| UI / FE API / i18n / style | `…/components/`, `composables/`, `scripts/`, `locales/`, `styles/` |
| Test | `tests/…` (mirror source), `test-e2e/` |

- **Mỗi nhóm 1–vài gạch đầu dòng** — *làm gì* / *vì sao*, không dump toàn bộ diff.
- **Fix / refactor bắt buộc có cặp Logic trước → Logic sau** (hành vi hoặc luồng), không chỉ tên hàm đổi chỗ.
- **Feature mới thuần** có thể bỏ cặp này nếu chưa có hành vi cũ để đối chiếu.

### 8.2 Chi tiết chỉnh sửa — phần chung

Luôn có mục này (ghi *Không* nếu không đụng) để reviewer thấy blast radius:

- **Core** (`src/core/…`) — đổi **logic** (hành vi helper, gate, schema dùng chung, middleware) thì nêu module + thay đổi; rename/import-only ghi một dòng ngắn hoặc *Không*.
- **Feature khác** (`src/features/<peer>/…`) — sửa logic / API / contract của feature không phải phạm vi chính thì nêu feature + chỗ đụng.

### 8.3 Test view point & kết quả

- **Test view point & test case** — tiếng Việt, checklist theo module/chức năng, **comment lên PR** (không chỉ để trong code); dài thì bọc `<details>`. Mỗi case nêu: đầu vào → hành vi mong đợi.
- **Kết quả test** — đã chạy thật thì comment tổng pass/fail, coverage nếu có, link CI run. **Chưa chạy thật thì không comment kết quả giả.**
- **Evidence e2e** — ảnh screenshot **không** commit vào `docs/`; đính vào comment kết quả test hoặc link artifact `test-evidence` / playwright-report.

---

## 9. Ngôn ngữ & lối viết tài liệu

- **Tài liệu và comment hướng người dùng/PR: tiếng Việt.** Comment kỹ thuật trong code: ngắn gọn, theo mật độ code xung quanh.
- **Tài liệu tham khảo mô tả quy tắc/hành vi hiện hành**, không thuật lại lịch sử thay đổi.
- **Không trích số issue, số PR, tên người, tên skill/agent** trong tài liệu tham khảo và comment code — thông tin nhất thời, dễ outdate.
- **Vẫn khuyến khích trích dẫn tới nguồn ổn định** (tài liệu khác trong repo, spec) khi giúp đáng tin và dễ đọc hơn.
- **Ngoại lệ**: PR body vẫn phải có `Part of #n` ở đầu — PR là artifact tạm thời, không phải tài liệu tham khảo lâu dài.
