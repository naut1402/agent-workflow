# Docker — biến môi trường

Cấu hình môi trường khi chạy dashboard bằng Docker. Chạy nhanh: [`../README.md`](../README.md). Compose, Dockerfile, `install.sh`: [`../docker/`](../docker/) kèm [`.env.example`](../docker/.env.example).

---

## Biến môi trường

| Biến | Bắt buộc? | Dùng cho | Khi không set |
|------|-----------|----------|---------------|
| `ANTHROPIC_API_KEY` | Tuỳ chọn | Sinh bản nháp agent từ mô tả (`/api/custom-agents/generate`) | Fallback heuristic |
| `DASHBOARD_SECRET_KEY` | Bắt buộc cho vault | Mã hoá `secret-vault.json` (`secretVault.ts`) — credential kiểu "dán secret trực tiếp" (`stored:`) và "Connect via browser"/OAuth (`oauth:`) trong `ConnectionDialog.vue` | 2 luồng đó fail rõ ràng; CLI và secretRef `env:` / `file:` không bị ảnh hưởng |
| `DEVTEAM_MCP_MODE` | Tuỳ chọn | Mode vận hành của MCP server — `readonly` hoặc `full` | Mặc định `readonly` (chỉ tool đọc). Giá trị lạ → cảnh báo ra `stderr` rồi lùi về `readonly`. Chi tiết: [`docs/mcp/server.md`](mcp/server.md) §3 |
| `RTK_VERSION` | Tuỳ chọn | Pin phiên bản rtk lúc **build image** (`docker/`) | Lấy release mới nhất lúc build |
| `RTK_REFRESH` | Tuỳ chọn | Phá cache layer cài rtk — truyền từ dòng lệnh lúc build, không đặt trong `.env` | Trống; Docker tái dùng layer cũ |
| `RTK_HOOK_ENABLED` | Tuỳ chọn | Bật/tắt hook nén output của rtk trong container | Mặc định `1` (bật) |
| `RTK_TELEMETRY_DISABLED` | Tuỳ chọn | Chặn cứng telemetry của rtk | Mặc định `1` (chặn) |
