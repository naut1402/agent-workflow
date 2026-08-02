# Review checklist — feature / business / helper

Dùng khi review PR đụng `src/features/*`, `src/core/lib`, hoặc tái cấu trúc tương tự cookbook core/feature. Chi tiết quy ước: [`feature-organization-rule.md`](feature-organization-rule.md), [`coding-convention.md`](coding-convention.md), [`pr-docs-convention.md`](pr-docs-convention.md) (§1 trình bày PR); bất biến repo: [`AGENTS.md`](../../AGENTS.md) § Bất biến.

Đánh dấu từng mục liên quan scope PR (không bắt buộc tick hết nếu PR không đụng vùng đó).

---

## A. Phạm vi & đặt file

- [ ] Thay đổi nằm đúng feature sở hữu; không “vá” logic domain vào feature khác hoặc vào `core` nếu là nghiệp vụ.
- [ ] Route mới/sửa chỉ ở `features/<f>/api.ts` + `controller.ts` — controller không chứa đọc/ghi filesystem phức tạp.
- [ ] Schema domain ở `features/<f>/schemas/`; không nhét schema shell vào feature; không đẩy schema domain lên `core/configs` trừ khi thật sự app-wide.
- [ ] UI string qua i18n (`locales/`); FE API qua `scripts/*Api.ts` + `apiGet`/`apiPost`.
- [ ] Không thêm wiring hub tay nếu glob/auto-load đã đủ (route / styles / locales).

## B. Tầng `business/`

- [ ] Module chia theo **nghiệp vụ đang xử lý**, không tách file theo kiểu thao tác (`store` / `fetch` / `paths` / `scan` mỏng) nếu cùng một capability.
- [ ] Không tạo file mới chỉ để chứa một helper kỹ thuật nhỏ — gắn vào module capability.
- [ ] `business/` không import Hono / không phụ thuộc `c.req`.
- [ ] Peer feature: chỉ `business/index.ts` import cây `business` của feature khác; controller / module nội bộ không import sâu peer.
- [ ] Thêm surface chia sẻ: đã cập nhật `business/index.ts` (và re-export bên tiêu thụ nếu cần); tránh cycle barrel↔barrel.
- [ ] Sanitize / rule domain gắn feature sở hữu, export qua index khi chia sẻ — không đưa lại túi “sanitize chung” ở core.

## C. Helper dùng chung (`core/lib`)

- [ ] Ưu tiên **dùng lại / mở rộng** `*Utils`, `*Lib`, `fileHelper` thay vì copy-paste hoặc helper local trùng ý.
- [ ] Helper mới đúng quy ước tên (`*Utils` / `*Lib` / `fileHelper`); không đặt tên mơ hồ (`helpers.ts`, `utils.ts` gốc).
- [ ] Business **không** `import` trực tiếp `node:fs` / `node:path`.
- [ ] Module dùng chung FE+BE không top-level `node:*` (đặc biệt `yamlLib` / markdown path đi vào bundle).
- [ ] Đổi chữ ký `fileHelper` / overload: đã nghĩ tới `vue-tsc` (vd `readDir` + `withFileTypes`, `watch`) và chạy typecheck.
- [ ] Call site khớp API wrapper (không truyền arg thừa như `'utf8'` nếu helper đã cố định encoding).

## D. Bất biến an toàn & I/O

- [ ] Đọc FS phòng thủ (`safeReadDir` / `statSafe` / `readYamlSafe` / tương đương) — lỗi file không làm sập request.
- [ ] Input path từ user đã sanitize / `resolvePathUnder` (hoặc tương đương) chống traversal.
- [ ] Ghi file quan trọng atomic (temp + rename) khi pattern hiện có yêu cầu (registry, runners, settings…).
- [ ] Fetch URL người dùng qua `fetchUrlSafe` (https, chặn private host) — không `fetch` trần với URL tùy ý.

## E. Coupling & kiến trúc

- [ ] Phụ thuộc một chiều: không `core` → `features`; không vòng import.
- [ ] Zod `safeParse` ở biên; không `interface` tay song song schema nếu có thể `z.infer`.
- [ ] Discriminated union: tránh narrow boolean `ok` dễ gãy dưới vue-tsc — dùng `'error' in v` hoặc discriminant string nếu cần.

## F. Test & CI & PR body

- [ ] Có unit/integration tương ứng vùng đổi; test mirror dưới `tests/` (không co-locate lung tung).
- [ ] Domain/fs → **bun test**; FE/component → vitest.
- [ ] PR đụng helper FE+BE hoặc `fileHelper`: typecheck / build xanh locally (và CI).
- [ ] Commit message / PR title đúng commitlint (`type(scope): subject`); không trailer công cụ.
- [ ] **Nội dung thay đổi**: phần riêng nhóm theo cây thư mục/lớp; fix/refactor có Logic trước → sau; phần chung nêu Core và/hoặc feature khác (hoặc *Không*) — [`pr-docs-convention.md`](pr-docs-convention.md) §1.1–§1.2.
- [ ] PR **`dev/x.y.z/main` → `main`**: thư mục `docs/todo/` **không tồn tại** — [`todo-debt-convention.md`](todo-debt-convention.md). PR feature → version main được mang nợ.

## G. Docs (khi đổi convention)

- [ ] Đổi quy ước đặt file / peer / helper: cập nhật `feature-organization-rule.md` và/hoặc `AGENTS.md` / `architecture.md` (mô tả **hiện hành**, không kể lịch sử issue).
- [ ] Đợt tái cấu trúc lớn: bổ sung đơn vị vào `docs/cookbook/` nếu cần tái hiện quyết định.

---

## Gợi ý comment review ngắn

| Vấn đề | Gợi ý phản hồi |
|--------|----------------|
| Tách `paths.ts` / `store.ts` mỏng | “Gộp theo nghiệp vụ X — xem feature-organization-rule §2.” |
| `import …/other/business/foo` từ controller | “Đưa re-export vào `business/index` của feature này.” |
| `import fs from 'node:fs'` trong business | “Dùng / mở rộng `fileHelper`.” |
| Copy `slugify` / YAML parse | “Dùng `stringUtils` / `yamlLib`.” |
| Sanitize mới trong `core` (sai chỗ) | “Gắn module business sở hữu + export index.” |
