# `src/core` — nền tảng app (FE shell + contracts + registry)

- **Browser:** UI primitives, composable, i18n, shell keys, `contracts/`
- **Node (không bundle vào SPA):** `registry.ts`, `business/AbstractBusiness`, `log/` (driver + ghi request/audit)

## Biên với các cây khác

| Cây | Vai trò |
|-----|---------|
| `src/core/` | Nền FE + contracts + project registry |
| `src/plugins/` | Cài thư viện app-scope (i18n, …); `installPlugins(app)` |
| `src/api/` | Setup HTTP app-root only (`apiServer`, `devTeamApi`) |
| `src/core/http/` | Kernel HTTP server (`types`, `AbstractController`, `respond`) + FE client (`client.ts`) |
| `src/features/` | Mode UI + `api.ts` / `controller.ts` / `business/` |
| `src/standalone.ts` | Entrypoint HTTP production (`bun run serve`) |
| `src/runner-cli.mjs` | CLI submit job |

Feature import type/controller từ `src/core/http/`. Contracts shell ở `src/core/contracts/` (`appSettings` + helpers). Schema domain ở `src/features/<feature>/schemas/`. Không còn `src/server/`.

## Có trong 1.0.0

- `composables/`, `ui/`, `i18n/`, `lib/`, `markdown.ts`, `shell/keys.ts`
- `contracts/` — helper FE↔BE + `schemas/appSettings` (alias `@shared`); schema domain ở `features/*/schemas/`
- `http/` — types + AbstractController + respond + FE `client.ts`
- `registry.ts`, `business/AbstractBusiness.ts`
- `log/` — chọn log driver + ghi request/audit (`emitAudit` / `appendRequestLog`); feature `logs` lo đọc UI + job log

Setup app-root xem `src/api/` (`apiServer`, `devTeamApi`, …).

## Chưa có (sau 1.0.0)

- ModeRegistry / event bus / contribution API

Xem [`docs/architecture.md`](../../docs/architecture.md).
