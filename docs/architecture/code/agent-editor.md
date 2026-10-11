# Agent editor — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho feature `src/features/agent-editor/`. Chỉ ghi phần **không tự giải thích được qua tên file**: quirk, giới hạn đã biết, ràng buộc ẩn. Khi sửa, đối chiếu lại với code thật.

---

## 1. Import peer sâu sang `pipeline-editor`

`business/agents.ts` (và barrel `business/index.ts`) import `sanitiseProfileName` thẳng từ `pipeline-editor/business/pipeline/index.js`, không qua barrel `pipeline-editor/business/index.js`.

- **Vì sao không qua barrel** — barrel `pipeline-editor/business/index.ts` re-export lại toàn bộ `agent-editor/business/index.js`; đi qua nó thì thành vòng import agent-editor ⇄ pipeline-editor.

## 2. `listPipelineProfileNames` chỉ trả tên giữ nguyên qua sanitise

`listPipelineProfileNames(root)` (`business/agents.ts`) liệt kê `<root>/pipeline-profiles/*.yaml` — chính là tập giá trị hợp lệ của `CreateTaskRequest.profileName` / `RunTaskAction.profileName`.

- **Bỏ tên mà `sanitiseProfileName` làm thay đổi** — đường tiêu thụ thật (`resolvePipelineOverride` ở `monitor/business/tasks/create.ts`) sanitise tên trước khi đọc file. Tên có dấu tiếng Việt, ký tự lạ, hoặc dài quá 64 ký tự sẽ trỏ sang stem khác, không thấy file, và task âm thầm chạy pipeline mặc định. Quảng cáo những tên như vậy là mời caller chọn một profile không bao giờ được dùng.
- **Không mất profile do dashboard tạo** — dashboard luôn ghi tên đã qua sanitise; chỉ file thêm tay vào repo mới bị loại.
- **File ghi dở `<tên>.yaml.tmp` tự rụng** — lọc theo đuôi `.yaml`.
