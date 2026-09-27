# Nợ kỹ thuật — collision detection cho dropdown (từ T242f6cc3)

`T242f6cc3` sửa lỗi che lấp/cắt chiều cao cho dropdown chọn repo bằng cách Teleport
`.project-select-menu` ra `body` + tính vị trí runtime (`position: fixed` + flip-to-fit)
trong `src/features/monitor/components/ProjectBar.vue`. Theo phạm vi task (D1), fix này
**chỉ** áp dụng cho `ProjectBar.vue`.

Cùng pattern lỗi (dropdown/menu dùng `position: absolute` tĩnh, không có collision
detection, dễ bị ancestor `overflow: hidden` cắt) còn tồn tại ở:

- `src/frontend/ui/CSelect.vue:201-216`
- `src/frontend/ui/CComboSelect.vue:257-273`
- `src/frontend/ui/NotificationBell.vue:99-110`

Nếu các nơi này báo lỗi tương tự, nên trích xuất logic `updateMenuPosition`/flip-to-fit
đang viết riêng trong `ProjectBar.vue` thành composable positioning dùng chung
(`useFloating`/`usePopper`-style) thay vì viết lại từ đầu cho từng component.
