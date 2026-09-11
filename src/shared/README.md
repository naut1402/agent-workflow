# `src/shared/` — dùng chung backend ⟷ frontend

Bucket **hẹp có chủ đích**: chỉ logic/type thuần, không hạ tầng. Hiện có đúng 4 module —
`lib/phase.ts`, `lib/stringUtils.ts`, `log/schema.ts` và `log/loggingPrefs.ts` — cả bốn đều
chỉ import `zod` hoặc không import gì, và đều có importer thật ở cả hai phía.

## Đặt file mới ở đây khi — và chỉ khi — cả 3 điều đúng

1. Có importer thật ở **cả** `src/backend/**` và `src/frontend/**` (hoặc `src/features/**`
   ở cả hai tầng). Một phía dùng thì để ở bucket của phía đó.
2. Không import `node:*` / `bun:*` / `hono` / `drizzle-orm` / `vue`.
3. Không import ngược `src/backend/**` hay `src/frontend/**`.

## Luật biên (eslint `no-restricted-imports`)

Cả 3 điều trên được lint chặn, **không có whitelist**. Đó là thứ giữ `shared/` khỏi
phình thành thư mục "misc" — nếu module mới không lọt qua lint, nó không thuộc về đây.
