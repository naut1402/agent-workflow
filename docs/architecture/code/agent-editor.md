# Agent Editor — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho feature `src/features/agent-editor/`. Chỉ ghi phần không tự giải thích được qua tên file. Khi sửa, đối chiếu lại với code thật.

---

## 1. Import peer từ `pipeline-editor`

- **`agents.ts` import sâu `pipeline-editor/business/pipeline/index.js`** — giống barrel `business/index.ts` của feature này: đi qua barrel `pipeline-editor/business/index.js` sẽ thành vòng, vì barrel đó re-export lại chính `agent-editor`.

## 2. `listPipelineProfileNames` chỉ trả tên canonical

- **Lọc theo `sanitiseProfileName`** — đường tiêu thụ (`resolvePipelineOverride`) sanitise tên trước khi đọc file; tên có dấu, ký tự lạ hoặc dài quá 64 sẽ trỏ sang stem khác, không thấy file, và task âm thầm chạy pipeline mặc định. Profile do dashboard tạo luôn qua sanitise; chỉ file thêm tay mới bị loại.

## 3. Khoá của `useKeyedApiAction`

- **So bằng `===`, không dựa truthiness** — `AgentSectionEditor.vue` giữ key section đang lưu (có thể là `''`), `WorkflowSectionEditor.vue` giữ `String(index)` (hàng đầu là index `0`); rảnh là `null`.
