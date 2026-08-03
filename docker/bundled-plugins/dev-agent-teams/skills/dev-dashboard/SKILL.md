---
name: dev-dashboard
description: Dựng và chạy dashboard realtime trực quan hóa trạng thái pipeline của dev-team-orchestrator. App đã tách thành repo riêng (https://github.com/naut1402/agent-workflow); skill này bootstrap state project rồi clone + chạy app đó. Dùng khi user muốn xem tiến độ task, theo dõi pipeline investigate→design→implement→review→PR, xem HITL gate đang chờ, đọc artifact/qa.md, hoặc nói "mở dashboard", "xem trạng thái orchestrator", "visualize tiến độ task". Gõ `/dev-dashboard`.
argument-hint: "[project-root] [--no-open] [--port=<n>]"
user-invocable: true
---

# Dev Team Dashboard

> **App đã tách repo.** Source của dashboard (Vue+Vite + server + MCP, đã migrate sang TypeScript) giờ sống ở repo độc lập **[naut1402/agent-workflow](https://github.com/naut1402/agent-workflow)**. Plugin này **không còn nhúng** bản copy viewer; skill chỉ (1) bootstrap state project và (2) clone/chạy app từ repo đó.

Dashboard đọc trực tiếp filesystem `.dev-team-agent/` để trực quan hóa state của `dev-team-orchestrator`: pipeline các phase, các HITL gate, vòng review/doc-review, artifact và câu hỏi blocking (`qa.md`). UI tự poll mỗi ~1.5s nên phản ánh **realtime** khi orchestrator chạy.

## Mô hình thư mục

State + tài liệu của orchestrator nằm dưới một root thống nhất ở gốc project, **tách biệt** với app:

```
<project-root>/.dev-team-agent/      # state + artifact (skill bootstrap; orchestrator ghi)
  .dev-state/<task-id>.json          # state pipeline
  tasks/<task-id>/...                # investigate.md, design.md, review.md, qa.md, ...
  pipeline.yaml                       # config flow (tuỳ chọn)

$DEV_TEAM_DASHBOARD_APP/             # clone của agent-workflow (mặc định ~/.dev-team-dashboard/app)
  src/ server/ mcp/ ...              # app dashboard — clone từ GitHub, KHÔNG nằm trong .dev-team-agent
```

Project cũ còn `tasks/` và `.dev-state/` ở gốc → skill **tự migrate** vào `.dev-team-agent/`.

## Yêu cầu môi trường

- **git** — để clone/cập nhật app.
- **[bun](https://bun.sh)** — agent-workflow dùng bun (có `bun.lock`); `server`/`mcp` chạy bằng bun, `runner-cli.mjs` import nguồn `.ts` qua specifier `.js` nên cần bun runtime. Nếu thiếu bun → báo user cài (`curl -fsSL https://bun.sh/install | bash`).
- **Node ≥ 18** — để chạy script bootstrap `setup.mjs`.

## Đầu vào

`$ARGUMENTS` = `[project-root] [--no-open] [--port=<n>]`

- `project-root`: gốc project chứa (hoặc sẽ chứa) `.dev-team-agent/`. Mặc định = thư mục làm việc hiện tại.
- `--no-open`: không tự mở browser.
- `--port=<n>`: cổng dev server (mặc định 5174).

Biến môi trường tuỳ chọn:

- `DEV_TEAM_DASHBOARD_APP`: nơi clone app. Mặc định `~/.dev-team-dashboard/app`.
- `DEV_TEAM_ROOT`: trỏ server tới một `.dev-team-agent/` cụ thể (skill set tự động theo `project-root`).

## Quy trình

Thực hiện tuần tự. Các bước dùng script/lệnh cố định — **không tự suy diễn lại**.

### Bước 1 — Bootstrap state project

Chạy script bootstrap (đường dẫn tính từ thư mục skill này, `<skill-dir>/scripts/setup.mjs`):

```bash
node "<skill-dir>/scripts/setup.mjs" "<project-root>"
```

Script này (idempotent) sẽ:
1. Tạo `<project-root>/.dev-team-agent/` (+ `pipeline-profiles/`).
2. Migrate `tasks/` và `.dev-state/` cũ ở gốc project vào `.dev-team-agent/` (nếu có, và chưa migrate).
3. Scaffold `pipeline.yaml` mặc định từ asset canonical (nếu chưa có).
4. Thêm `.dev-team-agent/` vào `.gitignore`.
5. Inject placeholder rule vào `CLAUDE.md` (nếu chưa có).

Script **không** đụng tới app dashboard. Đọc output để xác nhận đã migrate/scaffold gì. Lỗi (ví dụ không tìm thấy Node) → dừng, báo user.

### Bước 2 — Clone / cập nhật app dashboard

Đặt `APP_DIR = ${DEV_TEAM_DASHBOARD_APP:-~/.dev-team-dashboard/app}`.

- Nếu `APP_DIR` chưa tồn tại → clone:

```bash
git clone https://github.com/naut1402/agent-workflow "$APP_DIR"
```

- Nếu đã tồn tại → cập nhật (bỏ qua nếu user muốn pin version):

```bash
git -C "$APP_DIR" pull --ff-only
```

### Bước 3 — Cài dependency (lần đầu / khi đổi version)

Nếu `$APP_DIR/node_modules` chưa tồn tại (hoặc vừa pull):

```bash
cd "$APP_DIR" && bun install
```

### Bước 4 — Chạy dev server

Trỏ app vào state của project hiện tại qua `DEV_TEAM_ROOT`, rồi chạy:

```bash
cd "$APP_DIR" && DEV_TEAM_ROOT="<project-root>/.dev-team-agent" bun run dev
```

- Tôn trọng `--port` (đặt env hoặc cờ vite `--port`) và `--no-open` (`bun run dev -- --no-open`).
- Chạy **nền** (background) để không chặn session, rồi báo user URL (mặc định http://localhost:5174).

### Bước 5 — Báo user

Thông báo:
- URL dashboard.
- App nằm ở `$APP_DIR` (clone của agent-workflow); state đọc từ `<project-root>/.dev-team-agent/`.
- Dashboard tự cập nhật realtime — cứ để mở khi chạy `/dev-team-orchestrator`.
- Dừng server: tắt tiến trình `bun run dev` (Ctrl-C hoặc kill background task).

## Chế độ đa-project (standalone server)

Để theo dõi **nhiều project** từ một dashboard duy nhất, chạy server độc lập (không gắn với một `.dev-team-agent/` cụ thể):

```bash
cd "$APP_DIR" && bun install && bun run serve   # hoặc `bun start` = build + serve
```

- `bun run serve` chạy `server/standalone.ts`: serve `dist/` tĩnh + API `/api/*`, bind `127.0.0.1:5174` (local-first; chưa expose ra mạng).
- **Project registry**: danh sách project lưu ở `~/.dev-team-dashboard/projects.json` (override bằng env `DEV_TEAM_DASHBOARD_HOME`). Mỗi entry trỏ tới một thư mục `.dev-team-agent/`.
- **Thêm/xoá project**:
  - Qua UI: sidebar "Projects" → nút **＋**, nhập đường dẫn `.dev-team-agent/` (hoặc project root chứa nó) + tên hiển thị tuỳ chọn. Nút **×** gỡ project (chỉ gỡ khỏi registry, **không** xoá file). Không gỡ được project `default`.
  - Qua MCP: server `dev-team-dashboard` (khai báo ở `plugins/dev-agent-teams/.mcp.json`, trỏ tới `$DEV_TEAM_DASHBOARD_APP/mcp/server.ts`) cung cấp 4 tool `list_projects` / `add_project` / `remove_project` / `get_project`, dùng **chung** `projects.json` với UI/REST.
- **Tương thích ngược**: nếu set env `DEV_TEAM_ROOT`, project đó tự được seed làm `default` khi registry rỗng. Mọi endpoint cũ nhận thêm query optional `?project=<id>`; không truyền → dùng project mặc định và giữ nguyên shape `{ root, tasks }`.
- Chạy **nền** rồi báo user URL. Dừng: tắt tiến trình `bun run serve`.

## Dashboard hiển thị gì

- **Danh sách task** (dashboard tổng): mọi task trong `.dev-state/`, đánh dấu task đang chờ Q&A / HITL.
- **Pipeline**: investigate→design→implement→review→PR với HITL gate xen giữa; bước đang chạy nhấp nháy, bước xong tick xanh, gate đang chờ duyệt highlight vàng. Status suy từ sự tồn tại artifact + `current_phase`/`hitl_pending`.
- **Badge**: `auto_review`, `review_round`, `hitl_pending`, lỗi state.
- **QA panel**: nổi bật khi `qa.md` tồn tại — hiển thị câu hỏi blocking đang chờ trả lời.
- **Artifact panel**: liệt kê mọi tài liệu trong `tasks/<id>/`, click để xem nội dung (render markdown); tài liệu đang mở tự reload khi file đổi trên đĩa.
- **Knowledge mode**: quản lý entry Markdown tại `.dev-team-agent/knowledge/`.
- **Pipeline Editor**: chỉnh flow/step config từ UI.

> Chi tiết tính năng, API nội bộ, ảnh chụp UI và roadmap nằm trong repo app: https://github.com/naut1402/agent-workflow
