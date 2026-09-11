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
| `_` | Dấu gạch dưới ngăn taskID với slug. ⚠️ `{taskID}` **được phép** chứa `_` (§7), còn `{task-slug}` là `kebab-case` nên không chứa `_` ⇒ tooling tách hai phần ở dấu `_` **cuối cùng** (`taskIdOfBranch()` trong `.github/scripts/test-ref.ts`), vd `dev/1.1.5/B202608_2201_sqlite-log-driver-poc` → taskID `B202608_2201` |
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

### 4.3 Branch dòng test

**Test code không nằm cùng branch với code đối ứng.** Nó có dòng branch riêng, đối xứng hoàn toàn với dòng source:

```
dòng source :  dev/x.y.z/{taskID}_{slug}  →  dev/x.y.z/main   →  main
dòng test   :  test/x.y.z/{taskID}_{slug} →  test/x.y.z/main  →  test/main
```

- **Dòng test mang cây đầy của dòng source** — `test/x.y.z/main` = cây của `dev/x.y.z/main` cộng thêm test; `test/main` = cây của `main` cộng thêm test. Nhờ vậy dòng test **chạy độc lập được** (`bun install && bun test` ngay trên branch đó, không cần ghép cây) và các workflow của dòng test có `.github/` để kích hoạt.
- **Bản `src/` trên dòng test là bản sao, không phải nguồn sự thật.** CI (`sync-source-to-test.yml`) merge `dev/x.y.z/main` → `test/x.y.z/main` ở mỗi push, nên nó không lạc hậu. ⚠️ Nhưng khi **chấm** thì vẫn ghép cây: `test-overlay.yml` và `release-test-gate.yml` checkout ref **dòng source** rồi đắp `tests/` của dòng test lên. Chấm trên bản sao là chấm sai cây — bản sao có thể lệch trong khoảng giữa hai lượt sync.
- **Bất biến neo `test/main` ↔ `main`** — `test/main` chỉ nhận test của version **đã release**, nên overlay `test/main` lên `main` luôn xanh. Vì bất biến này mà dòng test phải hai tầng: gộp thẳng branch task vào `test/main` sẽ đưa test của version chưa release vào đó và làm cây neo đỏ thường trú.
- **`{taskID}_{slug}` giống hệt §4.2** — cùng task thì cùng taskID và cùng slug ở hai dòng, đó là cách truy từ PR code sang PR test mà không cần bảng tra.
- **Tên branch task không được kết thúc bằng `/main`.**

```bash
# Mở dòng test của một version (một lần cho mỗi version)
git switch -c test/1.1.4/main origin/test/main
git push -u origin test/1.1.4/main

# Branch task của dòng test
git switch -c test/1.1.4/T0000abcd_ten-task-ngan origin/test/1.1.4/main
```

**Dựng `test/main` — một lần cho cả repo.** Nó là bản sao của cây source **còn `tests/`**, nên chỉ là một branch thường:

```bash
git fetch origin
# <sha> = commit cuối TRƯỚC khi `tests/` bị cắt khỏi dòng source
git push origin <sha>:refs/heads/test/main
```

- ⚠️ **Không lấy từ `main` hiện tại.** Sau Đợt 5, `main` không còn `tests/` và `.gitignore` của nó chặn `/tests/` — dựng từ đó cho `test/main` rỗng test **và** chặn luôn việc thêm test mới. Repo đã cắt rồi thì lấy `<sha>` trước lượt cắt, hoặc nhân bản từ một dòng test đang có (`git push origin origin/test/main:refs/heads/test/1.1.5/main`).
- 🚫 **Không dựng bằng `git checkout --orphan`.** Cây orphan chỉ có `tests/`+`test-e2e/`+`reports/` thì (a) không chạy độc lập được vì thiếu `package.json`, và (b) **không có `.github/workflows/`** — mà GitHub Actions đọc định nghĩa workflow từ **chính ref được push**, nên mọi trigger `push: test/**` sẽ im lặng không chạy. Đây là loại lỗi không có thông báo: branch push xong, 0 run, không ai biết.
- **`.gitignore` của dòng test phải KHÔNG chặn `tests/` · `test-e2e/`** — nó nằm trong `PRESERVE_PATHS` của `sync-source-to-test.yml` nên bản của dòng source không đi sang. Đây là chỗ duy nhất hai dòng cố ý lệch nhau. Chặn ở đây là `push-tests.sh` (`git add tests test-e2e`) hết thêm được test mới.
- 🚫 **Đừng viết `.gitignore` mới từ đầu cho dòng test** — pattern không neo ở gốc (`.dev-team-agent/` thay vì `/.dev-team-agent/`) khớp ở **mọi** độ sâu và ăn mất `test-e2e/fixtures/**/.dev-team-agent/**`. Thừa hưởng bản của dòng source tại thời điểm dựng, rồi để `PRESERVE_PATHS` giữ nó.
- **Chạy dry-run trọn vòng** (`overlay` → `report` → `promote` → `sync`) trên cặp branch nháp `test/0.0.0/main` + `dev/0.0.0/main` trước khi cắt `tests/` khỏi dòng source. Bước cắt là một chiều.
- ⚠️ **`promote-test-line.yml` không có tham số target** — nó luôn ghi vào `test/main` thật. Dry-run bước `promote` sẽ đẩy nội dung nháp vào cây neo; cô lập trước hoặc chấp nhận một commit dọn.

| Việc | Ai làm | Khi nào |
|---|---|---|
| Mở `test/x.y.z/main` | người mở dòng version | cùng lúc mở `dev/x.y.z/main` |
| **Neo lại baseline sang dòng version mới** (hạ số theo cây mới) | người mở dòng version | ngay sau lượt `test-overlay` **đầu tiên** của `test/x.y.z/main` — runbook [`testing.md`](testing.md) §6 |
| Sync `main` → `test/main` · `dev/x.y.z/main` → `test/x.y.z/main` | CI (`sync-source-to-test.yml`) | mỗi push vào dòng source |
| Sync `test/main` → `test/x.y.z/main` | CI (`sync-test-line.yml`) | mỗi push vào `test/main` |
| Thăng `test/x.y.z/main` → `test/main` | CI (`promote-test-line.yml`) | ngay khi version lên `main` |
| Chặn release thiếu test | CI (`release-test-gate.yml`) | PR `dev/x.y.z/main` → `main` |

- **Merge PR code TRƯỚC PR test.** `test-overlay.yml` ghép PR dòng test với branch task dòng source cùng `{taskID}` khi branch đó **còn** trên remote — job summary in `Ghép theo: taskid`. Lượt đó chấm trên code **chưa merge**: hữu ích để viết test, 🚫 **không** đủ để merge, và bước `Merge order guard` chặn cứng bằng cách cho job đỏ **sau** khi suite đã chạy (kết quả vẫn đọc được, chỉ quyền merge bị chặn). Lượt có quyền merge là lượt `Ghép theo: no-match` — PR code đã merge, branch task đã xoá, nên cặp ghép quay về `dev/x.y.z/main`.

| `Ghép theo` | Nghĩa | Kết luận được về thứ tự merge? |
|---|---|---|
| `taskid` | ghép với branch task dòng source còn trên remote | ✅ PR code **chưa** merge ⇒ 🚫 chưa được merge PR test |
| `no-match` | không còn branch `dev/*/{taskID}_*` nào | ✅ PR code đã merge ⇒ đây là lượt **có quyền merge** |
| `ambiguous` | ≥ 2 branch dòng source cùng taskID ⇒ cổng 🚫 không chọn bừa, lùi về đầu dòng version | ❌ dọn branch thừa rồi chạy lại |
| `lookup-failed` | 🚫 không dò được remote (mất mạng, hết quyền) ⇒ lùi về đầu dòng version | ❌ **chạy lại lượt đó**, 🚫 đừng đọc thành "PR code đã merge" |
| `not-applicable` | ref không mang taskID, vd push thẳng vào đầu dòng test | — không áp dụng |

⚠️ `lookup-failed` cố ý **không** dùng chung tên với `no-match`: gộp hai thứ đó lại là khẳng định một điều chưa kiểm chứng về trạng thái merge của dòng source, và người duyệt đọc job summary sẽ kết luận sai.
- ⚠️ **Ghép cặp chỉ đổi *cây được chấm*, không đổi gì khác.** Suite và các cổng chạy y như nhau ở mọi giá trị `Ghép theo`.
- **PR của branch task dòng test target `test/x.y.z/main`** — không phải `test/main`, không phải `main`. Dùng template `?template=test.md`.
- **Commitlint chạy trên base `test/**/main`** → PR title và mọi commit đúng format §7, `type` là `test` (hoặc `chore` cho commit report do CI đẩy).
- **Workflow của dòng test checkout ref đang trigger, 🚫 không `ref: main`** — tooling dòng test (`test-ref.ts`, `coverage-gate.ts`, `sync-line.sh`) chỉ có mặt trên `main` sau khi version mở nó được release. Lấy script từ `main` trước lúc đó cho `Module not found`, mà lỗi đó đọc ra như "cổng hỏng" chứ không phải "chưa tới lượt".
- ⚠️ **`AUTO_MERGE_TOKEN` biến mọi push của CI thành trigger.** Không có secret đó, push bằng `GITHUB_TOKEN` 🚫 không kích workflow tiếp theo — nghe như hạn chế, nhưng đó chính là **van chặn vòng lặp duy nhất** của mô hình này, và nó là van *ẩn*: khai secret vào là mất van, không có gì cảnh báo. Đã xảy ra thật: job `report` push `reports/` về dòng test → push kích lại `test-overlay.yml` → `report` push lần nữa, ba lượt full suite liên tiếp cách nhau ~4,5 phút.
- **Mọi workflow mà CI tự push vào branch nó đang lắng nghe phải có van tường minh.** Ở đây là `paths-ignore: reports/**` trên trigger `push` của `test-overlay.yml` và `sync-test-line.yml` — `reports/` là **đầu ra**, không phải đầu vào, nên bỏ qua nó không mất phủ. 🚫 Đừng thay van bằng cách hạ `report` về `github.token`: token ở đó là để **có quyền push** khi dòng test bị branch protection. Token là quyền, `paths-ignore` là vòng lặp — hai việc khác nhau.
- **Job `report` chỉ chạy ở chiều `direction == 'test'`** (push vào dòng test), và đó là lượt duy nhất ghi `source_sha`/`test_sha` vào baseline.
- **Viết và chạy test ở local**: đứng thẳng trên branch dòng test cũng chạy được (cây đầy). Muốn chấm đúng cặp ref như CI thì `bun run test:overlay` kéo cây test về cây source đang đứng, `bun run test:push <branch-test> "<message>"` đẩy ngược lên dòng test. Xem [`testing.md`](testing.md) §3.1.
- **Dòng test mồ côi** (version bị huỷ, không release) không bao giờ vào `test/main`; dọn bằng cách xoá branch, không merge.

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
7. **Test luôn là commit `test:` riêng** — không bao giờ dính trong commit `feat`/`fix`. Trong giai đoạn `tests/` còn nằm trên dòng source, đây là điều kiện để cherry-pick phần test sang dòng test (§4.3) mà không kéo theo code.

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
| `[<TASK>]` | Không | ID task/issue gồm chữ-số, `-` và `_`, vd `[E0003]` · `[B202608_2201]` · `[20260911_001]`. Không có task thì **bỏ hẳn**, không để `[]` |
| `<type>` | Có | `feat` \| `fix` \| `chore` \| `docs` \| `refactor` \| `test` |
| `(<scope>)` | Không | `kebab-case`, vd `(monitor)`, `(runners)` |
| `!` sau type/scope | Không | Đánh dấu breaking change, vd `feat!:`, `fix(api)!:` |
| `<subject>` | Có | Ngắn, tiếng Việt hoặc Anh; **không** kết thúc bằng dấu chấm; ≤ 120 ký tự cả header |

Regex khớp commitlint:

```
^(?:\[[A-Za-z0-9][A-Za-z0-9_-]*\] )?(feat|fix|chore|docs|refactor|test)(\([a-z0-9-]+\))?(!)?: .+
```

⚠️ **Một regex, ba nơi dùng** — `commitlint.config.js`, `.github/scripts/test-coverage-status.ts` (`TASK_RE`) và bảng trên phải khớp nhau. Lệch một ký tự là có commit qua được commitlint mà **rơi khỏi sổ nợ test**: `[B202608_2201] feat(log): …` từng qua `bun run lint:commit` nhưng bị `test:status` xếp vào *không truy được task*, mà loại đó theo đúng tài liệu thì **không tính là thiếu test**.

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

- **Backend / Frontend / Shared** (`src/backend/…`, `src/frontend/…`, `src/shared/…`) — đổi **logic** (hành vi helper, gate, schema dùng chung, middleware) thì nêu module + thay đổi; rename/import-only ghi một dòng ngắn hoặc *Không*.
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
- **Dòng test của version phải tồn tại và xanh** — gate CI `Release test gate` chạy đúng ở loại PR này: nó overlay `test/x.y.z/main` lên head SHA của PR rồi chạy full suite. Ba thông điệp chặn khác nhau: *chưa viết test* (dòng test không tồn tại · rỗng · hoặc còn task thiếu test theo `test:status --strict`) · *không có neo* (dòng test chưa có `reports/`, hoặc SHA neo không còn tồn tại) · *test đỏ*. Đây là cổng cứng, không phải cảnh báo. 🚫 Không còn cổng theo phần trăm coverage — xem [`testing.md`](testing.md) §6.
- **Body nêu link sang dòng/PR test của version** — người duyệt release phải biết test nằm đâu mà không phải đi tìm. Đặt vào `## Nội bộ & công cụ dev`, hoặc ngay dưới title nếu không có section nào phù hợp.
- **Mở PR trên web kèm `?template=release.md`** để GitHub áp đúng template; mở thẳng sẽ ra template PR feature, khi đó xoá body và dán lại theo mục này.

---

## 9. Ngôn ngữ & lối viết tài liệu

- **Tài liệu và comment hướng người dùng/PR: tiếng Việt.** Comment kỹ thuật trong code: ngắn gọn, theo mật độ code xung quanh — quy ước đầy đủ ở [`coding-guideline.md`](coding-guideline.md) §7.
- **Định danh thì tiếng Anh, nội dung thì tiếng Việt.** Tên job / step / check run của workflow là **định danh**: branch protection khớp required check theo đúng string đó, và `gh pr checks` in nó ra. Đặt tiếng Anh như tên biến. Còn thứ chúng *in ra* — job summary, thông điệp lỗi, `::error::` — theo tiếng Việt như mọi bề mặt người đọc khác.
- **Đổi tên job đang là required check là breaking change** — protection trỏ vào tên cũ sẽ thành "expected — waiting". Đổi thì sửa protection cùng lượt.
- **Tài liệu tham khảo mô tả quy tắc/hành vi hiện hành**, không thuật lại lịch sử thay đổi.
- **Không trích số issue, số PR, tên người, tên skill/agent** trong tài liệu tham khảo và comment code — thông tin nhất thời, dễ outdate.
- **Vẫn khuyến khích trích dẫn tới nguồn ổn định** (tài liệu khác trong repo, spec) khi giúp đáng tin và dễ đọc hơn.
- **Ngoại lệ**: PR body vẫn phải có `Part of #n` ở đầu — PR là artifact tạm thời, không phải tài liệu tham khảo lâu dài.
