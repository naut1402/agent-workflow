# `src/backend/` — scope backend

Code **chỉ chạy trên Bun/Node**: app-root HTTP (Hono), kernel controller, security,
db (drizzle + migrations), events, log driver/store, registry, lib Node-only, và 2
entry point (`standalone.ts`, `runner-cli.mjs`).

## Đặt file mới ở đây khi

- Cần `node:*` / `bun:*` / `hono` / `drizzle-orm`, hoặc chạm filesystem / process / DB.
- Là business logic chỉ được gọi từ `api.ts` / `controller.ts`.

## Controller HTTP (`http/`)

- **Kiểu mới — decorator** (`decorators.ts`, `FormRequest.ts`, `AbstractHttpController.ts`,
  `registerControllers.ts`): feature khai `@Controller({ order, inject })` +
  `@Get/@Post/@Put/@Patch/@Delete(path, XRequest)` ngay trên method trong `controller.ts`
  (hoặc `controllers/*.ts`). Dispatcher lo validate → `after()` → inject business → gọi,
  `no-store`, 404 `unknown project`, 405 tự sinh. Quy ước:
  [`feature-architecture-guideline.md`](../../docs/agent-rules/feature-architecture-guideline.md) §2.5.
- **Kiểu cũ** (`AbstractController.ts` + `bind()` trong `features/<f>/api.ts`) còn hợp lệ tới
  lượt quét cuối — `apiServer.registerFeatureRoutes` nạp song song cả hai, sắp chung theo order.

## Luật biên (eslint `no-restricted-imports`)

- 🚫 Không import `src/frontend/**`, không import `vue`.
- ✅ Được import `src/shared/**`.

Dùng chung thật sự với frontend → [`../shared/README.md`](../shared/README.md), **không** để ở đây rồi cho FE import ngược.
