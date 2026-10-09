# Statistics — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho feature `src/features/statistics/`. Chỉ ghi phần không tự giải thích được qua tên file. Khi sửa, đối chiếu lại với code thật.

---

## 1. Thứ tự fetch trong `StatisticsPanel.vue`

- **Step summary đứng đầu `Promise.all`** — `load()` gửi request step summary (`groupBy: 'step'`) trước, request của từng chart theo sau; test dựa vào `lastUrl()` để lấy URL của chart cuối.

## 2. Prefs localStorage cũ

- **Prefs một chart** — `loadPrefs()` chuyển prefs bản đơn chart (`groupBy` / `metric` / `chartType` / `chart` ở gốc, không có `charts`) thành danh sách một phần tử (`id: 'migrated'`); bỏ nhánh này thì người dùng cũ mất cấu hình chart.

## 3. Bộ lọc query

- **Không dựng path từ filter** — `filterString` (`schemas/usageStats.ts`) chỉ giới hạn độ dài và tập ký tự, vẫn nhận `.` và `:`; giá trị `project` / `taskId` / `stepId` / `from` / `to` chỉ dùng để so khớp entry, không được nối vào đường dẫn.
