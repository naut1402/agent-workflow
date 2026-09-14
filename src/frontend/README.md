# `src/frontend/` — scope frontend

Code **chỉ chạy trên browser**: app root (`App.vue`, `main.ts`), composable, service
container, shell (mode registry / sub-sidebar), ui component, http client, plugins
(i18n), styles, lib thuần browser.

## Đặt file mới ở đây khi

- Có `.vue`, dùng `vue` / `vue-i18n`, hoặc chạm `window` / `document` / `localStorage`.
- Là helper chỉ được component hoặc composable gọi.

## Luật biên (eslint `no-restricted-imports`)

- 🚫 Không import `src/backend/**`.
- 🚫 Không import `node:*` / `bun:*` / `hono` / `drizzle-orm` — kể cả gián tiếp qua
  một module `business/`. Đây chính là lớp lỗi mà đợt tách bucket này xoá bỏ.
- ✅ Được import `src/shared/**`.

Cần một hằng số / schema mà backend cũng dùng → [`../shared/README.md`](../shared/README.md).
