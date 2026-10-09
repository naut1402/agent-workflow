# Tooling — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho `.github/scripts/`, `scripts/` và file cấu hình ở gốc repo. Chỉ ghi phần không tự giải thích được qua tên file. Quy ước dòng test và cổng phát hành: [`../../agent-rules/testing.md`](../../agent-rules/testing.md) §3.1, §6. Khi sửa, đối chiếu lại với code thật.

---

## 1. Cổng neo SHA — `test-anchor.ts`

- **Fetch trước khi kết luận `anchor-gone`** — `anchorExists()` thử `git fetch origin <sha>` khi `cat-file` thất bại: `actions/checkout` chỉ lấy history của head ref, nên neo nằm ở dòng version trước không có sẵn trong workspace dù commit vẫn còn trên remote.
- **Remote không tới được ≠ neo mất** — `anchorReachable()` chỉ kết luận `anchor-gone` khi `git ls-remote --exit-code origin` thoát 0 hoặc 2 (2 = remote tới được nhưng không có ref nào); mã khác là lỗi công cụ (exit 2), không phải kết luận của cổng.
- **SHA neo phải đủ 40 hex ở cả đường ghi lẫn đường đọc** — `readAnchor()` đòi cùng ràng buộc với `normalizeSha()` (`coverage-gate.ts`): git resolve được SHA viết tắt nên `cat-file` / `merge-base` vẫn chạy, nhưng `anchorSha === headSha` là so chuỗi ⇒ kết luận `behind` sai.

## 2. Ghép branch dòng source — `pair-source.ts`

- **`spawnSync` không qua shell** — `taskId` lấy từ tên branch do người mở PR đặt, nên không được nội suy vào chuỗi lệnh; glob `refs/heads/dev/<version>/<taskId>_*` là glob của refspec, không phải của shell.
- **Lọc lại kết quả glob bằng `taskIdOfBranch()`** — `_` vừa ngăn `{taskID}_{slug}` vừa hợp lệ trong taskID, nên `B202608_*` khớp cả branch của `B202608_2201`. Bỏ bước lọc thì một khớp duy nhất kiểu đó thành `paired: taskid` trên cây source của task khác.

## 3. Phân runner — `lib/runners.ts`

- **`bunTest` rỗng là lỗi** — `bun test` không kèm path quét toàn bộ repo và chạy cả file test thuộc vitest; `readRunners()` ném lỗi thay vì trả mảng rỗng.

## 4. Môi trường vitest — `vitest.config.ts`

- **Ép `NODE_ENV = 'test'` ở đầu file** — container dashboard đặt `NODE_ENV=production`, vitest chỉ tự set `test` khi biến chưa có; Vite đọc biến lúc load config để tính `isProduction`, nên đặt trong `test.env` là đã muộn.
- **`--no-webstorage` trên Node ≥ 25** — `localStorage` dựng sẵn (chưa đầy đủ) của Node che mất bản của jsdom.
- **Alias `zod` → `tests/shims/zod.ts`** — zod 3.25 là dual-package, Vite để named import `{ z }` thành `undefined`.

## 5. Coverage frontend

- **Reporter `json-summary` là bắt buộc** — `.github/scripts/coverage-gate.ts` đọc `coverage/frontend/coverage-summary.json` để ghi mốc coverage của version; `html` / `lcov` chỉ phục vụ người đọc.

## 6. Ranh giới import — `eslint.config.js`

- **Pattern khớp trên chuỗi specifier** — `no-restricted-imports` so minimatch với specifier, nên `**/backend/**` bắt cả import tương đối (`../../backend/log/store.js`) mà không cần alias.
- **`files` của khối frontend phủ trọn phần FE của feature** — gồm cả `lib/`, `schemas/`, `locales/`, `registerMode.ts`, không chỉ `components` / `composables` / `scripts`. `schemas/` dùng chung FE/BE nên là đường ngắn nhất để một component kéo `src/backend/**` vào.

## 7. Root mặc định của Vite dev — `vite.config.ts`

- **`root` = thư mục cha của `cwd`** — dashboard chạy từ `.dev-team-agent/viewer/` thì cha của `cwd` chính là data root; `DEV_TEAM_ROOT` ghi đè. Giá trị này thành `ctx.defaultRoot` của `devTeamApi()` — project phục vụ khi request không có `?project=`.
