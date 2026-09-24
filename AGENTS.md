# AGENTS.md

📌 Nguồn quy ước **hub** dùng chung cho mọi AI agent làm việc trong repo này.

- 📖 **Đọc file này trước**, rồi mở rule tương ứng với bước đang làm (bảng §3).
- 📐 **Rule chi tiết ở [`docs/agent-rules/`](docs/agent-rules/)** — mỗi file một category, dashboard quét qua `GET /api/rules` và gắn cho từng bước pipeline.
- 📚 **Tài liệu mô tả hệ thống ở [`docs/`](docs/)** — kiến trúc, domain event, i18n, quy ước UI.
- ⚖️ **Bất biến repo = checklist Review §4** (nhóm **Kiến trúc** + **Dữ liệu & An toàn**) — xung đột về bất biến hoặc coupling tối thiểu thì coi file này là đúng.

---

## 1. Dự án này là gì

`dev-team-dashboard` là SPA Vue 3 + Vite trực quan hoá runtime state của một **orchestrator agent chạy ngoài**. Repo này quan sát và cấu hình. Ngoại lệ duy nhất: pipeline bật tuỳ chọn **node điều phối** (`orchestrator.enabled`) thì dashboard tự điều phối task đó — xem `src/features/orchestrator/`.

- **State từng task** (`.dev-state/*.json`) — chỉ đọc.
- **Config + artifact markdown** (pipeline, custom agent, template, knowledge) — đọc/ghi được, ghi qua `PUT /api/artifact`.
- **Backend** — Hono trên 2 transport; feature gồm `api.ts` + `controller.ts` + `business/`, nền ở `src/backend/`.
- **Frontend** — `src/features/<mode>/` (components, scripts, styles, locales, schemas); nền `src/frontend/`.
- **Shared** — `src/shared/`: chỉ logic/type thuần dùng thật ở cả hai phía.
- **Data root** — `.dev-team-agent/`; standalone qua `ProjectRegistry` (`?project=<id>`).
- **Pipeline** — `DEFAULT_PIPELINE` ← `pipeline.yaml` ← `tasks/<id>/pipeline.yaml`. Key `orchestrator` (opt-in, mặc định tắt) merge cùng 3 tầng như `doc_reviewer`.
- **MCP** — `bun run mcp`, CRUD registry, không cần HTTP server.

---

## 2. Cấu trúc dự án — nhìn nhanh

```
agent-workflow/
├── src/     # backend/ (Node), frontend/ (browser), shared/ (cả hai), features/
├── mcp/
├── tests/   # unit (bun + vitest) · test-e2e/ — Playwright
└── docs/    # agent-rules/ · convention/ · template/ · architecture/ — xem docs/README.md
```

---

## 3. Rule theo bước pipeline

| Bước | Category | Rule |
|---|---|---|
| 🔍 Investigate · Design | `doc-writing` | [`doc-writing.md`](docs/agent-rules/doc-writing.md) — bố cục `investigate.md` / `design.md` · [`writing-guideline.md`](docs/agent-rules/writing-guideline.md) — trình bày markdown, tham chiếu tài liệu (category `coding`, đọc ở mọi bước viết tài liệu) |
| 🛠️ Implement | `coding` | [`coding-guideline.md`](docs/agent-rules/coding-guideline.md) · [`docs/convention/feature-architecture.md`](docs/convention/feature-architecture.md) · [`mode-registry-guideline.md`](docs/agent-rules/mode-registry-guideline.md) · [`ui-design-guideline.md`](docs/agent-rules/ui-design-guideline.md) · [`writing-guideline.md`](docs/agent-rules/writing-guideline.md) |
| 🔎 Review | `coding` + `test` | [`testing.md`](docs/agent-rules/testing.md) |
| 🧪 Test implement | `test` | [`testing.md`](docs/agent-rules/testing.md) — dòng branch test §3.1, mốc coverage + nợ test theo task §6 · [`git-pr.md`](docs/agent-rules/git-pr.md) §4.3 |
| 🚀 PR | `git-pr` | [`git-pr.md`](docs/agent-rules/git-pr.md) — đặt tên branch §4, dòng test §4.3, worktree §6, todo debt §7, PR phát hành §8 · publish tài liệu vào issue §11 (mọi bước có tài liệu đầu ra) |

Tra cứu (không phải rule): [`README.md`](README.md) quickstart · [`docs/architecture/`](docs/architecture/) kiến trúc C4 · [`docs/architecture/events/`](docs/architecture/events/README.md) domain event · [`docs/template/`](docs/template/) template agent / pipeline.

---

## 4. Checklist hoàn thành workflow

Template agent (`docs/template/agents/*`) chỉ có **bước cuối generic**: đọc mục này. Checklist nhóm theo giai đoạn pipeline (bảng §3).

### Mọi bước có tài liệu đầu ra

<details>
<summary><b>Publish tài liệu vào issue task</b></summary>

Quy ước: [`git-pr.md`](docs/agent-rules/git-pr.md) §11.

- [ ] **Publish ngay khi tài liệu của bước chốt** — `investigate.md` · `design.md` · `test-spec.md` · `review.md` · link whitebox, comment lên issue của task; bước `BLOCKED` thì chưa publish.
- [ ] **Bọc toàn bộ nội dung trong một thẻ `<details>`**, dòng đầu là marker `<!-- task-doc: <task-id>/<nhãn> -->`.
- [ ] **Tài liệu sửa lại → cập nhật đúng comment cũ** theo marker, không đăng comment mới.
- [ ] **Không có issue / publish lỗi** → ghi ở kết quả trả về, không chặn pipeline.

</details>

---

### Investigate

Khi survey call chain đụng persist / lifecycle / CRUD domain:

<details>
<summary><b>Emit & catalog event</b></summary>

- [ ] **Cân nhắc emit** — thêm/sửa/xoá `emit` / `emitEntity` (sau persist OK; payload tối thiểu, không secret).
- [ ] **Ghi kết luận** trong `investigate.md` (vd *Events: thêm … / sửa … / xoá … / không đổi — vì …*).
- [ ] **Cập nhật catalog nếu chốt đổi event** — file mode tương ứng trong [`docs/architecture/events/`](docs/architecture/events/README.md) (+ `DashboardEventType` nếu type mới/đổi tên) trong cùng thay đổi code, hoặc ghi nợ `docs/todo/`.

</details>

---

### Design

Chốt ngay trong `design.md` những gì Review sẽ kiểm — sai ở đây thì phải làm lại cả implement. Bố cục `design.md`: [`doc-writing.md`](docs/agent-rules/doc-writing.md) §3.

<details>
<summary><b>Vị trí code & ranh giới</b></summary>

- [ ] **Chốt feature sở hữu** — thay đổi nằm trong feature nào; có cần feature mới / mode mới ở FE shell không.
- [ ] **Chốt scope `backend` / `frontend` / `shared`** — chỉ logic dùng thật ở cả hai phía mới đưa vào `src/shared/`.
- [ ] **Route & schema** — route mới ở `api.ts` + `controller.ts` của feature nào; schema Zod đặt ở `features/<f>/schemas/`.
- [ ] **Dùng lại helper có sẵn** — nêu `*Utils` / `*Lib` / `fileHelper` sẽ dùng hoặc mở rộng, thay vì viết mới.

</details>

<details>
<summary><b>Dữ liệu & An toàn</b></summary>

- [ ] **Persist** — file/DB nào bị ghi; file quan trọng ghi atomic.
- [ ] **Input từ user** — path sanitize ở feature sở hữu; URL qua `fetchUrlSafe`.
- [ ] **Emit dự kiến** (hoặc *không emit*) — type, thời điểm (sau persist), payload không secret.

</details>

<details>
<summary><b>Test & tài liệu</b></summary>

- [ ] **Bề mặt test** — §5 Test Notes nêu hàm / route / hành vi công khai sẽ test, và suite nào trong [`tests/CATALOG.md`](tests/CATALOG.md) phủ vùng này (hoặc chưa có suite nào).
- [ ] **Rule / docs cần cập nhật** — file nào trong `docs/agent-rules/`, `docs/architecture/` sửa cùng thay đổi; hoãn thì ghi nợ `docs/todo/`.
- [ ] **UI text** — có key i18n mới không, thuộc namespace nào.

</details>

---

### Implement

<details>
<summary><b>Rule & tài liệu</b></summary>

- [ ] **Cập nhật rule** trong [`docs/agent-rules/`](docs/agent-rules/) ngay trong cùng thay đổi — rule lệch code là nợ, không phải chi tiết.
- [ ] **Cập nhật tài liệu cho người** nếu quy ước đó cũng mô tả hệ thống — [`docs/architecture/`](docs/architecture/) và các file liên quan trong `docs/`.
- [ ] **Cập nhật file này** nếu bảng §3 không còn đúng.

</details>

<details>
<summary><b>Thêm feature mới</b></summary>

Quy ước: [`docs/convention/feature-architecture.md`](docs/convention/feature-architecture.md). Nguyên tắc vị trí code & coupling: checklist Review › **Kiến trúc**.

- [ ] **Tạo `src/features/<name>/`** — `api.ts`, `controller.ts`, `business/`, và (tuỳ) `components`, `composables`, `scripts`, `styles/index.scss`, `locales/{vi,en}.ts`, `schemas/`.
- [ ] **Kế thừa abstract** — controller `extends AbstractController`; business `extends AbstractBusiness`.
- [ ] **Chạy `bun run typecheck` + `bun run build`** — khi đụng cả FE và Node.
- [ ] **Thêm mode ở FE shell** — theo checklist **Thêm mode mới ở FE shell** dưới đây.

</details>

<details>
<summary><b>Thêm mode mới ở FE shell</b></summary>

Quy ước 3 lớp / `ModeEntry` / `ShellContext`: [`docs/agent-rules/mode-registry-guideline.md`](docs/agent-rules/mode-registry-guideline.md).

- [ ] **Export đúng tên `registerMode(registry: ModeRegistry): void`** — glob ở `main.ts` gọi cố định `mod.registerMode(...)`.
- [ ] **`key` duy nhất** — trùng thì `registerMode()` throw lúc khởi động (fail-fast).
- [ ] **`order` duy nhất** — phù hợp vị trí mong muốn trong sidebar.
- [ ] **`labelKey` (+ `titleKey`) trỏ đúng key** — key đã có trong `plugins/i18n/locales/common/{vi,en}.ts` → `modes.*`.
- [ ] **`icon` khớp tên đã đăng ký** — trong `RailIcon.vue`.
- [ ] **Import `panel` trực tiếp** — ở top-level, không lazy-load.
- [ ] **`bindings(ctx)` chỉ lấy state đã có trong `ShellContext`** — cần state mới thì thêm đúng 1 dòng vào `shellContext`.
- [ ] **Ẩn/hiện động qua `visible(ctx)`** — không tự thêm `v-if` riêng trong `App.vue`.
- [ ] **Khai `descriptionKey` + `maturity`** (và `defaultEnabled: false` nếu mode chưa hoàn thiện) — group "Chế độ" trong Settings đọc thẳng từ đây.
- [ ] **Không tự đọc `settings.modes` trong feature** — quyết định hiển thị là việc của `canAccessMode` ở shell.
- [ ] **Không sửa `src/frontend/main.ts`** — thấy cần sửa nghĩa là đang làm sai convention.
- [ ] **Cập nhật `MODE_DEFS` trong `App.test.ts`** — để mode mới được cover trong cả 3 test lặp qua `MODE_DEFS`.
- [ ] **Giữ xanh trước khi PR** — `vue-tsc --noEmit`, `vitest run tests/src/App.test.ts`, và test riêng của feature.

</details>

<details>
<summary><b>Thêm/sửa text UI (i18n)</b></summary>

Quy ước: [`coding-guideline.md`](docs/agent-rules/coding-guideline.md) §6.

- [ ] **Xác định feature / namespace.**
- [ ] **Sửa `vi.ts`** — `src/features/<feature>/locales/vi.ts` (hoặc `plugins/i18n/locales/common/vi.ts`).
- [ ] **Đối ứng `en.ts` nếu có** (khuyến nghị) — thiếu thì runtime fallback `vi`.
- [ ] **Thay hardcode bằng `t(...)`.**

</details>

---

### Testing

Áp dụng cho **mọi** thay đổi code:

<details>
<summary><b>Chọn & chạy suite</b></summary>

- [ ] **Tra danh mục suite** [`tests/CATALOG.md`](tests/CATALOG.md) — xác định suite nào phủ vùng vừa sửa (có thể nhiều suite, khác runner). Sau khi `tests/` bị cắt khỏi dòng source thì file này không có ở đây: `bun run test:overlay` trước, hoặc xem [bản trên `test/main`](https://github.com/naut1402/agent-workflow/blob/test/main/tests/CATALOG.md).
- [ ] **Chạy đúng các suite đó** — `bun run test:scope` hoặc nối path thủ công. Full suite là việc của CI.
- [ ] **Vùng sửa chưa có suite nào** — viết test mới đặt theo layout (business/server → bun; FE → vitest). `test:scope` chọn ra 0 file **không** phải "đã xanh", nó là "chỗ này chưa ai test".
- [ ] **Thêm/đổi thư mục test** — khai vào `tests/runners.json` **và** sinh lại `bun run test:scope --catalog > tests/CATALOG.md` trong cùng thay đổi.
- [ ] **Test đụng filesystem / registry / agent / plugin** — chạy thêm một lượt với env đã tước (`HOME` rỗng, biến plugin trỏ path không tồn tại).
- [ ] **Test viết trên dòng branch riêng** — khi pipeline có bước `test-implementer` ([`testing.md`](docs/agent-rules/testing.md) §3.1). Đang ở dòng source thì `bun run test:overlay` trước khi chạy được suite nào.

</details>

<details>
<summary><b>Chiến lược tràn nội dung UI</b></summary>

Chạy trước khi báo hoàn thành 1 vùng UI có chiều cao phụ thuộc dữ liệu. Rule: [`ui-design-guideline.md`](docs/agent-rules/ui-design-guideline.md) §2.

- [ ] **Dữ liệu dài** (nhiều hơn số item thật hiện có) — cuộn được tới mục cuối cùng.
- [ ] **Dữ liệu rỗng** — empty state hiện đúng, khung không sụp về 0px.
- [ ] **Một thanh cuộn mỗi trục** — container ngoài không cuộn (`scrollHeight === clientHeight`).
- [ ] **Không tràn khung** — nội dung không tràn ra ngoài, không đè lên hàng nút / footer.
- [ ] **Viewport thấp** (thu cửa sổ còn ~500px chiều cao) — lặp lại các mục trên, kể cả khi mở nhiều section cùng lúc.

</details>

---

### Review

Dùng khi review PR đụng `src/features/*`, `src/backend/**`, `src/frontend/**`, `src/shared/**`, hoặc tái cấu trúc tương tự. Đánh dấu từng mục liên quan scope PR — không bắt buộc tick hết nếu PR không đụng vùng đó. Quy ước nền: [`docs/convention/feature-architecture.md`](docs/convention/feature-architecture.md), [`coding-guideline.md`](docs/agent-rules/coding-guideline.md), [`git-pr.md`](docs/agent-rules/git-pr.md).

<details>
<summary><b>Kiến trúc — vị trí code & coupling</b></summary>

- [ ] **Đặt đúng feature** — thay đổi domain nằm đúng feature; không vá logic domain vào feature khác hoặc vào `core`.
- [ ] **Kiểm soát route** — mới/sửa chỉ ở `features/<f>/api.ts` + `controller.ts`; controller không đọc/ghi filesystem phức tạp.
- [ ] **Đặt đúng schema domain** — ở `features/<f>/schemas/`; không nhét schema shell vào feature, không đẩy schema domain vào `src/frontend/configs`.
- [ ] **Chuẩn hoá UI string & FE API** — string qua i18n (`locales/`); gọi API qua `scripts/*Api.ts` + `apiGet` / `apiPost`.
- [ ] **Không wiring thủ công** — không thêm tay nếu glob/auto-load đã đủ (route / `apiServer` registry / styles / locales / `registerMode`).
- [ ] **Đặt style đúng tầng** — 1 component render selector gốc → `<style scoped>`; ≥2 cùng feature → `features/<f>/styles/`; xuyên feature → `src/frontend/styles/`. Không thêm file `styles/*.scss` chỉ-comment.
- [ ] **Danh sách dài không bị cắt cụt** — xem checklist **Chiến lược tràn nội dung UI** ở [Testing](#testing).
- [ ] **Tuân thủ mode-registry khi thêm/sửa mode** — đối chiếu checklist Implement › **Thêm mode mới ở FE shell**.
- [ ] **Gom module theo nghiệp vụ** — không tách file theo kiểu thao tác (`store` / `fetch` / `paths` / `scan` mỏng).
- [ ] **Không phụ thuộc Hono** — `business/` không import Hono, không phụ thuộc `c.req`.
- [ ] **Ranh giới `src/backend` ⟂ `src/frontend` ⟂ `src/shared` giữ nguyên** — lint chặn, không whitelist; chi tiết ở `src/{backend,frontend,shared}/README.md`.
- [ ] **ESM thuần, không import tĩnh `bun:*` trên đường nạp `vite.config.ts`** — [`coding-guideline.md`](docs/agent-rules/coding-guideline.md) §1.
- [ ] **Import peer qua index** — chỉ `business/index.ts` import cây `business` của feature khác.
- [ ] **Cập nhật surface chia sẻ** — thêm gì mới đều cập nhật `business/index.ts`; tránh cycle barrel↔barrel.
- [ ] **Gắn sanitize vào feature sở hữu** — export qua index khi chia sẻ, không đưa lên "sanitize chung" ở core.
- [ ] **Ưu tiên dùng lại helper** — `*Utils` / `*Lib` / `fileHelper` thay vì copy-paste; tên helper mới không mơ hồ (`helpers.ts`, `utils.ts`).
- [ ] **Không import `node:fs` / `node:path` trực tiếp trong business** — module dùng chung FE+BE không top-level `node:*`.
- [ ] **Kiểm kỹ khi đổi chữ ký `fileHelper`** — chạy typecheck và đối chiếu call site.
- [ ] **Phụ thuộc một chiều** — không `core` → `features`; không vòng import.
- [ ] **Validate ở biên** — Zod `safeParse`; ưu tiên `z.infer` thay vì `interface` tay song song schema.
- [ ] **Tránh boolean `ok` dễ gãy** — narrow bằng `'error' in v` hoặc discriminant string.

</details>

<details>
<summary><b>Dữ liệu & An toàn — I/O, persist, event</b></summary>

- [ ] **Đọc FS phòng thủ** — `safeReadDir` / `statSafe` / `readYamlSafe`; lỗi file không làm sập request.
- [ ] **Chống traversal** — input path từ user đã sanitize / `resolvePathUnder`.
- [ ] **Ghi atomic** — file quan trọng ghi qua temp + rename (registry, runners, settings).
- [ ] **Fetch qua wrapper an toàn** — URL người dùng qua `fetchUrlSafe` (https, chặn private host).
- [ ] **Pattern scan tuỳ chỉnh không escape project root** — `settings.scanPatterns` lọc 3 lớp: `sanitiseScanPattern` → `expandScanPatterns` (bỏ qua symlink) → `resolvePathUnder(projectRoot, …)` cho mỗi match.
- [ ] **Biến môi trường tuỳ chọn/bắt buộc đúng chỗ** — `ANTHROPIC_API_KEY` tuỳ chọn, `DASHBOARD_SECRET_KEY` bắt buộc cho vault; hành vi khi thiếu ở [`README.md`](README.md) › Biến môi trường.
- [ ] **Emit & catalog event khớp code** — `emit` / `emitEntity` sau persist, payload không secret; file mode trong [`docs/architecture/events/`](docs/architecture/events/README.md) và `DashboardEventType` đổi theo, hoặc nợ `docs/todo/` có lý do.

</details>

<details>
<summary><b>Quy trình & Tài liệu</b></summary>

- [ ] **Xác định bề mặt cần phủ** — mỗi vùng đổi có hàm/route/hành vi công khai test được. Không có bề mặt nào test được là vấn đề của **code**, không phải của test.
- [ ] **PR dòng source: test KHÔNG nằm trong diff** — test đi ở PR dòng test ([`git-pr.md`](docs/agent-rules/git-pr.md) §4.3). Thấy file `tests/`·`test-e2e/` trong diff PR code → yêu cầu chuyển sang PR dòng test.
- [ ] **PR dòng test: chọn đúng runner** — domain/fs → **bun test**; FE/component → vitest; khai báo path theo checklist [Testing](#testing).
- [ ] **PR dòng test: nêu cặp ref đã overlay** (source ref + SHA) — không có nó thì "test lệch pha với source" không truy được.
- [ ] **Giữ build xanh** — PR đụng helper FE+BE hoặc `fileHelper` → typecheck/build xanh cả local và CI.
- [ ] **Tuân thủ commitlint** — commit/PR title đúng `type(scope): subject`, không trailer công cụ.
- [ ] **Trình bày đúng nội dung PR** — phần riêng nhóm theo cây thư mục; fix/refactor có Logic trước → sau; phần chung nêu Core và/hoặc feature khác (hoặc *Không*).

</details>

---

### PR

<details>
<summary><b>Tự kiểm trước khi push</b></summary>

Quy ước: [`git-pr.md`](docs/agent-rules/git-pr.md) §1.

- [ ] **`git status`** — chỉ còn file đúng phạm vi PR.
- [ ] **`git diff --staged`** — không generated / export / lockfile lạ / file ngoài phạm vi.
- [ ] **Rename / migrate** — không còn bản cũ trùng.
- [ ] **File mới cần bỏ qua** — cập nhật `.gitignore` trước khi commit.
- [ ] **Không `git push` lại branch đã merged** — origin có thể đã xoá → tạo branch rác. Luôn tạo branch mới từ base mới nhất: `origin/main`, hoặc `origin/dev/x.y.z/main` nếu task gắn version release.

</details>

<details>
<summary><b>Todo debt</b></summary>

Bối cảnh đầy đủ: [`git-pr.md`](docs/agent-rules/git-pr.md) §7.

- [ ] **Hoãn docs/convention** — đã có `docs/todo/<issue>/<task-id>.md`.
- [ ] **PR feature → `dev/x.y.z/main`** — được mang nợ; Todo debt **không** chặn.
- [ ] **PR `dev/x.y.z/main` → `main`** — **không còn** thư mục `docs/todo/`; `bun run check:todo` xanh.
- [ ] **Đã trả nợ** — đã xoá toàn bộ `docs/todo/`.
- [ ] **Nợ test** — không ghi vào `docs/todo/`; dòng `test/x.y.z/main` phải tồn tại và xanh trước khi promote.

</details>
