# Review checklist guideline — feature / business / helper

Dùng khi review PR đụng `src/features/*`, `src/core/lib`, hoặc tái cấu trúc tương tự.

- **Đánh dấu từng mục liên quan scope PR** — không bắt buộc tick hết nếu PR không đụng vùng đó.
- **Thứ tự 3 khối theo luồng review** — code nằm đúng chỗ chưa → dữ liệu/an toàn có bị phá không → quy trình/tài liệu đã đủ chưa.
- **Quy ước nền**: [`feature-architecture-guideline.md`](feature-architecture-guideline.md), [`coding-guideline.md`](coding-guideline.md), [`git-pr.md`](git-pr.md). Bất biến repo: [`docs/architecture.md` §6](../architecture.md#6-bất-biến-kiến-trúc).

---

## 1. Kiến trúc — vị trí code & coupling

### 1.1 Đặt file & scope

- [ ] **Đặt đúng feature** — thay đổi domain nằm đúng feature; không vá logic domain vào feature khác hoặc vào `core`.
- [ ] **Kiểm soát route** — mới/sửa chỉ ở `features/<f>/api.ts` + `controller.ts`; controller không đọc/ghi filesystem phức tạp.
- [ ] **Đặt đúng schema domain** — ở `features/<f>/schemas/`; không nhét schema shell vào feature.
- [ ] **Chuẩn hoá UI string & FE API** — string qua i18n (`locales/`); gọi API qua `scripts/*Api.ts` + `apiGet` / `apiPost`.
- [ ] **Không wiring thủ công** — không thêm tay nếu glob/auto-load đã đủ (route / styles / locales / `registerMode`).
- [ ] **Đặt style đúng tầng** — 1 component render selector gốc → `<style scoped>`; ≥2 cùng feature → `features/<f>/styles/`; xuyên feature → `src/styles/`. Không thêm file `styles/*.scss` chỉ-comment.
- [ ] **Tuân thủ mode-registry khi thêm/sửa mode** — không sửa `main.ts`, không đụng `App.vue` ngoài `shellContext`, `MODE_DEFS` trong `App.test.ts` đã cập nhật.

### 1.2 `business/` & helper dùng chung

- [ ] **Gom module theo nghiệp vụ** — không tách file theo kiểu thao tác (`store` / `fetch` / `paths` / `scan` mỏng).
- [ ] **Không phụ thuộc Hono** — `business/` không import Hono, không phụ thuộc `c.req`.
- [ ] **Import peer qua index** — chỉ `business/index.ts` import cây `business` của feature khác.
- [ ] **Cập nhật surface chia sẻ** — thêm gì mới đều cập nhật `business/index.ts`; tránh cycle barrel↔barrel.
- [ ] **Gắn sanitize vào feature sở hữu** — export qua index khi chia sẻ, không đưa lên "sanitize chung" ở core.
- [ ] **Ưu tiên dùng lại helper** — `*Utils` / `*Lib` / `fileHelper` thay vì copy-paste; tên helper mới không mơ hồ (`helpers.ts`, `utils.ts`).
- [ ] **Không import `node:fs` / `node:path` trực tiếp** trong business; module dùng chung FE+BE không top-level `node:*`.
- [ ] **Kiểm kỹ khi đổi chữ ký `fileHelper`** — chạy typecheck và đối chiếu call site.

### 1.3 Coupling & kiến trúc

- [ ] **Phụ thuộc một chiều** — không `core` → `features`; không vòng import.
- [ ] **Validate ở biên** — Zod `safeParse`; ưu tiên `z.infer` thay vì `interface` tay song song schema.
- [ ] **Tránh boolean `ok` dễ gãy** — narrow bằng `'error' in v` hoặc discriminant string.

---

## 2. Dữ liệu & An toàn — I/O, persist, event

### 2.1 An toàn I/O

- [ ] **Đọc FS phòng thủ** — `safeReadDir` / `statSafe` / `readYamlSafe`; lỗi file không làm sập request.
- [ ] **Chống traversal** — input path từ user đã sanitize / `resolvePathUnder`.
- [ ] **Ghi atomic** — file quan trọng ghi qua temp + rename (registry, runners, settings).
- [ ] **Fetch qua wrapper an toàn** — URL người dùng qua `fetchUrlSafe` (https, chặn private host).

### 2.2 Domain events (khi đụng persist / lifecycle / CRUD)

Chi tiết type và nơi emit: [`docs/event-catalog.md`](../event-catalog.md).

- [ ] **Cân nhắc emit** — thêm/sửa/xoá `emit` / `emitEntity` sau persist; payload không chứa secret.
- [ ] **Đồng bộ catalog với code** — `docs/event-catalog.md` khớp, hoặc nợ `docs/todo/` có lý do.
- [ ] **Cập nhật type** — `DashboardEventType` đổi theo khi type mới / đổi tên.

---

## 3. Quy trình & Tài liệu

### 3.1 Test & CI

- [ ] **Đảm bảo coverage** — có unit/integration tương ứng vùng đổi; test mirror dưới `tests/`.
- [ ] **Chọn đúng runner** — domain/fs → **bun test**; FE/component → vitest.
- [ ] **Giữ build xanh** — PR đụng helper FE+BE hoặc `fileHelper` → typecheck/build xanh cả local và CI.

### 3.2 PR body & tài liệu

- [ ] **Tuân thủ commitlint** — commit/PR title đúng `type(scope): subject`, không trailer công cụ.
- [ ] **Trình bày đúng nội dung PR** — phần riêng nhóm theo cây thư mục; fix/refactor có Logic trước → sau; phần chung nêu Core và/hoặc feature khác (hoặc *Không*).
- [ ] **Dọn nợ trước merge `main`** — PR `dev/x.y.z/main` → `main` không còn thư mục `docs/todo/`.
- [ ] **Cập nhật quy ước khi đổi rule** — sửa file rule trong `docs/agent-rules/` và `docs/architecture.md` trong cùng thay đổi; mô tả **hiện hành**, không kể lịch sử issue.

---

## 4. Gợi ý comment review ngắn

| Vấn đề | Gợi ý phản hồi |
|--------|----------------|
| Tách `paths.ts` / `store.ts` mỏng | "Gộp theo nghiệp vụ X — xem feature-architecture-guideline §2." |
| `import …/other/business/foo` từ controller | "Đưa re-export vào `business/index` của feature này." |
| `import fs from 'node:fs'` trong business | "Dùng / mở rộng `fileHelper`." |
| Copy `slugify` / YAML parse | "Dùng `stringUtils` / `yamlLib`." |
| Sanitize mới đặt trong `core` | "Gắn module business sở hữu + export qua index." |
| Persist/CRUD mới không thấy `emit` | "Cân nhắc emit — xem event-catalog." |
| Event mới nhưng catalog chưa cập nhật | "Cập nhật catalog cùng PR, hoặc nợ `docs/todo/` có lý do." |
| Đổi chữ ký `fileHelper` | "Chạy typecheck xem call site có khớp không — đừng truyền arg thừa nếu helper đã cố định encoding." |
| `styles/<Component>.scss` mới nhưng chỉ 1 component render selector gốc | "Đưa vào `<style scoped lang=\"scss\">` trong SFC." |
| File SCSS chỉ có comment, 0 rule | "Xoá file + dòng `@use`; `styles/` rỗng theo thì xoá cả thư mục." |
