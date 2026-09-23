# Coding guideline — ngôn ngữ, Zod, Vue, i18n, comment

Quy ước viết code **hiện hành** trong repo này.

Mức độ ràng buộc đánh dấu bằng màu callout — bảng màu ở [`writing-guideline.md`](writing-guideline.md) §5.

---

## 1. Ngôn ngữ & module

> [!NOTE]
> <span style="color:#4493f8">Chưa bật strict toàn cục (`strict: false`, `checkJs: false`) — bật dần theo từng module đã có type vững, đừng coi cả repo đã strict.</span>

- **ESM thuần** — `package.json` khai `"type": "module"`; không `require()`, không `module.exports`, không file `.cjs`.
- **Backend import built-in của Node có tiền tố `node:`** — `node:path`, không phải `path`. Áp cho `src/backend/`, `api.ts`, `controller.ts`, `business/`.
- **Frontend không import gói phía server** — built-in Node (`node:path` lẫn `path`), `src/backend/**`, `hono`, `drizzle-orm`. Vite không polyfill built-in Node, và import xuyên scope kéo luôn code nghiệp vụ vào bundle trình duyệt.
- **Không import tĩnh `bun:*` trên đường nạp `vite.config.ts`** — `bun run build` chạy `vite build` dưới Node, Node ESM loader không hiểu scheme `bun:`. File với tới được từ `src/backend/apiServer.ts` (hiện tại: `src/backend/db/client.ts`) nạp `bun:sqlite` / `drizzle-orm/bun-sqlite` bằng `await import(...)`, phần type dùng `import type` — import tĩnh làm đỏ step `Build` trong CI.
- **TypeScript cho code mới/migrate** — còn ba ngoại lệ cố ý: `agentMarkdown.js` và `agentDraft.js` (`src/features/agent-editor/business/`), `src/backend/runner-cli.mjs`. Vì vậy `tsconfig.json` giữ `allowJs: true`.
- **Không default export** trừ khi framework bắt buộc (Vue SFC, `vite`/`vitest`/`playwright.config.*`, `*.d.ts`).

Lint/format: `bun run lint` / `bun run lint:fix` / `bun run format`. ESLint (flat) map quy ước ở mức `warn`:

| Quy ước | Rule |
|---------|------|
| Không TS `enum` | `no-restricted-syntax` → `TSEnumDeclaration` |
| Không default export | `ExportDefaultDeclaration` + allowlist |
| `<script setup lang="ts">` | `vue/block-lang` + `vue/component-api-style` |

### 1.1 Không dùng `enum`

> [!WARNING]
> <span style="color:#d29922">**Kiểu liệt kê khai bằng mảng `as const`, không bằng `enum`** — một khai báo cho ra cả ba thứ cần dùng, và khớp thẳng với Zod ở §3.</span>

Bản thân `z.enum()` không bị cấm — nó nhận mảng, không phải `enum`.

```ts
export const KNOWLEDGE_SCOPES = ['project', 'system', 'global'] as const
export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number]  // type
z.enum(KNOWLEDGE_SCOPES)                                        // validator ở biên I/O
KNOWLEDGE_SCOPES.map(...)                                       // danh sách để render
```

Hai lý do:

- **Một nguồn thay vì hai** — hệ quả trực tiếp của §3. Zod có `z.nativeEnum()` nên `enum` *dùng được*, nhưng khi đó danh sách để lặp phải lấy riêng qua `Object.values()`, tức là nuôi hai khai báo có thể lệch nhau.
- **String enum là nominal** — biến kiểu `Scope` không nhận string `'project'` thường, phải cast. Repo này đọc mọi giá trị từ JSON state và YAML pipeline dưới dạng string thô, nên ma sát đó rải khắp biên I/O.

---

## 2. Quirk TypeScript phải biết

> [!CAUTION]
> <span style="color:#e5534b">Discriminant kiểu boolean không narrow đúng dưới `vue-tsc` (TS6) trong repo này — `{ok:true,…} | {ok:false,…}` với `if (!v.ok) return v` **không** hoạt động.</span>

- **Dùng `in` để narrow** — `if ('error' in v) return v`.
- **Hoặc đổi discriminant sang string literal** — `kind: 'ok' | 'err'`.

---

## 3. Zod là nguồn chân lý cho type & validation

- **Định nghĩa schema một lần**, suy type bằng `z.infer` — không viết tay `interface` song song với validator.
- **Validate ở mọi biên I/O** (state JSON, YAML pipeline, request body) bằng `safeParse`.
- **Parse fail → trả default, không throw** — giữ triết lý defensive.
- **Schema domain ở `src/features/<feature>/schemas/`**; preference shell (`appSettings`) ở `src/frontend/configs/` để tránh `core` → `features`.

---

## 4. Kiến trúc & coupling — chỉ đi xuống

> [!WARNING]
> <span style="color:#d29922">Phụ thuộc chỉ đi xuống, không bao giờ vòng tròn: ba bucket nền (`backend/lib`, `frontend/lib`, `shared/lib`) → `*/configs` + `backend/log` (không import feature) → domain module → `backend/http/` và feature controller.</span>

- **Functional + ctx-injection** — dependency truyền qua tham số `ctx`, không class-DI / NestJS / OOP framework.
- **`business/` không biết HTTP** — nhận `root` / `ctx`, trả data thuần (`{ status, error }` khi lỗi).
- **Controller mỏng** — parse request → gọi `XxxBusiness` → `this.json` / `ok`.

---

## 5. Frontend (Vue 3)

- **`<script setup lang="ts">`** cho mọi SFC.
- **Kéo logic suy diễn ra khỏi `.vue`** xuống composable / lib thuần TS để test không cần render.
- **Cấu trúc feature-module** — `src/features/<mode>/{components,composables,scripts/*Api.ts,styles,locales,schemas}` + nền `src/frontend/{ui,composables,lib,shell}`; plugin app-scope ở `src/frontend/plugins/`.
- **Quy ước button** (ưu tiên icon-btn, default không viền, hover scale) — [`ui-design-guideline.md`](ui-design-guideline.md) §1.
- **Chiến lược tràn là bắt buộc, không phải tuỳ chọn** — mọi danh sách / vùng nội dung dài tuỳ dữ liệu phải có vùng cuộn giới hạn chiều cao ngay từ lúc viết, không được giả định "dữ liệu chắc là ngắn" — [`ui-design-guideline.md`](ui-design-guideline.md) §2.

Primitive dùng chung trong `src/frontend/ui/`:

- **Đặt tên `C<Name>.vue`** (`C` = Custom), class CSS gốc `c-<name>` — vd `CSelect.vue` / `.c-select`. Không dùng prefix `App`.
- **Icon luôn qua `<Icon name="..." />`** (`src/frontend/ui/Icon.vue`) — **không** tự vẽ `<svg>` / `<path>` trong component feature. Icon chưa có thì thêm case mới vào `Icon.vue` (giữ nguyên viewBox/style gốc), không copy SVG ra file khác dù chỉ dùng 1 nơi.
- **Dropdown mới không dùng `<select>` native** — dùng `CSelect` (option cố định) hoặc `CComboSelect` (nhiều option / creatable). Chỉ giữ `<select>` khi cần hành vi trình duyệt gốc không có API tương đương.
- **Class truyền vào `CSelect`/`CComboSelect` chỉ lo kích thước** (`width` / `flex` / `min-width`). Truyền class control native (`cfg-input`, `cfg-textarea`) sẽ rơi vào `div` wrapper → hộp lồng hộp. Mẫu đúng: `cfg-select` / `cfg-combo-select`.

---

## 6. Ngôn ngữ UI (i18n)

- **Mọi UI string đi qua `vue-i18n`** — không hardcode trong `.vue` / `.ts`.
- **`vi` là locale mặc định và fallback** (`fallbackLocale: 'vi'`) — locale khác thiếu key thì hiện bản `vi`, không bắt typecheck đối ứng đủ.
- **Message theo feature** — `src/features/<feature>/locales/{vi,en}.ts` (+ `common` ở `src/frontend/plugins/i18n/locales/common/`), plugin **glob** tự nạp. Namespace = camelCase tên feature (`agent-editor` → `agentEditor`).
- **Plugin chỉ gắn từ `main.ts`** qua `installPlugins`; `registerLocale` để bổ sung locale vào registry app-scope.
- **Trong `<script setup>` dùng `useI18nHelpers()`** (`src/frontend/composables/useI18nHelpers.ts`) — **không** import `useI18n` từ `vue-i18n`. Ngoài setup: `import { t } from '@/plugins/i18n'`.
- **Locale hiện tại ở `AppSettings.locale`** (localStorage), đổi qua `useLocale()`.
- **Test mount component có `t()`** dùng `mountWithI18n` (`tests/src/helpers/i18n.ts`).
- **Thêm/sửa text UI** — thêm key ở `vi`; `en` khuyến nghị nhưng không bắt buộc.

### 6.1 Cấu trúc file

```
src/frontend/plugins/
├── index.ts                 # installPlugins(app)
└── i18n/
    ├── index.ts             # i18nPlugin, injectI18nHelpers, registerLocale, setI18nLocale
    ├── loadLocales.ts       # glob feature + plugin locales
    └── locales/common/      # namespace shell dùng chung
        ├── vi.ts
        └── en.ts

src/features/<feature>/locales/
├── vi.ts                    # export default { ... }  (namespace = camelCase tên feature)
└── en.ts                    # tùy chọn; thiếu key → fallback vi
```

Ví dụ: `features/agent-editor/locales/vi.ts` → namespace `agentEditor`.

Plugin tự nạp bằng `import.meta.glob` — feature mới chỉ cần thêm `locales/vi.ts` (và `en.ts` nếu muốn).

### 6.2 Đăng ký locale mới (runtime)

```ts
import { registerLocale } from '@/plugins/i18n'

registerLocale('ja', {
  common: { /* ... */ },
  monitor: { /* ... */ },
})
```

`registerLocale` merge vào vue-i18n và cập nhật `getLocaleRegistry()` (inject app-scope qua `I18N_REGISTRY_KEY`). Locale preference persist vẫn theo `AppSettings.locale` — mở `LocalePreference` nếu thêm mã locale cố định vào Settings.

### 6.3 Cách dùng trong code

Plugin chỉ được gắn từ app root:

```ts
// src/frontend/main.ts
installPlugins(createApp(App), { i18n: { locale } }).mount('#app')
```

`i18nPlugin` inject helpers lên Vue app (`$t` qua vue-i18n, kèm `$setI18nLocale` / `$localeRegistry`):

| Ngữ cảnh | Cách gọi |
|---|---|
| Trong `<script setup>` / composable | `const { t } = useI18nHelpers()` (`src/frontend/composables/useI18nHelpers.ts`; **cấm** `import { useI18n } from 'vue-i18n'` ngoài `src/frontend/plugins`) |
| Template | `$t('…')` (globalProperties) |
| Ngoài setup (scripts / pure fn) | `import { t } from '@/plugins/i18n'` — đọc `$t` trên app sau `installPlugins` |
| Đổi locale | `useLocale()` hoặc `globalProperties.$setI18nLocale` |
| Test component có `$t` | `mountWithI18n` (`tests/src/helpers/i18n.ts`) — cài cùng globalProperties |

---

## 7. Comment code (KISS)

> [!WARNING]
> <span style="color:#d29922">Chỉ comment khi cần giải thích *why* — constraint ẩn, workaround, invariant khó thấy. Không giải thích *what*: tên biến/hàm tốt đã đủ.</span>

- **Thử đổi tên trước khi thêm comment.** Comment giải thích một tên xấu là trả lãi mãi; đổi tên là trả gốc một lần. `BEFORE` → `TARGET_SHA` bỏ được cả câu giải thích nó là gì.
- **Một why = một dòng.** Cần đoạn văn mới nói hết thì đó là dấu hiệu bối cảnh thuộc chỗ khác: PR body, hoặc `docs/`. Trong code để lại đúng câu chốt + link tới mục tài liệu.
- **Không markup nhấn mạnh trong comment code** — `**bold**`, 🚫, ⚠️, khung `── ─` là ngôn ngữ của tài liệu và PR. Trong code chúng thành nhiễu, và khung rỗng kéo comment dài ra cho "xứng".
- **Sửa nhỏ lẻ thì giữ nguyên comment cũ** — chỉ sửa khi nó đã outdate/sai so với code hiện tại.
- **Không thêm comment tường thuật thay đổi vừa làm** — cấm dạng `// sửa theo review`, `// fix CI`, `// đổi X vì lỗi Y`.
- **Comment mô tả hành vi hiện hành**, không kể lịch sử, không trích số issue / số PR / tên người, không nhắc định danh nội bộ của quy trình (số đợt, tên khối việc, mã task) — code sống lâu hơn kế hoạch.
- **Ngôn ngữ theo mật độ code xung quanh** — khối comment tiếng Anh thì viết tiếp tiếng Anh, không trộn nửa Anh nửa Việt.

---

Kiến trúc: [`docs/architecture/`](../architecture/README.md). Đặt file theo feature: [`docs/convention/feature-architecture.md`](../convention/feature-architecture.md).
