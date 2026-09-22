# Danh mục tài liệu

Tài liệu dành cho **người đọc**: hiểu hệ thống, chạy dự án, tra cứu quy ước hiển thị và dữ liệu.

Giới thiệu sản phẩm và hướng dẫn chạy nhanh: [`../README.md`](../README.md).

---

## Kiến trúc & vận hành

- **[`architecture/`](architecture/README.md)** — kiến trúc theo mô hình **C4**, 4 cấp trừu tượng thô → mịn (Context, Container, Component, Code). Tài liệu tra cứu chi tiết (sơ đồ IoC, i18n, quy ước UI) nằm trong cấp tương ứng — xem danh mục.
- **[`convention/architecture-doc-levels.md`](convention/architecture-doc-levels.md)** — chi tiết nào được phép đặt ở cấp nào. Đọc trước khi viết hoặc sửa file trong `architecture/`.

## Dữ liệu & sự kiện

- **[`architecture/events/`](architecture/events/README.md)** — mục lục domain event theo mode: type, nơi emit, payload, kèm state/flow chart. Dùng khi đọc tab **Logs › Events**, viết subscriber, hoặc thêm emit mới.

## Giao diện

- **[`convention/i18n.md`](convention/i18n.md)** · **[`convention/ui-buttons.md`](convention/ui-buttons.md)** · **[`convention/ui-overflow.md`](convention/ui-overflow.md)** — quy ước message/locale, nút, và chiến lược tràn nội dung; mỗi file gồm cả nguyên tắc lẫn chi tiết class/file.

## Quy ước

- **[`convention/`](convention/)** — quy ước theo chủ đề: nguyên tắc kèm chi tiết class/file của chính chủ đề đó, không tham chiếu checklist. Checklist agent thực thi (theo giai đoạn pipeline) nằm ở [`../AGENTS.md`](../AGENTS.md) §6.

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
