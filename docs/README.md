# Danh mục tài liệu

Tài liệu dành cho **người đọc**: hiểu hệ thống, chạy dự án, tra cứu quy ước hiển thị và dữ liệu.

Giới thiệu sản phẩm và hướng dẫn chạy nhanh: [`../README.md`](../README.md).

---

## Kiến trúc & vận hành

- **[`architecture/`](architecture/README.md)** — kiến trúc theo mô hình **C4**, 4 cấp trừu tượng thô → mịn (Context, Container, Component, Code). Tài liệu tra cứu chi tiết (sơ đồ IoC, event catalog, i18n, quy ước UI) nằm trong cấp tương ứng — xem danh mục.

## Dữ liệu & sự kiện

- **[`architecture/4-code/event-catalog.md`](architecture/4-code/event-catalog.md)** — mục lục domain event theo feature: type, nơi emit, payload. Dùng khi đọc tab **Logs › Events**, viết subscriber, hoặc thêm emit mới.

## Giao diện

- **[`architecture/4-code/i18n.md`](architecture/4-code/i18n.md)** — tổ chức message `vi` / `en`, namespace theo feature, cách thêm và đổi chuỗi UI.
- **[`architecture/4-code/ui-buttons.md`](architecture/4-code/ui-buttons.md)** — quy ước nút và trạng thái trên UI, class chuẩn ở `src/frontend/styles/_shell.scss`.
- **[`architecture/4-code/ui-overflow.md`](architecture/4-code/ui-overflow.md)** — chiến lược tràn cho danh sách và vùng nội dung dài: chuỗi sizing chuẩn, ví dụ trong repo, checklist review.

## Mẫu dùng lại

- **[`template/pipeline/`](template/pipeline/)** — pipeline mặc định, override theo task, cấu hình orchestrator từ xa.
- **[`template/agents/`](template/agents/)** — bộ agent template cho từng bước của pipeline.

## Vận hành & triển khai

- **[`../docker/`](../docker/)** — Docker Compose, Dockerfile, `install.sh` và [`.env.example`](../docker/.env.example).

---

## Quy ước phát hành

- **Branch phát hành theo dòng version** — `dev/x.y.z/main` (vd `dev/1.1.2/main`).
- **Branch task gắn version** — `dev/x.y.z/{taskID}_{task-slug}`, cắt từ `dev/x.y.z/main`; task không gắn version dùng `<type>/<TASK>/<slug>` cắt từ `main`.
- **Không commit thẳng `main`** — mọi thay đổi đi qua pull request.
- **PR promote `dev/x.y.z/main` → `main`** dùng template `.github/PULL_REQUEST_TEMPLATE/release.md` — release note hướng người dùng, so với version đã release trước đó; chỉ giữ section có nội dung thật, riêng `## PR đã merge` ở cuối body luôn có.
