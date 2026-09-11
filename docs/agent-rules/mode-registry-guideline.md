# Mode registry guideline — thêm mode mới ở FE shell

Quy ước khi thêm/sửa **mode** (`monitor`, `editor`, `agentEditor`, …) trong shell `src/App.vue`.

Sơ đồ bootstrap và runtime: [`docs/diagram/IoC.md`](../diagram/IoC.md). Kiến trúc tổng quan: [`docs/architecture.md` §3](../architecture.md).

---

## 1. Ba lớp

`App.vue` **không** hard-code danh sách mode:

| Lớp | File | Vai trò |
|---|---|---|
| Container (DI) | `src/core/container/` | `register` / `resolve` lazy singleton trên `Symbol` token; không phụ thuộc Vue |
| ModeRegistry | `src/core/shell/modeRegistry.ts` | `ModeEntry` + `createModeRegistry()` (`registerMode` / `listModes` / `getMode`) |
| Đăng ký mode | `src/features/<f>/registerMode.ts` | Mỗi feature tự khai `ModeEntry`, export `registerMode(registry)` |

- **`src/main.ts` tự quét** `src/features/*/registerMode.ts` bằng `import.meta.glob(..., { eager: true })` — không import/gọi tay từng feature.
- **`App.vue` chỉ `inject` → `resolve(modeRegistryToken)` → lặp `listModes()`** để render sidebar / status / main panel.

---

## 2. `ModeEntry` — field & ý nghĩa

- **`key`** — định danh mode, duy nhất; dùng làm route state.
- **`labelKey`** — i18n key cho label sidebar.
- **`titleKey?`** — i18n key cho tooltip nếu khác `labelKey`.
- **`icon`** — tên icon đã đăng ký trong `RailIcon.vue`.
- **`order`** — thứ tự hiển thị, **phải unique**; trùng thì thứ tự không xác định.
- **`statusKind`** — `'live'` hiện `common.status.updated` khi có `lastUpdated`; `'paused'` hiện `common.status.paused.<key>`.
- **`panel`** — component chính, **import trực tiếp** (xem §4).
- **`visible?(ctx)`** — ẩn mode khỏi sidebar/status/main-panel khi `false`; mặc định luôn hiện.
- **`subSidebar?`** — mode có sub-sidebar thu/phóng; `persistKey` là localStorage key, bỏ trống là không nhớ qua reload.
- **`bindings?(ctx)`** — props + listener `onXxx` truyền cho `panel`; bỏ qua nếu panel không nhận props.
- **`descriptionKey?`** — i18n key mô tả ngắn (`common.modeDesc.<key>`), hiện ở group "Chế độ" trong Settings.
- **`maturity?`** — `'stable'` (mặc định) | `'beta'` | `'experimental'`; **chỉ để hiện badge**, không ảnh hưởng quyền truy cập.
- **`defaultEnabled?`** — trạng thái khi `settings.json` chưa nói gì về mode này. Mặc định `true` (opt-out, giống `showLogsTab`); mode chưa hoàn thiện muốn tắt sẵn thì khai `false`.
- **`alwaysOn?`** — mode không tắt được, shell luôn còn một lối về. Chỉ `monitor` khai `true`; thắng mọi cấu hình, kể cả sửa tay `settings.json`.

---

## 3. `ShellContext` — state `App.vue` expose

`ShellContext` cố tình gõ lỏng (`Record<string, unknown>`) — `App.vue` sở hữu state, mode chỉ đọc/gọi qua `bindings(ctx)`.

- **Mode chỉ cần state đã có** (vd `selectedProjectId`, `defaultProjectId`) → **không đụng `App.vue`**, chỉ thêm `registerMode.ts`.
- **Mode cần state shell chưa expose** → thêm đúng 1 dòng vào `shellContext` computed trong `App.vue`. Đây là điểm chạm còn lại **có chủ đích**.
- **`subSidebar` không map thẳng xuống panel** — dùng helper `subSidebarBindings(ctx, '<key>')` (`src/core/shell/subSidebarBindings.ts`); chỉ có tác dụng khi mode đã khai `subSidebar`.
- **Đặt tên listener theo chuẩn Vue** — event kebab-case `foo-bar` → key `onFooBar`; event có `:` như `update:scope` → key `'onUpdate:scope'` (phải quote).

---

## 4. Bất biến bắt buộc giữ

- **Không lazy-load `panel`** (`() => import(...)`) — giữ import trực tiếp để không đổi 2 việc cùng lúc (DI + bundle splitting). Cần code-splitting thật thì làm riêng, có đo bundle size trước/sau.
- **`v-if` trong `v-for`, không `v-show`** ở main-panel loop — chỉ panel active được mount; `v-show` sẽ mount hết mọi panel, sai vì một số panel có side-effect trong `onMounted`.
- **Đăng ký đồng bộ, xong trước `app.mount()`** — không đổi `import.meta.glob` sang dynamic, không thêm `await` giữa lúc tạo registry và mount.
- **`registerMode.ts` không chứa business logic** — chỉ khai báo `ModeEntry` + map `bindings`.

---

## 5. Checklist thêm mode mới

- [ ] **Export đúng tên `registerMode(registry: ModeRegistry): void`** — glob ở `main.ts` gọi cố định `mod.registerMode(...)`.
- [ ] **`key` duy nhất** — trùng thì `registerMode()` throw lúc khởi động (fail-fast).
- [ ] **`order` duy nhất**, phù hợp vị trí mong muốn trong sidebar.
- [ ] **`labelKey` (+ `titleKey`) trỏ đúng key** đã có trong `plugins/i18n/locales/common/{vi,en}.ts` → `modes.*`; `statusKind: 'paused'` cần thêm `status.paused.<key>` ở **cả 2 locale**.
- [ ] **`icon` khớp tên đã đăng ký** trong `RailIcon.vue`.
- [ ] **Import `panel` trực tiếp** ở top-level, không lazy-load.
- [ ] **`bindings(ctx)` chỉ lấy state đã có trong `ShellContext`**; cần state mới thì thêm đúng 1 dòng vào `shellContext`.
- [ ] **Ẩn/hiện động qua `visible(ctx)`**, không tự thêm `v-if` riêng trong `App.vue`.
- [ ] **Khai `descriptionKey` + `maturity`** (và `defaultEnabled: false` nếu mode chưa hoàn thiện) — group "Chế độ" trong Settings đọc thẳng từ đây.
- [ ] **Không tự đọc `settings.modes` trong feature** — quyết định hiển thị là việc của `canAccessMode` ở shell (§7).
- [ ] **Không sửa `src/main.ts`** — thấy cần sửa nghĩa là đang làm sai convention.
- [ ] **Cập nhật `MODE_DEFS` trong `App.test.ts`** để mode mới được cover trong cả 3 test lặp qua `MODE_DEFS`.
- [ ] **Giữ xanh trước khi PR** — `vue-tsc --noEmit`, `vitest run tests/src/App.test.ts`, và test riêng của feature.

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

Mẫu phức tạp hơn: `src/features/automations/registerMode.ts` hoặc `src/features/statistics/registerMode.ts` (có `bindings`); nhiều props + event: `src/features/monitor/registerMode.ts`.

---

## 7. Lớp truy cập mode & đường lên phân quyền DB

Bật/tắt mode chia làm **3 lớp tách rời**, đừng trộn vào nhau:

| Lớp | File | Trách nhiệm |
|---|---|---|
| **Catalog** — mode nào tồn tại | `registerMode.ts` của từng feature | Khai báo tĩnh (§2). Không chứa logic quyết định |
| **Nguồn cấu hình** — provider | Interface + token: `src/core/shell/modeAccess.ts`; implementation hôm nay: `src/features/settings/scripts/settingsModeAccess.ts` | Đọc `modes.enabled` từ `settings.json`, giữ state reactive |
| **Quyết định hiển thị** | `canAccessMode(modeKey, ctx)`, shell gọi trong `App.vue` | UI **không bao giờ** đọc trực tiếp `settings.modes.enabled` |

Chỉ interface + token nằm ở `core/`: implementation phải gọi `fetchModesConfig()` của `features/settings`, để nguyên trong `core/` là import ngược chiều layering.

### Điểm gọi trong shell — đúng 2 chỗ

- Computed `modes` trong `App.vue`: `canAccessMode(key, { shell })` **AND** `visible(ctx)`.
- Hàm `setMode(key)`: lối vào mode duy nhất (nút sidebar **và** `provide(navigateToModeKey)`). Repo chưa có router nên đây là chỗ tương đương route guard — thêm `vue-router` hay deep-link `?mode=` sau này vẫn gọi vào `setMode()`, không viết lại lớp access.

Watcher `reachableModeKeys` đá về `monitor` khi mode đang mở bị tắt.

### Đổi nguồn sang role/permission trong DB

Mô hình dữ liệu dự kiến:

```
users ──< user_roles >── roles ──< role_permissions >── permissions
                                                            │
                                                   permission.mode_key
```

Các bước khi làm:

1. Viết `features/auth/scripts/permissionModeAccess.ts` implement đúng `ModeAccessProvider`.
2. Điền `ctx.user` (`{ id, roles }`) — field đã có sẵn trong `ModeAccessContext`, thêm field mới không phá chữ ký `canAccessMode`.
3. Đổi **một dòng** ở `src/main.ts`: `container.register(modeAccessToken, () => createPermissionModeAccess(...))`.

Không có file UI nào phải sửa — đó là lý do lớp này tồn tại.

### Luật kết hợp — chốt trước, code theo đúng nó

```
canAccessMode = alwaysOn || (globalEnabled && userPermitted)
```

**Mode bị tắt toàn cục thì luôn ẩn, kể cả user có quyền.** `settings.json` giữ vai trò công tắc vận hành toàn cục; DB không thay thế nó. Hôm nay `userPermitted` luôn `true`.

### Không phải biên giới bảo mật

Tắt mode là **kiểm soát phạm vi UI**. Endpoint `/api/*` của feature bị tắt vẫn gọi được bằng `curl`. Kiểm soát thật cần auth theo user và phải chặn ở tầng server — đi cùng lượt DB ở trên.
