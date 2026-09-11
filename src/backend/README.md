# `src/backend/` — scope backend

Code **chỉ chạy trên Bun/Node**: app-root HTTP (Hono), kernel controller, security,
db (drizzle + migrations), events, log driver/store, registry, lib Node-only, và 2
entry point (`standalone.ts`, `runner-cli.mjs`).

## Đặt file mới ở đây khi

- Cần `node:*` / `bun:*` / `hono` / `drizzle-orm`, hoặc chạm filesystem / process / DB.
- Là business logic chỉ được gọi từ `api.ts` / `controller.ts`.

## Luật biên (eslint `no-restricted-imports`)

- 🚫 Không import `src/frontend/**`, không import `vue`.
- ✅ Được import `src/shared/**`.

Dùng chung thật sự với frontend → [`../shared/README.md`](../shared/README.md), **không** để ở đây rồi cho FE import ngược.
