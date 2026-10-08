# Todo — T6fabee9b

- **Issue / epic:** adhoc (task nội bộ — `issue_url: null`)
- **Loại nợ:** feature — theo phân loại của design §6 (D6 là `feature`; ba mục còn lại là `refactor`, ghi loại nặng nhất ở header)
- **Branch / PR tạo nợ:** `dev/1.2.0/T6fabee9b_fix-job-chay-sai-runner`
- **Ngày tạo:** 2026-10-07

### Vì sao hoãn

Task này sửa bug *"job của step chạy sai runner sau khi thêm runner mới"* theo
phương án B của [`design.md`](../../../.dev-team-agent/tasks/T6fabee9b/design.md)
§3: chặn ghi đè im lặng (409), bỏ fallback im lặng của `getDefaultRunner()`, ghi
runner thực chạy lên job record, gom luật chọn default về một nguồn sự thật.

Bốn việc dưới đây **cùng chủ đề nhưng không phải nguyên nhân của bug** — làm
trong lượt này sẽ kéo PR vượt xa phạm vi một bug fix, hoặc kéo theo migration
dữ liệu người dùng. Ba trong bốn việc đã được lượt này làm cho **nhìn thấy
được** (qua `defaultRunnerIssue` trên UI) thay vì sửa hành vi.

1. **D6 — `askAgent` của node điều phối không pin được runner.** Nó luôn chạy
   runner mặc định; pipeline không có chỗ khai runner cho node này. Sửa đúng
   cần thêm field vào schema pipeline + UI + một vòng test.
2. **Phương án C — id runner/connection dùng UUID.** Hiện id suy từ
   `slugify(tên)` nên trùng tên = trùng id; 409 chỉ *chặn* va chạm chứ không
   *diệt* nó. Đổi sang UUID là cách triệt để duy nhất, nhưng kéo theo migration
   `runners.json` + `connections.json` + mọi `steps[].runner_id` đã pin trong
   `tasks/*/pipeline.yaml` của mọi máy.
3. **`loadRunners()` tự suy `defaultRunnerId = runners[0]?.id`** khi file thiếu
   hoặc trỏ runner đã mất (`registry.ts`). Không nằm trên đường gây bug (runner
   mới luôn `push` vào **cuối** mảng nên `runners[0]` không thể là runner vừa
   thêm), và đổi nó sẽ làm store cũ — chưa từng ghi `defaultRunnerId` — mất
   default. Lượt này chỉ phơi bày qua `defaultRunnerIssue`.
4. **G6 — `providerFamilyOf` phân loại provider theo hậu tố chuỗi**, nên một
   `providerId` lạ mặc định rơi vào `console-command`. Sửa phân loại provider là
   thay đổi riêng, rủi ro chạm mọi provider. Lượt này làm hệ quả của nó nhìn
   thấy được: runner mặc định như vậy nhận `reason: 'not-ai'` và hiện banner,
   thay vì im lặng rơi sang runner khác.

### Việc cần làm khi đối ứng

- [ ] **D6** — thêm chỗ pin runner cho node điều phối: field trong schema
      pipeline, UI chọn runner, và truyền `runnerId` xuống `askAgent`.
- [ ] **Phương án C** — đổi id runner/connection sang UUID, tên chỉ còn là nhãn:
  - [ ] Migration `runners.json` (`version: 2` → `3`) + `connections.json`.
  - [ ] Map lại mọi `steps[].runner_id` đã pin trong `tasks/*/pipeline.yaml`.
  - [ ] Bỏ guard 409 của lượt này nếu UUID làm nó thừa (va chạm id hết khả dĩ).
- [ ] **`loadRunners()` tự suy default** — quyết định: giữ nguyên (và nói rõ
      trong tài liệu rằng `defaultRunnerId` có thể là giá trị suy ra), hay bỏ
      hẳn và chấp nhận store cũ phải chọn lại default một lần.
- [ ] **G6** — phân loại provider theo catalog (`PROVIDER_CATALOG.family`) thay
      vì theo hậu tố chuỗi của `providerId`; rà lại mọi call site của
      `providerFamilyOf`.
- [ ] Xoá **cả thư mục** `docs/todo/` khi không còn file nợ nào
