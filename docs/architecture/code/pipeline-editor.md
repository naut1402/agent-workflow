# Pipeline Editor — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho feature `src/features/pipeline-editor/`. Chỉ ghi phần không tự giải thích được qua tên file. Khi sửa, đối chiếu lại với code thật.

---

## 1. Canvas Vue Flow: thứ tự và định danh node

- **Node vào store trước edge** — `buildFlowFromPipeline` (`components/PipelineEditor.vue`) gọi `setStepNodes` rồi mới `setEdges`: `setEdges` bỏ edge có source/target chưa nằm trong store.
- **Mọi `setNodes` mang theo node phái sinh** — Vue Flow cấp object mới cho id vắng mặt ở lần `setNodes` trước, nhưng component `art-*` không remount nên vẫn render object cũ đã rời store (node đứng ngoài khung `fitView`). `setStepNodes` giữ lại `derivedNodesOf(...)`; `autoLayout` đổi toạ độ tại chỗ bằng `updateNode`.
- **Không dựng lại graph giữa lúc kéo** — `setNodes` giữa drag làm node giật: `syncDerivedGraph` chỉ chạy ở `@node-drag-stop`, còn `onCanvasRemoval` chỉ phản ứng với change `remove` (`hasRemovalChange`, `lib/canvasGraph.ts`). `OrchestratorNode.vue` tự đặt `pointer-events: auto` vì Vue Flow gán `pointer-events: none` cho div cha của node không selectable/draggable.

## 2. Node phái sinh không bao giờ thành step

- **YAML chỉ dựng từ `stepGraph()`** — node artifact/knowledge, node điều phối và hub edge chỉ để nhìn. Mọi phép tính ra YAML hoặc thứ tự chạy (`buildFullPipeline`, `topoSort`, `hasFanOut`) lọc qua `stepNodesOf` / `stepEdgesOf` (`lib/canvasGraph.ts`), nếu không file lưu ra mọc step rác `art-*` / `__orchestrator__`. Node điều phối nằm ngoài nhờ type `orchestrator` (không phải `pipelineEditor`); hub edge bị loại vì đầu nguồn không phải step.
- **Step edge bị ẩn, không bị bỏ, khi bật node điều phối** — `buildEditorGraph` đặt `hidden: hubEnabled` thay vì loại edge khỏi mảng trả về, để `getEdges` (nguồn của `stepGraph()`) vẫn đủ khi tắt lại.
- **Xoá node có hai đường** — nút ✕ (`deleteNode`) và phím `Backspace` (Vue Flow tự gọi `removeNodes` / `removeEdges`). Dọn dẹp chỉ nằm ở `onCanvasRemoval` gắn vào `onNodesChange` / `onEdgesChange`; thiếu nó thì node artifact của step vừa xoá ở lại canvas mồ côi. Node điều phối được `syncDerivedGraph` dựng lại từ meta chừng nào checkbox còn tick.

## 3. Nạp pipeline lên canvas

- **Một đường nạp duy nhất** — `applyLoadedPipeline` giữ meta (`version` / `defaults` / `doc_reviewer` / `orchestrator`) và field lạ của step (`lib/pipelineRoundTrip.ts`); nạp bằng đường khác thì profile lưu ra không mở lại đúng.
- **Quay lại tab Profile nạp lại profile đang chọn**, không nạp pipeline global — nếu không, canvas và select nói về hai đối tượng khác nhau và Save ghi đè profile bằng nội dung global. Đổi project thì bỏ lựa chọn cũ.
- **`setSelectionSilently`** — đổi giá trị select mà không kích hoạt watcher auto-load (khi huỷ confirm, sau khi Save). Cờ `suppressAutoLoad` trả lại ở microtask sau vì watcher của Vue chạy sau microtask.

## 4. Pin runner của step

- **Ẩn control không xoá pin** — `StepConfigDialog.vue` ẩn chọn model khi ≤ 1 runner, nhưng `draft.runner_id` vẫn đi qua `buildStepUpdateFromDraft`.
- **`StepConfigUpdate.runner_id` luôn có mặt, kể cả `''`** — `applyStepUpdate` merge `{ ...n.data, ...updatedData }`, thiếu key thì gỡ pin không xoá được giá trị cũ trên node.
- **`buildStepFromNode` chỉ ghi `runner_id` khác rỗng** — `runner_id` nằm trong `CANVAS_STEP_KEYS` nên không đi đường preserved; gỡ pin phải làm key biến mất khỏi YAML, spread vô điều kiện làm mọi step mọc `runner_id: ''`.

## 5. Chặn tương tác khi preview / xem tài liệu

- **Unmount Vue Flow khi xem markdown** — `v-if` / `v-else` thật ở slot `#main`, không ẩn bằng CSS: hook của Vue Flow vẫn bắt phím ngầm phía sau.
- **Dialog teleport chặn bằng logic** — `openConfig` / `openOrchestratorConfig` tự return khi đang preview hoặc xem tài liệu: dialog teleport ra `<body>` nên rule `.preview-active …` không chạm tới.
- **Cụm action không bị khoá** — `styles/common.scss` chỉ làm mờ `.catalog-panel` / `.rules-panel`; cụm action của `EditorTargetPanel` chứa nút Stop.

## 6. Sub-sidebar: `<select>` native và `::details-content`

- **`CatalogPanel` / `RulesPanel` giữ `<select>` native** — popup của nó vẽ ở tầng OS nên không bị ancestor `overflow: hidden` của mục/cột cắt. Đây là ngoại lệ có chủ ý của quy ước dropdown ở [`coding-guideline.md`](../../agent-rules/coding-guideline.md) §5.
- **`CollapsibleSection.vue` khai `.editor-section[open]::details-content`** — Chrome ≥ 131 chèn hộp này giữa `<details>` và nội dung, làm đứt chuỗi flex nên vùng cuộn ở lá mất chiều cao xác định. Trình duyệt chưa hỗ trợ pseudo này bỏ qua rule.

## 7. Validate pipeline trước khi ghi (`controller.ts`)

- **Chạy ở cả hai đường ghi** — `validatePipelinePayload` được gọi từ `writePipelineConfig` lẫn `createPipelineProfile`; chặn một đường thì đường kia vẫn lưu được nội dung độc hại.
- **Id bị gọt là bị từ chối, không lưu bản đã gọt** — mọi đoạn của `orchestrator.agent` (`<source>:<name>`, source có thể nhiều đoạn như `repo:dev-agent-teams`) so bằng với `sanitiseAgentName`, vì đoạn nào cũng có thể thành thành phần path khi resolve agent. `steps[].runner_id` so bằng với `sanitiseRunnerId` vì nó là khoá tra registry lúc execute; không kiểm runner có tồn tại — profile chia sẻ giữa các máy, ca đó do `resolveStepRunnerId` lo.
- **Step id bắt đầu bằng `__` bị từ chối** — `__orchestrator__` là id dành riêng cho node điều phối; trùng vào thì session ledger và chat surface lẫn hai thứ.

## 8. Đọc / ghi `pipeline.yaml`

- **Không đọc được ≠ không có** — `loadPipelineConfig` (`business/pipeline/index.ts`) đặt `untrusted = true` khi `pipeline.yaml` global hoặc của task không đọc được, thay vì im lặng rơi về global/builtin; caller (`resolveHitlPending`) giữ nguyên gate thay vì tưởng gate đã bị gỡ.
- **Ghi atomic** — `writePipelineConfig` ghi qua `writeTextFileAtomicSync`: một lượt đọc rơi vào giữa lúc ghi sẽ thấy file cụt, rơi về global/builtin, và reconcile có thể gỡ nhầm gate hợp lệ.
- **Đồng bộ gate/orchestrator bằng `import()` động** — barrel `monitor` kéo theo runner (`node:child_process`), barrel `orchestrator` khởi động vòng lặp lúc module-eval. Lỗi ở bước này chỉ `console.warn`, không làm hỏng lượt ghi YAML đã xong.

## 9. Catalog và rule

- **Nguồn pattern đứng sau nguồn quy ước** — `buildCatalog` đẩy batch `scanPatterns` sau cùng: cùng priority thì `dedupeCatalogItems` giữ item gặp trước. `resolveCatalogAgentPath` / `resolveCatalogSkillPath` cũng thử đường `.claude/...` trước pattern, nếu không entry chỉ có ở pattern không bao giờ resolve.
- **Tên agent: scan quy ước dùng tên file, nhánh pattern ưu tiên frontmatter** — `readAgentFile` (`business/catalog/scan.ts`) nhận `opts.name` để id `project:<name>` của scan quy ước không đổi; `preferFrontmatterName` chỉ dành cho file khớp pattern, nơi tên file tuỳ ý.
- **Path đọc nội dung đều qua whitelist** — `resolveRuleContentPath` chỉ nhận path nằm dưới nguồn mà `buildRules` thật sự liệt kê (`resolvePathUnder` chặn `..` nhưng không chặn một `.md` bất kỳ dưới project). `resolveCatalogSkillPath` từ chối `name` chưa sanitize; fallback `plugins/<plugin>/skills` ở `getSkillContent` sanitize cả `pluginName` (nếu không `id=repo:../../..:x` thoát khỏi `plugins/`) rồi kiểm thêm bằng `path.resolve` + `startsWith`.

## 10. Scan pattern tuỳ chỉnh (`business/scanPatterns.ts`)

- **Gộp `*` liên tiếp trước khi dựng regex** — `segmentToRegExp` thay `**…` trong một segment bằng `*`: `[^/]*[^/]*` backtrack theo hàm mũ trên tên không khớp, một segment nhiều sao treo luồng Node nhiều phút trong một lần `RegExp.test`, nơi budget của walker không với tới.
- **Không theo symlink, không nhận `..`** — `walkSegment` / `walkDoubleStar` bỏ qua symlink (có thể trỏ ra ngoài project root hoặc tạo vòng); `expandScanPatterns` bỏ pattern chứa `..` độc lập với schema settings; `push` còn chặn lần cuối bằng `resolvePathUnder`. Wildcard không khớp tên bắt đầu bằng `.`.
- **Budget áp ở nơi làm việc thật** — trần của `expandScanPatterns` chỉ giới hạn việc *tìm* thư mục khớp, mà `**` có thể trả về chính `projectRoot`. `walkRuleFilesBounded` (`business/rules/index.ts`) vì vậy áp lại `DENY_DIRS` + budget khi đọc bên trong, và cả lô pattern dùng chung một budget, không phải mỗi pattern một budget mới.

## 11. Barrel `business/index.ts`

- **`fallow-ignore-next-line unused-export` là có chủ ý** — fallow không lần được consumer qua `export *` của barrel nên báo mọi named re-export ở đây là dead (cả `sanitiseProfileName` mà `controller.ts` dùng). Đó là dương tính giả, không xoá export theo báo cáo này.
