# Coding convention — ngôn ngữ, Zod, FE, i18n

Quy ước code **hiện hành** (module, type, FE, i18n). Tổ chức feature/business/helper: [`feature-organization-rule.md`](feature-organization-rule.md). Bất biến bắt buộc: [`AGENTS.md`](../../AGENTS.md) § Bất biến.

---

## 1. Ngôn ngữ & module

ESM thuần (`"type": "module"`); server import core Node có tiền tố `node:`. Code mới/migrate dùng TypeScript — migration TS cơ bản đã xong, chỉ còn `src/features/agent-editor/business/agentMarkdown.js` (và `src/runner-cli.mjs`) chưa chuyển nên `tsconfig.json` vẫn giữ `allowJs: true`.

`tsconfig.json` hiện **chưa bật strict** (`strict: false`, `checkJs: false` toàn cục) — hướng đi là bật `strict` dần theo từng module khi module đó đã có type vững, đừng coi cả repo đã strict.

Không dùng `enum` (ưu tiên union literal type); không default export trừ khi framework bắt buộc (vd Vue SFC).

Lint/format local & CI: `bun run lint` / `bun run lint:fix` / `bun run format`. ESLint (flat) map quy ước tối thiểu ở mức `warn` (chưa `--max-warnings 0`):

| Quy ước | Rule |
|---------|------|
| Không TS `enum` | `no-restricted-syntax` → `TSEnumDeclaration` (không cấm `z.enum`) |
| Không default export | `ExportDefaultDeclaration` — allowlist `*.vue`, `vite`/`vitest`/`playwright.config.*`, `*.d.ts` |
| `<script setup lang="ts">` | `vue/block-lang` + `vue/component-api-style` |

---

## 2. Quirk TypeScript

Discriminated union với discriminant kiểu boolean (`{ok:true,...}|{ok:false,...}`) — cách narrow quen thuộc (`if (!v.ok) return v`) **không hoạt động đúng** dưới vue-tsc (TS6) trong repo này. Dùng narrowing bằng toán tử `in`: `if ('error' in v) return v`, hoặc đổi discriminant sang string literal (`kind: 'ok'|'err'`).

---

## 3. Zod là nguồn chân lý cho type & validation

Định nghĩa schema bằng Zod một lần, suy type bằng `z.infer` — không viết tay `interface` song song với validator (dễ trôi lệch nhau). Validate ở mọi biên I/O (state JSON, YAML pipeline, request body) bằng `safeParse`, giữ triết lý defensive: parse fail → trả default, không throw. Schema **theo domain feature** đặt ở `src/features/<feature>/schemas/`; preference shell (`appSettings`) giữ ở `src/core/configs/` (core/plugins dùng, tránh `core` → `features`).

---

## 4. Kiến trúc & coupling — chỉ đi xuống

Functional + ctx-injection: dependency truyền qua tham số `ctx`, không dùng class-DI/NestJS/OOP framework. Phụ thuộc chỉ đi một chiều xuống dưới: `src/core/lib/` → `src/core/configs/` và `src/core/log/` không import feature → domain module chỉ import core → `http/` / feature controller. Không vòng tròn.

Helper dùng chung, tổ chức `business/`, peer cross-feature: xem [`feature-organization-rule.md`](feature-organization-rule.md).

Tầng `business/` không biết HTTP — nhận `root`/`ctx`, trả data thuần (`{ status, error }` khi lỗi). Controller parse request → gọi `XxxBusiness` → `this.json` / `ok`.

---

## 5. Frontend (Vue 3)

`<script setup lang="ts">`; kéo logic suy diễn ra khỏi `.vue` xuống composable/lib thuần TS để test không cần render. Cấu trúc feature-module: `src/features/<mode>/{components,composables,scripts/*Api.ts,styles/,locales/,schemas/}` + `src/core/{ui,composables,lib,shell}`; plugins app-scope ở `src/plugins/`; FE client trong `scripts/`; SCSS feature trong `styles/` — tự nạp bởi `import.meta.glob` trong `src/main.ts`; locale feature trong `locales/` — tự nạp bởi plugin i18n.

- Quy ước button (ưu tiên icon-btn, default không viền, hover scale): [`../ui-buttons.md`](../ui-buttons.md).
- **Custom UI primitives** trong `src/core/ui/`: đặt tên `C<Name>.vue` (`C` = Custom), class CSS gốc `c-<name>` (vd `CSelect.vue` / `.c-select`). Dùng khi thay control native (select, …) để theme/token đồng bộ và dễ decorate sau; không dùng prefix `App` cho các primitive này.
- **Icon dùng chung** (`src/core/ui/Icon.vue`): mọi icon SVG trong component feature dùng `<Icon name="..." />` — **không** tự vẽ tay `<svg>`/`<path>` lặp lại trong từng component. Icon chưa có trong union `name` của `Icon.vue` thì thêm case mới trực tiếp vào `Icon.vue` (giữ nguyên viewBox/style gốc), không copy SVG ra file khác dù chỉ dùng 1 nơi.

---

## 6. Ngôn ngữ UI (i18n)

UI strings đi qua i18n (`vue-i18n`), **không** hardcode trong `.vue`/`.ts`. **Tiếng Việt (`vi`) là locale mặc định** và **fallback** (`fallbackLocale: 'vi'`) — locale khác thiếu key thì hiện bản `vi`, không bắt typecheck đối ứng đủ.

- Cài đặt qua `src/plugins` (`installPlugins` / `i18nPlugin`); `registerLocale` để bổ sung locale vào registry app-scope.
- Message theo feature: `src/features/<feature>/locales/{vi,en}.ts` (+ `common` ở `src/plugins/i18n/locales/common/`); plugin **glob** tự nạp. Namespace = camelCase tên feature (`agent-editor` → `agentEditor`).
- Plugin chỉ gắn từ `main.ts` qua `installPlugins` — helpers i18n inject global (`$t`, `$setI18nLocale`). Trong `<script setup>`: `const { t } = useI18nHelpers()` (`src/core/composables/useI18nHelpers.ts` — **không** import `useI18n` từ `vue-i18n`). Ngoài setup (scripts/pure): `import { t } from '@/plugins/i18n'`.
- Locale hiện tại lưu trong `AppSettings.locale` (localStorage); đổi qua `useLocale()`.
- Test mount component có `t()`: dùng `mountWithI18n` (`tests/src/helpers/i18n.ts`).
- **Khi thêm/sửa text UI**: thêm key ở `vi`; `en` khuyến nghị đối ứng nhưng không bắt buộc (thiếu → fallback `vi`). Chi tiết: [`../i18n.md`](../i18n.md).
