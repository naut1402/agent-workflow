# IoC bootstrap — service container + ModeRegistry

Sơ đồ trình tự khởi động (bootstrap) của service container (DI/IoC) và `ModeRegistry` ở FE shell, từ lúc `main.ts` chạy tới lúc `App.vue` render xong sidebar/main panel. Hub: [`../../AGENTS.md`](../../AGENTS.md); kiến trúc tổng quan: [`../architecture.md`](../architecture.md) §3; quy ước thêm mode mới: [`../implement/mode-registry-convention.md`](../implement/mode-registry-convention.md).

---

## Sơ đồ

```mermaid
sequenceDiagram
    participant main as main.ts
    participant vite as Vite/Vitest (import.meta.glob)
    participant rm as registerMode.ts<br/>(×9 feature)
    participant registry as ModeRegistry
    participant container as Container (DI)
    participant plugins as installPlugins
    participant app as App.vue (setup)

    main->>vite: import.meta.glob('./features/*/registerMode.ts', { eager: true })
    vite-->>main: object tĩnh { path: module } — resolve lúc build/transform, đồng bộ
    main->>registry: createModeRegistry()

    loop mỗi module trong object glob
        main->>rm: mod.registerMode(registry)
        rm->>registry: registry.registerMode({ key, order, icon,<br/>labelKey, statusKind, panel, bindings, visible })
        alt key đã tồn tại
            registry-->>main: throw Error "mode đã được đăng ký" — fail-fast, dừng app ngay lúc khởi động
        end
    end

    main->>container: createContainer()
    main->>container: register(modeRegistryToken, () => registry)
    Note over container: factory lazy — CHƯA chạy ở bước này,<br/>chỉ lưu tham chiếu tới `registry` đã đăng ký đủ 9 mode

    main->>plugins: installPlugins(createApp(App), { i18n, container })
    plugins->>app: app.provide(containerKey, container)
    plugins->>app: app.provide(I18N_HELPERS_KEY, ...)

    main->>app: .mount('#app')

    activate app
    app->>app: inject(containerKey)
    alt container chưa provide (thiếu installPlugins/không set container)
        app-->>app: throw Error — fail rõ ràng, không render app rỗng
    end
    app->>container: resolve(modeRegistryToken)
    container->>container: factory chưa cache → chạy factory lần đầu<br/>(`() => registry`) — trả về registry đã build ở bước loop trên
    container-->>app: ModeRegistry (singleton, cache lại cho lần resolve sau)
    app->>registry: listModes()
    registry-->>app: ModeEntry[] đã sort theo `order`
    app->>app: render sidebar nav + status text + main panel<br/>từ ModeEntry[] (không hard-code mode nào)
    deactivate app
```

---

## Diễn giải

### 1. Glob thay vì import/gọi tay (bước 1–2)

`main.ts` không `import` và gọi tay từng `registerXMode()`. Thay vào đó dùng `import.meta.glob('./features/*/registerMode.ts', { eager: true })` — Vite (dev/build) và Vitest (test) transform pattern này thành **1 object tĩnh** `{ "<path>": <module> }` ngay lúc biên dịch, tương đương việc `import` sẵn tất cả file khớp pattern. `eager: true` là điểm mấu chốt: nếu đổi thành `eager: false` (mặc định), mỗi entry sẽ là `() => import(...)` — dynamic import async — phá vỡ bất biến "đăng ký đồng bộ trước khi App.vue đọc registry lần đầu".

Hệ quả thực dụng: thêm 1 feature mới chỉ cần tạo đúng 1 file `src/features/<feature>/registerMode.ts` — không đụng `main.ts`.

### 2. Đăng ký vào `ModeRegistry` (bước loop)

`main.ts` gọi `createModeRegistry()` tạo 1 registry rỗng, rồi lặp qua từng module trong object glob, gọi `mod.registerMode(registry)` — mỗi feature tự đẩy `ModeEntry` của mình vào registry dùng chung. `registry.registerMode()` throw ngay nếu `key` trùng — lỗi này xảy ra **đồng bộ, ngay lúc `main.ts` chạy**, tức là app sẽ crash sớm ở console/build thay vì lỗi ngầm lúc runtime khi user chuyển mode.

### 3. Container chỉ là 1 lớp gián tiếp mỏng (bước `register(modeRegistryToken, ...)`)

`container.register(modeRegistryToken, () => registry)` **không** chạy factory ngay — chỉ lưu tham chiếu. Điểm quan trọng dễ hiểu nhầm: **registry đã được build đầy đủ (9 mode) từ bước loop phía trên, độc lập với việc container có lazy hay không** — factory ở đây chỉ trả lại đúng object `registry` đã có sẵn, container không tự "xây" gì thêm. Nói cách khác: laziness của container chỉ ảnh hưởng tới **thời điểm App.vue lấy được registry**, không ảnh hưởng tới **thời điểm registry được điền dữ liệu** (luôn luôn là lúc `main.ts` chạy, trước `app.mount()`).

### 4. `installPlugins` cài container vào cây Vue (bước `app.provide`)

`installPlugins(app, { i18n, container })` gọi `app.provide(containerKey, container)` — dùng cơ chế `provide/inject` gốc của Vue, không thêm thư viện DI ngoài. Đây là **composition root** duy nhất biết cả i18n lẫn container — feature con không tự tạo container riêng.

### 5. `App.vue` resolve registry lúc `setup()` (bước `inject` → `resolve` → `listModes`)

Khi Vue chạy `setup()` của `App.vue` (trong lúc `mount()`), `App.vue`:
1. `inject(containerKey)` — nếu `undefined` (quên `installPlugins` hoặc test quên `provide`) → throw ngay, không lặng lẽ render app rỗng.
2. `container.resolve(modeRegistryToken)` — lần đầu resolve nên container mới chạy factory, nhưng vì registry đã đầy đủ sẵn từ bước 2 nên `resolve()` trả về ngay, không có async gap, không risk thiếu mode.
3. `modeRegistry.listModes()` — trả `ModeEntry[]` đã sort theo `order`, dùng để lặp `v-for` render sidebar nav, status text, main panel (`<component :is="m.panel" v-bind="m.bindings?.(shellContext) ?? {}" />`).

### 6. Vì sao thứ tự này quan trọng

Nếu đảo thứ tự — vd `app.mount()` trước khi glob/loop đăng ký mode chạy xong — `App.vue` sẽ `resolve()` một `ModeRegistry` rỗng hoặc thiếu mode, và vì `registerMode()` không được gọi lại sau đó, sidebar sẽ thiếu mode vĩnh viễn cho tới khi reload. Thứ tự bắt buộc: **glob (đồng bộ) → loop đăng ký → tạo container → `installPlugins` → `mount()`** — đúng như code hiện tại ở `src/main.ts`, không đảo được.

---

## Tham chiếu code thật

| Bước trong sơ đồ | File |
|---|---|
| Glob + loop đăng ký, tạo container | `src/main.ts` |
| `ModeEntry`, `createModeRegistry`, `modeRegistryToken` | `src/core/shell/modeRegistry.ts` |
| `Container` (`register`/`resolve`), `createToken` | `src/core/container/{index,types}.ts` |
| `containerKey` (`InjectionKey<Container>`) | `src/core/shell/containerKey.ts` |
| `installPlugins` (`app.provide(containerKey, ...)`) | `src/plugins/index.ts` |
| `inject`/`resolve`/`listModes`, render sidebar/main panel | `src/App.vue` |
| Mỗi feature tự đăng ký `ModeEntry` | `src/features/<feature>/registerMode.ts` |
