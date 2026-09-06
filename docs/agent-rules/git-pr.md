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

**Không `git push` lại branch đã merged** (origin có thể đã xoá → tạo branch rác). Luôn tạo branch mới từ base mới nhất — `origin/main`, hoặc `origin/dev/x.y.z/main` nếu task gắn version release (§4).

---

## 4. Không commit/push thẳng `main`

- **Mọi thay đổi qua feature branch → PR → review → merge.**
- **`main` chỉ nhận qua merge PR** — không amend / rebase / force-push lên `main`.
- **Branch phát hành theo dòng version** — `dev/x.y.z/main`.

Tên branch task theo §4.1 hoặc §4.2 tuỳ request có gắn version release hay không.

### 4.1 Branch task mặc định

Request **không** nêu base branch hay version release → cắt từ `origin/main`, đặt tên `<type>/<TASK>/<slug>` (vd `feat/U0005/dashboard-agent-integration`).

### 4.2 Branch task dưới dòng version

Request/task **có** nêu base branch dạng `dev/x.y.z/…` **hoặc** version release `x.y.z` → branch phải nằm dưới đúng dòng version đó:

```
dev/x.y.z/{taskID}_{task-slug}
```

| Thành phần | Quy tắc |
|---|---|
| `x.y.z` | Lấy từ base branch hoặc version nêu trong request (base `dev/1.1.2/main` → `1.1.2`) |
| `{taskID}` | Giữ nguyên id task, đúng chữ hoa/thường |
| `_` | Đúng **một** dấu gạch dưới ngăn taskID với slug |
| `{task-slug}` | `kebab-case` toàn chữ thường, 3–5 từ, mô tả nội dung task |

```bash
git fetch origin
git switch -c dev/1.1.2/T0000abcd_ten-task-ngan origin/dev/1.1.2/main
```

- **Base là `origin/dev/x.y.z/main`** — không phải `origin/main`. Request nêu base khác dạng `/main` (vd `dev/x.y.z/dev`) thì vẫn trích `x.y.z` để đặt tên, còn base checkout đúng branch request nêu.
- **PR của branch này target `dev/x.y.z/main`** (không phải `main`); PR promote lên `main` theo §8.4.
- **Tên branch không được kết thúc bằng `/main`** — pattern `dev/**/main` là branch dòng version, được workflow sync tự cập nhật từ `main`.
- **Dòng version chưa tồn tại trên remote thì không tự tạo** — mở dòng version là việc của release, hỏi người chốt trước.
- **Commitlint** chạy trên PR base `dev/**/main` → PR title và **mọi** commit phải đúng format §7.
- **Epic branch (§5) thắng về base** — task vừa gắn version vừa thuộc epic thì cắt từ branch epic, tên branch vẫn theo §4.2.

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
- **Ngoại lệ duy nhất: PR phát hành** (base `main` ← `dev/x.y.z/main`) — commitlint không chạy trên base `main`, title dùng dạng `Release version x.y.z` (§8.4).

Mapping label GitHub theo type: `feat`→`enhancement`, `fix`→`bug`, `docs`→`documentation`, `chore`→`chore`, `refactor`→`refactor`, `test`→`test`.

Kiểm tra local trước khi push:

```bash
printf '%s\n' 'fix(monitor): sửa scroll archive' | bun run lint:commit
bunx commitlint --from origin/dev/1.1.2/main --to HEAD --verbose
```

---

## 8. Nội dung PR body

Repo có **2 loại PR**, body khác nhau:

| Loại PR | Base ← Head | Body theo |
|---|---|---|
| Feature / fix / docs… | `dev/x.y.z/main` ← branch task | §8 + §8.1–§8.3 · `.github/pull_request_template.md` |
| Phát hành (promote) | `main` ← `dev/x.y.z/main` | §8.4 · `.github/PULL_REQUEST_TEMPLATE/release.md` |

Phần dưới đây (kể cả §8.1–§8.3) áp dụng cho **PR feature**. Theo `.github/pull_request_template.md`.

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

### 8.4 PR phát hành (`main` ← `dev/x.y.z/main`)

PR promote dòng version lên `main` là **release note hướng người dùng cuối** — mô tả *người dùng thấy gì đổi*, không liệt kê file/hàm. **Không** áp dụng `## Issue`, `## Module / Phạm vi`, bảng mapping file hay checklist của §8 / §8.1–§8.3.

- **Title** — `Release version x.y.z`, khớp `version` trong `package.json` của dòng đó.
- **Body** — chọn trong 4 section sau, giữ nguyên tên và thứ tự:

| Section | Dùng cho |
|---|---|
| `## Tính năng mới` | Chức năng người dùng chưa từng có |
| `## Cải tiến` | Chức năng đã có, nay dùng tốt hơn |
| `## Sửa lỗi` | Hiện tượng sai đã được sửa |
| `## Nội bộ & công cụ dev` | Không tác động người dùng cuối: tooling, quy ước, CI |

- **Không section nào bắt buộc** — chỉ giữ section thật sự có nội dung, **xoá hẳn** section rỗng. Không viết "Không có" và **không bịa** nội dung để lấp chỗ trống.
- **Mỗi gạch đầu dòng mở bằng tên tính năng / hiện tượng in đậm**, rồi tới mô tả; nêu cả hành vi mặc định khi bỏ trống và cách báo lỗi nếu có.
- **Nội dung không rơi vào 4 section** (vd breaking change) → đặt vào section gần nhất và nêu rõ trong mô tả; không tự thêm section mới.
- **Trước khi mở PR: không còn thư mục `docs/todo/`** — gate CI Todo debt chỉ chặn đúng loại PR này ([`pr-todo-debt.md`](pr-todo-debt.md)).
- **Mở PR trên web kèm `?template=release.md`** để GitHub áp đúng template; mở thẳng sẽ ra template PR feature, khi đó xoá body và dán lại theo mục này.

---

## 9. Ngôn ngữ & lối viết tài liệu

- **Tài liệu và comment hướng người dùng/PR: tiếng Việt.** Comment kỹ thuật trong code: ngắn gọn, theo mật độ code xung quanh.
- **Tài liệu tham khảo mô tả quy tắc/hành vi hiện hành**, không thuật lại lịch sử thay đổi.
- **Không trích số issue, số PR, tên người, tên skill/agent** trong tài liệu tham khảo và comment code — thông tin nhất thời, dễ outdate.
- **Vẫn khuyến khích trích dẫn tới nguồn ổn định** (tài liệu khác trong repo, spec) khi giúp đáng tin và dễ đọc hơn.
- **Ngoại lệ**: PR body vẫn phải có `Part of #n` ở đầu — PR là artifact tạm thời, không phải tài liệu tham khảo lâu dài.
