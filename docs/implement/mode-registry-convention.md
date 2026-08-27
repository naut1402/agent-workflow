# Mode registry convention — thêm mode mới ở FE shell

Quy ước khi thêm/sửa **mode** (`monitor`, `editor`, `agentEditor`, …) trong shell `src/App.vue`. Hub: [`AGENTS.md`](../../AGENTS.md); kiến trúc tổng quan: [`../architecture.md`](../architecture.md) §3.

---

## 1. Kiến trúc

Sơ đồ trình tự bootstrap (từ `main.ts` chạy tới `App.vue` render xong) + diễn giải chi tiết: [`../diagram/IoC.md`](../diagram/IoC.md).

`App.vue` không còn hard-code danh sách mode. 3 lớp:

| Lớp | File | Vai trò |
|---|---|---|
| Container (DI) | `src/core/container/` | `register`/`resolve` lazy singleton trên `Symbol` token. Không phụ thuộc Vue. |
| ModeRegistry | `src/core/shell/modeRegistry.ts` | `ModeEntry` (khai báo 1 mode) + `createModeRegistry()` (`registerMode`/`listModes`/`getMode`). Cài vào container qua `containerKey` (`src/core/shell/containerKey.ts`). |
| Đăng ký mode | `src/features/<feature>/registerMode.ts` | Mỗi feature tự khai `ModeEntry` của mình, export hàm `registerMode(registry)`. |

`src/main.ts` **tự quét** `src/features/*/registerMode.ts` bằng `import.meta.glob(..., { eager: true })` (cùng pattern với `styles/index.scss` và locale loader) — **không** import/gọi tay từng feature. `App.vue` chỉ `inject(containerKey)` → `resolve(modeRegistryToken)` → lặp `listModes()` để render sidebar/status/main panel.

**Bất biến:** đăng ký mode phải **đồng bộ**, xong **trước** `app.mount()` — `eager: true` đảm bảo Vite/Vitest transform glob thành object tĩnh lúc build, không phải dynamic import async. Không đổi sang glob thường (`eager: false`) hoặc thêm bước async giữa registration và mount.

---

## 2. `ModeEntry` — field & ý nghĩa

```ts
interface ModeEntry {
  key: string                                          // định danh mode, duy nhất — dùng làm route state (`mode.value`)
  labelKey: string                                      // i18n key cho label sidebar
  titleKey?: string                                     // i18n key cho tooltip nếu KHÁC labelKey (mặc định dùng labelKey)
  icon: string                                           // tên icon trong RailIcon.vue
  order: number                                          // thứ tự hiển thị trong sidebar — PHẢI unique, không unique thì thứ tự không xác định giữa 2 mode cùng order
  statusKind: 'live' | 'paused'                          // 'live': hiện `common.status.updated` khi có lastUpdated; 'paused': hiện `common.status.paused.<key>`
  panel: Component                                       // component chính của mode — import trực tiếp (KHÔNG lazy `() => import(...)`, xem §5)
  visible?: (ctx: ShellContext) => boolean               // ẩn mode khỏi sidebar/status/main-panel khi false — mặc định luôn hiện
  bindings?: (ctx: ShellContext) => Record<string, unknown> // props + `onXxx` listener truyền cho `panel` — optional nếu panel 0 props
}
```

---

## 3. `ShellContext` — state/hàm App.vue đang expose

`ShellContext` cố tình gõ lỏng (`Record<string, unknown>`) — `App.vue` sở hữu state, mode chỉ đọc/gọi qua `bindings(ctx)`. Property hiện có (xem `shellContext` trong `App.vue`): `projects, tasks, selectedId, selected, selectedProjectId, defaultProjectId, connected, error, lastUpdated, sidebarCollapsed, editorScope, editorTaskId, openArtifact, showLogsTab, onSelectProject, onProjectsChanged, onSelectTask, onOpenArtifact, poll, onTaskDeleted, onCreateTaskOpen, onUpdateScope, onUpdateTaskId`.

- Mode chỉ cần state **đã có** trong list trên (vd `selectedProjectId`, `defaultProjectId`) → **không đụng `App.vue`**, chỉ thêm `registerMode.ts`.
- Mode cần state **App.vue chưa expose** (case hiếm — state mới thật sự thuộc về shell, không phải riêng feature) → phải thêm 1 dòng vào `shellContext` computed trong `App.vue`. Đây là điểm chạm còn lại **có chủ đích** (state phải sống ở đâu đó tại tầng shell) — không phải bug của kiến trúc; khác với trước đây (đụng `App.vue` ở 4 vị trí bất kể mode cần gì).
- Convention đặt tên listener trong `bindings()`: đúng chuẩn Vue — event kebab-case `foo-bar` → key `onFooBar` (event có `:` như `update:scope` → key `'onUpdate:scope'`, phải quote vì có `:`).

---

## 4. Checklist — thêm mode mới

- [ ] Tạo `src/features/<feature>/registerMode.ts`, export **đúng tên** `registerMode(registry: ModeRegistry): void` (không đặt tên khác — glob ở `main.ts` gọi cố định `mod.registerMode(...)`).
- [ ] `key` duy nhất, chưa tồn tại ở mode nào khác (trùng → `registry.registerMode()` throw lúc khởi động — fail-fast, không lỗi ngầm).
- [ ] `order` duy nhất, chọn số phù hợp vị trí mong muốn trong sidebar (không cần liền kề mode khác).
- [ ] `labelKey` (+ `titleKey` nếu tooltip khác label) trỏ đúng key đã có trong `plugins/i18n/locales/common/{vi,en}.ts` → `modes.*`; `statusKind: 'paused'` cần thêm key `status.paused.<key>` ở cả 2 locale (xem [`../i18n.md`](../i18n.md)).
- [ ] `icon` khớp tên đã đăng ký trong `RailIcon.vue`.
- [ ] `panel` import trực tiếp (top-level `import X from './components/X.vue'`), **không** lazy-load — xem §5.
- [ ] `bindings(ctx)` chỉ lấy state/hàm đã có sẵn trong `ShellContext` (§3); nếu cần state mới thật sự thuộc shell, thêm đúng 1 dòng vào `shellContext` trong `App.vue` (không thêm nhánh `v-if` hay import tĩnh nào khác ở `App.vue`).
- [ ] Mode cần điều kiện ẩn/hiện động (như `logs` theo `showLogsTab`) → dùng `visible(ctx)`, không tự thêm `v-if` riêng trong `App.vue`.
- [ ] **Không** sửa `src/main.ts` — nếu thấy cần sửa main.ts để "đăng ký" mode mới nghĩa là đang làm sai convention (glob tự quét theo path `features/*/registerMode.ts`).
- [ ] Panel component tự apply coding convention chung của feature ([`feature-organization-rule.md`](feature-organization-rule.md), [`coding-convention.md`](coding-convention.md)) — `registerMode.ts` không phải chỗ chứa logic domain, chỉ khai báo + map props/listener.
- [ ] Test: cập nhật `tests/src/App.test.ts` — thêm entry vào `MODE_DEFS` (key, labelKey, statusKind, component) để mode mới được cover tự động trong cả 3 test lặp qua `MODE_DEFS` (sidebar active, status text, main panel + props/listener nếu cần assert riêng như `monitor`/`editor`). File này build container qua cùng glob với `main.ts` — không cần đăng ký tay.
- [ ] Chạy `vue-tsc --noEmit`, `vitest run tests/src/App.test.ts`, và test riêng của feature (unit/business) — xanh trước khi PR.

---

## 5. Bất biến bắt buộc giữ

- **Không lazy-load `panel`** (`() => import(...)`) — giữ import trực tiếp để không đổi 2 việc cùng lúc (kiến trúc DI + bundle-splitting strategy). Cần code-splitting thật sự thì làm riêng, có đo bundle size trước/sau.
- **`v-if` trong `v-for`, không `v-show`** ở main-panel loop (`App.vue`) — chỉ panel đang active được mount; đổi sang `v-show` sẽ mount hết mọi panel cùng lúc, sai vì một số panel có side-effect trong `onMounted` (polling, fetch...).
- **Đăng ký đồng bộ, không async** — không đổi `import.meta.glob` sang dynamic (`() => import(...)`) hoặc thêm `await` giữa lúc tạo registry và `app.mount()`.
- **`registerMode.ts` không phải chỗ đặt business logic** — chỉ khai báo `ModeEntry` + map `bindings`; logic thật nằm trong `business/`/`composables/` của feature như bình thường.

---

## 6. Ví dụ tối thiểu (mode không props)

```ts
// src/features/<feature>/registerMode.ts
import type { ModeRegistry } from '../../core/shell/modeRegistry'
import MyPanel from './components/MyPanel.vue'

export function registerMode(registry: ModeRegistry): void {
  registry.registerMode({
    key: 'myFeature',
    labelKey: 'common.modes.myFeature',
    icon: 'myFeature',
    order: 10,
    statusKind: 'paused',
    panel: MyPanel,
  })
}
```

Mode cần props từ shell (vd `projectId` đang chọn) — xem `src/features/automations/registerMode.ts` hoặc `src/features/statistics/registerMode.ts` làm mẫu `bindings(ctx)`; mode cần nhiều props + event (case phức tạp nhất) — xem `src/features/monitor/registerMode.ts`.
