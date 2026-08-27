# Review checklist — feature / business / helper

Dùng khi review PR đụng `src/features/*`, `src/core/lib`, hoặc tái cấu trúc tương tự cookbook core/feature. Chi tiết quy ước: [`feature-organization-rule.md`](feature-organization-rule.md), [`coding-convention.md`](coding-convention.md), [`pr-docs-convention.md`](pr-docs-convention.md) (§1 trình bày PR); bất biến repo: [`AGENTS.md`](../../AGENTS.md) § Bất biến.

Đánh dấu từng mục liên quan scope PR (không bắt buộc tick hết nếu PR không đụng vùng đó). 3 khối dưới đây theo luồng review: code nằm đúng chỗ chưa → dữ liệu/an toàn có bị phá không → quy trình/tài liệu đã đủ chưa.

---

## 1. Kiến trúc — vị trí code & coupling

### Đặt file & scope

- **Feature sở hữu**: thay đổi domain nằm đúng feature; không vá logic domain vào feature khác hoặc vào `core`.
- **Route**: mới/sửa chỉ ở `features/<f>/api.ts` + `controller.ts` — controller không đọc/ghi filesystem phức tạp.
- **Schema domain**: ở `features/<f>/schemas/`; không nhét schema shell vào feature, không đẩy lên `core/configs` trừ khi thật sự app-wide.
- **UI string & FE API**: string qua i18n (`locales/`); gọi API qua `scripts/*Api.ts` + `apiGet`/`apiPost`.
- **Wiring hub**: không thêm tay nếu glob/auto-load đã đủ (route / styles / locales / `registerMode`).
- **Mode mới/sửa ở FE shell** (`App.vue`, `registerMode.ts`): theo [`mode-registry-convention.md`](mode-registry-convention.md) — không sửa `main.ts`, không đụng `App.vue` ngoài `shellContext` (trừ khi thật sự cần state mới), `MODE_DEFS` trong `App.test.ts` đã cập nhật.

### `business/` & helper dùng chung

- **Chia theo nghiệp vụ**: module gom theo capability đang xử lý, không tách file theo kiểu thao tác (`store`/`fetch`/`paths`/`scan` mỏng); không tạo file mới chỉ để chứa một helper kỹ thuật nhỏ.
- **Không phụ thuộc Hono**: `business/` không import Hono, không phụ thuộc `c.req`.
- **Peer feature qua index**: chỉ `business/index.ts` import cây `business` của feature khác; controller/module nội bộ không import sâu peer.
- **Surface chia sẻ**: thêm gì mới đều cập nhật `business/index.ts` (re-export bên tiêu thụ nếu cần); tránh cycle barrel↔barrel.
- **Sanitize gắn feature sở hữu**: export qua index khi chia sẻ — không đưa lại thành “sanitize chung” ở core.
- **Ưu tiên dùng lại**: `*Utils`/`*Lib`/`fileHelper` thay vì copy-paste hoặc helper local trùng ý; tên helper mới đúng quy ước, không mơ hồ (`helpers.ts`, `utils.ts` gốc).
- **Không import `node:fs`/`node:path` trực tiếp** trong business; module dùng chung FE+BE không top-level `node:*` (đặc biệt `yamlLib`/markdown path đi vào bundle).
- **Đổi chữ ký `fileHelper`**: đã tính tới `vue-tsc` (vd `readDir` + `withFileTypes`, `watch`) và chạy typecheck; call site khớp API wrapper (không truyền arg thừa như `'utf8'` nếu helper đã cố định encoding).

### Coupling & kiến trúc

- **Một chiều**: không `core` → `features`; không vòng import.
- **Biên schema**: Zod `safeParse` ở biên; ưu tiên `z.infer` thay vì `interface` tay song song schema.
- **Discriminated union**: tránh narrow boolean `ok` dễ gãy dưới `vue-tsc` — dùng `'error' in v` hoặc discriminant string.

## 2. Dữ liệu & An toàn — I/O, persist, event

### An toàn I/O

- **Đọc FS phòng thủ**: `safeReadDir`/`statSafe`/`readYamlSafe` (hoặc tương đương) — lỗi file không làm sập request.
- **Chống traversal**: input path từ user đã sanitize/`resolvePathUnder` (hoặc tương đương).
- **Ghi atomic**: file quan trọng ghi qua temp + rename khi pattern hiện có yêu cầu (registry, runners, settings…).
- **Fetch an toàn**: URL người dùng qua `fetchUrlSafe` (https, chặn private host) — không `fetch` trần với URL tùy ý.

### Domain events (khi đụng persist / lifecycle / CRUD)

Chi tiết type / nơi emit: [`../event-catalog.md`](../event-catalog.md).

- **Cân nhắc emit**: thêm/sửa/xoá `emit`/`emitEntity` sau persist; payload không chứa secret.
- **Catalog khớp code**: `docs/event-catalog.md` khớp (hoặc nợ `docs/todo/` có lý do).
- **Type cập nhật**: `DashboardEventType` đổi theo khi type mới/đổi tên.

## 3. Quy trình & Tài liệu

### Test & CI

- **Coverage**: có unit/integration tương ứng vùng đổi; test mirror dưới `tests/` (không co-locate lung tung).
- **Runner đúng loại**: domain/fs → **bun test**; FE/component → vitest.
- **Build xanh**: PR đụng helper FE+BE hoặc `fileHelper` → typecheck/build xanh locally và CI.

### PR body & docs

- **Commit/PR title**: đúng commitlint (`type(scope): subject`), không trailer công cụ.
- **Nội dung PR**: phần riêng nhóm theo cây thư mục/lớp; fix/refactor có Logic trước → sau; phần chung nêu Core và/hoặc feature khác (hoặc *Không*) — [`pr-docs-convention.md`](pr-docs-convention.md) §1.1–§1.2.
- **Nợ docs/test**: PR **`dev/x.y.z/main` → `main`** không còn thư mục `docs/todo/` — [`todo-debt-convention.md`](todo-debt-convention.md); PR feature → version main được mang nợ.
- **Đổi convention**: cập nhật `feature-organization-rule.md`/`AGENTS.md`/`architecture.md` (mô tả **hiện hành**, không kể lịch sử issue); tái cấu trúc lớn → bổ sung đơn vị vào `docs/cookbook/`.

---

## Gợi ý comment review ngắn

| Vấn đề | Gợi ý phản hồi |
|--------|----------------|
| Tách `paths.ts` / `store.ts` mỏng | “Gộp theo nghiệp vụ X — xem feature-organization-rule §2.” |
| `import …/other/business/foo` từ controller | “Đưa re-export vào `business/index` của feature này.” |
| `import fs from 'node:fs'` trong business | “Dùng / mở rộng `fileHelper`.” |
| Copy `slugify` / YAML parse | “Dùng `stringUtils` / `yamlLib`.” |
| Sanitize mới trong `core` (sai chỗ) | “Gắn module business sở hữu + export index.” |
| Persist/CRUD mới không thấy `emit` | “Cân nhắc emit — xem event-catalog + mục Dữ liệu & An toàn.” |
| Event mới nhưng `event-catalog.md` chưa cập nhật | “Cập nhật catalog cùng PR, hoặc nợ `docs/todo/` có lý do.” |
