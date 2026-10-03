# Quy ước — đặt code vào đúng chỗ (feature architecture)

Quy ước **hiện hành** khi task đụng `src/features/*`, tầng `business/`, logic dùng chung, hoặc MCP server (`mcp/`).

Kiến trúc tổng quan và bất biến: [`docs/architecture/`](../architecture/). Quy ước ngôn ngữ / Zod / Vue: [`coding-guideline.md`](coding-guideline.md).

## 1. Bản đồ đặt file theo task

Xác định **feature sở hữu** trước, rồi đặt artifact đúng lớp:

| Loại thay đổi | Đặt ở |
|---------------|--------|
| Route HTTP | `src/features/<f>/api.ts` (+ method trên `controller.ts`) |
| Parse request / `c.json` / status | `controller.ts` — **không** nhét filesystem vào đây |
| Domain thuần (đọc/ghi root, rule nghiệp vụ) | `business/` |
| Zod schema domain | `schemas/` của feature |
| UI Vue / composable | `components/`, `composables/` |
| FE gọi API | `scripts/*Api.ts` (dùng `apiGet` / `apiPost` từ `src/frontend/http/client`) |
| Chuỗi UI | `locales/vi.ts` (+ `en` khuyến nghị) |
| Style chỉ **1** component render selector gốc | `<style scoped lang="scss">` trong chính `.vue` |
| Style **≥2** component cùng feature | `features/<f>/styles/*.scss` + `@use` từ `styles/index.scss` |
| Style xuyên feature, hoặc element do JS/`core` tạo runtime | `src/frontend/styles/` (shell) hoặc primitive `src/frontend/ui/C<Name>.vue` |
| Prefer shell / theme / locale app | `src/frontend/configs/` hoặc `src/frontend/plugins/` |
| Helper kiểu dữ liệu / wrap package / FS | `src/backend/lib/` (Node) hoặc `src/frontend/lib/` (browser) |
| Ghi audit / request log | `src/backend/log/` — feature `logs` chỉ đọc/stream |

- **Không tạo cây song song** kiểu `server/<domain>` hay helper "misc" ngoài convention.
- **Feature tự mang `styles/index.scss` và `locales/{vi,en}.ts`** — glob eager ở `src/frontend/main.ts` tự nạp, không liệt kê tay, không sửa hub wiring.

## 2. Tổ chức `business/`

> [!IMPORTANT]
> <span style="color:#a371f7">File trong `business/` chia theo **quan hệ abstraction ↔ hiện thực**, không theo capability (kiểu thao tác, loại dữ liệu).</span>

**Phạm vi**: `src/features/*/business/` và `mcp/`. 🚫 Không áp cho `src/{backend,frontend,shared}/lib` (`*Utils`, `*Lib`, `fileHelper`), `components/`, `styles/`, `locales/`, `schemas/`, `scripts/*Api.ts` — nhóm này giữ quy ước riêng ở §1, §3, §5.

### 2.1 Phân biệt logic trừu tượng và logic chi tiết

| | Logic trừu tượng | Logic chi tiết |
|---|---|---|
| **Là gì** | Hợp đồng và quy trình nghiệp vụ dựa vào | Cách hiện thực hợp đồng bằng một cơ chế cụ thể |
| **Dạng** | `interface` vai trò · lớp `Abstract*` giữ trình tự cố định (template method) · rule nghiệp vụ thuần không I/O | Lớp / hàm gọi CLI, HTTP, SDK, file, DB, YAML cụ thể · tên env var, path, tên nhà cung cấp, định dạng thông điệp |
| **Ví dụ trong repo** | `RunnerProvider`, `AgentCliProvider`, `*Store` (`runner`) · `AgenticApiProvider` · `AbstractMcpTools`, `ToolDef` | `claude-code-cli.ts`, `codex-cli.ts`, `anthropic-compatible-api.ts` · `tools/TaskTools.ts` |
| **Tần suất đổi** | Thấp nhất — đổi là đổi mọi hiện thực | Cao — đổi riêng từng hiện thực |

Ba câu hỏi để xếp một đoạn logic:

- **Thay cơ chế thì có phải sửa không?** Đổi CLI → API, file → DB, YAML → JSON mà đoạn này vẫn đứng yên → trừu tượng.
- **Có ≥ 2 hiện thực không?** Tính cả hiện thực thật và test double thay ở biên I/O. Chỉ có một và không phải biên I/O → chưa cần tách abstraction.
- **Nó có biết tên một thứ cụ thể không?** Biết tên binary, env var, path, định dạng, nhà cung cấp → chi tiết, kể cả khi đang nằm trong lớp abstract.

### 2.2 Chia file theo quan hệ abstraction

- **Một abstraction = một file**, tên file trùng tên kiểu: `RunnerProvider.ts`, `AbstractMcpTools.ts`.
- **Một hiện thực = một file**, đặt cạnh abstraction hoặc trong thư mục con mang tên vai trò (`providers/`, `tools/`). Tên = biến thể + vai trò: `ClaudeCliProvider.ts`, `TaskTools.ts`.
- **Interface nằm cùng file với abstraction của nó**, 🚫 không gom vào `types.ts` chung — gom theo "là type" là chia theo capability. Type dữ liệu thuần dùng chung đi qua `schemas/` (`z.infer`).
- **Phụ thuộc một chiều: chi tiết → abstraction.** Caller (business khác, controller) chỉ biết abstraction; đúng **một** chỗ lắp ráp (factory / registry / composition root) biết hiện thực cụ thể.
- **Abstraction không chứa chi tiết** — tên env var, path, prefix thông điệp, tên nhà cung cấp đẩy xuống hiện thực hoặc truyền vào qua tham số / hook.
- **Không tạo abstraction trước nhu cầu** — một hiện thực, không phải biên I/O thì viết module thường theo §2.3. Tách ra khi xuất hiện hiện thực thứ hai.
- **Đổi chữ ký abstraction là thay đổi lớn** — ghi trong `design.md` §4 kèm danh sách hiện thực bị ảnh hưởng.

### 2.3 Module không có quan hệ abstraction

Logic đơn lẻ (một hiện thực, không phải biên I/O) gom theo nghiệp vụ, không theo kiểu thao tác:

| Nên | Tránh |
|-----|--------|
| `agents.ts` (CRUD + path + seed template + fetch URL an toàn) | `store.ts` + `paths.ts` + `fetch.ts` + `templates.ts` tách chỉ vì khác I/O |
| `dashboardSettings.ts` / `autoscan.ts` | `autoscan/config.ts` + `scan.ts` khi cùng một cụm settings nhỏ |
| Tách `catalog/scan.ts` khi scan đã lớn và biên rõ với `buildCatalog` | Tách `builtins.ts` / `dedupe.ts` 20 dòng chỉ vì "loại helper" |

- **Ít file, ít phân tán** — chỉ tách khi biên rõ với người đọc domain, hoặc file đủ lớn / đủ độc lập để review và test riêng.
- **Helper nhỏ** (sanitize tên, parse một format) gắn vào module đang dùng nó — không tạo file riêng chỉ vì "là sanitize" / "là parse".

### 2.4 Áp dụng cho code hiện có

- **Không đổi tên / tách hàng loạt.** Code đang có (`runner/business/types.ts`, `providers/claude-code-cli.ts`…) giữ nguyên tới khi task sửa đáng kể vùng đó.
- **Task tạo mới hoặc sửa đáng kể một vùng có abstraction** — đưa vùng đó về §2.2 trong cùng thay đổi, hoặc ghi nợ `docs/todo/`.

### 2.5 Ranh giới HTTP

- **`business/` không import Hono**, không biết `c.req`.
- **Nhận `root` / dữ liệu đã parse**, trả data thuần hoặc `{ status, error }` / discriminated result.
- **Facade `XxxBusiness extends AbstractBusiness` mỏng** — `requireRoot` → gọi hàm domain.

### 2.6 Cross-feature (peer)

- **Chỉ `features/<A>/business/index.ts`** được import từ `features/<B>/business/**`.
- **Trong feature A**, controller và các `business/*.ts` import peer qua `./business/index.js` (hoặc `./index.js` trong cùng `business/`).
- **Không import sâu** `../../other-feature/business/foo.js` từ controller hay module nội bộ — **trừ** khi đi qua index tạo vòng barrel.
- **Tránh vòng barrel↔barrel** — khi cần, index A re-export từ **module sâu** của B.
- **Sanitize / rule chỉ thuộc một feature** đặt trong module sở hữu; feature khác dùng qua index.

## 3. Logic dùng chung — mở rộng helper trước khi copy

Thứ tự quyết định:

1. **Đã có trong `src/backend/lib/` · `src/frontend/lib/` · `src/shared/lib/`?** → dùng lại.
2. **Cùng kiểu, thiếu API?** → **mở rộng** helper hiện có (giữ tên & overload TypeScript ổn định).
3. **Loại hoàn toàn mới, dùng ≥ 2 feature hoặc FE+BE?** → thêm helper mới theo quy ước tên dưới đây.
4. **Chỉ một feature / một capability?** → để trong `business/` của feature đó, **không** đẩy lên `backend/` · `frontend/` · `shared/` sớm.

### 3.1 Quy ước tên trong `backend/lib` · `frontend/lib` · `shared/lib`

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

### 3.2 Không thuộc `*/lib`

- **Rule / sanitize domain** (tên agent, profile, task id, artifact path) → business feature sở hữu.
- **Preference shell** (`locale`, theme) → `src/frontend/configs` / `src/frontend/plugins`.
- **Driver log ghi hạ tầng** → `src/backend/log`.

## 4. Hướng phụ thuộc

```
backend/{lib,configs,log,registry}   shared/{lib,log}   frontend/{lib,configs,ui,composables,shell}
        ↑
features/*/business
        ↑
features/*/controller + api.ts
        ↑
src/backend (setup) / src/frontend/main.ts (glob)
```

- **Không vòng tròn**; `backend` / `frontend` / `shared` **không** import `features`.
- **Ranh giới scope**: `frontend` 🚫 `backend` (và 🚫 `node:*` / `bun:*` / `hono` / `drizzle-orm`), `backend` 🚫 `frontend` (và 🚫 `vue`), `shared` 🚫 cả hai + 🚫 hạ tầng. Lint chặn, không whitelist.
- **Zod một nguồn chân lý** tại `schemas/`; `safeParse` ở biên I/O; fail → default an toàn.

## 5. Tổ chức style (SCSS)

Tiêu chí **duy nhất** chọn nơi đặt style là **bao nhiêu component render selector gốc** (selector ở cột 0, không tính class con lồng bên trong):

| Selector gốc được render bởi | Đặt ở |
|------------------------------|--------|
| Đúng **1** component | `<style scoped lang="scss">` trong chính `.vue` đó |
| **≥2** component **cùng** feature | `features/<f>/styles/<Nhóm>.scss` + `@use` từ `styles/index.scss` |
| **≥2** feature, hoặc element do JS/composable `core` tạo runtime | `src/frontend/styles/` (shell), hoặc primitive `src/frontend/ui/C<Name>.vue` + class `c-<name>` |

- **Kích thước file không phải lý do tách** — 300 dòng `<style scoped>` cạnh template vẫn dễ định vị hơn 300 dòng ở file rời.
- **Đếm theo compound CUỐI của selector, không phải tổ tiên** — `scoped` gắn `[data-v-…]` vào compound cuối. Rule *bắc cầu* (tổ tiên ở SFC này, đích ở SFC khác) tính là **≥2 component**.
- **Giữ đúng thứ tự nạp cũ khi gộp nhiều file** vào một `<style scoped>` — rule cùng specificity dựa vào source order để thắng.
- **Giữ global, không scope hoá**: `src/frontend/styles/_tokens.scss` (`:root` vars), `_shell.scss`, `_scrollbar.scss`.

Không làm:

- **File `styles/<Component>.scss` mà chỉ component đó render selector gốc** → inline vào SFC.
- **File SCSS chỉ có comment, 0 rule** → xoá cả dòng `@use`.
- **`styles/index.scss` chỉ tồn tại để `@use` lại file private** → xoá cả thư mục `styles/`; glob ở `main.ts` là pattern-based nên **không** sửa `main.ts`.
- **Đặt tên `common.scss` cho nội dung chỉ một component dùng** — tên sai lệch còn tệ hơn phân mảnh.
- **Định nghĩa primitive xuyên feature** (`.cfg-input`, `.chip`) trong `styles/` của một feature — feature khác sẽ phụ thuộc ngầm vào thứ tự glob; đưa lên `src/frontend/styles/`.

## 6. Test gắn với chỗ đặt file

| Đổi gì | Test tối thiểu |
|--------|----------------|
| Hàm thuần / business | `tests/` mirror path; runner **bun** nếu đụng fs |
| Composable / component | vitest + `mountWithI18n` nếu có `t()` |
| Helper `src/*/lib` dùng ở FE | `bun run build` nếu nghi `node:fs` lọt bundle |
| Đổi overload `fileHelper` | `bun run typecheck` |

## 7. MCP server (`mcp/`)

`mcp/` là transport thứ hai song song `apiServer` — handler đóng vai controller, gọi `business/` của feature. Chia file theo quan hệ abstraction ↔ hiện thực như §2.2.

| Thay đổi | Đặt ở |
|---|---|
| Hành vi chung mọi server (lọc tool, `instructions`, vòng đời) | `mcp/AbstractMcpServer.ts` |
| Helper chung mọi nhóm tool (`ok` / `fail` / `requireRoot`, `ToolDef`) | `mcp/AbstractMcpTools.ts` |
| Chọn nhóm tool, preamble, cảnh báo khởi động của dashboard | `mcp/DashboardMcpServer.ts` |
| Tool mới / sửa tool | `ToolDef` + method trong `mcp/tools/<Feature>Tools.ts` của feature được gọi tới |

- **Một file = một class**, tên file trùng tên class. Ngoại lệ duy nhất: entry `mcp/server.ts`.
- **Một tool = một `ToolDef`** — tên, `access`, schema, mô tả, handler, `hint` khai cùng chỗ; 🚫 không tách schema / allowlist / hướng dẫn sang file khác.
- **Nhóm tool `extends AbstractMcpTools`**, handler là method public (test gọi thẳng); logic domain ở `business/` của feature, 🚫 không viết lại trong handler.
- **Chi tiết và ràng buộc cài đặt**: [`docs/mcp/server.md`](../mcp/server.md) §8.
