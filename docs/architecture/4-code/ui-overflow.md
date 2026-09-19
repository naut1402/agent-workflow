# Chiến lược tràn cho danh sách và vùng nội dung dài

← [`README.md`](README.md) (Cấp 4 · Code)

Chi tiết implementation cho chiến lược tràn nội dung. Quy ước: [`docs/convention/ui-overflow.md`](../../convention/ui-overflow.md).

Class nền nằm ở `src/frontend/styles/_shell.scss` (entry `src/frontend/styles/main.scss`).

## Chuỗi sizing chuẩn

Đọc từ ngoài vào, mỗi tầng có đúng một trách nhiệm:

```
container ngoài     overflow: hidden           ← KHÔNG cuộn, chỉ chặn tràn
└── tầng trung gian  display: flex; flex-direction: column
    │                flex: <chia chiều cao>; min-height: 0
    └── lá           flex: 1; min-height: 0; overflow-y: auto   ← DUY NHẤT cuộn
```

Ba cạm bẫy khiến chuỗi này gãy:

- **Thiếu `min-height: 0`.** Flex item mặc định có `min-height: auto` — nó không co nhỏ hơn nội dung, nên `overflow-y: auto` ở lá không bao giờ kích hoạt; phần thừa tràn ra ngoài hoặc bị cắt. `overflow` khác `visible` cũng thoát được ràng buộc này, nhưng đó là hiệu ứng phụ ngầm: cứ khai báo `min-height: 0` tường minh.
- **Trộn basis giữa các anh em cùng cấp.** `flex: 1` (basis `0%`) và `flex: 0 1 auto` (basis = chiều cao nội dung) đứng cạnh nhau thì hệ số co nhân với basis khác nhau: cái khai `flex: 1` bị bóp về 0px thay vì bật thanh cuộn. Các panel cùng cấp phải khai `flex` theo cùng một quy ước.
- **Scroller thứ hai ở container ngoài.** Đặt `overflow-y: auto` cho cả container lẫn lá thì container nuốt mất trách nhiệm cuộn của lá — đúng triệu chứng "kéo mãi không tới mục cuối".
- **Hộp ẩn xen giữa hai tầng.** Chuỗi chỉ liền mạch khi mỗi tầng là flex item *trực tiếp* của tầng trên. `<details>` là ca điển hình: Chrome ≥131 chèn hộp `::details-content` giữa `<details>` và nội dung, nên nội dung không còn là flex item trực tiếp và chuỗi đứt ngay đó — phải khai báo cả `::details-content` (`display: flex; flex: 1 1 0; min-height: 0; overflow: hidden`).

Khi một panel chỉ nên giành chiều cao lúc nội dung của nó đang mở, dùng **class modifier** (`--open`) thay vì để basis 0 cố định — panel đang đóng mà basis 0 vẫn chiếm nửa cột.

## Hai ví dụ chuẩn trong repo

**Task list ở Monitor** — `src/features/monitor/styles/TaskList.scss`. `.tasklist-panel` là `flex` + `min-height: 0` + `overflow: hidden`; `.tasklist` là lá mang `overflow-y: auto; flex: 1; min-height: 0`. Hai chế độ sizing là hai class khác nhau: `.tasklist--active` chia phần còn lại, `.tasklist--archived` cap `max-height: min(40vh, 280px)`.

**Dialog `.modal`** — `src/frontend/styles/_shell.scss` ghi thẳng hợp đồng: *dialog dùng `.modal` PHẢI có đúng một `.modal-body` bọc phần nội dung*. `.modal` không khai báo `overflow`; nó dựa vào `.modal-body` (`flex: 1; min-height: 0; overflow-y: auto`) để hút phần cao quá `max-height: 88vh`. Đặt nội dung thẳng vào `.modal` thì khi vượt 88vh, hàng nút `.modal-actions` bị vẽ ra ngoài border dưới.
