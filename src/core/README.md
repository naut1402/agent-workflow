# `src/core` — nền tảng app (FE shell + contracts + registry)

- **Browser:** UI primitives, composable, i18n, shell keys, `contracts/`
- **Node (không bundle vào SPA):** `registry.ts`, `business/AbstractBusiness`

## Biên với các cây khác

| Cây | Vai trò |
|-----|---------|
| `src/core/` | Nền FE + contracts + project registry |
| `src/api/` | Setup HTTP app-root only (`apiServer`, `devTeamApi`) |
| `src/core/http/` | Kernel HTTP server (`types`, `AbstractController`, `respond`) + FE client (`client.ts`) |
| `src/features/` | Mode UI + `api.ts` / `controller.ts` / `business/` |
| `src/standalone.ts` | Entrypoint HTTP production (`bun run serve`) |
| `src/runner-cli.mjs` | CLI submit job |

Feature import type/controller từ `src/core/http/`. Contracts giữ ở `src/core/contracts/`. Không còn `src/server/`.

## Có trong 1.0.0

- `composables/`, `ui/`, `i18n/`, `lib/`, `markdown.ts`, `shell/keys.ts`
- `contracts/` — Zod/schema FE↔BE (alias `@shared`)
- `http/` — types + AbstractController + respond + FE `client.ts`
- `registry.ts`, `business/AbstractBusiness.ts`

Setup app-root xem `src/api/` (`apiServer`, `devTeamApi`, …).

## Chưa có (sau 1.0.0)

- ModeRegistry / event bus / contribution API

Xem [`docs/architecture.md`](../../docs/architecture.md).
