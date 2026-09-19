# Mode registry guideline — thêm mode mới ở FE shell

Quy ước khi thêm/sửa **mode** (`monitor`, `editor`, `agentEditor`, …) trong shell `src/frontend/App.vue`.

Sơ đồ bootstrap và runtime: [`docs/architecture/3-component/ioc-bootstrap-runtime.md`](../architecture/3-component/ioc-bootstrap-runtime.md). Kiến trúc frontend: [`docs/architecture/3-component/`](../architecture/3-component/README.md) §2.

---

## 1. Ba lớp

`App.vue` **không** hard-code danh sách mode:

| Lớp | File | Vai trò |
|---|---|---|
| Container (DI) | `src/frontend/container/` | `register` / `resolve` lazy singleton trên `Symbol` token; không phụ thuộc Vue |
| ModeRegistry | `src/frontend/shell/modeRegistry.ts` | `ModeEntry` + `createModeRegistry()` (`registerMode` / `listModes` / `getMode`) |
| Đăng ký mode | `src/features/<f>/registerMode.ts` | Mỗi feature tự khai `ModeEntry`, export `registerMode(registry)` |

- **`src/frontend/main.ts` tự quét** `src/features/*/registerMode.ts` bằng `import.meta.glob(..., { eager: true })` — không import/gọi tay từng feature.
- **`App.vue` chỉ `inject` → `resolve(modeRegistryToken)` → lặp `listModes()`** để render sidebar / status / main panel.

---

## 2. `ModeEntry` — field & ý nghĩa

- **`key`** — định danh mode, duy nhất; dùng làm route state.
- **`labelKey`** — i18n key cho label sidebar.
- **`titleKey?`** — i18n key cho tooltip nếu khác `labelKey`.
- **`icon`** — tên icon đã đăng ký trong `RailIcon.vue`.
- **`order`** — thứ tự hiển thị, **phải unique**; trùng thì thứ tự không xác định.
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
- **`subSidebar` không map thẳng xuống panel** — dùng helper `subSidebarBindings(ctx, '<key>')` (`src/frontend/shell/subSidebarBindings.ts`); chỉ có tác dụng khi mode đã khai `subSidebar`.
- **Đặt tên listener theo chuẩn Vue** — event kebab-case `foo-bar` → key `onFooBar`; event có `:` như `update:scope` → key `'onUpdate:scope'` (phải quote).

---

## 4. Bất biến bắt buộc giữ

- **Không lazy-load `panel`** (`() => import(...)`) — giữ import trực tiếp để không đổi 2 việc cùng lúc (DI + bundle splitting). Cần code-splitting thật thì làm riêng, có đo bundle size trước/sau.
- **`v-if` trong `v-for`, không `v-show`** ở main-panel loop — chỉ panel active được mount; `v-show` sẽ mount hết mọi panel, sai vì một số panel có side-effect trong `onMounted`.
- **Đăng ký đồng bộ, xong trước `app.mount()`** — không đổi `import.meta.glob` sang dynamic, không thêm `await` giữa lúc tạo registry và mount.
- **`registerMode.ts` không chứa business logic** — chỉ khai báo `ModeEntry` + map `bindings`.

---

## 5. Checklist thêm mode mới

Tách sang [`docs/checklist/new-mode.md`](../checklist/new-mode.md).

---

## 6. Ví dụ tối thiểu (mode không props)

```ts
// src/features/<feature>/registerMode.ts
import type { ModeRegistry } from '../../frontend/shell/modeRegistry'
import MyPanel from './components/MyPanel.vue'

export function registerMode(registry: ModeRegistry): void {
  registry.registerMode({
    key: 'myFeature',
    labelKey: 'common.modes.myFeature',
    icon: 'myFeature',
    order: 10,
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
| **Nguồn cấu hình** — provider | Interface + token: `src/frontend/shell/modeAccess.ts`; implementation hôm nay: `src/features/settings/scripts/settingsModeAccess.ts` | Đọc `modes.enabled` từ `settings.json`, giữ state reactive |
| **Quyết định hiển thị** | `canAccessMode(modeKey, ctx)`, shell gọi trong `App.vue` | UI **không bao giờ** đọc trực tiếp `settings.modes.enabled` |

Chỉ interface + token nằm ở `src/frontend/shell/`: implementation phải gọi `fetchModesConfig()` của `features/settings`, để nguyên trong `src/frontend/` là import ngược chiều layering.

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
3. Đổi **một dòng** ở `src/frontend/main.ts`: `container.register(modeAccessToken, () => createPermissionModeAccess(...))`.

Không có file UI nào phải sửa — đó là lý do lớp này tồn tại.

### Luật kết hợp — chốt trước, code theo đúng nó

```
canAccessMode = alwaysOn || (globalEnabled && userPermitted)
```

**Mode bị tắt toàn cục thì luôn ẩn, kể cả user có quyền.** `settings.json` giữ vai trò công tắc vận hành toàn cục; DB không thay thế nó. Hôm nay `userPermitted` luôn `true`.

### Không phải biên giới bảo mật

Tắt mode là **kiểm soát phạm vi UI**. Endpoint `/api/*` của feature bị tắt vẫn gọi được bằng `curl`. Kiểm soát thật cần auth theo user và phải chặn ở tầng server — đi cùng lượt DB ở trên.
