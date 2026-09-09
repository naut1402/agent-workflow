# Feature architecture guideline — đặt code vào đúng chỗ

Quy ước **hiện hành** khi task đụng `src/features/*`, tầng `business/`, hoặc logic dùng chung.

Kiến trúc tổng quan và bất biến: [`docs/architecture.md`](../architecture.md). Quy ước ngôn ngữ / Zod / Vue: [`coding-guideline.md`](coding-guideline.md).

---

## 1. Bản đồ đặt file theo task

Xác định **feature sở hữu** trước, rồi đặt artifact đúng lớp:

| Loại thay đổi | Đặt ở |
|---------------|--------|
| Route HTTP | `src/features/<f>/api.ts` (+ method trên `controller.ts`) |
| Parse request / `c.json` / status | `controller.ts` — **không** nhét filesystem vào đây |
| Domain thuần (đọc/ghi root, rule nghiệp vụ) | `business/` |
| Zod schema domain | `schemas/` của feature |
| UI Vue / composable | `components/`, `composables/` |
| FE gọi API | `scripts/*Api.ts` (dùng `apiGet` / `apiPost` từ `core/http`) |
| Chuỗi UI | `locales/vi.ts` (+ `en` khuyến nghị) |
| Style chỉ **1** component render selector gốc | `<style scoped lang="scss">` trong chính `.vue` |
| Style **≥2** component cùng feature | `features/<f>/styles/*.scss` + `@use` từ `styles/index.scss` |
| Style xuyên feature, hoặc element do JS/`core` tạo runtime | `src/styles/` (shell) hoặc primitive `core/ui/C<Name>.vue` |
| Prefer shell / theme / locale app | `src/core/configs/` hoặc plugins |
| Helper kiểu dữ liệu / wrap package / FS | `src/core/lib/` |
| Ghi audit / request log | `src/core/log/` — feature `logs` chỉ đọc/stream |

- **Không tạo cây song song** kiểu `server/<domain>` hay helper "misc" ngoài convention.
- **Feature tự mang `styles/index.scss` và `locales/{vi,en}.ts`** — glob eager ở `src/main.ts` tự nạp, không liệt kê tay, không sửa hub wiring.

---

## 2. Tổ chức `business/`

### 2.1 Chia theo nghiệp vụ, không theo kiểu thao tác

| Nên | Tránh |
|-----|--------|
| `agents.ts` (CRUD + path + seed template + fetch URL an toàn) | `store.ts` + `paths.ts` + `fetch.ts` + `templates.ts` tách chỉ vì khác I/O |
| `dashboardSettings.ts` / `autoscan.ts` | `autoscan/config.ts` + `scan.ts` khi cùng một cụm settings nhỏ |
| Tách `catalog/scan.ts` khi scan đã lớn và biên rõ với `buildCatalog` | Tách `builtins.ts` / `dedupe.ts` 20 dòng chỉ vì "loại helper" |

**Mục tiêu: ít file, ít phân tán.** Chỉ tách khi biên capability rõ với người đọc domain, **hoặc** file đã đủ lớn / đủ độc lập để review và test riêng.

Helper nhỏ (sanitize tên, parse một format) **gắn vào module đang xử lý capability đó** — không tạo file riêng chỉ vì "là sanitize" / "là parse".

### 2.2 Ranh giới HTTP

- **`business/` không import Hono**, không biết `c.req`.
- **Nhận `root` / dữ liệu đã parse**, trả data thuần hoặc `{ status, error }` / discriminated result.
- **Facade `XxxBusiness extends AbstractBusiness` mỏng** — `requireRoot` → gọi hàm domain.

### 2.3 Cross-feature (peer)

- **Chỉ `features/<A>/business/index.ts`** được import từ `features/<B>/business/**`.
- **Trong feature A**, controller và các `business/*.ts` import peer qua `./business/index.js` (hoặc `./index.js` trong cùng `business/`).
- **Không import sâu** `../../other-feature/business/foo.js` từ controller hay module nội bộ — **trừ** khi đi qua index tạo vòng barrel.
- **Tránh vòng barrel↔barrel** — khi cần, index A re-export từ **module sâu** của B.
- **Sanitize / rule chỉ thuộc một feature** đặt trong module sở hữu; feature khác dùng qua index.

---

## 3. Logic dùng chung — mở rộng helper trước khi copy

Thứ tự quyết định:

1. **Đã có trong `src/core/lib/`?** → dùng lại.
2. **Cùng kiểu, thiếu API?** → **mở rộng** helper hiện có (giữ tên & overload TypeScript ổn định).
3. **Loại hoàn toàn mới, dùng ≥ 2 feature hoặc FE+BE?** → thêm helper mới theo quy ước tên dưới đây.
4. **Chỉ một feature / một capability?** → để trong `business/` của feature đó, **không** đẩy lên core sớm.

### 3.1 Quy ước tên trong `core/lib`

| Loại | Tên | Ví dụ |
|------|-----|--------|
| Thao tác kiểu dữ liệu thuần | `*Utils` | `stringUtils`, `arrayUtils`, `dateUtils` |
| Biên thư viện bên thứ ba | `*Lib` | `yamlLib`, `markdownLib`, `diffLib` |
| Filesystem / path / URL file (Node) | `fileHelper` | `joinPath`, `readTextFile`, `pathToFileURL` |
| Quét thư mục + dynamic `import` | `dirModuleLoader` | `loadModulesUnder` |

- **`parseFrontmatter` / `readYamlSafe` nằm ở `yamlLib`.**
- **Module dùng chung FE+BE không top-level import `node:*`** (Vite bundle) — I/O Node để `fileHelper` hoặc dynamic import có chủ đích.
- **`business/` không import trực tiếp `node:fs` / `node:path` / `node:url`** — đi qua `fileHelper`. Cần thao tác fs mới thì bổ sung vào `fileHelper` (kèm overload nếu cần) rồi mới gọi từ business.
- **`apiServer` không liệt kê feature tay** — `loadModulesUnder(featuresRoot, { entryFile: 'api.ts' })` rồi sort `routeOrder`; giữ `node:http` / `node:buffer` ở tầng transport.
- **Đổi chữ ký helper → chạy `bun run typecheck`** (CI gate).

### 3.2 Không thuộc `core/lib`

- **Rule / sanitize domain** (tên agent, profile, task id, artifact path) → business feature sở hữu.
- **Preference shell** (`locale`, theme) → `core/configs` / plugins.
- **Driver log ghi hạ tầng** → `core/log`.

---

## 4. Hướng phụ thuộc

```
core/lib, core/configs, core/log, core/registry
        ↑
features/*/business
        ↑
features/*/controller + api.ts
        ↑
src/api (setup) / main.ts (glob)
```

- **Không vòng tròn**; `core` **không** import `features`.
- **Zod một nguồn chân lý** tại `schemas/`; `safeParse` ở biên I/O; fail → default an toàn.

---

## 5. Tổ chức style (SCSS)

Tiêu chí **duy nhất** chọn nơi đặt style là **bao nhiêu component render selector gốc** (selector ở cột 0, không tính class con lồng bên trong):

| Selector gốc được render bởi | Đặt ở |
|------------------------------|--------|
| Đúng **1** component | `<style scoped lang="scss">` trong chính `.vue` đó |
| **≥2** component **cùng** feature | `features/<f>/styles/<Nhóm>.scss` + `@use` từ `styles/index.scss` |
| **≥2** feature, hoặc element do JS/composable `core` tạo runtime | `src/styles/` (shell), hoặc primitive `core/ui/C<Name>.vue` + class `c-<name>` |

- **Kích thước file không phải lý do tách** — 300 dòng `<style scoped>` cạnh template vẫn dễ định vị hơn 300 dòng ở file rời.
- **Đếm theo compound CUỐI của selector, không phải tổ tiên** — `scoped` gắn `[data-v-…]` vào compound cuối. Rule *bắc cầu* (tổ tiên ở SFC này, đích ở SFC khác) tính là **≥2 component**.
- **Giữ đúng thứ tự nạp cũ khi gộp nhiều file** vào một `<style scoped>` — rule cùng specificity dựa vào source order để thắng.
- **Giữ global, không scope hoá**: `src/styles/_tokens.scss` (`:root` vars), `_shell.scss`, `_scrollbar.scss`.

Không làm:

- **File `styles/<Component>.scss` mà chỉ component đó render selector gốc** → inline vào SFC.
- **File SCSS chỉ có comment, 0 rule** → xoá cả dòng `@use`.
- **`styles/index.scss` chỉ tồn tại để `@use` lại file private** → xoá cả thư mục `styles/`; glob ở `main.ts` là pattern-based nên **không** sửa `main.ts`.
- **Đặt tên `common.scss` cho nội dung chỉ một component dùng** — tên sai lệch còn tệ hơn phân mảnh.
- **Định nghĩa primitive xuyên feature** (`.cfg-input`, `.chip`) trong `styles/` của một feature — feature khác sẽ phụ thuộc ngầm vào thứ tự glob; đưa lên `src/styles/`.

---

## 6. Checklist thêm feature mới

1. **Tạo `src/features/<name>/`** với `api.ts`, `controller.ts`, `business/`, và (tuỳ) `components`, `composables`, `scripts`, `styles/index.scss`, `locales/{vi,en}.ts`, `schemas/`.
2. **Kế thừa abstract** — controller `extends AbstractController`; business `extends AbstractBusiness`.
3. **Gom `business/` theo nghiệp vụ**; peer chỉ qua `business/index.ts`.
4. **Không sửa `apiServer` registry tay** — để glob nạp.
5. **Schema domain để trong feature**, đừng đẩy vào `core/configs` trừ shell preference thật sự.
6. **Dùng `*Utils` / `*Lib` / `fileHelper` có sẵn**, mở rộng helper trước khi copy logic.
7. **Business không import trực tiếp `node:fs` / `node:path`.**
8. **Chạy `bun run typecheck` + `bun run build`** nếu đụng cả FE và Node.
9. **Thêm mode ở FE shell** thì theo [`mode-registry-guideline.md`](mode-registry-guideline.md).

---

## 7. Test gắn với chỗ đặt file

| Đổi gì | Test tối thiểu |
|--------|----------------|
| Hàm thuần / business | `tests/` mirror path; runner **bun** nếu đụng fs |
| Composable / component | vitest + `mountWithI18n` nếu có `t()` |
| Helper `core/lib` dùng ở FE | `bun run build` nếu nghi `node:fs` lọt bundle |
| Đổi overload `fileHelper` | `bun run typecheck` |
