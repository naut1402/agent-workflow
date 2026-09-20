# Frontend — bootstrap & API layer

← [`../README.md`](../README.md) (Cấp 4 · Code)

Tham chiếu code cho 2 việc: **ModeRegistry/service container** khởi động ra sao, và **FE gọi API/suy diễn trạng thái** qua đâu. Đọc khi cần thêm mode mới, đổi cách FE gọi server, hoặc lần theo bootstrap lúc app khởi động.

## Bootstrap — ModeRegistry & service container

Bảng dưới map khái niệm ở cấp Component (sơ đồ bootstrap/runtime flow) sang đúng file.

| Khái niệm | File |
|---|---|
| Tự quét + đăng ký mode lúc khởi động, tạo container | `src/frontend/main.ts` |
| Danh sách mode (`ModeEntry`, `ModeRegistry`) | `src/frontend/shell/modeRegistry.ts` |
| Bộ quyết định mode nào dùng được — giao diện + khoá (`canAccessMode`) | `src/frontend/shell/modeAccess.ts` |
| Bản hiện thực đọc cấu hình bật/tắt mode trong Cài đặt | `src/features/settings/scripts/settingsModeAccess.ts` |
| Service container (`register`/`resolve`) | `src/frontend/container/{index,types}.ts` |
| Khoá để lấy container trong giao diện | `src/frontend/shell/containerKey.ts` |
| Bước cài đặt container vào giao diện | `src/frontend/plugins/index.ts` |
| Màn hình chính: lấy danh sách mode, vẽ sidebar/trạng thái/nội dung, xử lý theo dõi liên tục | `src/frontend/App.vue` |
| Mỗi tính năng tự khai báo mode của mình | `src/features/<feature>/registerMode.ts` |
| Theo dõi liên tục của mode Theo dõi (Monitor) — nhận task-list qua SSE `GET /api/tasks/stream` | `src/features/monitor/composables/useTaskPolling.ts` |
| Fetch-based SSE reader (tự gắn header `Authorization`, không dùng `EventSource` gốc) | `src/frontend/lib/sseClient.ts` |

## API layer

| Khái niệm | File |
|---|---|
| Client fetch dùng chung mọi feature (`apiGet`/`apiPost`/…) | `src/frontend/http/client.ts` |
| Suy diễn trạng thái phase (`PHASES`, `phasesFromPipeline`, `phaseStatus`) từ artifact + con trỏ live | `src/shared/lib/phase.ts` |
