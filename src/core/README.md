# `src/core` — nền tảng frontend / shell

Kernel phía browser: UI primitives, composable dùng chung, i18n, helper thuần, và injection key của shell.

## Biên với các cây khác

| Cây | Vai trò |
|-----|---------|
| `src/core/` | Nền FE + shell keys (thư mục này) |
| `src/features/` | Mode / panel UI |
| `shared/` (repo root) | Contract FE↔BE (Zod schema, sanitize, fs helper…) — **không** nằm trong bundle Vue thuần Node |
| `server/` | Domain + HTTP Node |

`src/core` được import từ `App.vue` và `src/features/*`. Không import `server/`.

## Có trong 1.0.0

- `composables/`, `ui/`, `i18n/`, `lib/`, `markdown.ts` — nền tảng UI trước đây ở `src/shared/`
- `shell/keys.ts` — `InjectionKey` typed cho `navigateToMode` và `reloadProjects` (App.vue `provide`, feature `inject`)

## Chưa có (sau 1.0.0)

- ModeRegistry / `registerMode` / sidebar động theo plugin
- Event bus / contribution API (artifact toolbar, settings section, …)
- Ports plugin công khai

Xem thêm [`docs/architecture.md`](../../docs/architecture.md) §3.2.
