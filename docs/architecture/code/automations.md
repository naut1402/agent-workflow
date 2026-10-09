# Automations — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho feature `src/features/automations/`. Chỉ ghi phần không tự giải thích được qua tên file. Khi sửa, đối chiếu lại với code thật. Luồng trigger → run và event: [`../events/automations.md`](../events/automations.md).

---

## 1. Project đích của action `runTask`

- **Id project không bao giờ là path** — `PROJECT_ID_PATTERN` (`schemas/automation.ts`) chặn id thành mảnh path; root thật luôn lấy từ `registry.get(id).path`. `PROJECT_ID_RE` trong `AutomationFormDialog.vue` là bản sao FE để báo lỗi tại chỗ — đổi một bên phải đổi bên kia.
- **Không fallback** — `resolveActionTarget()` (`business/runAction.ts`): id rỗng hoặc trùng project của rule → dùng thẳng root của rule (rule có thể chạy với `projectId` không có trong registry: test, seed `DEV_TEAM_ROOT`); id lạ → lỗi tường minh, không rơi về project của rule. `executeCreateAction` resolve trước khi `createTask` để project đích hỏng không để lại task rác.
- **Artifact theo root của bước** — `executeSequence` đọc artifacts theo `StepExecution.root` chứ không theo root của rule, vì bước cross-project nằm ở data root khác.

## 2. Ghi state và one-shot

- **Ghi state trước khi chạy** — `runAutomation()` ghi `lastRunAt`, `inFlight`, `triggerFired` trước khi execute: `lastRunAt` neo lịch due kế tiếp, `inFlight` chặn trigger chạy chồng, timer `once` tới hạn coi như đã kích hoạt dù action fail.
- **Tắt one-shot trong file YAML** — `disableIfAllOnceTriggersSpent()` (`business/rules.ts`) ghi `enabled: false` vào rule file ở data root: runtime state ở `registryHome()` mất khi redeploy docker (container mới), còn data root là volume mount nên lệnh cấm chạy lại bền vững. Hàm đọc lại rule từ file vì object truyền vào có thể là bản cũ trong bộ nhớ (run kéo dài, container khác vừa ghi).

## 3. Cron và YAML cũ

- **Cron theo giờ local, ngữ nghĩa vixie-cron** — `business/matcher.ts` đánh giá bằng getter `Date` local; dom + dow cùng bị giới hạn → OR, còn lại AND. Field chỉ là wildcard khi là `*` trần — `*/n` (kể cả `*/1`) tính là có giới hạn.
- **YAML 1.1 trả `Date`** — parser YAML có thể đọc timestamp ISO thành `Date`, nên `normaliseAutomationDoc()` (`schemas/automation.ts`) chuẩn `createdAt` / `updatedAt` / `startAt` về chuỗi ISO trước `safeParse`.

## 4. Frontend

- **Options theo project đích** — `useAutomations.ts` cache options theo project id (`optionsByProject`, khoá `''` = project đang chọn). Lỗi fetch của project đích không được cache: `ensureFormOptions` thấy khoá đã có là thôi fetch, nên cache lỗi làm combobox của project đó rỗng suốt phiên; khoá `''` vẫn ghi rỗng để form render. `optionsOf()` (`AutomationFormDialog.vue`) không mượn options của project khác khi project đích chưa nạp xong; riêng `projects` là global.
- **Thứ tự CSS trong `AutomationFormDialog.vue`** — `.field` phải đứng trước `.checkbox-field`: cùng specificity (0,2,0), cùng set `flex-direction` / `gap`, `.checkbox-field` thắng chỉ nhờ đứng sau. Selector input của `.field` chỉ nhắm con trực tiếp (`>`) để không đè input bên trong `CComboSelect`.
