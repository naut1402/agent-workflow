# Settings — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho feature `src/features/settings/`. Chỉ ghi phần không tự giải thích được qua tên file. Khi sửa, đối chiếu lại với code thật.

---

## 1. Ghi `settings.json` từng phần

- **Merge theo khoá** — `PUT` modes (`updateModes` trong `controller.ts`) gộp `enabled` lên bản đang lưu; `PUT` scan patterns đi qua `mergeScanPatternsConfig()` — kind thiếu hoặc không phải mảng giữ nguyên, chỉ `[]` tường minh mới xoá. Một `PUT` một phần không được xoá cấu hình còn lại.
- **Bỏ riêng entry rác** — `ModesConfigSchema` khai `enabled` là `record(unknown)` chứ không `boolean`, và `PatternList` (`schemas/scanPatterns.ts`) sanitise từng phần tử, để `parseModesConfig` / `parseScanPatternsConfig` bỏ riêng entry sai thay vì để `safeParse` hỏng cả map — một dòng sửa tay sai trong `settings.json` không xoá phần còn lại.

## 2. Phát tán cấu hình mode

- **Phát bản server đã merge** — sau khi lưu một mode, `SettingsDialog.vue` phát `dev-dashboard:modes-changed` với `data.config` (bản đã merge ở server), không phải map cục bộ một khoá: `App.vue` gọi `modeAccess.applyOverrides()` thay cả config, nên map một khoá sẽ đưa mọi mode khác về `defaultEnabled`.
