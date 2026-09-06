# Coding guideline — ngôn ngữ, Zod, Vue, i18n

Quy ước viết code **hiện hành** trong repo này.

Kiến trúc và bất biến bắt buộc: [`docs/architecture.md` §6](../architecture.md#6-bất-biến-kiến-trúc). Đặt file theo feature: [`feature-architecture-guideline.md`](feature-architecture-guideline.md).

---

## 1. Ngôn ngữ & module

- **ESM thuần** (`"type": "module"`); server import core Node có tiền tố `node:`.
- **TypeScript cho code mới/migrate** — chỉ còn `src/features/agent-editor/business/agentMarkdown.js` và `src/runner-cli.mjs` chưa chuyển, nên `tsconfig.json` giữ `allowJs: true`.
- **Chưa bật strict toàn cục** (`strict: false`, `checkJs: false`) — bật dần theo từng module đã có type vững, đừng coi cả repo đã strict.
- **Không dùng `enum`** — ưu tiên union literal type (không cấm `z.enum`).
- **Không default export** trừ khi framework bắt buộc (Vue SFC, `vite`/`vitest`/`playwright.config.*`, `*.d.ts`).

Lint/format: `bun run lint` · `bun run lint:fix` · `bun run format`. ESLint (flat) map quy ước ở mức `warn`:

| Quy ước | Rule |
|---------|------|
| Không TS `enum` | `no-restricted-syntax` → `TSEnumDeclaration` |
| Không default export | `ExportDefaultDeclaration` + allowlist |
| `<script setup lang="ts">` | `vue/block-lang` + `vue/component-api-style` |

---

## 2. Quirk TypeScript phải biết

- **Discriminant kiểu boolean không narrow đúng** dưới `vue-tsc` (TS6) trong repo này — `{ok:true,…} | {ok:false,…}` với `if (!v.ok) return v` **không** hoạt động.
- **Dùng `in` để narrow** — `if ('error' in v) return v`.
- **Hoặc đổi discriminant sang string literal** — `kind: 'ok' | 'err'`.

---

## 3. Zod là nguồn chân lý cho type & validation

- **Định nghĩa schema một lần**, suy type bằng `z.infer` — không viết tay `interface` song song với validator.
- **Validate ở mọi biên I/O** (state JSON, YAML pipeline, request body) bằng `safeParse`.
- **Parse fail → trả default, không throw** — giữ triết lý defensive.
- **Schema domain ở `src/features/<feature>/schemas/`**; preference shell (`appSettings`) ở `src/core/configs/` để tránh `core` → `features`.

---

## 4. Kiến trúc & coupling — chỉ đi xuống

- **Functional + ctx-injection** — dependency truyền qua tham số `ctx`, không class-DI / NestJS / OOP framework.
- **Phụ thuộc một chiều** — `core/lib` → `core/configs` + `core/log` không import feature → domain module chỉ import core → `http/` / feature controller. Không vòng tròn.
- **`business/` không biết HTTP** — nhận `root` / `ctx`, trả data thuần (`{ status, error }` khi lỗi).
- **Controller mỏng** — parse request → gọi `XxxBusiness` → `this.json` / `ok`.

---

## 5. Frontend (Vue 3)

- **`<script setup lang="ts">`** cho mọi SFC.
- **Kéo logic suy diễn ra khỏi `.vue`** xuống composable / lib thuần TS để test không cần render.
- **Cấu trúc feature-module** — `src/features/<mode>/{components,composables,scripts/*Api.ts,styles,locales,schemas}` + nền `src/core/{ui,composables,lib,shell}`; plugin app-scope ở `src/plugins/`.
- **Quy ước button** (ưu tiên icon-btn, default không viền, hover scale) — [`docs/ui-buttons.md`](../ui-buttons.md).

Primitive dùng chung trong `src/core/ui/`:

- **Đặt tên `C<Name>.vue`** (`C` = Custom), class CSS gốc `c-<name>` — vd `CSelect.vue` / `.c-select`. Không dùng prefix `App`.
- **Icon luôn qua `<Icon name="..." />`** (`src/core/ui/Icon.vue`) — **không** tự vẽ `<svg>` / `<path>` trong component feature. Icon chưa có thì thêm case mới vào `Icon.vue` (giữ nguyên viewBox/style gốc), không copy SVG ra file khác dù chỉ dùng 1 nơi.
- **Dropdown mới không dùng `<select>` native** — dùng `CSelect` (option cố định) hoặc `CComboSelect` (nhiều option / creatable). Chỉ giữ `<select>` khi cần hành vi trình duyệt gốc không có API tương đương.
- **Class truyền vào `CSelect`/`CComboSelect` chỉ lo kích thước** (`width` / `flex` / `min-width`). Truyền class control native (`cfg-input`, `cfg-textarea`) sẽ rơi vào `div` wrapper → hộp lồng hộp. Mẫu đúng: `cfg-select` / `cfg-combo-select`.

---

## 6. Ngôn ngữ UI (i18n)

- **Mọi UI string đi qua `vue-i18n`** — không hardcode trong `.vue` / `.ts`.
- **`vi` là locale mặc định và fallback** (`fallbackLocale: 'vi'`) — locale khác thiếu key thì hiện bản `vi`, không bắt typecheck đối ứng đủ.
- **Message theo feature** — `src/features/<feature>/locales/{vi,en}.ts` (+ `common` ở `src/plugins/i18n/locales/common/`), plugin **glob** tự nạp. Namespace = camelCase tên feature (`agent-editor` → `agentEditor`).
- **Plugin chỉ gắn từ `main.ts`** qua `installPlugins`; `registerLocale` để bổ sung locale vào registry app-scope.
- **Trong `<script setup>` dùng `useI18nHelpers()`** (`src/core/composables/useI18nHelpers.ts`) — **không** import `useI18n` từ `vue-i18n`. Ngoài setup: `import { t } from '@/plugins/i18n'`.
- **Locale hiện tại ở `AppSettings.locale`** (localStorage), đổi qua `useLocale()`.
- **Test mount component có `t()`** dùng `mountWithI18n` (`tests/src/helpers/i18n.ts`).
- **Thêm/sửa text UI** — thêm key ở `vi`; `en` khuyến nghị nhưng không bắt buộc. Chi tiết: [`docs/i18n.md`](../i18n.md).

---

## 7. Comment code (KISS)

- **Chỉ comment khi cần giải thích *why*** — constraint ẩn, workaround, invariant khó thấy. Không giải thích *what*: tên biến/hàm tốt đã đủ.
- **Sửa nhỏ lẻ thì giữ nguyên comment cũ** — chỉ sửa khi nó đã outdate/sai so với code hiện tại.
- **Không thêm comment tường thuật thay đổi vừa làm** — cấm dạng `// sửa theo review`, `// fix CI`, `// đổi X vì lỗi Y`.
- **Comment mô tả hành vi hiện hành**, không kể lịch sử, không trích số issue / số PR / tên người.
- **Ngôn ngữ theo mật độ code xung quanh** — khối comment tiếng Anh thì viết tiếp tiếng Anh, không trộn nửa Anh nửa Việt.
