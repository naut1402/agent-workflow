# Todo — T4b5d7d6f

- **Issue / epic:** adhoc (task nội bộ — `issue_url: null`)
- **Loại nợ:** other
- **Branch / PR tạo nợ:** `dev/1.2.0/T4b5d7d6f_loading-overlay-chan-thao-tac`
- **Ngày tạo:** 2026-10-01

### Vì sao hoãn

PR này migrate **19 cờ** theo bảng `design.md` §4.1. Phần còn lại là **18 cờ,
gồm ~9 cờ ĐỌC và 9 cờ GHI** — 🚫 **không** phải "toàn bộ phần còn lại là luồng
đọc" như bản đầu của file này ghi nhầm.

- **~9 cờ ĐỌC** (list-load / load-on-open, đang hiện chữ "Đang tải…") — hoãn có
  chủ ý, xem ba lý do dưới.
- **9 cờ GHI** nằm ở ba file mà bảng design §4.1 không liệt kê, nên chúng rơi ra
  ngoài phạm vi lượt này. Đây **không** phải lệch so với design, nhưng là nợ
  thật: cả 9 đều bọc quanh một lời gọi ghi, đều **không** có guard chống bấm lặp
  và **không** có overlay. Danh sách đầy đủ ở mục đối ứng bên dưới.

Hoãn phần ĐỌC vì ba lý do, không phải vì quên:

1. **Bấm lặp trên luồng đọc gần như vô hại** — gọi lại một `GET` chỉ tốn một
   request, không sinh bản ghi trùng như luồng ghi.
2. **Quy mô review** — migrate cả 37 cờ làm PR chạm gần như mọi feature; tách
   làm hai lượt để lượt đầu còn đọc được.
3. **Khác hình dạng** — cờ đọc thường bật lúc `onMounted` chứ không do người
   dùng bấm, nên nó cần một *skeleton/placeholder*, không cần *overlay chặn
   thao tác*. Áp thẳng `CLoadingOverlay` vào là sai ngữ nghĩa.

### Việc cần làm khi đối ứng

- [ ] **9 cờ GHI còn sót — ưu tiên cao nhất, làm trước phần đọc.** Cùng hình
      dạng A của `design.md` §4.2.5, migrate thẳng sang `useApiAction` +
      `CLoadingOverlay`:
  - [ ] `PipelineView.vue:311` `hitlBusy` → `patchTaskState` (`:763`) —
        approve/reject HITL. **Bấm lặp là gửi hai quyết định HITL.** Làm đầu tiên.
  - [ ] `PipelineView.vue:633` `resetBusy` → `resetPipelineStep` (`:693`) —
        thao tác **phá huỷ** (xoá artifact theo scope). Làm thứ hai.
  - [ ] `SettingsDialog.vue:202` `modesBusy` → `saveModesConfig` (`:241`)
  - [ ] `SettingsDialog.vue:273` `loggingBusy` → `saveLoggingConfig` (`:298`)
  - [ ] `SettingsDialog.vue:371` `recoveryBusy` → `saveRecoveryConfig` (`:392`)
  - [ ] `SettingsDialog.vue:418` `autoscanBusy` → `saveAutoscanConfig` (`:439`, `:488`)
  - [ ] `SettingsDialog.vue:516` `scanPatternsBusy` → `saveScanPatternsConfig` (`:542`)
  - [ ] `SettingsDialog.vue:583` `githubTokensBusy` → `saveGithubTokensConfig` (`:608`)
  - [ ] `KnowledgeUploadDialog.vue:15` `uploading` → `uploadKnowledgeFile` (`:26`)
- [ ] Quyết định primitive cho luồng đọc (skeleton / placeholder) — **không**
      mặc định dùng lại `CLoadingOverlay`, nó được thiết kế để *chặn* thao tác.
- [ ] Migrate các cờ đọc đã khảo sát, gồm: `KnowledgePanel.loading`,
      `useArtifactProposal.loading`, `ConnectionDialog.loadingModels`,
      `AgentFormDialog.loading`, `useQuickActionCatalog.loading`,
      `RunnerDialog.loadingTemplate` và các cờ đọc còn lại (tổng 18).
- [ ] `useInlineMarkdownEdit.saving` (`src/features/monitor/composables/`):
      đây là cờ **ghi** nhưng cố ý để ngoài lượt này — composable còn
      `saveIndicatorTimer` + `savedSection` cho hiệu ứng flash "đã lưu", thay
      `saving` phải xét lại cả cơ chế flash. Ràng buộc: giữ nguyên hành vi flash.
- [ ] Cân nhắc `AbortController` (huỷ request thật). Lượt này **không** làm:
      `ApiRequestOptions` chưa có `signal`, thêm vào là đổi API dùng chung của
      132 call site. "Huỷ" trong PR này chỉ có nghĩa là người dùng rời khỏi
      vùng đang bận — `finally` của `run` đã phủ ca đó.
- [ ] **Xác minh F1 bằng trình duyệt thật** — lượt sửa F1 (overlay neo vào
      `.c-loading-host` thay vì vào chính hộp cuộn) **chưa** chạy được trên
      Chromium: máy build thiếu `libglib-2.0.so.0` và không có quyền root để
      cài. Repro tối giản: `/tmp/overlay-probe.html` — cuộn `#body` xuống đáy
      rồi so `getBoundingClientRect()` của overlay với của hộp cuộn; overlay
      phải vẫn phủ đúng khung nhìn. `tests/` đã giữ một assertion **cấu trúc**
      chạy trong jsdom nhưng nó không thay được phép đo bằng layout thật.
- [ ] Chạy các ca kiểm thủ công/e2e mà jsdom không phủ được (overlay thật sự
      chặn con trỏ; `position: relative` của container; scrim đảo theo theme;
      `prefers-reduced-motion`) — xem `test-spec.md` §5.
- [ ] Xoá **cả thư mục** `docs/todo/` khi không còn file nợ nào
