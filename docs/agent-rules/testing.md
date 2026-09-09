# Testing — chọn runner, phạm vi chạy, danh mục suite

Quy ước test **hiện hành**. Coverage ưu tiên cao: mỗi module refactor phải kèm test.

---

## 1. Runner & phạm vi

| Tầng | Runner | Phạm vi | Lệnh |
|------|--------|---------|------|
| Unit/integration backend | **bun test** | `src/core/**` (http/registry), `src/features/**/business/**`, `mcp/**` | `bun run test` |
| Unit frontend | **vitest** (jsdom) | `src/**` (features, core, configs) | `bun run test:fe` |
| E2E | **@playwright/test** | full stack: server thật + fixture `.dev-team-agent/` + browser | `bun run test:e2e` |

`bun run test:all` chạy tuần tự: typecheck → lint → bun test → vitest → playwright.

⚠️ **Test code sống ở dòng branch riêng** (`test/x.y.z/…`) — trên dòng source phải `bun run test:overlay` trước khi các lệnh trên có gì để chạy. Xem §3.1.

---

## 2. Vòng lặp local — chạy theo phạm vi

Full suite là việc của CI; mọi PR đều chạy đủ ở workflow `CI`. Ở local dùng:

```bash
bun run test:scope                                # suy ra phạm vi từ thay đổi chưa commit
bun run test:scope --base origin/dev/1.1.2/main   # + các commit trên nhánh
bun run test:scope src/features/automations       # ép phạm vi theo path/thư mục
bun run test:scope --list                         # chỉ in ra sẽ chạy gì
```

Script dựng đồ thị import của `src/` + `mcp/` + `tests/` rồi chọn mọi test file **đi tới được** file đã đổi (transitive), tách sẵn theo runner. Nó cố tình chọn rộng hơn là hẹp.

### 2.1 Blind spot phải tự biết

Trong các trường hợp này chạy full trước khi push:

- **Nạp động** — `apiServer.ts` quét `features/<name>/api.ts` lúc chạy, không có cạnh import nào. Thêm điểm nạp động khác thì phải khai báo trong `.github/scripts/test-scope.ts`.
- **Không đi qua import** — fixture, file JSON/YAML, snapshot, biến môi trường, dữ liệu trong `test-e2e/fixtures/`.
- **Đổi hạ tầng** (`package.json`, `vitest.config.ts`, `tsconfig.json`, `bun.lock`) — script tự nhận ra và chạy full.

### 2.2 Xanh local vẫn có thể đỏ CI

- **Chọn hẹp chỉ giảm thời gian, không giảm trách nhiệm** — môi trường CI khác máy dev (plugin cài sẵn, `/opt/bundled-plugins`, `~/.claude/…`, browser cho e2e).
- **`bun run test:scope` chọn ra 0 file KHÔNG có nghĩa "đã xanh"** — nó nghĩa là "chỗ này chưa ai test".
- **Test đụng filesystem / registry / agent / plugin** — chạy thêm một lượt với env đã tước (`HOME` rỗng, biến plugin trỏ path không tồn tại) trước khi tin là xanh.

### 2.3 Resolve agent template khi chạy local

Repo **không** còn thư mục `plugins/` ở root — bản agent template chỉ là tài liệu, đặt ở `docs/template/agents/`.

`resolveAgentFilePath` (`src/features/runner/business/agentResolver.ts`) tìm agent theo thứ tự:

1. `<projectRoot>/plugins/<plugin>/agents/`
2. `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/agents/`
3. `DEV_TEAM_BUNDLED_PLUGINS` — biến trỏ tới thư mục **chứa** `<plugin>/agents/*.md`
4. `/opt/bundled-plugins`

- **Cache đứng TRƯỚC biến env** — đặt `DEV_TEAM_BUNDLED_PLUGINS` **không** thắng được bản cache cũ. Muốn bản mới thắng thì phải cập nhật hoặc xoá entry trong `~/.claude/plugins/cache/`.
- **Docker không bị ảnh hưởng** — `docker/Dockerfile` copy `docs/template/agents` vào `/opt/bundled-plugins`.

### 2.4 Chạy test trong container dashboard

- **Image có sẵn `bun` + `node`** (Node 24 — `vitest` / `eslint` / `vue-tsc` là script `#!/usr/bin/env node`).
- **`cd /data/project/<repo>` rồi chạy đúng lệnh ở bảng §1** — `bun test` / `vitest` không cần thêm biến môi trường; riêng **E2E cần một bước dựng thư viện hệ thống một lần**, xem §2.5.
- **`node_modules` lấy từ repo mount**, không dùng `/app/node_modules`.

### 2.5 E2E trên máy không có root

- **Chromium của Playwright cần một loạt shared library** (glib, nss, x11, gbm, …) **và ít nhất một font** — container dashboard không có cái nào, cũng không có `sudo` nên `npx playwright install-deps` (đường chuẩn, cần root) không dùng được.
- **Chạy một lần cho mỗi máy**: `bun run e2e:sysdeps`. Script tải browser + `.deb` của các lib đó vào `~/.cache/pw-sysdeps` (~375 MB sau khi giải), tự kiểm chứng bằng `ldd`; in `OK — prefix: …` là xong. Chạy lại lần sau thoát nhanh, không tải lại. Đổi chỗ prefix bằng `PW_SYSDEPS_PREFIX`.
- **Sau đó `bun run test:e2e` chạy bình thường** — `playwright.config.ts` tự phát hiện prefix và trỏ `LD_LIBRARY_PATH` + `XDG_DATA_DIRS` cho **riêng tiến trình browser** (không đụng env của `webServer`). Không có prefix thì khối đó là no-op, nên CI và máy đã cài đủ lib bằng root hành xử không đổi.
- **Tắt hẳn đường prefix** (máy đã cài đủ lib bằng root, hoặc nghi prefix cũ gây lỗi loader): `PW_SYSDEPS_PREFIX=/nonexistent bun run test:e2e`.
- **Cạm bẫy phải biết** — thiếu font thì chrome **vẫn chạy** nhưng mọi text render ra bề rộng 0px, Playwright coi phần tử bounding-box rỗng là "không visible" ⇒ đỏ hàng loạt với message `not visible` / `timeout waiting for locator`. Thấy triệu chứng đó thì chạy lại `bun run e2e:sysdeps` và kiểm `ls ~/.cache/pw-sysdeps/usr/share/fonts` **trước** khi nghi ngờ code.
- **CI không đi đường này** — workflow cài bằng root qua `playwright install --with-deps chromium`.

---

## 3. Layout test — gom vào `tests/` + `test-e2e/`

- **Unit test mirror cây source trong `tests/`** — không co-locate cạnh source.
- **Runner theo path** — khai trong `tests/runners.json` (khoá `bunTest`); phần còn lại dưới `tests/src/**` là vitest. Đây là **nguồn sự thật duy nhất**: cả `bun run test` và `bun run test:scope` đọc file này, nên thêm một thư mục test chỉ khai một chỗ.
- **Script tooling của repo** (`.github/scripts/`) có test riêng ở `tests/tools/`, cùng runner bun.
- **E2E ở `test-e2e/`** — `test-e2e/<feature>.spec.ts` + `test-e2e/fixtures/`; `playwright.config.ts` trỏ `testDir` về đây.

### 3.1 Test sống ở dòng branch riêng

Test code có dòng branch riêng, đối xứng với dòng source — quy ước đầy đủ ở [`git-pr.md`](git-pr.md) §4.3:

```
test/x.y.z/{taskID}_{slug}  →  test/x.y.z/main  →  test/main   (cây đầy của dòng source + test)
```

Không commit nào chứa cả source và test, nên **chạy test = ghép hai cây** — cây test đặt đúng gốc repo (`tests/` + `test-e2e/`), cùng vị trí cây tracked cũ:

```bash
bun run test:overlay                    # suy ref test từ branch đang đứng
bun run test:overlay test/1.1.4/main    # ép ref cụ thể
bun run test:all                        # rồi chạy như bình thường
```

**Đứng trên branch dòng test cũng chạy được** (cây đầy có `package.json` + config runner). Nhưng để chấm đúng **cặp ref** như CI — test của dòng test trên code của dòng source — thì viết trên worktree dòng source rồi đẩy sang, vì bản `src/` ở dòng test chỉ là bản sao được sync định kỳ:

```bash
bun run test:push test/1.1.4/T0000abcd_ten-task "[T0000abcd] test(monitor): phủ TC-01…TC-07"
```

- **Idempotent** — chạy lại là ghi đè; file đã xoá ở ref mới cũng biến mất ở local. `test:push` cũng vậy: nó thay nguyên cây test ở dòng test, không merge từng file.
- **Cây test đang bẩn thì `test:overlay` dừng** thay vì xoá thay đổi chưa commit (giai đoạn đệm `tests/` còn tracked trên dòng source). Chấp nhận mất thì `FORCE=1`.
- **🚫 Không symlink** — vite/vitest resolve qua realpath, symlink ra ngoài gốc repo làm alias `@/…` và shim `zod` vỡ. Cây test phải là file thật trong gốc repo.
- **Chưa overlay mà chạy `bun run test` / `test:scope`** → báo lỗi nêu đúng lệnh cần chạy, **exit khác 0**. "Không tìm thấy test" không bao giờ được hiểu là "đã xanh".
- **Không kéo được dòng test** (mất mạng, dòng test chưa tồn tại) → thông điệp phân biệt rõ với "test đỏ".
- **Trong CI** — `test-overlay.yml` ghép cặp (ref test, ref source) rồi chạy full suite; `ci.yml` job `full` chỉ chạy khi cây test có mặt trong checkout, và khi skip thì ghi rõ ra job summary rằng **đây không phải "đã test và xanh"**.
- **Lệch pha bắt ở cả hai chiều** — `test-overlay.yml` chạy lại cặp ref khi *test* đổi (PR/push dòng test) **và** khi *source* đổi (push `dev/x.y.z/main`). Nhờ chiều thứ hai, một PR code merge sau khi test đã viết mà làm test hỏng thì đỏ ngay ở dòng version, không phải đợi tới PR phát hành. Dòng test của version chưa tồn tại thì lượt đó skip kèm ghi chú, không đỏ vô cớ.

---

## 4. Danh mục suite

Tra bảng này để biết **vùng mình sửa đã có suite nào** (chạy đúng suite đó) và **chỗ nào chưa có** (phải bổ sung test).

**Bảng nằm ở [`tests/CATALOG.md`](../../tests/CATALOG.md)** — cùng cây với test, nên nó đi theo dòng test và không lệch khi hai dòng branch cập nhật lệch nhịp. Ở đây chỉ trỏ tới, không chép lại: chép là có hai bảng, và bảng lệch là bảng vô dụng.

⚠️ **Đang đứng trên dòng source sau khi `tests/` đã bị cắt thì link tương đối ở trên không có file.** Hai cách tới bảng: chạy `bun run test:overlay` để kéo cây test về, hoặc mở bản trên dòng test — [`tests/CATALOG.md` @ `test/main`](https://github.com/naut1402/agent-workflow/blob/test/main/tests/CATALOG.md) (link tuyệt đối, không phụ thuộc branch đang đứng).

**Sinh lại bảng sau khi thêm/đổi thư mục test**, ngay trong cùng thay đổi — sinh **sau khi đã overlay** (cần đồng thời `package.json` của dòng source và cây `tests/` của dòng test):

```bash
bun run test:scope --catalog > tests/CATALOG.md
```

Chạy nhiều suite một lượt thì nối path (cùng runner):

```bash
bun test tests/src/server/automations tests/src/features/monitor/business
npx vitest run tests/src/features/automations tests/src/core/ui
```

---

## 5. Triết lý không-regression

- **Trước khi đụng code production** — viết characterization/golden test trên hành vi hiện tại (pure fn + API response snapshot qua `app.request`), rồi refactor dưới nền xanh đó.
- **Logic/module mới hoàn toàn** — test-first (TDD thật).
- **Test fail sau khi sửa code** (kể cả lỗi chỉ lộ ở CI) — điều tra **root cause**, sửa code sản phẩm. Không mock/stub để né qua đường code đang lỗi.
- **Mock chỉ hợp lệ cho phụ thuộc ngoài** (API, thư viện nặng/không chạy được dưới jsdom) đã hợp lý từ đầu — không dùng mock để thay cho việc sửa bug vừa phát hiện.

---

## 6. Coverage — ngưỡng và cổng

Tách test sang dòng branch riêng thì coverage tụt không còn tự hiện ra trong diff PR. Nên có **hai lớp cổng**, phục vụ hai việc khác nhau:

| Lớp | Ở đâu | Chặn gì |
|---|---|---|
| `thresholds` | `vitest.config.ts` | Sàn cứng, đỏ **ngay trong lượt chạy** vitest. Đặt bằng baseline làm tròn xuống ~1 điểm % |
| `coverage-gate` | `.github/scripts/coverage-gate.ts` | **Xu hướng tụt dần**, dung sai 0,5 điểm % so với baseline đã chốt |

```bash
bun run test:fe                                              # sinh coverage/frontend/
bun run test -- --coverage --coverage-reporter=lcov \
  --coverage-dir=coverage/backend                            # sinh coverage/backend/lcov.info
bun run coverage:gate -- --check                              # gác cổng
```

- **Baseline là dữ liệu, không phải niềm tin** — `reports/coverage-baseline.json` (máy đọc, là cổng) + `reports/coverage-history.md` (log cho người). Xem [`reports/README.md`](../../reports/README.md).
- **Baseline chỉ đi lên** — `--update` lấy `max(cũ, mới)`. Muốn hạ (vd xoá hẳn một module) thì sửa file bằng tay trong một PR test có ghi lý do.
- **Thiếu baseline là ĐỎ**, không phải "đạt". Khởi tạo lần đầu mới cần `--allow-missing`.
- **Cả hai runner đều được gác** — frontend 4 chỉ số từ `coverage-summary.json`, backend một chỉ số `lines` từ `lcov.info`. Vùng không đo được thì cổng nói ra, không im lặng gác một nửa.
- **Ba nơi cổng chạy** — PR dòng test (`test-overlay.yml`) · push dòng test · **PR phát hành** (`release-test-gate.yml`). Nơi cuối là cổng chặn merge thật. 🚫 Cố ý **không** gác ở PR feature của dòng source: làm vậy sẽ chặn mọi PR thêm source trước khi test kịp viết.
- **Test lệch pha với source** là rủi ro số 1 của mô hình tách. Cơ chế phát hiện, tách riêng khỏi coverage: job summary của mọi lượt CI ghi **cặp ref (source, test) + SHA** đã dùng; PR test ghi `Source ref đã overlay`; cổng phát hành chặn khi dòng test của version không tồn tại hoặc rỗng.

---

## 7. E2E capture

- **Module frontend bắt buộc có bước capture e2e** — Playwright boot app thật (standalone + fixture `.dev-team-agent`) và screenshot mode liên quan; spec này gate CI mỗi PR frontend.
- **Ảnh capture không ghi vào `docs/`** — chụp vào `testInfo.outputPath(...)` (gitignored) rồi `testInfo.attach(...)` để vào playwright-report, đính vào comment kết quả test trên PR.
- **CI upload artifact `test-evidence`** (coverage + playwright-report).
- **Module backend không bắt buộc e2e** nếu chỉ migrate code — `bun run test:e2e` chạy `--pass-with-no-tests`.
