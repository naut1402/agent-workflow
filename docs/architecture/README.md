# Kiến trúc — danh mục C4

Kiến trúc `dev-team-dashboard` viết theo mô hình **C4** (Simon Brown): 4 cấp trừu tượng, thô → mịn. Mỗi cấp là **một tài liệu độc lập** — không cấp nào liên kết trực tiếp sang cấp khác, muốn chuyển cấp thì quay lại danh mục này.

- Giới thiệu + hướng dẫn chạy nhanh: [`../../README.md`](../../README.md).
- Danh mục tài liệu chung: [`../README.md`](../README.md).

---

| Cấp | Tài liệu | Trả lời câu hỏi gì |
|---|---|---|
| **1 · Context** | [`1-context/`](1-context/README.md) | Hệ thống nằm ở đâu trong bức tranh lớn? Ai/cái gì tương tác với nó? |
| **2 · Container** | [`2-container/`](2-container/README.md) | Hệ thống triển khai thành những khối chạy độc lập nào? |
| **3 · Component** | [`3-component/`](3-component/README.md) | Bên trong một container, chia thành những khối trách nhiệm nào? |
| **4 · Code** | [`4-code/`](4-code/README.md) | Implementation cụ thể ra sao? (cấp thay đổi thường xuyên nhất, kèm **Bất biến kiến trúc**) |
