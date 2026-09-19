# AGENTS.md

📌 Nguồn quy ước **hub** dùng chung cho mọi AI agent làm việc trong repo này.

- 📖 **Đọc file này trước**, rồi mở rule tương ứng với bước đang làm (bảng §3).
- 📐 **Rule chi tiết ở [`docs/agent-rules/`](docs/agent-rules/)** — mỗi file một category, dashboard quét qua `GET /api/rules` và gắn cho từng bước pipeline.
- 📚 **Tài liệu mô tả hệ thống ở [`docs/`](docs/)** — kiến trúc, domain event, i18n, quy ước UI.
- ⚖️ **Xung đột về bất biến hoặc coupling tối thiểu** → coi file này là đúng.

---

## 1. Dự án này là gì

`dev-team-dashboard` là SPA Vue 3 + Vite trực quan hoá runtime state của một **orchestrator agent chạy ngoài**. Repo này quan sát và cấu hình. Ngoại lệ duy nhất: pipeline bật tuỳ chọn **node điều phối** (`orchestrator.enabled`) thì dashboard tự điều phối task đó — xem `src/features/orchestrator/`.

- **State từng task** (`.dev-state/*.json`) — chỉ đọc.
- **Config + artifact markdown** (pipeline, custom agent, template, knowledge) — đọc/ghi được, ghi qua `PUT /api/artifact`.
- **Backend** — Hono trên 2 transport. Feature: `api.ts` + `controller.ts` + `business/`. Setup app-root ở `src/backend/`; kernel HTTP ở `src/backend/http/`; registry ở `src/backend/registry.ts`. Entry: `src/backend/standalone.ts`.
- **Frontend** — `src/features/<mode>/` (components, scripts, styles, locales, schemas); nền `src/frontend/`.
- **Shared** — `src/shared/`: chỉ logic/type thuần dùng thật ở cả hai phía; cấm `node:*`/`bun:*`/`hono`/`drizzle-orm`/`vue` (ESLint, không whitelist). Xem `src/{backend,frontend,shared}/README.md`.
- **Data root** — `.dev-team-agent/`; standalone qua `ProjectRegistry` (`?project=<id>`).
- **Pipeline** — `DEFAULT_PIPELINE` ← `pipeline.yaml` ← `tasks/<id>/pipeline.yaml`. Key `orchestrator` (opt-in, mặc định tắt) merge cùng 3 tầng như `doc_reviewer`.
- **MCP** — `bun run mcp`, CRUD registry, không cần HTTP server.

Chi tiết: [`docs/architecture/`](docs/architecture/) (mô hình C4, 4 cấp — xem bảng §3).

---

## 2. Cấu trúc dự án — nhìn nhanh

```
agent-workflow/
├── src/          # backend/ (Node), frontend/ (browser), shared/ (cả hai), features/
├── mcp/
├── tests/        # unit (bun + vitest)
├── test-e2e/
└── docs/
    ├── agent-rules/   # rule cho mọi AI agent, theo category
    ├── convention/    # quy ước (nguyên tắc), theo chủ đề — không tham chiếu checklist
    ├── template/      # agent + pipeline mẫu
    └── architecture/{1-context,2-container,3-component,4-code}/  # 4-code/ kèm events/, i18n.md, ui-buttons.md, ui-overflow.md (chi tiết implementation)
```

⚠️ Ngoại lệ cố ý còn `.js`: `src/features/agent-editor/business/agentMarkdown.js`, `src/backend/runner-cli.mjs`. Tooling `vite` / `vitest` / `playwright` dùng `.ts`; `eslint.config.js` giữ `.js`.

---

## 3. Rule theo bước pipeline

| Bước | Category | Rule |
|---|---|---|
| 🔍 Investigate · Design | `doc-writing` | [`doc-writing.md`](docs/agent-rules/doc-writing.md) — bố cục `investigate.md` / `design.md`, quy tắc trình bày |
| 🛠️ Implement | `coding` | [`docs/convention/coding.md`](docs/convention/coding.md) · [`docs/convention/feature-architecture.md`](docs/convention/feature-architecture.md) · [`mode-registry-guideline.md`](docs/agent-rules/mode-registry-guideline.md) |
| 🔎 Review | `coding` + `test` | [`testing.md`](docs/agent-rules/testing.md) — checklist review ở §6 dưới |
| 🧪 Test implement | `test` | [`testing.md`](docs/agent-rules/testing.md) — dòng branch test §3.1, mốc coverage + nợ test theo task §6 · [`git-pr.md`](docs/agent-rules/git-pr.md) §4.3 |
| 🚀 PR | `git-pr` | [`git-pr.md`](docs/agent-rules/git-pr.md) — đặt tên branch §4, dòng test §4.3, PR phát hành §8 · [`git-worktree.md`](docs/agent-rules/git-worktree.md) · [`pr-todo-debt.md`](docs/agent-rules/pr-todo-debt.md) · checklist PR ở §6 dưới |

Tài liệu tra cứu kèm theo (không phải rule):

| Chủ đề | Tài liệu |
|--------|----------|
| Quickstart | [`README.md`](README.md) |
| Kiến trúc (C4, 4 cấp: Context → Container → Component → Code) | [`docs/architecture/`](docs/architecture/) |
| Mục lục domain event theo mode | [`docs/architecture/4-code/events/`](docs/architecture/4-code/events/README.md) |
| Sơ đồ bootstrap DI / ModeRegistry | [`docs/architecture/3-component/ioc-bootstrap-runtime.md`](docs/architecture/3-component/ioc-bootstrap-runtime.md) |
| Quy ước i18n | [`docs/convention/i18n.md`](docs/convention/i18n.md) — chi tiết [`docs/architecture/4-code/i18n.md`](docs/architecture/4-code/i18n.md) |
| Quy ước UI button | [`docs/convention/ui-buttons.md`](docs/convention/ui-buttons.md) — chi tiết [`docs/architecture/4-code/ui-buttons.md`](docs/architecture/4-code/ui-buttons.md) |
| Quy ước tràn nội dung UI | [`docs/convention/ui-overflow.md`](docs/convention/ui-overflow.md) |
| Template agent / pipeline | [`docs/template/`](docs/template/) |

---

## 4. Bất biến bắt buộc giữ

🚫 Nội dung đầy đủ: [`docs/architecture/4-code/README.md` — Bất biến kiến trúc](docs/architecture/4-code/README.md#bất-biến-kiến-trúc) — đọc trước khi thêm scan/endpoint mới.

Danh mục: đọc filesystem phòng thủ · chống path-traversal (sanitize tại feature sở hữu) · ghi registry atomic · `fetchUrlSafe` cho URL người dùng · ESM thuần · `ANTHROPIC_API_KEY` tuỳ chọn · `DASHBOARD_SECRET_KEY` bắt buộc cho vault.

---

## 5. Con trỏ nhanh theo loại task

| Task | Đọc thêm |
|------|----------|
| Viết/sửa code feature | [`docs/convention/feature-architecture.md`](docs/convention/feature-architecture.md) + [`docs/convention/coding.md`](docs/convention/coding.md) + bất biến §4 |
| Thêm mode mới ở FE shell (`App.vue`) | [`mode-registry-guideline.md`](docs/agent-rules/mode-registry-guideline.md) — checklist ở §6 dưới |
| Review PR | Checklist Review ở §6 dưới — mục **Dữ liệu & An toàn** có domain event khi đụng persist |
| Test / CI | [`testing.md`](docs/agent-rules/testing.md) — dòng branch test + `test:overlay` §3.1; mốc coverage + nợ test theo task §6 |
| Commit / PR / docs | [`docs/convention/git-commits.md`](docs/convention/git-commits.md) khi PR nhiều xử lý; [`git-pr.md`](docs/agent-rules/git-pr.md) — branch task gắn version §4.2; **dòng test §4.3**; PR phát hành §8 |
| Hoãn docs/test (hotfix, POC) | [`pr-todo-debt.md`](docs/agent-rules/pr-todo-debt.md) — gate CI chỉ khi PR `dev/x.y.z/main` → `main` |
| Agent chạy song song | [`git-worktree.md`](docs/agent-rules/git-worktree.md) |
| Viết `investigate.md` / `design.md` | [`doc-writing.md`](docs/agent-rules/doc-writing.md) |

---

## 6. Checklist hoàn thành workflow

Template agent (`docs/template/agents/*`) chỉ có **bước cuối generic**: đọc mục này. **Repo khác không có mục tương đương → agent bỏ qua.** Checklist là việc **agent** làm — `docs/convention/` chỉ nêu nguyên tắc, không tham chiếu checklist; nhóm theo giai đoạn pipeline (bảng §3).

### Investigate

Khi survey call chain đụng persist / lifecycle / CRUD domain:

- [ ] **Cân nhắc emit** — thêm/sửa/xoá `emit` / `emitEntity` (sau persist OK; payload tối thiểu, không secret).
- [ ] **Ghi kết luận** trong `investigate.md` (vd *Events: thêm … / sửa … / xoá … / không đổi — vì …*).
- [ ] **Cập nhật catalog nếu chốt đổi event** — file mode tương ứng trong [`docs/architecture/4-code/events/`](docs/architecture/4-code/events/README.md) (+ `DashboardEventType` nếu type mới/đổi tên) trong cùng thay đổi code, hoặc ghi nợ `docs/todo/`.

### Design

- [ ] **Nêu rõ emit dự kiến trong design** (hoặc *không emit*).

### Implement

- [ ] **Cập nhật rule** trong [`docs/agent-rules/`](docs/agent-rules/) ngay trong cùng thay đổi — rule lệch code là nợ, không phải chi tiết.
- [ ] **Cập nhật tài liệu cho người** nếu quy ước đó cũng mô tả hệ thống — [`docs/architecture/`](docs/architecture/) và các file liên quan trong `docs/`.
- [ ] **Cập nhật file này** nếu bảng §3 / §5 không còn đúng.

**Thêm feature mới** (quy ước: [`docs/convention/feature-architecture.md`](docs/convention/feature-architecture.md)):

1. **Tạo `src/features/<name>/`** với `api.ts`, `controller.ts`, `business/`, và (tuỳ) `components`, `composables`, `scripts`, `styles/index.scss`, `locales/{vi,en}.ts`, `schemas/`.
2. **Kế thừa abstract** — controller `extends AbstractController`; business `extends AbstractBusiness`.
3. **Gom `business/` theo nghiệp vụ**; peer chỉ qua `business/index.ts`.
4. **Không sửa `apiServer` registry tay** — để glob nạp.
5. **Schema domain để trong feature**, đừng đẩy vào `src/frontend/configs` trừ shell preference thật sự.
6. **Dùng `*Utils` / `*Lib` / `fileHelper` có sẵn**, mở rộng helper trước khi copy logic.
7. **Business không import trực tiếp `node:fs` / `node:path`.**
8. **Chạy `bun run typecheck` + `bun run build`** nếu đụng cả FE và Node.
9. **Thêm mode ở FE shell** thì theo checklist "Thêm mode mới" dưới đây.

**Thêm mode mới ở FE shell** (quy ước 3 lớp/`ModeEntry`/`ShellContext`: [`docs/agent-rules/mode-registry-guideline.md`](docs/agent-rules/mode-registry-guideline.md)):

- [ ] **Export đúng tên `registerMode(registry: ModeRegistry): void`** — glob ở `main.ts` gọi cố định `mod.registerMode(...)`.
- [ ] **`key` duy nhất** — trùng thì `registerMode()` throw lúc khởi động (fail-fast).
- [ ] **`order` duy nhất**, phù hợp vị trí mong muốn trong sidebar.
- [ ] **`labelKey` (+ `titleKey`) trỏ đúng key** đã có trong `plugins/i18n/locales/common/{vi,en}.ts` → `modes.*`.
- [ ] **`icon` khớp tên đã đăng ký** trong `RailIcon.vue`.
- [ ] **Import `panel` trực tiếp** ở top-level, không lazy-load.
- [ ] **`bindings(ctx)` chỉ lấy state đã có trong `ShellContext`**; cần state mới thì thêm đúng 1 dòng vào `shellContext`.
- [ ] **Ẩn/hiện động qua `visible(ctx)`**, không tự thêm `v-if` riêng trong `App.vue`.
- [ ] **Khai `descriptionKey` + `maturity`** (và `defaultEnabled: false` nếu mode chưa hoàn thiện) — group "Chế độ" trong Settings đọc thẳng từ đây.
- [ ] **Không tự đọc `settings.modes` trong feature** — quyết định hiển thị là việc của `canAccessMode` ở shell.
- [ ] **Không sửa `src/frontend/main.ts`** — thấy cần sửa nghĩa là đang làm sai convention.
- [ ] **Cập nhật `MODE_DEFS` trong `App.test.ts`** để mode mới được cover trong cả 3 test lặp qua `MODE_DEFS`.
- [ ] **Giữ xanh trước khi PR** — `vue-tsc --noEmit`, `vitest run tests/src/App.test.ts`, và test riêng của feature.

**Thêm/sửa text UI (i18n)** (quy ước: [`docs/convention/i18n.md`](docs/convention/i18n.md)):

1. Xác định feature / namespace.
2. Sửa `src/features/<feature>/locales/vi.ts` (hoặc `plugins/i18n/locales/common/vi.ts`).
3. (Khuyến nghị) đối ứng `en.ts` nếu có — thiếu thì runtime fallback `vi`.
4. Thay hardcode bằng `t(...)`.

### Testing

Áp dụng cho **mọi** thay đổi code:

- [ ] **Tra danh mục suite** [`tests/CATALOG.md`](tests/CATALOG.md) — xác định suite nào phủ vùng vừa sửa (có thể nhiều suite, khác runner). Sau khi `tests/` bị cắt khỏi dòng source thì file này không có ở đây: `bun run test:overlay` trước, hoặc xem [bản trên `test/main`](https://github.com/naut1402/agent-workflow/blob/test/main/tests/CATALOG.md).
- [ ] **Chạy đúng các suite đó** — `bun run test:scope` hoặc nối path thủ công. Full suite là việc của CI.
- [ ] **Vùng sửa chưa có suite nào** → viết test mới đặt theo layout (business/server → bun; FE → vitest). `test:scope` chọn ra 0 file **không** phải "đã xanh", nó là "chỗ này chưa ai test".
- [ ] **Thêm/đổi thư mục test** → khai vào `tests/runners.json` **và** sinh lại `bun run test:scope --catalog > tests/CATALOG.md` trong cùng thay đổi.
- [ ] **Test đụng filesystem / registry / agent / plugin** → chạy thêm một lượt với env đã tước (`HOME` rỗng, biến plugin trỏ path không tồn tại).
- [ ] **Test viết trên dòng branch riêng** khi pipeline có bước `test-implementer` — [`testing.md`](docs/agent-rules/testing.md) §3.1. Đang ở dòng source thì `bun run test:overlay` trước khi chạy được suite nào.

**Chiến lược tràn nội dung UI** — chạy trước khi báo hoàn thành 1 vùng UI có chiều cao phụ thuộc dữ liệu (quy ước: [`docs/convention/ui-overflow.md`](docs/convention/ui-overflow.md)):

- [ ] Thử với **dữ liệu dài** (nhiều hơn số item thật hiện có) — cuộn được tới mục cuối cùng.
- [ ] Thử với **dữ liệu rỗng** — empty state hiện đúng, khung không sụp về 0px.
- [ ] Trên mỗi trục chỉ có **một** thanh cuộn; container ngoài không cuộn (`scrollHeight === clientHeight`).
- [ ] Nội dung không tràn ra ngoài khung, không đè lên hàng nút / footer.
- [ ] Lặp lại ở **viewport thấp** (thu cửa sổ còn ~500px chiều cao) và khi mở nhiều section cùng lúc.

### Review

Dùng khi review PR đụng `src/features/*`, `src/backend/**`, `src/frontend/**`, `src/shared/**`, hoặc tái cấu trúc tương tự. Đánh dấu từng mục liên quan scope PR — không bắt buộc tick hết nếu PR không đụng vùng đó. Quy ước nền: [`docs/convention/feature-architecture.md`](docs/convention/feature-architecture.md), [`docs/convention/coding.md`](docs/convention/coding.md), [`git-pr.md`](docs/agent-rules/git-pr.md). Bất biến repo: §4.

**Kiến trúc — vị trí code & coupling:**

- [ ] **Đặt đúng feature** — thay đổi domain nằm đúng feature; không vá logic domain vào feature khác hoặc vào `core`.
- [ ] **Kiểm soát route** — mới/sửa chỉ ở `features/<f>/api.ts` + `controller.ts`; controller không đọc/ghi filesystem phức tạp.
- [ ] **Đặt đúng schema domain** — ở `features/<f>/schemas/`; không nhét schema shell vào feature.
- [ ] **Chuẩn hoá UI string & FE API** — string qua i18n (`locales/`); gọi API qua `scripts/*Api.ts` + `apiGet` / `apiPost`.
- [ ] **Không wiring thủ công** — không thêm tay nếu glob/auto-load đã đủ (route / styles / locales / `registerMode`).
- [ ] **Đặt style đúng tầng** — 1 component render selector gốc → `<style scoped>`; ≥2 cùng feature → `features/<f>/styles/`; xuyên feature → `src/frontend/styles/`. Không thêm file `styles/*.scss` chỉ-comment.
- [ ] **Danh sách dài không bị cắt cụt** — xem checklist "Chiến lược tràn nội dung UI" ở Testing.
- [ ] **Tuân thủ mode-registry khi thêm/sửa mode** — không sửa `main.ts`, không đụng `App.vue` ngoài `shellContext`, `MODE_DEFS` trong `App.test.ts` đã cập nhật.
- [ ] **Gom module theo nghiệp vụ** — không tách file theo kiểu thao tác (`store` / `fetch` / `paths` / `scan` mỏng).
- [ ] **Không phụ thuộc Hono** — `business/` không import Hono, không phụ thuộc `c.req`.
- [ ] **Import peer qua index** — chỉ `business/index.ts` import cây `business` của feature khác.
- [ ] **Cập nhật surface chia sẻ** — thêm gì mới đều cập nhật `business/index.ts`; tránh cycle barrel↔barrel.
- [ ] **Gắn sanitize vào feature sở hữu** — export qua index khi chia sẻ, không đưa lên "sanitize chung" ở core.
- [ ] **Ưu tiên dùng lại helper** — `*Utils` / `*Lib` / `fileHelper` thay vì copy-paste; tên helper mới không mơ hồ (`helpers.ts`, `utils.ts`).
- [ ] **Không import `node:fs` / `node:path` trực tiếp** trong business; module dùng chung FE+BE không top-level `node:*`.
- [ ] **Kiểm kỹ khi đổi chữ ký `fileHelper`** — chạy typecheck và đối chiếu call site.
- [ ] **Phụ thuộc một chiều** — không `core` → `features`; không vòng import.
- [ ] **Validate ở biên** — Zod `safeParse`; ưu tiên `z.infer` thay vì `interface` tay song song schema.
- [ ] **Tránh boolean `ok` dễ gãy** — narrow bằng `'error' in v` hoặc discriminant string.

**Dữ liệu & An toàn — I/O, persist, event:**

- [ ] **Đọc FS phòng thủ** — `safeReadDir` / `statSafe` / `readYamlSafe`; lỗi file không làm sập request.
- [ ] **Chống traversal** — input path từ user đã sanitize / `resolvePathUnder`.
- [ ] **Ghi atomic** — file quan trọng ghi qua temp + rename (registry, runners, settings).
- [ ] **Fetch qua wrapper an toàn** — URL người dùng qua `fetchUrlSafe` (https, chặn private host).
- [ ] **Cân nhắc emit** (khi đụng persist/lifecycle/CRUD) — thêm/sửa/xoá `emit` / `emitEntity` sau persist; payload không chứa secret. Chi tiết type/nơi emit: [`docs/architecture/4-code/events/`](docs/architecture/4-code/events/README.md).
- [ ] **Đồng bộ catalog với code** — file mode tương ứng trong `docs/architecture/4-code/events/` khớp, hoặc nợ `docs/todo/` có lý do.
- [ ] **Cập nhật type** — `DashboardEventType` đổi theo khi type mới / đổi tên.

**Quy trình & Tài liệu:**

- [ ] **Xác định bề mặt cần phủ** — mỗi vùng đổi có hàm/route/hành vi công khai test được. Không có bề mặt nào test được là vấn đề của **code**, không phải của test.
- [ ] **PR dòng source: test KHÔNG nằm trong diff** — test đi ở PR dòng test ([`git-pr.md`](docs/agent-rules/git-pr.md) §4.3). Thấy file `tests/`·`test-e2e/` trong diff PR code → yêu cầu chuyển sang PR dòng test.
- [ ] **Suite hiện có không hồi quy** — "chọn ra 0 file test" KHÔNG phải "đã xanh" ([`testing.md`](docs/agent-rules/testing.md) §3.1).
- [ ] **PR dòng test: chọn đúng runner** — domain/fs → **bun test**; FE/component → vitest; khai path mới vào `tests/runners.json` và sinh lại `tests/CATALOG.md`.
- [ ] **PR dòng test: nêu cặp ref đã overlay** (source ref + SHA) — không có nó thì "test lệch pha với source" không truy được.
- [ ] **Giữ build xanh** — PR đụng helper FE+BE hoặc `fileHelper` → typecheck/build xanh cả local và CI.
- [ ] **Tuân thủ commitlint** — commit/PR title đúng `type(scope): subject`, không trailer công cụ.
- [ ] **Trình bày đúng nội dung PR** — phần riêng nhóm theo cây thư mục; fix/refactor có Logic trước → sau; phần chung nêu Core và/hoặc feature khác (hoặc *Không*).
- [ ] **Dọn nợ trước merge `main`** — PR `dev/x.y.z/main` → `main` không còn thư mục `docs/todo/`, và dòng `test/x.y.z/main` của version tồn tại + xanh (checklist PR dưới).

### PR

**Tự kiểm trước khi push** (quy ước: [`docs/convention/git-hygiene.md`](docs/convention/git-hygiene.md)):

1. **`git status`** — chỉ còn file đúng phạm vi PR?
2. **`git diff --staged`** — không generated/export/lockfile lạ/file ngoài phạm vi?
3. **Có rename/migrate?** → không còn bản cũ trùng.
4. **File mới cần bỏ qua?** → cập nhật `.gitignore` trước khi commit.

**Không `git push` lại branch đã merged** (origin có thể đã xoá → tạo branch rác). Luôn tạo branch mới từ base mới nhất — `origin/main`, hoặc `origin/dev/x.y.z/main` nếu task gắn version release.

**Todo debt** (bối cảnh đầy đủ: [`pr-todo-debt.md`](docs/agent-rules/pr-todo-debt.md)):

- [ ] Có hoãn docs/convention? → đã có `docs/todo/<issue>/<task-id>.md`
- [ ] PR feature → `dev/x.y.z/main`? → được mang nợ; Todo debt **không** chặn
- [ ] PR `dev/x.y.z/main` → `main`? → **không còn** thư mục `docs/todo/`; `bun run check:todo` xanh
- [ ] Đã trả nợ? → đã xoá toàn bộ `docs/todo/`
- [ ] Nợ **test**? → không ghi vào `docs/todo/`; dòng `test/x.y.z/main` phải tồn tại và xanh trước khi promote
