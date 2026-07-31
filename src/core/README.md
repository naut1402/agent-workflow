# `src/core` — nền tảng app (FE shell + contracts + HTTP kernel)

- **Browser:** UI primitives, composable, i18n, shell keys, `contracts/`
- **Node (không bundle vào SPA):** `registry.ts`, `http/`, `devTeamApi.ts`, `business/AbstractBusiness`

## Biên với các cây khác

| Cây | Vai trò |
|-----|---------|
| `src/core/` | Nền FE + contracts + HTTP/registry kernel |
| `src/core/http/types.ts` | **Nguồn type thống nhất** (`HonoEnv`, re-export registry types) |
| `src/features/` | Mode UI + `api.ts` / `controller.ts` / `business/` |
| `src/standalone.ts` | Entrypoint HTTP production (`bun run serve`) |
| `src/runner-cli.mjs` | CLI submit job |

Feature import type từ `src/core/http/types.js`. Không còn thư mục `src/server/`.

## Có trong 1.0.0

- `composables/`, `ui/`, `i18n/`, `lib/`, `markdown.ts`, `shell/keys.ts`
- `contracts/` — Zod/schema FE↔BE (alias `@shared`)
- `registry.ts`, `http/{app,createApiHandler,loadFeatureRoutes,types,respond,AbstractController}`, `devTeamApi.ts`
- `business/AbstractBusiness.ts`

## Chưa có (sau 1.0.0)

- ModeRegistry / event bus / contribution API

Xem [`docs/architecture.md`](../../docs/architecture.md).
