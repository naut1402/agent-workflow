# Todo — integrate-antigravity

- **Issue / epic:** adhoc
- **Loại nợ:** other
- **Branch / PR tạo nợ:** adhoc
- **Ngày tạo:** 2026-08-12

## Vì sao hoãn

Cần nghiên cứu và lập kế hoạch chi tiết trước khi tiến hành tích hợp Antigravity CLI vào nguồn agent CLI của runner (có thể là `src/runner-cli.mjs` hoặc các module liên quan), nhằm tránh ảnh hưởng tới luồng thực thi hiện tại.

## Việc cần làm khi đối ứng

- [ ] Khảo sát luồng gọi CLI hiện tại của runner (`runner-cli`).
- [ ] Lên phương án tích hợp (gọi Antigravity CLI qua spawn/exec hoặc API nếu có).
- [ ] Viết code tích hợp.
- [ ] Cập nhật tài liệu (nếu cần thiết) và viết test.
- [ ] Xóa **cả thư mục** `docs/todo/` khi không còn file nợ nào (bắt buộc trước merge version main).

## Ghi chú

- Tham khảo tài liệu của Antigravity CLI để biết cách tích hợp tối ưu nhất.
