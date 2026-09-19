# Checklist — chiến lược tràn nội dung

Chạy trước khi báo hoàn thành 1 vùng UI có chiều cao phụ thuộc dữ liệu.

- [ ] Thử với **dữ liệu dài** (nhiều hơn số item thật hiện có) — cuộn được tới mục cuối cùng.
- [ ] Thử với **dữ liệu rỗng** — empty state hiện đúng, khung không sụp về 0px.
- [ ] Trên mỗi trục chỉ có **một** thanh cuộn; container ngoài không cuộn (`scrollHeight === clientHeight`).
- [ ] Nội dung không tràn ra ngoài khung, không đè lên hàng nút / footer.
- [ ] Lặp lại ở **viewport thấp** (thu cửa sổ còn ~500px chiều cao) và khi mở nhiều section cùng lúc.

Quy ước: [`docs/convention/ui-overflow.md`](../convention/ui-overflow.md). Chi tiết implementation: [`docs/architecture/4-code/ui-overflow.md`](../architecture/4-code/ui-overflow.md).
