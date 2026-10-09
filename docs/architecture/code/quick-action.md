# Quick Action — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho feature `src/features/quick-action/`. Chỉ ghi phần không tự giải thích được qua tên file. Khi sửa, đối chiếu lại với code thật.

---

## 1. Catalog

- **Toàn dashboard, ghi đè cả mảng** — catalog nằm ở `~/.dev-team-dashboard/artifact-actions.yaml`, dùng chung mọi project, nên `useQuickActionCatalog` bỏ qua `getProjectId`. `persist` gửi nguyên `actions` + `menus` qua `PUT /api/artifact-actions` (thay cả catalog); server là nguồn schema, client chỉ kiểm trùng id và field bắt buộc.
- **Id ổn định khi sửa** — `QuickActionPanel.vue` chỉ sinh id từ label lúc tạo (`deriveId`); sửa action giữ id cũ vì leaf menu tham chiếu action qua `action_id`.

## 2. Form và placeholder

- **Placeholder khớp server** — `PROMPT_PLACEHOLDERS` (`QuickActionPanel.vue`) chép tay theo `substitutePrompt()` (`monitor/business/artifactActions/index.ts`); `{{selection}}` / `{{selection_lines}}` chỉ có giá trị khi chạy từ selection toolbar.
- **Escape `{` trong locale** — vue-i18n coi `{…}` là nội suy, nên token cần hiện nguyên văn trong `locales/{vi,en}.ts` phải viết `{'{'}`.
- **Gắn listener sau `nextTick`** — `openPromptHelp` gắn listener click (capture phase) sau `nextTick`, nếu không chính cú click mở popover kích luôn handler "click ra ngoài" và đóng nó.

## 3. Dialog menu

- **Clone cây menu bằng JSON** — `cloneMenus` (`QuickActionMenuDialog.vue`) dùng JSON round-trip: `toRaw` chỉ bóc proxy ngoài cùng, node lồng vẫn reactive và làm `structuredClone` ném lỗi.
