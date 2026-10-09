# Runner — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho feature `src/features/runner/`. Chỉ ghi phần **không tự giải thích được qua tên file**: quirk, giới hạn đã biết, lý do giữ một hành vi trông như thừa. Khi sửa, đối chiếu lại với code thật.

---

## 1. Id runner / connection

- **Id suy từ tên** — FE dựng id bằng `slugify(tên)` (`RunnerDialog.vue`, `ConnectionDialog.vue`), backend chỉ sanitize (`sanitiseRunnerId`). Hai runner cùng tên ⇒ cùng id.
- **Tạo mới trùng id trả 409** — request mang `create: true` mà id đã có thì `upsertRunner` / `upsertConnection` trả `409` **trước** mọi side effect, không ghi đè im lặng. Request không mang `create` (sửa, caller lập trình) vẫn upsert như cũ.
- **409 chỉ chặn va chạm, không diệt nó** — cách triệt để là đổi id sang UUID kèm migration dữ liệu: #473.

## 2. `defaultRunnerId` có thể là giá trị suy ra

`loadRunners()` (`business/registry.ts`) không trả nguyên `defaultRunnerId` trong `runners.json`:

| Trên đĩa | Giá trị `loadRunners()` trả |
|---|---|
| Có, trỏ runner còn tồn tại | Đúng giá trị đó |
| Thiếu, hoặc trỏ runner đã xoá | `runners[0].id` — runner **đầu mảng**, không xét đủ điều kiện chạy AI |
| `runners` rỗng | `null` |

- **Vì sao giữ** — store tạo trước khi có `defaultRunnerId` chưa từng ghi field này. Bỏ dòng suy là những máy đó mất default và phải chọn lại một lần.
- **Không gây chạy sai runner vừa thêm** — runner mới luôn được `push` vào **cuối** mảng, nên `runners[0]` không thể là nó.
- **Hệ quả cho `resolveDefaultRunner`** — hai nhánh `unset` / `missing` không chạm được từ đĩa (giá trị đã được suy trước khi tới đây); chỉ store dựng tay trong test mới vào được.
- **Phơi bày thay vì sửa** — runner được suy ra mà không đủ điều kiện (tắt, mất connection, không phải họ AI) hiện qua `defaultRunnerIssue` của `GET /api/runners` và banner ở Runner Config; job không pin **không** tự rơi sang runner khác.
- **Lần ghi kế tiếp chốt giá trị suy xuống đĩa** — `upsertRunner` / `deleteRunner` lưu lại cả store vừa load, nên `runners[0]` được suy ra trở thành `defaultRunnerId` thật trong `runners.json`.
- **Chọn lại theo điều kiện chỉ ở hai ca** — xoá đúng runner đang là default (`deleteRunner`), hoặc thêm runner vào store đang rỗng (`upsertRunner`): khi đó lấy runner **đủ điều kiện chạy AI** đầu tiên.

## 3. Phân loại family của provider

`providerFamilyOf(providerId)` (`business/registry.ts`) quyết định runner nào chạy được agent (default AI, pin step, reader transcript). Thứ tự:

1. **`PROVIDER_CATALOG.family`** (`business/connections.ts`) — provider có sẵn.
2. **`family` provider tự khai** khi đăng ký qua `registerProvider`.
3. **Quy tắc theo id** `providerFamilyFromId` (`business/providers/agentCli.ts`) — chỉ cho id không có khai báo nào: `console-command` · đuôi `-api` ⇒ `ai-api` · id agent CLI có sẵn ⇒ `agent-cli` · còn lại ⇒ `console-command`.

- **FE dùng cùng thứ tự** — `familyOfProviderId` (`lib/runnerModelOptions.ts`) nhận catalog từ `GET /api/runners` (`providers`), rồi mới tới quy tắc theo id. Provider đăng ký runtime không có trong catalog FE nên ở FE nó rơi về quy tắc theo id.
- **Id lạ vẫn rơi về `console-command`** — runner mặc định dùng provider như vậy nhận `reason: 'not-ai'` và hiện banner, không im lặng chạy runner khác.
