# Todo — Tbefa5f4c

- **Issue / epic:** adhoc (task nội bộ — chưa có issue GitHub)
- **Loại nợ:** other
- **Branch / PR tạo nợ:** `dev/1.2.0/Tbefa5f4c_phan-tich-pattern-tool-mcp`
- **Ngày tạo:** 2026-10-04

### Vì sao hoãn

Task tổ chức lại `mcp/` (bỏ `envelope.ts` / `schemas.ts` / `modes.ts` / `tools/tasks.ts`, đổi entry `server.ts` → `stdio.ts`). Ba comment ngoài `mcp/` còn trỏ tới path cũ.

Theo [`coding-guideline.md`](../../agent-rules/coding-guideline.md) §7 (cấm giải thích trong code, cấm mã quyết định / mã task trong comment), các comment này phải **xoá** chứ không sửa path. Gom vào một lượt quét toàn repo để PR của task này không kéo thêm file ngoài phạm vi.

### Việc cần làm khi đối ứng

- [ ] Xoá comment trỏ path `mcp/` không còn tồn tại:
  - [ ] `src/backend/registry.ts:8` — nhắc `mcp/server.mjs`
  - [ ] `src/features/monitor/business/tasks/qa.ts:32` — nhắc `TASK_ID_PATTERN` ở `mcp/schemas.ts` (nay ở `mcp/tools/TaskTools.ts`), kèm mã `R4`
  - [ ] `src/frontend/lib/appVersion.ts:5` — nhắc `mcp/server.ts` (nay là `mcp/stdio.ts` / `mcp/DashboardMcpServer.ts`)
- [ ] Quét toàn repo một lượt các comment vi phạm `coding-guideline.md` §7 — đoạn giải thích *what* / *why*, mã quyết định / finding (`D3`, `G8`, `TC-D8`, `R4`…), mã task (`T<hex>`), khung `── ─` — rồi xoá; ý nào cần giữ thì chuyển sang `docs/` và để lại một dòng `// xem docs/…`
- [ ] Xoá **cả thư mục** `docs/todo/` khi không còn file nợ nào
