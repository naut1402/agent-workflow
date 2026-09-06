# Danh mục tài liệu

Tài liệu dành cho **người đọc**: hiểu hệ thống, chạy dự án, tra cứu quy ước hiển thị và dữ liệu.

Giới thiệu sản phẩm và hướng dẫn chạy nhanh: [`../README.md`](../README.md).

---

## Kiến trúc & vận hành

- **[`architecture.md`](architecture.md)** — nguồn chính cho kiến trúc: data root `.dev-team-agent/`, Hono trên hai transport, tầng `business/`, cấu trúc thư mục `src/`, bất biến kiến trúc.
- **[`diagram/IoC.md`](diagram/IoC.md)** — hai sơ đồ giải thích service container (DI/IoC) và `ModeRegistry`: bootstrap lúc khởi động, và runtime khi người dùng chuyển mode.

## Dữ liệu & sự kiện

- **[`event-catalog.md`](event-catalog.md)** — mục lục domain event theo feature: type, nơi emit, payload. Dùng khi đọc tab **Logs › Events**, viết subscriber, hoặc thêm emit mới.

## Giao diện

- **[`i18n.md`](i18n.md)** — tổ chức message `vi` / `en`, namespace theo feature, cách thêm và đổi chuỗi UI.
- **[`ui-buttons.md`](ui-buttons.md)** — quy ước nút và trạng thái trên UI, class chuẩn ở `src/styles/_shell.scss`.

## Mẫu dùng lại

- **[`template/pipeline/`](template/pipeline/)** — pipeline mặc định, override theo task, cấu hình orchestrator từ xa.
- **[`template/agents/`](template/agents/)** — bộ agent template cho từng bước của pipeline.

## Vận hành & triển khai

- **[`../docker/`](../docker/)** — Docker Compose, Dockerfile, `install.sh` và [`.env.example`](../docker/.env.example).

---

## Quy ước phát hành

- **Branch phát hành theo dòng version** — `dev/x.y.z/main` (vd `dev/1.1.2/main`).
- **Không commit thẳng `main`** — mọi thay đổi đi qua pull request.
