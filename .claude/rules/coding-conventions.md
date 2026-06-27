# Coding Conventions — TS Refactor

Áp dụng cho toàn bộ quá trình migrate dev-team-dashboard sang Bun + TypeScript.

## Ngôn ngữ & module
- **ESM thuần** (`"type":"module"`). Server dùng import core `node:`-prefixed.
- **TypeScript** cho code mới/migrate. Trong giai đoạn chuyển tiếp, `tsconfig` bật `allowJs: true` — JS và TS chạy lẫn lộn được, migrate **từng file một**, không big-bang.
- `strict: false` ở giai đoạn đầu, **bật `strict` dần theo từng module** khi module đó đã có type vững.
- Không dùng `enum` (ưu tiên union literal type). Không default export trừ khi framework yêu cầu (vd Vue SFC).

## TS quirks đã gặp
- **Discriminated union với discriminant kiểu boolean** (`{ok:true,...}|{ok:false,...}`): `if (!v.ok) return v` / `if (v.ok){}` **không narrow** đúng dưới vue-tsc (TS6) trong repo này. Dùng **`in`-operator narrowing** thay thế: `if ('error' in v) return v` (hoặc đặt discriminant là string literal `kind: 'ok'|'err'`).

## Type & validation — Zod là single source of truth
- Định nghĩa schema bằng **Zod 1 lần**, suy ra type bằng `z.infer`. KHÔNG viết tay cặp `interface` + validator trùng nhau.
- Validate ở **mọi biên I/O**: đọc state JSON, YAML pipeline, request body. Dùng `safeParse` để **giữ triết lý defensive** (parse fail → trả default, không throw).
- Schema dùng chung 2 phía đặt ở `shared/schemas/`.

## Kiến trúc & coupling
- **Functional + ctx-injection**: truyền `ctx`/deps qua tham số. KHÔNG dùng class-DI / NestJS / OOP framework.
- **Phụ thuộc chỉ đi xuống**: `shared/` không import gì khác trong server. Domain modules chỉ import `shared/`. `http/` import domain modules. Transport (Vite/node adapter) import `http/`. Không vòng tròn.
- Domain modules **không biết gì về HTTP** — nhận `ctx`/`root`, trả data thuần. HTTP chỉ ở tầng `http/` (Hono).
- Tầng HTTP dùng **Hono**: route mỏng (`parse input → gọi domain module → c.json`).

## Giữ các bất biến hiện có của codebase
- **Defensive filesystem reads**: helper kiểu `safeReadDir`/`statSafe`/`readYamlSafe`/`readState` nuốt lỗi, trả empty/false thay vì throw. Giữ nguyên khi thêm scan.
- **Path-traversal hardening**: mọi input từ request phải sanitize (`resolveArtifact`, `resolveStatic`, `sanitise*`, taskId regex). Endpoint ghi file mới phải nghiêm ngặt tương đương.
- **Atomic registry writes** (temp + rename).
- **Outbound fetch URL người dùng** qua `fetchUrlSafe` (https-only, chặn private host).

## Frontend (Vue 3)
- `<script setup lang="ts">`. Kéo **logic suy diễn ra khỏi `.vue`** xuống composable/lib thuần TS để test không cần render.
- Cấu trúc **feature-module**: `src/features/<mode>/{components,composables,*.api.ts}` + `src/shared/{ui,composables,lib}`.

## UI / ngôn ngữ
- UI strings tiếng Việt (giữ nguyên quy ước hiện tại).
