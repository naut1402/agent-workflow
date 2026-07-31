# `src/core` — nền tảng frontend / shell + contracts

Kernel phía browser: UI primitives, composable dùng chung, i18n, helper thuần, injection key của shell, và **contracts** (Zod/schema/helper FE↔BE).

## Biên với các cây khác

| Cây | Vai trò |
|-----|---------|
| `src/core/` | Nền FE + shell keys + `contracts/` |
| `src/core/contracts/` | Contract FE↔BE (Zod, sanitize, fs helper…) — alias `@shared` |
| `src/features/` | Mode / panel UI |
| `src/server/` | Domain + HTTP Node (không import từ browser bundle) |

`src/core` (trừ phần Node-only trong `contracts/fs.ts` khi chỉ server dùng) được import từ `App.vue` và `src/features/*`. Feature **không** import `src/server/`.

## Có trong 1.0.0

- `composables/`, `ui/`, `i18n/`, `lib/`, `markdown.ts`
- `contracts/` — trước đây là repo-root `shared/`
- `shell/keys.ts` — `InjectionKey` typed cho `navigateToMode` và `reloadProjects`

## Chưa có (sau 1.0.0)

- ModeRegistry / `registerMode` / sidebar động theo plugin
- Event bus / contribution API
- Ports plugin công khai

Xem thêm [`docs/architecture.md`](../../docs/architecture.md) §3.2.
