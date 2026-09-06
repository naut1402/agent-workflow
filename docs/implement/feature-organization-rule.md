# Feature organization rule — tổ chức feature & helper

Quy ước **hiện hành** khi làm task đụng `src/features/*`, tầng `business/`, và logic dùng chung. Bổ sung [`../architecture.md`](../architecture.md); không thay thế [bất biến kiến trúc](../architecture.md#6-bất-biến-kiến-trúc). Coding convention (TS/Zod/FE): [`coding-convention.md`](coding-convention.md).

Lịch sử tái cấu trúc: [`../cookbook/core-path-reorg.md`](../cookbook/core-path-reorg.md). Checklist review: [`review-checklist-rule.md`](review-checklist-rule.md).

---

## 1. Bản đồ đặt file theo task

Khi nhận task, xác định **feature sở hữu** trước, rồi đặt artifact đúng lớp:

| Loại thay đổi | Đặt ở |
|---------------|--------|
| Route HTTP | `src/features/<feature>/api.ts` (+ method trên `controller.ts`) |
| Parse request / `c.json` / status | `controller.ts` — **không** nhét filesystem vào đây |
| Domain thuần (đọc/ghi root, rule nghiệp vụ) | `business/` (theo §2) |
| Zod schema domain | `schemas/` của feature |
| UI Vue / composable | `components/`, `composables/` |
| FE gọi API | `scripts/*Api.ts` (dùng `apiGet` / `apiPost` từ `core/http`) |
| Chuỗi UI | `locales/vi.ts` (+ `en` khuyến nghị) |
| Style chỉ **1** component render selector gốc | `<style scoped lang="scss">` trong chính `.vue` (§5) |
| Style **≥2** component cùng feature dùng | `features/<f>/styles/*.scss` + `@use` từ `styles/index.scss` — glob từ `main.ts` (§5) |
| Style dùng **xuyên feature**, hoặc gắn element do JS/`core` tạo runtime | `src/styles/` (shell) hoặc primitive `core/ui/C<Name>.vue` (§5) |
| Prefer shell / theme / locale app | `src/core/configs/` hoặc plugins — **không** đẩy schema shell vào feature |
| Helper kiểu dữ liệu / wrap package / FS | `src/core/lib/` (§3) |
| Ghi audit / request log | `src/core/log/` — feature logs chỉ consume / stream job log |

**Không** tạo lại cây song song kiểu `server/<domain>` hay helper “misc” ngoài convention.

Feature mới: thêm thư mục theo checklist cuối cookbook — glob tự nạp route/styles/locales; tránh sửa hub wiring tay.

---

## 2. Tổ chức `business/`

### 2.1 Theo nghiệp vụ đang xử lý

Chia module theo **capability / đối tượng nghiệp vụ gắn kết**, không theo kiểu thao tác kỹ thuật.

| Nên | Tránh |
|-----|--------|
| `agents.ts` (CRUD + path + seed template + fetch URL an toàn) | `store.ts` + `paths.ts` + `fetch.ts` + `templates.ts` tách chỉ vì khác I/O |
| `dashboardSettings.ts` / `autoscan.ts` | `autoscan/config.ts` + `scan.ts` nếu cùng một cụm settings nhỏ |
| Tách `catalog/scan.ts` khi scan đã lớn và biên rõ với `buildCatalog` | Tách `builtins.ts` / `dedupe.ts` 20 dòng chỉ vì “loại helper” |

**Mục tiêu:** ít file, ít phân tán. Chỉ tách khi:

1. Biên capability rõ với người đọc domain, **hoặc**
2. File đã đủ lớn / đủ độc lập để review & test riêng.

Helper nhỏ (sanitize tên, parse một format) **gắn vào module đang xử lý capability đó** — không tạo file riêng chỉ vì “là sanitize” / “là parse”.

### 2.2 Ranh giới HTTP

- `business/` **không** import Hono / không biết `c.req`.
- Nhận `root` / dữ liệu đã parse; trả data thuần hoặc `{ status, error }` / discriminated result.
- Facade `XxxBusiness extends AbstractBusiness` mỏng: `requireRoot` → gọi hàm domain.

### 2.3 Cross-feature (peer)

1. Chỉ **`features/<A>/business/index.ts`** được `import` từ `features/<B>/business/**`.
2. Trong feature A: controller và `business/*.ts` khác import peer qua `./business/index.js` (hoặc `./index.js` trong cùng `business/`).
3. **Không** import sâu `../../other-feature/business/foo.js` từ controller hay module nội bộ — **trừ** khi đi qua index tạo **vòng barrel** (vd `agent-editor/business/index` re-export pipeline → pipeline/controller không được import index đó; import sâu `agentMarkdown.js` thay thế).
4. Tránh vòng barrel↔barrel: khi cần, index A re-export từ **module sâu** của B (không bắt buộc đi qua `B/business/index` nếu tạo cycle).

Sanitize / rule chỉ thuộc một feature: đặt trong module sở hữu; feature khác dùng qua index (của mình re-export hoặc của peer — theo quy tắc trên).

---

## 3. Logic dùng chung — mở rộng helper trước khi copy

Thứ tự quyết định:

1. **Đã có trong `src/core/lib/`?** → dùng lại.
2. **Cùng kiểu, thiếu API?** → **mở rộng** helper hiện có (giữ tên & overload TypeScript ổn định).
3. **Loại hoàn toàn mới, dùng ≥ 2 feature hoặc FE+BE?** → thêm helper mới theo quy ước tên dưới đây.
4. **Chỉ một feature / một capability?** → để trong `business/` của feature đó (hoặc `composables`/`lib` FE nội bộ), **không** đẩy core sớm.

### 3.1 Quy ước tên trong `core/lib`

| Loại | Tên | Ví dụ |
|------|-----|--------|
| Thao tác kiểu dữ liệu thuần | `*Utils` | `stringUtils`, `arrayUtils`, `dateUtils` |
| Biên thư viện bên thứ ba | `*Lib` | `yamlLib`, `markdownLib`, `diffLib` |
| Filesystem / path / URL file (Node) | `fileHelper` | `joinPath`, `readTextFile`, `pathToFileURL`, `dirnameFromImportMeta` |
| Quét thư mục + dynamic `import` (Node/Bun) | `dirModuleLoader` | `loadModulesUnder` |

- `parseFrontmatter` / `readYamlSafe` nằm `yamlLib`.
- Module **FE + BE** dùng chung: **không** `import` top-level `node:*` (Vite bundle). I/O Node để `fileHelper` hoặc dynamic import có chủ đích (`dirModuleLoader` — **không** import từ bundle browser).
- Business **không** `import` trực tiếp `node:fs` / `node:path` / `node:url` (path↔file URL) — đi qua `fileHelper`. Thêm thao tác fs mới → bổ sung vào `fileHelper` (kèm overload nếu cần, vd `readDir` với `withFileTypes`) rồi mới gọi từ business.
- `apiServer` đăng ký route: `loadModulesUnder(featuresRoot, { entryFile: 'api.ts' })` rồi sort `routeOrder` / gọi `registerRoutes` — **không** liệt kê feature tay; giữ `node:http` / `node:buffer` ở tầng transport.
- Sau khi đổi chữ ký helper: chạy `bun run typecheck` (CI gate).

### 3.2 Không thuộc `core/lib`

- Rule/sanitize **domain** (tên agent, profile, task id, artifact path) → business feature sở hữu.
- Preference shell (`locale`, theme, …) → `core/configs` / plugins.
- Driver log ghi hạ tầng → `core/log`.

---

## 4. Coupling & hướng phụ thuộc

```
core/lib, core/configs, core/log, core/registry
        ↑
features/*/business
        ↑
features/*/controller + api.ts
        ↑
src/api (setup) / main.ts (glob)
```

- Không vòng tròn; `core` **không** import `features`.
- Zod một nguồn chân lý tại `schemas/`; `safeParse` ở biên I/O; fail → default/an toàn, không throw lung tung.

---

## 5. Tổ chức style (SCSS)

Cùng mục tiêu §2.1 — **ít file, ít phân tán**. Tiêu chí **duy nhất** để chọn nơi đặt
style là **bao nhiêu component render selector gốc** (selector ở cột 0 của file, không
tính class con lồng bên trong):

| Selector gốc được render bởi | Đặt ở |
|------------------------------|--------|
| Đúng **1** component | `<style scoped lang="scss">` trong chính `.vue` đó |
| **≥2** component **cùng** feature | `features/<f>/styles/<Nhóm>.scss` + `@use` từ `styles/index.scss` |
| **≥2** feature, hoặc element do JS/composable `core` tạo runtime (không có scope-id) | `src/styles/` (shell), hoặc primitive `core/ui/C<Name>.vue` + class `c-<name>` |

**Kích thước file không phải lý do tách.** 300 dòng `<style scoped>` cạnh template của
nó vẫn dễ định vị hơn 300 dòng ở file rời + một dòng `@use`.

**Đếm theo compound CUỐI của selector, không phải tổ tiên.** `scoped` gắn `[data-v-…]`
vào compound cuối, nên rule chỉ inline được khi **phần tử đích** nằm trong template của
chính SFC đó. Rule *bắc cầu* — tổ tiên ở SFC này, đích ở SFC khác (vd
`.preview-active .catalog-panel`, `.monitor-sub-sidebar .tasklist`) — tính là **≥2
component** ⇒ bậc 2, dù chỉ có một component render selector gốc.

Không làm:

- File `styles/<Component>.scss` mà chỉ component đó render selector gốc → inline vào SFC.
- File SCSS chỉ chứa comment, 0 rule (kiểu `/* … hiện gói trong X. */`) → xoá cả dòng `@use`.
- `styles/index.scss` chỉ tồn tại để `@use` lại các file private → xoá cả thư mục `styles/`;
  glob ở `main.ts` là pattern-based nên **không** sửa `main.ts`.
- Đặt tên `common.scss` cho nội dung chỉ một component dùng (tên sai lệch còn tệ hơn
  phân mảnh) — và ngược lại, đừng để `<Component>.scss` rỗng trong khi `common.scss`
  giữ hết style của đúng component đó.
- Định nghĩa primitive dùng xuyên feature (`.cfg-input`, `.chip`, …) trong `styles/` của
  một feature bất kỳ: feature khác sẽ phụ thuộc ngầm vào thứ tự glob → đưa lên `src/styles/`.

Khi tách một file SCSS đang phục vụ nhiều component: kiểm bằng **compound cuối** —
với mỗi selector, phần tử đích phải do template của SFC nhận nó render. Rule nào không
thoả thì thuộc bậc 2/3, không inline.

Khi gộp nhiều file vào một `<style scoped>`: **giữ đúng thứ tự nạp cũ** (theo thứ tự
`@use` trong `index.scss` — `common` trước, `<Component>` sau), vì các rule cùng
specificity dựa vào source order để thắng.

Giữ global, **không** scope hoá: `src/styles/_tokens.scss` (`:root` vars — SFC `scoped`
đọc biến bình thường), `_shell.scss`, `_scrollbar.scss`.

---

## 6. Test & CI gắn với chỗ đặt file

| Đổi gì | Test tối thiểu |
|--------|----------------|
| Hàm thuần / business | `tests/` mirror path; runner **bun** nếu đụng fs |
| Composable / component | vitest + `mountWithI18n` nếu có `t()` |
| Helper `core/lib` dùng FE | `bun run build` nếu nghi `node:fs` lọt bundle |
| Đổi overload `fileHelper` | `bun run typecheck` |

---

## 7. Tóm tắt nhanh

1. Task → chọn **feature** → đặt đúng lớp (api / controller / business / UI / schema / locale).
2. `business/` = **nghiệp vụ đang xử lý gì**, ít file; peer chỉ qua `business/index`.
3. Dùng chung → **mở rộng** `*Utils` / `*Lib` / `fileHelper` trước khi copy hoặc tạo file mới.
4. Domain sanitize ở feature; FS/path qua `fileHelper`; không phình core bằng nghiệp vụ.
5. Style: **1 component → `<style scoped>` trong SFC**; ≥2 component cùng feature → `styles/`; xuyên feature → `src/styles/` (§5).
