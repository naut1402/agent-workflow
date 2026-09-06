# Agent flow

### Harness vận hành đội AI agent — pipeline, rule, knowledge, runner trong một dashboard

[![Bun](https://img.shields.io/badge/runtime-Bun-fbf0df?logo=bun&logoColor=black)](https://bun.sh)
[![Vue 3](https://img.shields.io/badge/UI-Vue%203-42b883?logo=vue.js&logoColor=white)](https://vuejs.org)
[![Hono](https://img.shields.io/badge/API-Hono-e36002)](https://hono.dev)
[![GitHub stars](https://img.shields.io/github/stars/naut1402/agent-workflow?style=social)](https://github.com/naut1402/agent-workflow)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/naut1402/agent-workflow/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/naut1402/agent-workflow/actions/workflows/ci.yml?query=branch%3Amain)

---

## AI harness — điều phối, quan sát và cấu hình đội agent

**Agent flow** là một *AI harness system* chạy tại chỗ: nơi bạn **mô tả** đội AI agent làm việc thế nào, **giao việc** cho nó, rồi **nhìn** nó làm.

- **Mô tả luồng làm việc** — pipeline nhiều bước (khảo sát → thiết kế → viết test → code → review → PR), mỗi bước gắn agent, rule và skill riêng; lưu thành profile dùng lại cho task sau.
- **Giao việc & chạy thật** — tạo task, đẩy vào hàng đợi runner, chạy agent CLI trên máy local hoặc máy từ xa qua connection đã khai báo.
- **Người vẫn nắm quyền** — HITL gate dừng luồng chờ bạn duyệt; artifact markdown (`investigate.md`, `design.md`, `review.md`, …) đọc và sửa ngay trên dashboard.
- **Tự động hoá** — automation theo lịch (once / interval / cron) hoặc theo sự kiện, nối nhiều bước chạy task, tham chiếu output của bước trước.
- **Nhiều dự án một chỗ** — standalone mode chọn project qua registry (`?project=<id>`).
- Toàn bộ state nằm ở thư mục `.dev-team-agent/` của **project đích** — dashboard đọc/ghi trực tiếp, không có database riêng. UI mặc định tiếng Việt (`vue-i18n`).

## Stack

- **Runtime & build** — [Bun](https://bun.sh) (dev server, test, script), [Vite](https://vitejs.dev) cho SPA và dev middleware.
- **Frontend** — [Vue 3](https://vuejs.org) `<script setup>`, DI/IoC bằng `provide/inject` thuần + `ModeRegistry` (mỗi mode tự đăng ký), `vue-i18n` (vi/en, glob theo feature), [Vue Flow](https://vueflow.dev) cho pipeline canvas, Toast UI Editor + Mermaid cho markdown & sơ đồ, SCSS token tập trung.
- **Backend** — [Hono](https://hono.dev) trên **hai transport** (Vite middleware khi dev, `src/standalone.ts` khi chạy Node/Bun), route tự nạp từ `src/features/*/api.ts`, [Zod](https://zod.dev) validate biên I/O, không database — filesystem là nguồn sự thật.
- **Tích hợp AI** — Anthropic SDK cho wizard sinh agent bằng ngôn ngữ tự nhiên; MCP server stdio (`bun run mcp`) cho Claude Code.
- **Chất lượng** — TypeScript (`vue-tsc`), ESLint, Prettier, Commitlint, `bun test` (domain/API), Vitest + coverage (frontend), Playwright (e2e).
- **Đóng gói** — Docker Compose + Dockerfile kèm `install.sh` (xem [`docker/`](docker/)).

## Mode & khả năng chính

- **Monitor** — theo dõi task đang chạy tới đâu: danh sách task, pipeline view theo phase, HITL gate chờ duyệt, timeline, panel artifact sửa tại chỗ, hỏi đáp Q&A với runner.
- **Pipeline editor** — thiết kế luồng làm việc: kéo thả bước, gắn agent / rule / skill cho từng bước, bật auto-review và HITL, lưu thành profile.
- **Agent editor** — soạn agent riêng: sửa từng section prompt, template bước workflow, wizard sinh bản nháp từ mô tả tiếng Việt (cần `ANTHROPIC_API_KEY`).
- **Automations** — đặt luật chạy tự động: trigger theo lịch (một lần / lặp / cron) hoặc theo sự kiện, chuỗi nhiều bước `runTask`, chọn project đích cho từng bước.
- **Knowledge** — kho tri thức agent đọc khi làm việc: ghi chú theo scope project / system, chọn driver lưu trữ, tra cứu và sửa ngay trên UI.
- **Runner** — chỗ công việc chạy thật: khai báo connection, quản lý credential (vault mã hoá bằng `DASHBOARD_SECRET_KEY`), theo dõi hàng đợi job và log stdout.
- **Quick action** — chạy nhanh một action lên task/artifact đang chọn, không cần tạo task đầy đủ; menu lồng nhau.
- **Logs** — soi lại chuyện đã xảy ra: audit thao tác, request HTTP, log job; bật/tắt từng loại trong Settings.
- **Statistics** — thống kê drill-down project → task → step → job, biểu đồ pie / xychart.
- **MCP** — CRUD project registry qua stdio (`bun run mcp`), không cần HTTP server chạy.

## Data root `.dev-team-agent/`

Mọi I/O backend scope vào thư mục **`.dev-team-agent/`** của project đích:

```text
.dev-team-agent/
├── .dev-state/<task>.json      # state sống (phase, HITL, …)
├── tasks/<id>/*.md             # investigate, design, review, qa, …
├── pipeline.yaml               # + override theo task
├── pipeline-profiles/ …
└── knowledge…                  # knowledge store
```

| Run mode | Resolve root |
|----------|----------------|
| **Dev** (`bun run dev`) | `cwd/..` hoặc `DEV_TEAM_ROOT` |
| **Standalone** (`bun run serve`) | ProjectRegistry `~/.dev-team-dashboard/projects.json` (+ `DEV_TEAM_DASHBOARD_HOME`); request `?project=<id>` |

---

## Bắt đầu nhanh

Yêu cầu: **[Bun](https://bun.sh)**.

```bash
bun install
bun run dev          # Vite :5174 — single-project
bun run build        # SPA → dist/
bun run serve        # Node standalone (cần dist/) :5174
bun run start        # build + serve
bun run mcp          # MCP stdio — project registry
```

### Lệnh hữu ích

```bash
bun run lint         # ESLint
bun run lint:fix     # ESLint --fix
bun run format       # Prettier
bun run test         # bun test — domain / API
bun run test:fe      # vitest — frontend + coverage
bun run test:e2e     # Playwright
bun run test:all     # typecheck → lint → test → test:fe → e2e
bun run check:todo   # gate docs/todo (CI promote → main)
```

## Danh mục tài liệu

- [`docs/`](docs/)
  - [`architecture.md`](docs/architecture.md) — data root, Hono trên 2 transport, cây `src/`, bất biến kiến trúc
  - [`event-catalog.md`](docs/event-catalog.md) — mục lục domain event theo feature
  - [`i18n.md`](docs/i18n.md) — cách tổ chức message vi/en
  - [`ui-buttons.md`](docs/ui-buttons.md) — quy ước nút và trạng thái trên UI
  - [`diagram/IoC.md`](docs/diagram/IoC.md) — sơ đồ bootstrap & runtime của service container / ModeRegistry
  - [`implement/`](docs/implement/) — convention phát triển
    - [`feature-organization-rule.md`](docs/implement/feature-organization-rule.md) — đặt file theo feature, `business/`, helper dùng chung
    - [`coding-convention.md`](docs/implement/coding-convention.md) — ESM/TS, Zod, Vue, i18n
    - [`mode-registry-convention.md`](docs/implement/mode-registry-convention.md) — thêm mode mới ở FE shell
    - [`test-convention.md`](docs/implement/test-convention.md) — danh mục suite, chọn runner, phạm vi chạy
    - [`doc-writing-convention.md`](docs/implement/doc-writing-convention.md) — viết `investigate.md` / `design.md`
    - [`pr-docs-convention.md`](docs/implement/pr-docs-convention.md) — commit message, PR body, evidence test
    - [`git-convention.md`](docs/implement/git-convention.md) — git hygiene, tách commit
    - [`worktree-convention.md`](docs/implement/worktree-convention.md) — cô lập mỗi phiên làm việc
    - [`review-checklist-rule.md`](docs/implement/review-checklist-rule.md) — checklist review PR
    - [`todo-debt-convention.md`](docs/implement/todo-debt-convention.md) — hoãn docs/test, gate `dev/*/main` → `main`
  - [`cookbook/core-path-reorg.md`](docs/cookbook/core-path-reorg.md) — bài học đợt tái cấu trúc core/feature
  - [`template/`](docs/template/) — agent & pipeline mẫu
- [`docker/`](docker/) — Compose, Dockerfile, `install.sh`, [`.env.example`](docker/.env.example)
- Liên quan — [plugin Claude Code (bộ agent template)](docs/template/agents/) · [Issues](https://github.com/naut1402/agent-workflow/issues) · [Pull requests](https://github.com/naut1402/agent-workflow/pulls)

Branch phát hành theo dòng version: `dev/x.y.z/main` (vd `dev/1.1.2/main`). Không commit thẳng `main` — mọi thay đổi qua PR.

## License

Mã nguồn phát hành theo [MIT License](LICENSE) — © 2026 Tran Thanh Tuan.
