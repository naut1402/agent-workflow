# HTTP kernel & entrypoint

← [`../README.md`](../README.md) (Cấp 4 · Code)

Mọi route `/api/*` đều đi qua đây. Đọc khi thêm/sửa endpoint, hoặc cần biết vì sao server chạy được ở cả `bun run dev` lẫn `bun run serve`.

## Tầng HTTP (Hono)

| File | Vai trò |
|---|---|
| `src/backend/apiServer.ts` | `createApp(ctx)` dựng Hono + middleware resolve root từ `?project=` / tự duyệt `features/<name>/api.ts` (`registerFeatureRoutes`); `createApiHandler(ctx)` là **cầu nối Node ⇆ Hono** (lazy-await `createApp`), và là **điểm chốt duy nhất** ghi request log (fire-and-forget trong `finally`, không await vào response). |
| `src/backend/http/AbstractController.ts` | Base controller (`json`/`ok`/`requireRoot`/`parseBody`/…) + `bind(Controller, method)`. |
| `src/backend/business/AbstractBusiness.ts` | Base tầng domain (`requireRoot`/`fail`; không biết HTTP). |
| `src/features/<name>/controller.ts` | HTTP handler (extends `AbstractController`); gọi `XxxBusiness`. |
| `src/features/<name>/business/` | Domain + class `XxxBusiness` (extends `AbstractBusiness`). |
| `src/features/<name>/api.ts` | Map route → `bind(...)` + `routeOrder` / `registerRoutes`. |
| `src/backend/http/{responseHelper,types}.ts` | Helper response (Node `json` + Hono `j`) + type tầng HTTP. |

## Entrypoint & shim (2 transport)

| File | Vai trò |
|---|---|
| `src/backend/devTeamApi.ts` | Shim: re-export `createApiHandler` + export Vite plugin `devTeamApi({root})`, mount vào dev server. Không chứa logic core. |
| `src/backend/standalone.ts` | Node standalone, mount `createApiHandler` trực tiếp, phục vụ thêm `dist/` (SPA fallback). |

MCP server bật qua `.claude/settings.local.json` (`enabledMcpjsonServers`).
