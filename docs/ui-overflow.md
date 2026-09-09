# Chiến lược tràn cho danh sách và vùng nội dung dài

Quy ước cho mọi vùng UI có chiều cao phụ thuộc dữ liệu (danh sách, cây, body dialog, panel log). Class nền nằm ở `src/styles/_shell.scss` (entry `src/styles/main.scss`).

## Phương châm

1. **Chiến lược tràn là bắt buộc, không phải tuỳ chọn.** Vùng nội dung dài tuỳ dữ liệu phải có vùng cuộn giới hạn chiều cao **ngay từ lúc viết**, không đợi tới lúc có người báo "xem không hết".
2. **Không giả định "dữ liệu chắc là ngắn".** Catalog 7 agent hôm nay là 70 agent sau khi thêm plugin; danh sách rule của project dài ra theo thời gian. Layout đúng phải chịu được cả dữ liệu dài lẫn dữ liệu rỗng.
3. **Cắt cụt tệ hơn cuộn.** Nội dung bị cắt không để lại dấu hiệu nào trên UI — người dùng không biết là còn mục phía dưới. Vùng cuộn ít nhất luôn tự tố cáo bằng thanh cuộn.
4. **Một trục, một thanh cuộn.** Hai scroller lồng nhau trên cùng một trục là lỗi, không phải "cho chắc": chuột lăn rơi nhầm tầng và mục cuối vẫn có thể không tới được.

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

**Dialog `.modal`** — `src/styles/_shell.scss` ghi thẳng hợp đồng: *dialog dùng `.modal` PHẢI có đúng một `.modal-body` bọc phần nội dung*. `.modal` không khai báo `overflow`; nó dựa vào `.modal-body` (`flex: 1; min-height: 0; overflow-y: auto`) để hút phần cao quá `max-height: 88vh`. Đặt nội dung thẳng vào `.modal` thì khi vượt 88vh, hàng nút `.modal-actions` bị vẽ ra ngoài border dưới.

## Checklist trước khi báo hoàn thành

- [ ] Thử với **dữ liệu dài** (nhiều hơn số item thật hiện có) — cuộn được tới mục cuối cùng.
- [ ] Thử với **dữ liệu rỗng** — empty state hiện đúng, khung không sụp về 0px.
- [ ] Trên mỗi trục chỉ có **một** thanh cuộn; container ngoài không cuộn (`scrollHeight === clientHeight`).
- [ ] Nội dung không tràn ra ngoài khung, không đè lên hàng nút / footer.
- [ ] Lặp lại ở **viewport thấp** (thu cửa sổ còn ~500px chiều cao) và khi mở nhiều section cùng lúc.
