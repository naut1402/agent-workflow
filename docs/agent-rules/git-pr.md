# Git & PR — hygiene, commit, branch, worktree, todo debt, PR body, ngôn ngữ, publish tài liệu

Toàn bộ quy ước git/commit/PR gộp về **một file** — kể cả phần trước đây tách ở `docs/convention/` vì lý do "không gắn CI riêng". Cơ chế branch/CI hiện hành (§4, §5, §7, §8) gắn chặt repo này; các quy ước còn lại (§1–3, §6, §9–11) là nguyên tắc SWE chung áp dụng lên trên cơ chế đó — không tách file nữa để khỏi phải nhảy qua lại.

---

## 1. Git hygiene — staging, rename/move

Áp dụng khi stage, rename/move, hoặc migrate file trong repo.

### 1.1 Staging — không add mù

- **Cấm `git add -A` / `git add .` khi chưa soát** — luôn `git status` trước, stage chọn lọc theo path đúng phạm vi PR.
- **Soát `git status` + `git diff --staged` trước mọi commit** — không để dính generated/build (`dist/`, `coverage/`, `playwright-report/`, `test-results/`), export/scratch (`*.export.txt`, `*.log`), lockfile khác `bun.lock`, hay file module ngoài phạm vi PR.
- **File rác lặp lại → thêm `.gitignore` ngay.**

### 1.2 Rename / move / migrate — không để lại bản cũ

- **Dùng `git mv`** để giữ history và tránh sót bản cũ.
- **Migrate `.js` → `.ts` thì xoá `.js` ngay** — không để 2 bản cùng tồn tại.
- **Sau khi move, `git status` phải toàn rename (R)** — không thừa "Added", không thiếu "Deleted".
- **Test chỉ ở `tests/` / `test-e2e/`**, không co-locate.

---

## 2. Tách commit theo xử lý

Một commit ≈ một concern.

### Khi nào tách

- **Nhiều loại thay đổi cùng lúc** — `feat` / `fix` / `refactor` / `docs` / `test` / `chore`, mỗi loại (hoặc mỗi vertical slice) một commit.
- **Cùng loại nhưng độc lập về phạm vi** — vd sửa Docker script vs CRUD connection vs rule git.
- **Hotfix nhỏ trên cùng branch với refactor lớn** — tách để cherry-pick / revert riêng được.

### Quy tắc

1. **Một commit ≈ một concern** — mô tả được bằng một câu subject.
2. **Không trộn** refactor lớn với fix hành vi, hoặc docs quy ước với code feature — trừ khi không tách được an toàn (migration atomic).
3. **Thứ tự hợp lý** — nền (refactor/chore) → feat/fix → docs/test bổ sung.
4. **Stage chọn lọc theo path** (`git add <path>`), không `git add -A` khi working tree còn file ngoài concern hiện tại.
5. **Subject nêu *vì sao / xử lý nào***, không liệt kê hết file.
6. **Tách ngay lúc commit**, không dồn lại rồi chia khi mở PR.
7. **Test luôn là commit `test:` riêng** — không bao giờ dính trong commit `feat`/`fix`. Trong giai đoạn `tests/` còn nằm trên dòng source, đây là điều kiện để cherry-pick phần test sang dòng test mà không kéo theo code — xem §4.3.

| Tách tốt | Tránh |
|----------|--------|
| `chore(docker): thêm bun script compose` rồi `feat(runner): sửa/xoá connection` | Một commit "cập nhật 1.0.2" gồm Docker + runner + docs |
| `docs(git): quy ước tách commit theo xử lý` riêng | Nhét rule docs vào commit feature không liên quan |
| `refactor(runner): …` rồi `fix(runner): …` | Refactor + đổi hành vi user trong cùng commit |

Quy ước format message: §3.

---

## 3. Commit message, PR title & issue title

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
- **Ngoại lệ duy nhất: PR phát hành** (base `main` ← `dev/x.y.z/main`) — commitlint không chạy trên base `main`, title dùng dạng `Release version x.y.z` — xem §8.

Mapping label GitHub theo type: `feat`→`enhancement`, `fix`→`bug`, `docs`→`documentation`, `chore`→`chore`, `refactor`→`refactor`, `test`→`test`.

Kiểm tra local trước khi push:

```bash
printf '%s\n' 'fix(monitor): sửa scroll archive' | bun run lint:commit
bunx commitlint --from origin/dev/1.1.2/main --to HEAD --verbose
```

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
| `_` | Dấu gạch dưới ngăn taskID với slug. ⚠️ `{taskID}` **được phép** chứa `_` (xem §3), còn `{task-slug}` là `kebab-case` nên không chứa `_` ⇒ tooling tách hai phần ở dấu `_` **cuối cùng** (`taskIdOfBranch()` trong `.github/scripts/test-ref.ts`), vd `dev/1.1.5/B202608_2201_sqlite-log-driver-poc` → taskID `B202608_2201` |
| `{task-slug}` | `kebab-case` toàn chữ thường, 3–5 từ, mô tả nội dung task |

```bash
git fetch origin
git switch -c dev/1.1.2/T0000abcd_ten-task-ngan origin/dev/1.1.2/main
```

- **Base là `origin/dev/x.y.z/main`** — không phải `origin/main`. Request nêu base khác dạng `/main` (vd `dev/x.y.z/dev`) thì vẫn trích `x.y.z` để đặt tên, còn base checkout đúng branch request nêu.
- **PR của branch này target `dev/x.y.z/main`** (không phải `main`); PR promote lên `main` theo §8.
- **Tên branch không được kết thúc bằng `/main`** — pattern `dev/**/main` là branch dòng version, được workflow sync tự cập nhật từ `main`.
- **Dòng version chưa tồn tại trên remote thì không tự tạo** — mở dòng version là việc của release, hỏi người chốt trước.
- **Commitlint** chạy trên PR base `dev/**/main` → PR title và **mọi** commit phải đúng format — xem §3.
- **Branch chung của task lớn (§5.2) thắng về base** — task con cắt từ branch chung, tên branch vẫn theo §4.2.

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
- **Commitlint chạy trên base `test/**/main`** → PR title và mọi commit đúng format (§3), `type` là `test` (hoặc `chore` cho commit report do CI đẩy).
- **Workflow của dòng test checkout ref đang trigger, 🚫 không `ref: main`** — tooling dòng test (`test-ref.ts`, `coverage-gate.ts`, `sync-line.sh`) chỉ có mặt trên `main` sau khi version mở nó được release. Lấy script từ `main` trước lúc đó cho `Module not found`, mà lỗi đó đọc ra như "cổng hỏng" chứ không phải "chưa tới lượt".
- ⚠️ **`AUTO_MERGE_TOKEN` biến mọi push của CI thành trigger.** Không có secret đó, push bằng `GITHUB_TOKEN` 🚫 không kích workflow tiếp theo — nghe như hạn chế, nhưng đó chính là **van chặn vòng lặp duy nhất** của mô hình này, và nó là van *ẩn*: khai secret vào là mất van, không có gì cảnh báo. Đã xảy ra thật: job `report` push `reports/` về dòng test → push kích lại `test-overlay.yml` → `report` push lần nữa, ba lượt full suite liên tiếp cách nhau ~4,5 phút.
- **Mọi workflow mà CI tự push vào branch nó đang lắng nghe phải có van tường minh.** Ở đây là `paths-ignore: reports/**` trên trigger `push` của `test-overlay.yml` và `sync-test-line.yml` — `reports/` là **đầu ra**, không phải đầu vào, nên bỏ qua nó không mất phủ. 🚫 Đừng thay van bằng cách hạ `report` về `github.token`: token ở đó là để **có quyền push** khi dòng test bị branch protection. Token là quyền, `paths-ignore` là vòng lặp — hai việc khác nhau.
- **Job `report` chỉ chạy ở chiều `direction == 'test'`** (push vào dòng test), và đó là lượt duy nhất ghi `source_sha`/`test_sha` vào baseline.
- **Viết và chạy test ở local**: đứng thẳng trên branch dòng test cũng chạy được (cây đầy). Muốn chấm đúng cặp ref như CI thì `bun run test:overlay` kéo cây test về cây source đang đứng, `bun run test:push <branch-test> "<message>"` đẩy ngược lên dòng test. Xem [`testing.md`](testing.md) §3.1.
- **Dòng test mồ côi** (version bị huỷ, không release) không bao giờ vào `test/main`; dọn bằng cách xoá branch, không merge.

---

## 5. Issue task — version, milestone, chia nhỏ

Mỗi task có một issue GitHub, tạo theo một trong hai template (`gh issue create --template <file>`):

| | `.github/ISSUE_TEMPLATE/feature.md` | `.github/ISSUE_TEMPLATE/bug.md` |
|---|---|---|
| Loại task | feat · refactor · docs · chore · test | fix |
| Label | gán tay theo type | gán sẵn `bug` |
| Tổng quan | Bối cảnh · Mong muốn | Hiện trạng · Trình tự tái hiện |
| Kết quả điều tra | **Phương châm** đối ứng · Phạm vi thay đổi · Ngoài phạm vi · `### Chi tiết kỹ thuật` | **Phương án** đối ứng · Phạm vi thay đổi · Ngoài phạm vi · `### Chi tiết kỹ thuật` |
| Kế hoạch (phạm vi lớn) | chia thành **sub issue** (§5.2) | chia thành **nhiều PR**, mỗi PR ghi `Part of #<issue>` (§5.2) |
| Checklist | label · version · milestone · chia nhỏ | version · milestone · whitebox · blackbox |

- **`### Chi tiết kỹ thuật` (trong `## Kết quả điều tra`) giống hệt nhau ở hai template** — 🚫 không đổi tên heading này, script publish (§11.3) tìm đúng chuỗi đó. Sửa phần dùng chung của một template thì sửa luôn template kia.
- **`## Tài liệu liên quan` không bắt buộc** — agent tự quyết có thêm hay không. Chỉ dùng cho tài liệu của issue khác hoặc tài liệu yêu cầu nằm ngoài pipeline; tài liệu pipeline của chính task ở `### Chi tiết kỹ thuật`.
- **Checklist của template chỉ nêu tên việc** — quy trình từng việc ở mục này.

### 5.1 Release version & milestone

**Release version** `x.y.z` là điểm checkout branch chung cho toàn bộ task — base là `origin/dev/x.y.z/main` (§4.2). **Milestone** tên đúng bằng version (`x.y.z`), dùng để quản lý các issue trong version đó. Xác định theo thứ tự:

1. **Người dùng chỉ định version** → dùng version đó.
2. **Không chỉ định** → suy từ các dòng version đang mở (`origin/dev/x.y.z/main` chưa release, tức version lớn hơn version trên `main`):
   - Chỉ một dòng → dùng dòng đó.
   - Nhiều dòng → chọn theo loại issue: **bug · cải thiện** → dòng **patch** (`x.y.z`, `z > 0`) gần nhất; **tính năng lớn** → dòng **minor / major** (`x.y.0`).
   - Không có dòng phù hợp → hỏi người chốt; 🚫 không tự mở dòng version (§4.2).
3. **Gắn milestone** `x.y.z` — đã có thì gắn vào; chưa có thì tạo mới rồi gắn.

```bash
gh api "repos/{owner}/{repo}/milestones?state=open" --jq '.[] | select(.title=="1.2.0") | .number'
gh api -X POST "repos/{owner}/{repo}/milestones" -f title=1.2.0   # chỉ khi lệnh trên rỗng
gh issue edit <n> --milestone 1.2.0
```

### 5.2 Chia nhỏ task lớn

Task lớn thì không code trước khi có plan (investigate / design) và đã chia nhỏ. Cách chia khác nhau theo loại issue:

- **Bug phạm vi lớn** → chia thành **nhiều PR chỉnh sửa**, 🚫 không tạo sub issue. Mỗi PR liệt kê ở `## Kế hoạch` và ghi `Part of #<issue>` trong body; các PR target thẳng `dev/x.y.z/main` theo §4.2, không cần branch chung.
- **Feature / task lớn** → chia thành **sub issue**, theo các bước dưới:

1. **Branch chung** — `dev/x.y.z/{issue-slug}`, cắt từ `origin/dev/x.y.z/main`. `x.y.z` theo §5.1; `{issue-slug}` là `kebab-case` 3–5 từ tóm tắt mục đích issue. 🚫 Không kết thúc bằng `/main` (§4.2).
2. **Sub issue** — mỗi phần một issue nhỏ, liệt kê ở mục `## Kế hoạch` của issue cha và gắn làm **sub issue** của nó. Branch của task con theo §4.2 nhưng cắt từ branch chung; PR target branch chung, body ghi `Part of #<issue cha>`.
3. **Blocked by** — issue cha **bị block bởi** từng sub issue, để issue cha chỉ đóng được khi mọi phần đã xong.
4. **Gộp về dòng version** — chỉ PR cuối của branch chung merge vào `dev/x.y.z/main`.

API sub issue và dependency nhận **id** của issue (`gh api …/issues/<số> --jq .id`), không phải số issue:

```bash
sub_id=$(gh api "repos/{owner}/{repo}/issues/<sub>" --jq .id)
gh api -X POST "repos/{owner}/{repo}/issues/<cha>/sub_issues" -F sub_issue_id="$sub_id"
gh api -X POST "repos/{owner}/{repo}/issues/<cha>/dependencies/blocked_by" -F issue_id="$sub_id"
```

---

## 6. Git worktree — cô lập mỗi instance agent

Nhiều instance agent có thể làm việc đồng thời trên cùng repo. Mỗi phiên code dùng **một git worktree riêng** để tránh race condition (giành working tree, `index.lock`, checkout đè branch, sửa trùng file, build/test ghi đè).

### 6.1 Bắt buộc

- **Không sửa/commit trực tiếp trên working tree gốc.**
- **Mỗi task/instance một worktree riêng**, gắn một branch riêng (git đã cấm 2 worktree cùng checkout 1 branch).
- **Đặt worktree ngoài cây repo chính** — vd `../wt-<task>`.

### 6.2 Tạo worktree

```bash
git fetch origin
# base: origin/main — task gắn version release thì dùng origin/dev/x.y.z/main
git worktree add -b <branch-name> ../wt-<task> origin/main
cd ../wt-<task>
bun install            # node_modules riêng cho worktree
```

Tên branch và base lấy theo §4 (§4.2 khi task gắn version release).

**Một task có cả worktree dòng source và dòng test** (`dev/x.y.z/{taskID}_{slug}` + `test/x.y.z/{taskID}_{slug}`) thì **đặt tên thư mục worktree đúng bằng taskID** cho cái đang làm việc chính:

```bash
git worktree add -b dev/1.1.4/T0000abcd_ten-task  ../T0000abcd       origin/dev/1.1.4/main
git worktree add -b test/1.1.4/T0000abcd_ten-task ../T0000abcd-test  origin/test/1.1.4/main
```

Vì sao: dashboard map task → worktree theo **hai tầng** — tên thư mục trước, rồi mới tới taskID trong tên branch. Hai worktree cùng mang taskID trong tên branch mà không có thư mục nào tên đúng bằng taskID thì tầng hai thấy **hai** ứng viên và **từ chối đoán** (không remove gì cả). Đặt đúng một thư mục tên `<taskID>` là tầng một khớp ngay, tầng hai không phải chạy.

Harness có sẵn cơ chế cô lập worktree thì dùng luôn — nguyên tắc 1-instance-1-worktree vẫn giữ.

### 6.3 Luôn làm trên commit mới nhất

Áp dụng cho bước **investigate**, **implement** và **test implement**. Điều tra trên code cũ cho ra kết luận phải sửa lại sau khi đồng bộ — phạm vi, call chain, file cần sửa đều có thể đã khác.

- **`git fetch origin` ngay trước khi bắt đầu bước** — kể cả khi worktree vừa tạo; giữa hai bước có thể đã có PR khác merge (chờ HITL, chờ QA).
- **Đứng đúng branch** — investigate đọc code của **base** task (`dev/x.y.z/main` theo §4.2, hoặc branch chung theo §5.2); implement làm trên branch task; test implement làm trên branch task dòng test (§4.3).
- **Branch không được đi sau base** — `git rev-list --count HEAD..origin/<base>` phải ra `0`. Khác `0` thì đồng bộ trước khi làm tiếp:
  - branch **chưa push** → `git rebase origin/<base>`;
  - branch **đã push** → `git merge origin/<base>`, 🚫 không rebase rồi force-push branch đã push.
- **Test implement lấy source mới nhất** — sau khi đồng bộ branch dòng test, chạy lại `bun run test:overlay` để cây test chấm trên code source mới nhất (§4.3).
- **Đồng bộ ra xung đột, hoặc base đổi làm kết luận điều tra không còn đúng** → dừng, cập nhật lại tài liệu của bước trước rồi mới làm tiếp; 🚫 không làm tiếp trên kết luận cũ.

```bash
git fetch origin
git rev-list --count HEAD..origin/dev/1.2.0/main   # phải là 0
```

### 6.4 Làm việc & commit

- **Mọi git / commit / push thực hiện trong worktree đó.**
- **Không `cd` về cây chính để sửa file task khác.**

### 6.5 Tránh đụng tài nguyên runtime

- **Cổng cố định dễ đụng** — dev `:5174`, e2e webServer `:4319`. Hai instance chạy song song thì override khác nhau (`DEV_TEAM_DASHBOARD_PORT`, `E2E_PORT`, hoặc `vite --port`).
- **Registry / jobs store dùng chung `~/.dev-team-dashboard`** — ghi song song thì set riêng `DEV_TEAM_DASHBOARD_HOME` mỗi worktree (e2e đã làm sẵn trong `playwright.config.ts`).

### 6.6 Dọn dẹp sau khi merge

```bash
git worktree remove ../wt-<task>
git worktree prune
git branch -d <branch-name>
git worktree list
```

**Đừng `git push` lại branch vừa merge** — origin có thể đã xoá, push lại sẽ tạo branch rác.

---

## 7. PR todo debt — đánh dấu việc đối ứng sau

Quy ước cho nợ tài liệu / test hoãn lại (`docs/todo/`).

### 7.1 Khi nào ghi nợ

- **Đổi convention / rule trong lúc code chưa ổn** — implement vẫn đang đổi kiến trúc; mỗi lần chỉnh rule rồi sửa lại là lãng phí. Hoãn cập nhật đến khi hành vi đã review / ổn định.
- **Hotfix / POC / ship nhanh** — cố ý tạm bỏ test hoặc bước chất lượng, nhưng vẫn phải **ghi nợ** để không mất dấu.

### 7.2 Phương châm

| Việc | Làm |
|------|-----|
| Đánh dấu nợ | Tạo `docs/todo/<issue>/<task-id>.md` (tạo cả cây `docs/todo/` khi chưa có) |
| Đất sống của file nợ | Branch / PR vào dòng version (`dev/x.y.z/main`) — **được** mang nợ trong giai đoạn version |
| Gate | PR **`dev/x.y.z/main` → `main`**: CI **chặn** nếu thư mục `docs/todo` còn tồn tại |
| Trả nợ | Trước khi promote lên `main`: làm đủ việc còn thiếu **và xoá toàn bộ** `docs/todo/` |

- **`<issue>` / `<task-id>`** là slug chữ-số/gạch ngang (vd `174`, `F0012`, `hotfix-logs`). Không có issue GitHub thì dùng id task nội bộ hoặc `adhoc`.
- **Bất biến**: trên `main` (sau merge từ dòng version), `docs/todo` **không tồn tại**.

#### 7.2.1 Nợ test KHÔNG đi qua `docs/todo/`

Test code sống ở dòng branch riêng (§4.3), nên nợ test có bề mặt cứng của riêng nó — **không** ghi vào `docs/todo/` nữa:

| | Nợ docs/convention | Nợ test |
|---|---|---|
| Đánh dấu bằng | file `docs/todo/<issue>/<task-id>.md` | **dòng `test/x.y.z/main` chưa tồn tại hoặc rỗng** |
| Gate | `todo-debt.yml` — kiểm thư mục có tồn tại (honor-system) | `release-test-gate.yml` — **chạy thật**: overlay dòng test, chạy full suite, gác nợ test theo task (`test:status --strict`) |
| Nới được không | được, bằng cách trả nợ trước khi promote | **không** nới bằng sửa cấu hình cổng. Hotfix gấp thì bỏ qua bằng thao tác có dấu vết (admin merge / ghi rõ ở PR body), không bằng cách tắt gate |

- **Vì sao khác nhau** — nợ docs chỉ người đọc phát hiện được, còn nợ test thì máy chạy ra được. Cái đo được thì gác bằng cách đo, không gác bằng file đánh dấu.
- **Loại nợ `test` trong khung §7.3 vẫn giữ** cho trường hợp còn lại: task cố ý **miễn trừ** test (chỉ đổi tài liệu, chỉ đổi tên biến nội bộ) — ghi lý do miễn trừ để người duyệt thấy, thay vì để cổng đỏ vô cớ.
- **Miễn trừ test khai ở đâu** — [`tests/exemptions.json`](../../tests/exemptions.json) (dòng test), đọc bởi `.github/scripts/test-coverage-status.ts`. Mỗi bản ghi bắt buộc đủ `taskId` + `version` + `reason` + `approved_by`; thiếu `reason`/`approved_by`, dùng wildcard, hay trùng entry đều là **ĐỎ**. 🚫 Không đi qua `docs/todo/` (trộn lại đúng hai loại nợ mà mục này vừa cố ý tách) và 🚫 không miễn cấp version. Cách khai: [`testing.md`](testing.md) §3.1.

### 7.3 Nội dung file nợ

Tối thiểu phải có: **Loại nợ** (`docs-convention` | `test` | `other`), **Vì sao hoãn**, **Việc cần làm khi đối ứng** (checklist), **Liên kết** PR/branch liên quan.

**Không nhét diff dài hay secret vào file nợ.**

Khung chuẩn:

```markdown
# Todo — <task-id>

- **Issue / epic:** <n hoặc slug>
- **Loại nợ:** docs-convention | test | other
- **Branch / PR tạo nợ:** …
- **Ngày tạo:** YYYY-MM-DD

### Vì sao hoãn

…

### Việc cần làm khi đối ứng

- [ ] …
- [ ] Xoá **cả thư mục** `docs/todo/` khi không còn file nợ nào
```

### 7.4 Luồng làm việc

```text
[hotfix / POC / refactor trên dòng version]
    → tạo docs/todo/<issue>/<task-id>.md
    → merge vào dev/x.y.z/main khi còn nợ (gate Todo debt KHÔNG chạy ở đây)

[trước khi mở / merge PR promote: dev/x.y.z/main → main]
    → cập nhật rule trong docs/agent-rules/ (nếu nợ convention)
    → bổ sung test (nếu nợ test)
    → xoá hết docs/todo/ (cả thư mục)
    → CI Todo debt xanh → mới merge được lên main
```

Theo dõi nợ dài hạn ngoài gate này thì dùng GitHub Issue.

### 7.5 CI

- **Script gate**: `.github/scripts/check-todo-debt.ts`; workflow `.github/workflows/todo-debt.yml`.
- **Chỉ chạy khi** `pull_request` có **base** = `main` và **head** khớp `dev/<…>/main`.
- **`bun run check:todo`** fail nếu `docs/todo` còn tồn tại.
- **Nợ test có gate riêng** — `.github/workflows/release-test-gate.yml`, cùng loại PR, nhưng chặn bằng cách chạy thật (§7.2.1). `todo-debt.yml` **không** gánh việc đó.

---

## 8. PR phát hành (`main` ← `dev/x.y.z/main`)

PR promote dòng version lên `main` là **release note hướng người dùng cuối** — mô tả *người dùng thấy gì đổi*, không liệt kê file/hàm. **Không** áp dụng `## Issue` hay checklist PR feature (§9).

- **Title** — `Release version x.y.z`, khớp `version` trong `package.json` của dòng đó.
- **Body** — dùng 5 section sau, giữ nguyên tên và thứ tự:

| Section | Dùng cho | Bắt buộc |
|---|---|---|
| `## Tính năng mới` | Chức năng người dùng chưa từng có — lần đầu phát hành ở chính version này | không |
| `## Cải tiến` | Chức năng **đã release ở version trước**, nay dùng tốt hơn | không |
| `## Sửa lỗi` | Hiện tượng sai **người dùng gặp được trên bản đã release**, nay đã sửa | không |
| `## Nội bộ & công cụ dev` | Không tác động người dùng cuối: tooling, quy ước, CI | không |
| `## PR đã merge` | Danh sách PR đã merge vào dòng version — gồm cả PR sửa cho tính năng mới | **có** |

- **4 section mô tả không bắt buộc** — chỉ giữ section thật sự có nội dung, **xoá hẳn** section rỗng. Không viết "Không có" và **không bịa** nội dung để lấp chỗ trống.
- **Mỗi gạch đầu dòng mở bằng tên tính năng / hiện tượng in đậm**, rồi tới mô tả; nêu cả hành vi mặc định khi bỏ trống và cách báo lỗi nếu có.
- **Nội dung không rơi vào 4 section mô tả** (vd breaking change) → đặt vào section gần nhất và nêu rõ trong mô tả; không tự thêm section mới.
- **Trước khi mở PR: không còn thư mục `docs/todo/`** — gate CI Todo debt chỉ chặn đúng loại PR này (§7).
- **Dòng test của version phải tồn tại và xanh** — gate CI `Release test gate` chạy đúng ở loại PR này: nó overlay `test/x.y.z/main` lên head SHA của PR rồi chạy full suite. Ba thông điệp chặn khác nhau: *chưa viết test* (dòng test không tồn tại · rỗng · hoặc còn task thiếu test theo `test:status --strict`) · *không có neo* (dòng test chưa có `reports/`, hoặc SHA neo không còn tồn tại) · *test đỏ*. Đây là cổng cứng, không phải cảnh báo. 🚫 Không còn cổng theo phần trăm coverage — xem [`testing.md`](testing.md) §6.
- **Body nêu link sang dòng/PR test của version** — người duyệt release phải biết test nằm đâu mà không phải đi tìm. Đặt vào `## Nội bộ & công cụ dev`, hoặc ngay dưới title nếu không có section nào phù hợp.
- **Mở PR trên web kèm `?template=release.md`** để GitHub áp đúng template; mở thẳng sẽ ra template PR feature, khi đó xoá body và dán lại theo mục này.

### 8.1 Mốc so sánh: version đã release trước đó

Release note viết cho người đang chạy **bản đã release gần nhất**, không phải cho người theo dõi dòng `dev/**`. Mốc so sánh là cây `main` trước lượt promote này.

- **Tính năng lần đầu phát hành ở version này chỉ xuất hiện ở `## Tính năng mới`.** Mọi lượt sửa lỗi, tinh chỉnh UI, đổi cách gọi API của nó trong lúc phát triển là **quá trình làm ra tính năng**, không phải "cải tiến" hay "sửa lỗi" theo nghĩa người dùng — họ chưa từng thấy bản lỗi. Mô tả **trạng thái cuối** của tính năng trong đúng một gạch đầu dòng; 🚫 không tách thành dòng riêng ở `## Cải tiến` / `## Sửa lỗi`.
- **`## Cải tiến` / `## Sửa lỗi` chỉ nói về thứ đã có trong bản người dùng đang chạy.** Phép thử một câu: *"người dùng ở version đã release trước đó có gặp được điều này không?"* — **không** thì nội dung đó không lên hai section này; gộp vào gạch đầu dòng của chính thứ nó thuộc về:
  - lỗi/tinh chỉnh của **tính năng mới** → gộp vào gạch đầu dòng ở `## Tính năng mới`;
  - lỗi của một **cải tiến cũng phát hành ở version này** → gộp vào đúng gạch đầu dòng cải tiến đó ở `## Cải tiến`, không mở dòng riêng ở `## Sửa lỗi`.
- **Tính năng ẩn sau cờ tắt mặc định vẫn là tính năng mới** khi lần đầu phát hành; nêu rõ trong mô tả rằng mặc định tắt và bật ở đâu.
- **Dấu vết từng lượt sửa không mất** — nó nằm ở `## PR đã merge`, nơi duy nhất được phép liệt kê PR sửa cho tính năng mới.

### 8.2 `## PR đã merge`

Section bắt buộc, đặt **cuối body**. Cho người duyệt release truy ngược từng thay đổi mà không phải mở `git log`, và là nơi chứa các PR không lên được 4 section mô tả (fix cho tính năng mới, sửa nội bộ vụn).

- **Mỗi dòng `- #<số> — <title PR>`** — GitHub tự render link và trạng thái. Giữ nguyên title gốc của PR, không viết lại theo giọng người dùng cuối.
- **Thứ tự cũ → mới** theo thời điểm merge.
- **Dài quá ~20 dòng thì bọc `<details><summary>Danh sách PR</summary> … </details>`** để body vẫn đọc được.

```bash
gh pr list --base dev/x.y.z/main --state merged --limit 300 \
  --json number,title --jq 'reverse | .[] | "- #\(.number) — \(.title)"'
```

⚠️ Lệnh trên chỉ lấy PR nhắm thẳng `dev/x.y.z/main`. Dòng version có branch chung của task lớn (§5.2) hoặc nhận merge từ dòng khác thì đối chiếu thêm `git log --merges origin/main..origin/dev/x.y.z/main` và bổ sung tay.

---

## 9. Nội dung PR body (PR feature)

Repo có **2 loại PR**, body khác nhau:

| Loại PR | Base ← Head | Body theo |
|---|---|---|
| Feature / fix / docs… | `dev/x.y.z/main` ← branch task | mục này · `.github/pull_request_template.md` |
| Phát hành (promote) | `main` ← `dev/x.y.z/main` | §8 · `.github/PULL_REQUEST_TEMPLATE/release.md` |

Nội dung dưới đây áp dụng cho **PR feature**, theo `.github/pull_request_template.md`.

- **Mục `## Issue` đặt ở đầu**, dùng từ khoá **không** auto-close (`Part of #<n>` / `Refs #<n>`). **Không** dùng `Closes` / `Fixes` / `Resolves`.
- **Thứ tự body cố định**: `## Issue` → `## Tổng quan` → `## Module / Phạm vi` → `## Nội dung thay đổi` (các mục ①, ②, …) → `## Tài liệu liên quan` → `## Checklist`.
- **`## Tài liệu liên quan`** — link tới tài liệu đã publish ở mục `## Kết quả điều tra › ### Chi tiết kỹ thuật` của issue theo §11 (investigate · design · test-spec · whitebox · review-result). 🚫 Chỉ liệt kê tài liệu **đã publish**, không để dòng trống chờ điền.
- **Checklist chỉ hai mục** — đã làm checklist agent (chi tiết ở `AGENTS.md` §4, 🚫 không chép lại từng mục vào PR body) · chưa thực kiểm thử thì đã dán nhãn `test-pending`.

### 9.1 Tổng quan

Ngay dưới `## Issue`, giữ đúng **một** khối theo loại task:

| Loại task | Nội dung |
|---|---|
| Feature | **Bối cảnh** · **Mong muốn** · **Phương châm thực hiện** |
| Fix bug | **Hiện trạng** · **Trình tự tái hiện** (các bước đánh số) · **Phương án chỉnh sửa** |

Chore / docs / refactor chọn khối gần nhất. Mỗi ý 1–3 câu — đủ để reviewer hiểu *vì sao* trước khi đọc *sửa gì*.

### 9.2 Nội dung thay đổi

- **Mỗi thay đổi nghiệp vụ / logic quan trọng một mục, đánh số ①, ②, ③, …**
- **Mỗi mục gồm Logic thay đổi, rồi ngay dưới là một thẻ `<details>` chi tiết chỉnh sửa của riêng mục đó** — 🚫 không gom chi tiết các mục về một chỗ; reviewer đọc logic xong là thấy ngay file hiện thực nó.
- **Các mục ngăn cách bằng đường kẻ ngang `---`** — để trống một dòng phía trên, không thì Markdown đọc `---` thành gạch chân heading của dòng trước.

**Logic thay đổi**

- **Fix / refactor bắt buộc có cặp Trước → Sau** (hành vi hoặc luồng), không chỉ tên hàm đổi chỗ.
- **Feature mới thuần** chỉ ghi *Sau* nếu chưa có hành vi cũ để đối chiếu.

**Chi tiết chỉnh sửa** — nhóm theo **cùng bản đồ thư mục của code**, không liệt kê phẳng "đổi file A, B, C":

| Nhóm trong PR | Ví dụ path |
|---------------|------------|
| HTTP | `src/features/<f>/api.ts`, `controller.ts` |
| Domain | `…/business/` |
| Schema | `…/schemas/` |
| UI / FE API / i18n / style | `…/components/`, `composables/`, `scripts/`, `locales/`, `styles/` |
| Nền / feature khác | `src/backend/…`, `src/frontend/…`, `src/shared/…`, `src/features/<peer>/…` |

- **Mỗi nhóm 1–vài gạch đầu dòng** — *làm gì* / *vì sao*, không dump toàn bộ diff.
- **Test không thuộc PR này** — nó ở PR dòng test (§4.3).

### 9.3 Test view point & kết quả

- **Test view point & test case** — tiếng Việt, checklist theo module/chức năng, **comment lên PR** (không chỉ để trong code); dài thì bọc `<details>`. Mỗi case nêu: đầu vào → hành vi mong đợi.
- **Kết quả test** — đã chạy thật thì comment tổng pass/fail, coverage nếu có, link CI run. **Chưa chạy thật thì không comment kết quả giả.**
- **Evidence e2e** — ảnh screenshot **không** commit vào `docs/`; đính vào comment kết quả test hoặc link artifact `test-evidence` / playwright-report.

---

## 10. Ngôn ngữ & lối viết tài liệu

- **Tài liệu và comment hướng người dùng/PR: tiếng Việt.** Comment kỹ thuật trong code: ngắn gọn, theo mật độ code xung quanh — quy ước đầy đủ ở [`coding-guideline.md`](coding-guideline.md) §7.
- **Định danh thì tiếng Anh, nội dung thì tiếng Việt.** Tên job / step / check run của workflow là **định danh**: branch protection khớp required check theo đúng string đó, và `gh pr checks` in nó ra. Đặt tiếng Anh như tên biến. Còn thứ chúng *in ra* — job summary, thông điệp lỗi, `::error::` — theo tiếng Việt như mọi bề mặt người đọc khác.
- **Đổi tên job đang là required check là breaking change** — protection trỏ vào tên cũ sẽ thành "expected — waiting". Đổi thì sửa protection cùng lượt.
- **Tài liệu tham khảo mô tả quy tắc/hành vi hiện hành**, không thuật lại lịch sử thay đổi.
- **Không trích số issue, số PR, tên người, tên skill/agent** trong tài liệu tham khảo và comment code — thông tin nhất thời, dễ outdate.
- **Vẫn khuyến khích trích dẫn tới nguồn ổn định** (tài liệu khác trong repo, spec) khi giúp đáng tin và dễ đọc hơn.
- **Ngoại lệ**: PR body vẫn phải có `Part of #n` ở đầu — PR là artifact tạm thời, không phải tài liệu tham khảo lâu dài.

---

## 11. Publish tài liệu task vào issue

Mỗi bước pipeline có tài liệu đầu ra thì **publish tài liệu đó thẳng vào body issue của task**, mục `### Chi tiết kỹ thuật` trong `## Kết quả điều tra` — người theo dõi issue đọc được kết quả từng bước mà không phải mở `.dev-team-agent/tasks/<task-id>/`, và `## Tài liệu liên quan` của PR (§9) trỏ về issue này.

| Bước | Tài liệu | Nhãn |
|---|---|---|
| Investigate | `investigate.md` | `investigate` |
| Design | `design.md` | `design` |
| Test design | `test-spec.md` | `test-spec` |
| Review | `review.md` | `review-result` |
| PR | link spreadsheet whitebox | `whitebox` |

Bước không có tài liệu đầu ra (implement, test implement) thì không publish.

### 11.1 Khi nào publish

- **Ngay khi tài liệu của bước đã chốt** — ghi file xong, trước khi báo DONE. Bước kết thúc `BLOCKED` (còn `qa.md` chờ người) thì **chưa** publish.
- **Investigate / design cập nhật luôn phần tóm tắt của `## Kết quả điều tra`** — phương châm đối ứng (feature) hoặc phương án đối ứng (fix), phạm vi thay đổi, ngoài phạm vi — đủ để người đọc issue biết task sẽ tiến hành thế nào.
- **Tài liệu sửa lại sau đó** (doc review, HITL yêu cầu sửa, chạy lại bước) → **thay đúng khối cũ** giữa cặp marker, 🚫 không thêm khối mới — issue chỉ giữ bản cuối của mỗi tài liệu.
- **Đọc lại body ngay trước khi ghi** — `gh issue edit --body-file` ghi đè cả body; đọc từ bản cũ là xoá mất phần người khác vừa sửa.
- **Issue của task** là issue GitHub nêu trong request của task — cũng là issue PR sẽ ghi ở `Part of #<n>`. Task không gắn issue GitHub, hoặc publish lỗi (hết quyền, mất mạng) → ghi rõ ở kết quả trả về của bước, 🚫 không chặn pipeline.

### 11.2 Định dạng khối

Mỗi tài liệu một khối, bọc trong **một** thẻ `<details>`, nằm giữa cặp marker để lượt sau tìm và thay:

```markdown
<!-- task-doc: <task-id>/<nhãn> -->
<details>
<summary><b>Design</b> — <task-id> · cập nhật YYYY-MM-DD</summary>

<nội dung design.md, giữ nguyên>

</details>
<!-- /task-doc: <task-id>/<nhãn> -->
```

- **Để trống một dòng sau `</summary>` và trước `</details>`** — thiếu thì GitHub không render markdown bên trong.
- **Nội dung giữ nguyên file** — không tóm tắt lại; whitebox chỉ có link spreadsheet.
- **Thứ tự khối theo thứ tự bước** (bảng trên) — khối mới chèn sau khối cuối cùng đang có.
- **Body vượt giới hạn 65.536 ký tự** → đăng tài liệu đó thành comment riêng (cùng định dạng), khối trong body chỉ còn `<details>` chứa link tới comment.
- **Không secret, không dán diff dài** — cùng ràng buộc với file nợ (§7.3).

### 11.3 Lệnh

`block.md` là khối `<details>…</details>` (không kèm marker), soạn trong thư mục tạm cùng `body.md` — 🚫 không ghi vào repo.

```bash
gh issue view <n> --json body -q .body > body.md
KEY='T0000abcd/design' BLOCK=block.md BODY=body.md bun -e '
const fs = require("node:fs")
const { KEY, BLOCK, BODY } = process.env
const open = `<!-- task-doc: ${KEY} -->`, close = `<!-- /task-doc: ${KEY} -->`
const block = `${open}\n${fs.readFileSync(BLOCK, "utf8").trim()}\n${close}`
let body = fs.readFileSync(BODY, "utf8").replace(/\r\n/g, "\n")
const i = body.indexOf(open), j = body.indexOf(close)
if (i >= 0 && j > i) {
  body = body.slice(0, i) + block + body.slice(j + close.length)
} else {
  const last = body.lastIndexOf("<!-- /task-doc: ")
  const h = body.indexOf("\n### Chi tiết kỹ thuật\n")
  let at = -1
  if (last >= 0) at = body.indexOf("-->", last) + 3
  else if (h >= 0) {
    at = body.indexOf("\n", h + 1)
    const m = body.slice(at).match(/^\s*<!--[\s\S]*?-->/)
    if (m) at += m[0].length
  }
  body = at < 0
    ? `${body.trimEnd()}\n\n### Chi tiết kỹ thuật\n\n${block}\n`
    : `${body.slice(0, at)}\n\n${block}\n${body.slice(at)}`
}
fs.writeFileSync(BODY, body)
'
gh issue edit <n> --body-file body.md
```
