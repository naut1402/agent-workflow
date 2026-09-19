# Quy ước — chiến lược tràn nội dung

Áp dụng cho mọi vùng UI có chiều cao phụ thuộc dữ liệu (danh sách, cây, body dialog, panel log).

1. **Chiến lược tràn là bắt buộc, không phải tuỳ chọn.** Vùng nội dung dài tuỳ dữ liệu phải có vùng cuộn giới hạn chiều cao **ngay từ lúc viết**, không đợi tới lúc có người báo "xem không hết".
2. **Không giả định "dữ liệu chắc là ngắn".** Catalog 7 agent hôm nay là 70 agent sau khi thêm plugin; danh sách rule của project dài ra theo thời gian. Layout đúng phải chịu được cả dữ liệu dài lẫn dữ liệu rỗng.
3. **Cắt cụt tệ hơn cuộn.** Nội dung bị cắt không để lại dấu hiệu nào trên UI — người dùng không biết là còn mục phía dưới. Vùng cuộn ít nhất luôn tự tố cáo bằng thanh cuộn.
4. **Một trục, một thanh cuộn.** Hai scroller lồng nhau trên cùng một trục là lỗi, không phải "cho chắc": chuột lăn rơi nhầm tầng và mục cuối vẫn có thể không tới được.

Chi tiết implementation (chuỗi sizing chuẩn, cạm bẫy, ví dụ trong repo): [`docs/architecture/4-code/ui-overflow.md`](../architecture/4-code/ui-overflow.md).
