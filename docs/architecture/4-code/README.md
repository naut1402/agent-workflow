# C4 · Cấp 4 — Code

← [Danh mục kiến trúc (C4)](../README.md)

Chi tiết implementation cụ thể — mỗi module tách 1 folder riêng để dễ tra. Đây là cấp **thay đổi thường xuyên nhất** — khi sửa, đối chiếu lại với code thật thay vì tin nội dung cũ.

## Module

| Module | Đọc khi nào | Chi tiết |
|---|---|---|
| Frontend bootstrap & API | Thêm mode mới, đổi cách FE gọi server, hoặc lần theo bootstrap lúc app khởi động | [`frontend/`](frontend/README.md) |
| HTTP kernel & entrypoint | Thêm/sửa endpoint API, hoặc cần biết vì sao server chạy được ở cả `bun run dev` lẫn `bun run serve` | [`http/`](http/README.md) |
| Event bus | Viết subscriber, thêm emit mới, hoặc tra cứu 1 domain event cụ thể | [`events/`](events/README.md) |
| Data root `.dev-team-agent/` | Cần biết chính xác 1 field/tên file mà orchestrator ghi/đọc | [`data-root/`](data-root/README.md) |
| DB (SQLite) | Trước khi bật `logging.driver: sqlite` hoặc thêm bảng mới | [`db/`](db/README.md) |
| Config shell | Không chắc 1 setting nên đặt ở preference shell hay schema business | [`config/`](config/README.md) |
| Styling | Thêm style mới xuyên feature | [`styling/`](styling/README.md) |
| i18n | Thêm/sửa cách nạp locale, đăng ký locale mới | [`i18n.md`](i18n.md) |
| UI button | Thêm nút mới, tra class chuẩn | [`ui-buttons.md`](ui-buttons.md) |
| Chống tràn nội dung UI | Vùng UI có chiều cao phụ thuộc dữ liệu | [`ui-overflow.md`](ui-overflow.md) |

Quy ước + checklist tương ứng nằm ở [`../../convention/`](../../convention/) và `AGENTS.md` §6, không lặp ở đây.

---

## Cấu trúc thư mục đầy đủ

```
agent-workflow/
├── index.html, vite.config.ts, package.json, tsconfig.json, …
├── src/
│   ├── backend/            # scope Node/Bun — HTTP kernel, db, events, log, registry, entry
│   ├── frontend/           # scope browser — app root, composables, ui, shell, plugins, styles
│   ├── shared/             # dùng chung cả hai phía — logic/type thuần, không hạ tầng
│   └── features/           # feature-module (giữ nguyên cấu trúc)
├── mcp/                    # MCP stdio — chi tiết ở cấp Container
├── tests/                  # mirror: tests/src/server · tests/src/{backend,frontend,shared} · tests/mcp
├── test-e2e/
├── docs/
├── dist/
└── .claude/
```

> Thư mục `.claude/` là state cục bộ của công cụ AI (worktree, cache, settings.local) — chỉ phần rule được version. Danh mục tài liệu cho người đọc: [`../../README.md`](../../README.md).

> Ngoại lệ đuôi file cố ý còn `.js`: `src/features/agent-editor/business/agentMarkdown.js` và `src/backend/runner-cli.mjs`. Tooling `vite` / `vitest` / `playwright` dùng `.ts`; `eslint.config.js` giữ `.js`.

---

## Bất biến kiến trúc

Thêm scan / endpoint / feature mới không được phá các bất biến sau (mục đã thành checklist review — [`AGENTS.md`](../../../AGENTS.md) §6 Review — không lặp lại ở đây: đọc FS phòng thủ, chống path-traversal, ghi atomic, fetch qua wrapper an toàn):

- **Pattern scan tuỳ chỉnh không escape project root**: pattern trong `settings.scanPatterns` bị loại ở `sanitiseScanPattern` (schema dùng chung FE/BE của feature `settings`), lại ở `expandScanPatterns` (bỏ qua mọi symlink), và mỗi match còn qua `resolvePathUnder(projectRoot, …)`.
- **Ranh giới scope `src/backend` ⟂ `src/frontend`.** Code frontend **không** import `src/backend/**` hay `node:*` / `bun:*` / `hono` / `drizzle-orm` — kể cả gián tiếp qua một module `business/`. Code backend không import `src/frontend/**` hay `vue`. Thứ dùng thật ở cả hai phía đi vào `src/shared/**`, nơi bị cấm import hạ tầng lẫn hai bucket kia. Cả ba luật do `no-restricted-imports` trong `eslint.config.js` chặn, **không có whitelist** — xem `src/{backend,frontend,shared}/README.md`.
- **ESM thuần**; phía server import module Node bằng dạng `node:`-prefixed.
- **Module `bun:*` không được import tĩnh trên đường nạp `vite.config.ts`.** `bun run build` = `vite build` chạy dưới **Node**, mà Node ESM loader không hiểu scheme `bun:`. `vite.config.ts` kéo `src/backend/apiServer.ts` vào module graph, nên mọi file với tới được từ đó (hiện tại: `src/backend/db/client.ts`) phải nạp `bun:sqlite` và `drizzle-orm/bun-sqlite` bằng `await import(...)`, phần type dùng `import type`. Đổi về import tĩnh là làm đỏ build của **cả repo** — cửa chặn là step `Build` trong CI.
- `ANTHROPIC_API_KEY` tùy chọn, bật NL agent-draft generation (`/api/custom-agents/generate`); không có key thì fallback heuristic.
- `DASHBOARD_SECRET_KEY` **bắt buộc** để dùng credential kiểu "dán secret trực tiếp" (`stored:`) hoặc "Connect via browser"/OAuth (`oauth:`) trong `ConnectionDialog.vue` — mã hoá `secret-vault.json` (`secretVault.ts`). Không set → 2 luồng đó fail rõ ràng, các luồng khác (CLI, `env:`/`file:` secretRef) không bị ảnh hưởng.
