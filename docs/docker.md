# Docker — biến môi trường và vận hành

Cấu hình môi trường khi chạy dashboard bằng Docker. Chạy nhanh: [`../README.md`](../README.md). Compose, Dockerfile, `install.sh`: [`../docker/`](../docker/) kèm [`.env.example`](../docker/.env.example).

Mọi lệnh dưới đây chạy từ **thư mục gốc repo**.

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

## rtk — nén output lệnh trong container

Image dashboard bake sẵn [rtk](https://github.com/rtk-ai/rtk) (CLI, không phải
service). `entrypoint.sh` đăng ký PreToolUse hook cho Claude Code CLI, nên lệnh
shell mà agent chạy trong container được nén trước khi vào context LLM. Không có
port nào được mở, không cần secret nào.

Build và chạy:

```bash
./docker/install.sh --runners --build          # build + up (pin: RTK_VERSION trong docker/.env)

# Quy ước cho mọi lệnh compose dưới đây — giữ ĐỦ các -f của luồng đang chạy.
# Bỏ bớt một -f rồi `up -d` sẽ recreate dashboard theo cấu hình hẹp hơn và vứt mất
# mount auth của host (compose.runners.yml) — xem cảnh báo ở mục rollback bên dưới.
export DCR="docker compose --env-file docker/.env -f docker/compose.yml -f docker/compose.runners.yml"

$DCR exec dashboard rtk --version
$DCR logs dashboard | grep rtk
```

Kiểm tra hook đã đăng ký và số liệu tiết kiệm:

```bash
$DCR exec dashboard grep -o 'rtk hook claude' /home/dashboard/.claude/settings.json

$DCR --profile tools run --rm rtk gain    # khuyến nghị: service toolbox chạy sẵn non-root
# exec: cờ -u nở ở shell HOST, không đọc docker/.env — thay 1001 bằng đúng PUID bạn đặt ở đó
$DCR exec -u 1001 dashboard rtk gain
```

> `exec dashboard` vào bằng **root** (image kết thúc ở `USER root` để entrypoint có uid 0), nên
> `rtk gain` không có `-u` sẽ để lại file `root:root` trong volume `rtk-data` và agent ở uid `PUID`
> gặp `EACCES` cho tới lần start sau. Biến thể `run --rm rtk` đã chạy non-root sẵn.

- Đổi `RTK_VERSION` **bắt buộc kèm rebuild** — binary bake lúc build, không phải env runtime.
- `RTK_VERSION` trống = lấy latest **lúc build layer đó**; Docker tái dùng layer cũ nên lần build sau
  vẫn ra bản cũ. Ép lấy latest: `RTK_REFRESH=$(date +%s) ./docker/install.sh --build` (hoặc `--no-cache`).
- Tắt nhanh không cần rebuild: `RTK_HOOK_ENABLED=0` trong `docker/.env` rồi `./docker/install.sh --runners`
  — phải **recreate** container, `docker compose restart` giữ nguyên env cũ nên không có tác dụng.
  Nếu gọi compose trực tiếp, **phải giữ đủ các `-f` đang dùng** (`$DCR up -d`); bỏ
  `compose.runners.yml` sẽ recreate dashboard không còn mount auth của host.
- Hiện chỉ đăng ký hook cho runner **`claude-code-cli`**. rtk cũng hỗ trợ `cursor-cli` (`--agent cursor`)
  và `codex-cli` (`--codex`) nhưng image này chưa bật — mở rộng là task riêng.
- Runner họ API (`anthropic-compatible-api`, `openai-compatible-api`) gọi thẳng Messages API, không có
  Bash tool nên không có hook để bắn.

