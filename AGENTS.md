# AGENTS.md

Nguồn quy ước **hub** cho mọi AI agent trong repo. Chi tiết nằm ở `docs/`; nếu xung đột về **bất biến** hoặc coupling tối thiểu, coi file này là đúng.

**Đọc file này trước**, rồi mở doc tương ứng scope task (bảng dưới).

| Chủ đề | Tài liệu |
|--------|----------|
| Quickstart | [`README.md`](README.md) |
| Kiến trúc / cây thư mục chi tiết | [`docs/architecture.md`](docs/architecture.md) |
| Mục lục domain events (theo feature) | [`docs/event-catalog.md`](docs/event-catalog.md) |
| Tổ chức feature / business / helper | [`docs/implement/feature-organization-rule.md`](docs/implement/feature-organization-rule.md) |
| Coding convention (TS, Zod, FE, i18n) | [`docs/implement/coding-convention.md`](docs/implement/coding-convention.md) |
| Thêm mode mới ở FE shell (ModeRegistry/DI) | [`docs/implement/mode-registry-convention.md`](docs/implement/mode-registry-convention.md) — sơ đồ bootstrap: [`docs/diagram/IoC.md`](docs/diagram/IoC.md) |
| Test | [`docs/implement/test-convention.md`](docs/implement/test-convention.md) |
| Viết artifact `investigate.md` / `design.md` | [`docs/implement/doc-writing-convention.md`](docs/implement/doc-writing-convention.md) |
| PR / commit / docs output | [`docs/implement/pr-docs-convention.md`](docs/implement/pr-docs-convention.md) |
| Nợ đối ứng sau (`docs/todo`) | [`docs/implement/todo-debt-convention.md`](docs/implement/todo-debt-convention.md) |
| Git hygiene / tách commit theo xử lý | [`docs/implement/git-convention.md`](docs/implement/git-convention.md) (§6) |
| Worktree | [`docs/implement/worktree-convention.md`](docs/implement/worktree-convention.md) |
| Checklist review | [`docs/implement/review-checklist-rule.md`](docs/implement/review-checklist-rule.md) |
| i18n chi tiết | [`docs/i18n.md`](docs/i18n.md) |
| Cookbook tái cấu trúc core/feature | [`docs/cookbook/core-path-reorg.md`](docs/cookbook/core-path-reorg.md) |
| Template agent / pipeline | [`docs/template/`](docs/template/) |
| Rule rút gọn cho công cụ AI (theo category) | [`.claude/rules/`](.claude/rules/) |
| Claude Code | [`CLAUDE.md`](CLAUDE.md) |

---

## 1. Dự án này là gì

`dev-team-dashboard` là SPA Vue 3 + Vite trực quan hoá runtime state của một **orchestrator agent chạy ngoài**; repo này quan sát và cấu hình, không chạy orchestrator. Với *state* từng task (`.dev-state/*.json`) thì chỉ đọc; với *config* (pipeline, custom agent, template, knowledge) và **artifact markdown** thì đọc/ghi được (ghi qua `PUT /api/artifact`).

- **Backend**: Hono trên 2 transport. Feature: `api.ts` + `controller.ts` + `business/`. Setup app-root ở `src/api/`; kernel HTTP ở `src/core/http/`; registry ở `src/core/registry.ts`. Entry: `src/standalone.ts`.
- **Frontend**: `src/features/<mode>/` (components, scripts, styles, locales, schemas); nền `src/core/`; config shell `@configs` → `src/core/configs/`.
- **Data root** `.dev-team-agent/`; standalone qua `ProjectRegistry` (`?project=<id>`).
- **Pipeline**: `DEFAULT_PIPELINE` ← `pipeline.yaml` ← `tasks/<id>/pipeline.yaml`.
- **MCP**: `bun run mcp` — CRUD registry, không cần HTTP server.

Chi tiết: [`docs/architecture.md`](docs/architecture.md).

---

## 2. Cấu trúc dự án — nhìn nhanh

```
agent-workflow/
├── src/          # features/, core/, api/, plugins/, styles/
├── mcp/
├── tests/        # unit (bun + vitest)
├── test-e2e/
├── docs/
│   ├── architecture.md, event-catalog.md, i18n.md, ui-buttons.md
│   ├── template/           # agent + pipeline mẫu
│   ├── cookbook/           # tái cấu trúc / bài học đợt lớn
│   └── implement/          # *-rule.md, *-convention.md
└── .claude/
```

Ngoại lệ cố ý còn `.js`: `src/features/agent-editor/business/agentMarkdown.js`, `src/runner-cli.mjs`. Tooling: `vite`/`vitest`/`playwright` dùng `.ts`; `eslint.config.js` giữ `.js`.

---

## 3. Bắt buộc khi implement (tóm tắt)

Đọc đủ trước khi code feature/business:

1. [`feature-organization-rule.md`](docs/implement/feature-organization-rule.md) — đặt file, `business/` theo nghiệp vụ, peer qua `business/index`, `fileHelper` / `*Utils` / `*Lib`.
2. [`coding-convention.md`](docs/implement/coding-convention.md) — ESM/TS, Zod, Vue, i18n.
3. Mục **Bất biến** bên dưới — không được phá.

---

## 4. Bất biến bắt buộc giữ

Nội dung đầy đủ: [`docs/architecture.md` §6](docs/architecture.md#6-bất-biến-kiến-trúc) — đọc trước khi thêm scan/endpoint mới.

Danh mục: đọc filesystem phòng thủ · chống path-traversal (sanitize tại feature sở hữu) · ghi registry atomic · `fetchUrlSafe` cho URL người dùng · ESM thuần · `ANTHROPIC_API_KEY` tuỳ chọn · `DASHBOARD_SECRET_KEY` bắt buộc cho vault.

---

## 5. Con trỏ nhanh theo loại task

| Task | Đọc thêm |
|------|----------|
| Viết/sửa code feature | implement `*-rule` + `coding-convention` + bất biến §4 |
| Thêm mode mới ở FE shell (`App.vue`) | [`mode-registry-convention.md`](docs/implement/mode-registry-convention.md) — checklist §4 |
| Review PR | [`review-checklist-rule.md`](docs/implement/review-checklist-rule.md) (mục **Dữ liệu & An toàn** có domain events khi đụng persist) |
| Test / CI | [`test-convention.md`](docs/implement/test-convention.md) |
| Commit / PR / docs | [`pr-docs-convention.md`](docs/implement/pr-docs-convention.md) + [`git-convention.md`](docs/implement/git-convention.md) (tách commit §6 khi PR nhiều xử lý) |
| Hoãn docs/test (hotfix, POC, convention chưa ổn) | [`todo-debt-convention.md`](docs/implement/todo-debt-convention.md) — `docs/todo/…`; gate CI chỉ khi PR **`dev/x.y.z/main` → `main`** (phải xóa cả `docs/todo/`) |
| Agent song song | [`worktree-convention.md`](docs/implement/worktree-convention.md) |

---

## 6. Checklist hoàn thành workflow

Template agent (`docs/template/agents/*`) chỉ có **bước cuối generic**: đọc mục này. **Repo khác không có mục tương đương → agent bỏ qua.** Chi tiết catalog event: [`docs/event-catalog.md`](docs/event-catalog.md); danh mục test suite: [`test-convention.md`](docs/implement/test-convention.md) §2.1.

### Survey / investigate

Khi survey call chain đụng persist / lifecycle / CRUD domain:

- [ ] **Cân nhắc emit**: thêm/sửa/xoá `emit`/`emitEntity` (sau persist OK; payload tối thiểu, không secret).
- [ ] **Ghi kết luận**: trong `investigate.md` (vd *Events: thêm … / sửa … / xoá … / không đổi — vì …*).
- [ ] **Cập nhật catalog nếu chốt đổi event**: [`docs/event-catalog.md`](docs/event-catalog.md) (+ `DashboardEventType` nếu type mới/đổi tên) trong cùng thay đổi code, hoặc nợ [`docs/todo/`](docs/implement/todo-debt-convention.md).

### Design / implement / review (khi scope đụng event)

- [ ] **Nêu rõ emit dự kiến trong design** (hoặc *không emit*).
- [ ] **Đối chiếu catalog với code khi implement/review** — xem thêm [`review-checklist-rule.md`](docs/implement/review-checklist-rule.md) mục **Dữ liệu & An toàn**.

### Implement — test suite

Áp dụng cho **mọi** thay đổi code (không chỉ khi đụng event):

- [ ] **Tra danh mục suite** [`test-convention.md`](docs/implement/test-convention.md) §2.1 — xác định suite nào phủ vùng vừa sửa (một hoặc nhiều, có thể khác runner).
- [ ] **Chạy đúng các suite đó**: `bun run test:scope` (tự suy ra từ thay đổi) hoặc nối path thủ công — `bun test <suite>…` / `npx vitest run <suite>…`. Full suite là việc của CI, không cần chạy ở local.
- [ ] **Vùng sửa chưa có suite nào** → viết test mới đặt theo layout §2 (business/server → bun; FE → vitest). `test:scope` chọn ra 0 file **không** phải là "đã xanh", nó là "chỗ này chưa ai test".
- [ ] **Thêm/đổi thư mục test** → sinh lại bảng `bun run test:scope --catalog` và cập nhật §2.1 trong cùng thay đổi.
- [ ] **Test đụng filesystem / registry / agent / plugin**: chạy thêm một lượt với env đã tước (`HOME` rỗng, biến plugin trỏ path không tồn tại) — máy dev có sẵn `/opt/bundled-plugins` và `~/.claude/plugins`, CI thì không, đây là nguồn "xanh local đỏ CI" đã gặp.

### Implement — đổi quy ước

- [ ] **Cập nhật tầng tài liệu cho người**: `docs/implement/` + `docs/architecture.md` trong cùng thay đổi.
- [ ] **Cập nhật tầng agent nếu quy ước đó cũng nằm ở đây**: file này + [`.claude/rules/`](.claude/rules/) — hai tầng lệch nhau là nợ, không phải chi tiết.

---

## 7. Rule viết tài liệu — `investigate.md` / `design.md` (doc-writing)

Áp dụng cho artifact markdown trong `.dev-team-agent/tasks/<id>/`. Rule này **thắng** mọi template mặc định đi kèm công cụ sinh tài liệu. Bản đầy đủ (lý do, ví dụ, anti-pattern): [`docs/implement/doc-writing-convention.md`](docs/implement/doc-writing-convention.md); khi hai bên lệch, bản đầy đủ là đúng.

### `investigate.md` — decision-first, 6 section

Đúng 6 heading `##`, đúng thứ tự, giữ nguyên tên:

1. `## 1. Tổng quan` — vấn đề, hướng giải quyết, phạm vi (module + số lượng), confidence tổng thể.
2. `## 2. Quyết định cần chốt` — bảng `| # | Nhóm | Vấn đề | Đề xuất mặc định | Nếu chọn khác | Người chốt |`, đánh số `D1…Dn`. Gom **mọi** rủi ro cần người quyết và câu hỏi mở vào đây; mỗi dòng bắt buộc có đề xuất mặc định để người duyệt chỉ việc đồng ý — nếu thật sự chưa có mặc định thì nêu ≥ 2 lựa chọn kèm điều kiện chọn, không để ô trống.
3. `## 3. Luồng xử lý & UX` — chỉ luồng chuẩn (happy path) và ghi chú UX. Chọn text flow / `mermaid sequenceDiagram` / `mermaid flowchart TD` theo độ phức tạp. Không chèn bug hay cạm bẫy kỹ thuật vào đây.
4. `## 4. Lưu ý kỹ thuật` — `G1…Gn`, mỗi mục theo *hiện tượng → nguyên nhân → cách xử lý*: cạm bẫy, xung đột, ràng buộc môi trường/branch. Rủi ro dev tự xử lý được nằm ở đây, không đẩy lên §2.
5. `## 5. Phạm vi ảnh hưởng & test` — một bảng gộp `| Module / File | Thay đổi dự kiến | Test hiện có | Confidence |` ở mức file/hàm/component; kèm vài câu blast radius, kết luận DB/schema và kết luận events (§6).
6. `## 6. Phụ lục` — dành cho người code và review PR: entry points, chi tiết `file:line`, DB/schema chi tiết, test coverage chi tiết, ghi chú khảo sát khác. Mỗi mục con là một `###`.

Bất biến:

- Chỉ `##` mới là section — viewer gập/sửa theo `##`; chi tiết bên trong dùng `###`. Không đặt `##` ở đầu dòng bên trong code fence: viewer cắt section không phân biệt fence nên sẽ cắt đôi khối code (thụt 1 space, hoặc dùng `###` trở xuống).
- `file:line` **chỉ** xuất hiện ở §4 và §6. §1–§3 và §5 nêu tên file/hàm/component, không kèm số dòng.
- §1 + §2 phải đủ để người duyệt chốt mà không cần đọc tiếp.
- Không xoá section vì "không có gì để ghi" — giữ đủ 6 section, ghi empty state tường minh (vd *Không có quyết định cần phê duyệt*, *Không đổi schema*, *Không có khía cạnh UX*).
- Không dùng checkbox `[ ]` trong ô bảng — không render thành control. Mục **blocking** phải đưa sang `qa.md`, mỗi câu một block `## Q<n>` + `**Lựa chọn:**` (list `- A. …`) + `**Trả lời:**`.
- Không đặt ngân sách độ dài bằng số dòng; tiêu chí là "đọc §1–§2 là chốt được".

### `design.md` — giữ 7 section

`## §1. Tổng quan` / `§2. Investigation Summary` / `§3. So sánh giải pháp` (ít nhất 2 phương án, kể cả "giữ nguyên hiện trạng") / `§4. Implementation Details` (4.1 Files, 4.2 Logic, 4.3 DB, 4.4 Edge cases) / `§5. Test Notes` / `§6. Out of scope` / `§7. Schedule`. §4 phải đủ chi tiết để code mà không hỏi lại.