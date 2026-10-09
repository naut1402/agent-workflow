# Backend — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho `src/backend/`. Chỉ ghi phần không tự giải thích được qua tên file. Khi sửa, đối chiếu lại với code thật.

---

## 1. Khoá phân vùng knowledge trong SQLite

- **`store_key`, không `project_id`** — `knowledge_collections` / `knowledge_tags` (`db/schema.ts`) phân vùng theo đường dẫn tuyệt đối của store base (`<root>/knowledge`, hoặc `globalKnowledgeRoot()` cho scope `global`). `project_id` là `null` khi request không truyền `?project=`, và `UNIQUE` trên cột NULL trong SQLite không ràng buộc gì ⇒ `migrateKnowledgeToSqlite()` chạy lại sẽ nhân đôi dữ liệu.

## 2. Import namespace cho module `node:*`

- **Không named import từ `node:url` / `node:crypto` / `node:util` / `node:child_process` / `node:async_hooks`** — Vite viết lại named import `from 'node:*'` thành truy cập thuộc tính lúc module init (`ext["fileURLToPath"]`), ném lỗi trên browser nếu file lọt vào client graph. `lib/fileHelper.ts`, `lib/processHelper.ts` dùng `import * as …` và chỉ truy cập ở call site; `log/traceContext.ts` tạo `AsyncLocalStorage` lười trong `traceAls()`.

## 3. Quyền file khi ghi atomic

- **`chmodSync` chạy ở cả hai nhánh của `writeTextFileAtomicSync()`** (`lib/fileHelper.ts`) — nhánh fallback `copyFileSync` giữ mode của file đích đã tồn tại chứ không lấy mode của temp, và `writeFileSync` không đổi mode của file đã có; chỉ lệnh `chmodSync` cuối hàm chốt được `mode`.
- **Lỗi `chmodSync` bị nuốt** — win32 / FS không hỗ trợ POSIX mode: nội dung vẫn ghi đúng, luồng không bị chặn.

## 4. Event bus giữ state trên `globalThis`

- **Một bus cho mọi bản nạp module** — `events/eventBus.ts` cất handler/trigger dưới khoá `__devTeamDashboardEventBus__` của `globalThis`. Vite dev (plugin graph) và loader `import(fileURL)` của feature có thể nạp hai bản module; dùng `Map` cục bộ thì subscriber đăng ký ở bản A còn `emit` của job queue bắn vào bản B ⇒ tab Events rỗng.

## 5. Chuỗi middleware `/api/*`

- **Thứ tự CORS → rate-limit → JWT** — `createApp()` (`apiServer.ts`) gắn rate-limit trước JWT để giới hạn áp cả request chưa auth; cả ba no-op khi chưa cấu hình (`loadSecurityConfig()`, `DASHBOARD_JWT_SECRET`).
- **`/api/orchestrator/*` bỏ qua JWT dashboard** — route này xác thực bằng token riêng theo job (`X-Dashboard-Orchestrator-Token`), không bằng `Authorization`.
- **`x-dtd-client-ip` ghi đè sau khi copy header gốc** — `nodeToWebRequest()` set header từ `req.socket.remoteAddress` sau vòng copy, nên client không tự gửi header trùng tên để giả IP; `rateLimiter.ts` đếm theo header này.

## 6. Base URL tự gọi ngược `DEV_TEAM_SELF_BASE_URL`

- **Luôn `http://127.0.0.1:<port>`, không dùng `HOST`** — `standalone.ts` (callback `listen`) và `devTeamApi.ts` (sự kiện `listening` của Vite dev server) đặt biến này cho tiến trình con gọi ngược route MCP orchestrator (`claude-code-cli.ts`, `orchestrator/business/mcpRoute.ts`). Tiến trình con luôn chạy cùng máy, còn `HOST` có thể là `0.0.0.0` — không phải địa chỉ đích hợp lệ để tự kết nối. Tiến trình con nhận biến qua `process.env` sẵn có, không cần truyền thêm.
