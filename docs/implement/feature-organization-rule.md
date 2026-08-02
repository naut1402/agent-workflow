# Feature organization rule — tổ chức feature & helper

Quy ước **hiện hành** khi làm task đụng `src/features/*`, tầng `business/`, và logic dùng chung. Bổ sung [`AGENTS.md`](../../AGENTS.md) / [`../architecture.md`](../architecture.md); không thay thế bất biến trong `AGENTS.md`. Coding convention (TS/Zod/FE): [`coding-convention.md`](coding-convention.md).

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
| SCSS mode | `styles/index.scss` (glob từ `main.ts`) |
| Prefer shell / theme / locale app | `src/core/contracts/schemas/` hoặc plugins — **không** đẩy schema shell vào feature |
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
3. **Không** import sâu `../../other-feature/business/foo.js` từ controller hay module nội bộ.
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
- Preference shell (`locale`, theme, …) → `core/contracts` / plugins.
- Driver log ghi hạ tầng → `core/log`.

---

## 4. Coupling & hướng phụ thuộc

```
core/lib, core/contracts, core/log, core/registry
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

## 5. Test & CI gắn với chỗ đặt file

| Đổi gì | Test tối thiểu |
|--------|----------------|
| Hàm thuần / business | `tests/` mirror path; runner **bun** nếu đụng fs |
| Composable / component | vitest + `mountWithI18n` nếu có `t()` |
| Helper `core/lib` dùng FE | `bun run build` nếu nghi `node:fs` lọt bundle |
| Đổi overload `fileHelper` | `bun run typecheck` |

---

## 6. Tóm tắt nhanh

1. Task → chọn **feature** → đặt đúng lớp (api / controller / business / UI / schema / locale).
2. `business/` = **nghiệp vụ đang xử lý gì**, ít file; peer chỉ qua `business/index`.
3. Dùng chung → **mở rộng** `*Utils` / `*Lib` / `fileHelper` trước khi copy hoặc tạo file mới.
4. Domain sanitize ở feature; FS/path qua `fileHelper`; không phình core bằng nghiệp vụ.
