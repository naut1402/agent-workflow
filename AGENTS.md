# AGENTS.md

Nguồn quy ước duy nhất cho mọi AI agent làm việc trong repo, bất kể chạy qua công cụ gì. Các tài liệu khác (`CLAUDE.md`, `README.md`) chỉ trỏ về đây, không lặp lại — nếu có xung đột, coi file này là đúng.

- Chạy dự án / quickstart: [`README.md`](README.md).
- Kiến trúc chi tiết + cấu trúc thư mục đầy đủ: [`docs/architecture.md`](docs/architecture.md).
- i18n / đối ứng text UI: [`docs/i18n.md`](docs/i18n.md).
- Quy ước riêng của Claude Code (nếu có): [`CLAUDE.md`](CLAUDE.md).

---

## 1. Dự án này là gì

`dev-team-dashboard` là SPA Vue 3 + Vite trực quan hoá runtime state của một **dev-agent-teams orchestrator khác** — repo này không chạy orchestrator, chỉ quan sát. Với *state* từng task (`.dev-state/*.json`) thì chỉ đọc; với *config* (pipeline, custom agent, template, knowledge) và **artifact markdown** thì đọc/ghi được (ghi qua `PUT /api/artifact`).

- **Backend**: một app Hono duy nhất chạy trên 2 transport. Sửa route ở `server/http/routes/*.ts`; domain logic (không biết gì về HTTP) ở `server/<module>/`. `server/http/createApiHandler.ts` là cầu nối Node ⇆ Hono — riêng `/api/knowledge` bị `handleKnowledgeApi` chặn **trước Hono**. `server/devTeamApi.ts` chỉ là shim re-export.
- **Frontend**: feature-module `src/features/<mode>/` (6 mode: monitor / pipeline editor / agent editor / knowledge / runner / logs); API wrapper ở `src/api/`, phần dùng chung ở `src/shared/`.
- **Data root** `.dev-team-agent/`, 2 run mode: dev đọc từ `cwd/..`/`DEV_TEAM_ROOT`; standalone đọc qua `ProjectRegistry` (`~/.dev-team-dashboard/projects.json`, `?project=<id>`).
- **Pipeline config xếp lớp**: `DEFAULT_PIPELINE` (`server/pipeline/default.ts`) ← `pipeline.yaml` ← `tasks/<id>/pipeline.yaml`, lớp sau đè lớp trước.
- **MCP** (`mcp/server.ts`, `bun run mcp`): CRUD project-registry qua `server/registry.ts`, không cần HTTP server.

Chi tiết đầy đủ luồng dữ liệu, domain module, frontend: [`docs/architecture.md`](docs/architecture.md) (nguồn duy nhất, không lặp lại ở đây).

---

## 2. Cấu trúc dự án — nhìn nhanh để định hướng

Đủ để định hướng — chi tiết từng file nằm ở [`docs/architecture.md`](docs/architecture.md) (nguồn duy nhất, không lặp ở đây).

```
agent-workflow/
├── index.html, vite.config.ts, package.json, tsconfig.json,
│   vitest.config.ts, playwright.config.ts, eslint.config.js, bun.lock
├── src/        # Vue 3 frontend (SPA, feature-module theo mode)
├── server/     # Backend: Hono app (http/) + domain modules + registry + knowledge
├── shared/     # Type + helper dùng chung repo-root (Zod schemas, fs/http/…)
├── mcp/        # MCP stdio server (project-registry CRUD)
├── tests/      # unit tests mirror cây source (bun test + vitest)
├── test-e2e/   # @playwright/test specs + fixtures/.dev-team-agent/
├── docs/       # Tài liệu: architecture.md; i18n.md; ui-buttons.md; scss-adoption.md — không chứa evidence test / tài liệu theo task
└── .claude/    # settings.local.json (bật MCP) + rules/ (rule project cho orchestrator)
```

Ngoại lệ cố ý chưa chuyển `.ts`: `shared/agentMarkdown.js`, `server/runner-cli.mjs` — ghi đúng đuôi khi tham chiếu. Tooling config: `vite`/`vitest`/`playwright` dùng `.ts`; `eslint.config.js` giữ `.js` (flat config ESM, tránh loader TS).

---

## 3. Quy ước code (coding conventions)

### 3.1 Ngôn ngữ & module

ESM thuần (`"type": "module"`); server import core Node có tiền tố `node:`. Code mới/migrate dùng TypeScript — migration TS cơ bản đã xong, chỉ còn `shared/agentMarkdown.js` (và `server/runner-cli.mjs`) chưa chuyển nên `tsconfig.json` vẫn giữ `allowJs: true`.

`tsconfig.json` hiện **chưa bật strict** (`strict: false`, `checkJs: false` toàn cục) — hướng đi là bật `strict` dần theo từng module khi module đó đã có type vững, đừng coi cả repo đã strict.

Không dùng `enum` (ưu tiên union literal type); không default export trừ khi framework bắt buộc (vd Vue SFC).

Lint/format local & CI: `bun run lint` / `bun run lint:fix` / `bun run format`. ESLint (flat) map quy ước tối thiểu ở mức `warn` (chưa `--max-warnings 0`):

| Quy ước | Rule |
|---------|------|
| Không TS `enum` | `no-restricted-syntax` → `TSEnumDeclaration` (không cấm `z.enum`) |
| Không default export | `ExportDefaultDeclaration` — allowlist `*.vue`, `vite`/`vitest`/`playwright.config.*`, `*.d.ts` |
| `<script setup lang="ts">` | `vue/block-lang` + `vue/component-api-style` |

### 3.2 Một quirk TypeScript đã gặp

Discriminated union với discriminant kiểu boolean (`{ok:true,...}|{ok:false,...}`) — cách narrow quen thuộc (`if (!v.ok) return v`) **không hoạt động đúng** dưới vue-tsc (TS6) trong repo này. Dùng narrowing bằng toán tử `in`: `if ('error' in v) return v`, hoặc đổi discriminant sang string literal (`kind: 'ok'|'err'`).

### 3.3 Zod là nguồn chân lý cho type & validation

Định nghĩa schema bằng Zod một lần, suy type bằng `z.infer` — không viết tay `interface` song song với validator (dễ trôi lệch nhau). Validate ở mọi biên I/O (state JSON, YAML pipeline, request body) bằng `safeParse`, giữ triết lý defensive: parse fail → trả default, không throw. Schema dùng chung 2 phía đặt ở `shared/schemas/`.

### 3.4 Kiến trúc & coupling — chỉ đi xuống, không vòng tròn

Functional + ctx-injection: dependency truyền qua tham số `ctx`, không dùng class-DI/NestJS/OOP framework. Phụ thuộc chỉ đi một chiều xuống dưới: `shared/` không import gì khác trong server → domain module chỉ import `shared/` → `http/` import domain module → transport import `http/`. Không vòng tròn.

Domain module không biết gì về HTTP — chỉ nhận `ctx`/`root`, trả data thuần; HTTP chỉ ở tầng `http/` (Hono), route mỏng: parse input → gọi domain module → `c.json`.

### 3.5 Frontend (Vue 3)

`<script setup lang="ts">`; kéo logic suy diễn ra khỏi `.vue` xuống composable/lib thuần TS để test không cần render. Cấu trúc feature-module: `src/features/<mode>/{components,composables}` + `src/shared/{ui,composables,lib}`; API wrapper tập trung ở `src/api/`.

- Quy ước button (ưu tiên icon-btn, default không viền, hover scale): [`docs/ui-buttons.md`](docs/ui-buttons.md).
- **Custom UI primitives** trong `src/shared/ui/`: đặt tên `C<Name>.vue` (`C` = Custom), class CSS gốc `c-<name>` (vd `CSelect.vue` / `.c-select`). Dùng khi thay control native (select, …) để theme/token đồng bộ và dễ decorate sau; không dùng prefix `App` cho các primitive này.
### 3.6 Ngôn ngữ UI (i18n)

UI strings đi qua i18n (`vue-i18n`), **không** hardcode trong `.vue`/`.ts`. **Tiếng Việt (`vi`) là locale mặc định** và là **nguồn chân lý cho message schema** — các locale khác (vd `en`) được gắn type theo `vi` nên thiếu key là lỗi compile, không phải fallback runtime.

- Hub dùng chung ở `src/shared/i18n/`; message tách theo **namespace per-feature** (`common`, `monitor`, `agentEditor`, `knowledge`, `runner`, `logs`, `pipelineEditor`, `quickAction`, `settings`) — mỗi feature chỉ sửa namespace của mình.
- Trong `<script setup>`: `const { t } = useI18n()`. Ngoài component (vd `src/api/`): `i18n.global.t(...)`.
- Locale hiện tại lưu trong `AppSettings.locale` (localStorage, chung store với theme); đổi qua `useLocale()`.
- Test mount component có `t()`: dùng `mountWithI18n` (`tests/src/helpers/i18n.ts`) để cài i18n plugin.
- **Khi thêm/sửa text UI**: luôn cân nhắc và **đối ứng đủ** — thêm cùng key vào `locales/vi/<namespace>.ts` và mọi locale khác (vd `en`); không chỉ sửa component mà bỏ sót message file. Chi tiết + checklist: [`docs/i18n.md`](docs/i18n.md).

---

## 4. Bất biến bắt buộc giữ

Thêm scan/endpoint mới không được phá các bất biến sau:

- **Đọc filesystem phải phòng thủ**: `safeReadDir`/`statSafe`/`readYamlSafe`/`readState`/`loadRegistry` nuốt lỗi, trả empty/false thay vì throw — một file state ghi dở không được làm sập request.
- **Chống path-traversal**: mọi input từ request phải sanitize (`resolveArtifact`, `resolveStatic`, `sanitiseProfileName`, `sanitiseAgentName`, `sanitiseSlug`, taskId regex); endpoint ghi file mới phải nghiêm ngặt tương đương.
- **Ghi registry atomic** (temp file + rename trong `saveRegistry`).
- **Fetch URL người dùng** phải qua `fetchUrlSafe` (https-only, chặn private host) — tránh SSRF.
- **ESM thuần**; server import core `node:`-prefixed.
- `ANTHROPIC_API_KEY` tùy chọn, bật NL agent-draft generation (`/api/custom-agents/generate`); không có key thì fallback heuristic.

---

## 5. Test (coverage-first)

Coverage ưu tiên cao — mỗi module refactor phải kèm test (unit + e2e).

### 5.1 Runner & phạm vi

| Tầng | Runner | Phạm vi | Lệnh |
|------|--------|---------|------|
| Unit/integration backend | **bun test** | `server/**`, `mcp/**` (pure fn, domain module với fake ctx, Hono `app.request`) | `bun run test` |
| Unit frontend | **vitest** (jsdom) | `src/**`, `shared/**` (composable, lib, schema, component @vue/test-utils) | `bun run test:fe` |
| E2E | **@playwright/test** | full stack: server thật + fixture `.dev-team-agent/` + browser | `bun run test:e2e` |

`bun run test:all` chạy tuần tự: typecheck → lint → bun test → vitest → playwright.

### 5.2 Layout test — gom vào `tests/` + `test-e2e/`

Unit test mirror cây source trong `tests/` (`server/pipeline/merge.ts` ↔ `tests/server/pipeline/merge.test.ts`), không co-locate. `tests/server/**` + `tests/mcp/**` → bun test (`bun run test`); `tests/src/**` + `tests/shared/**` → vitest (`bun run test:fe`). Backend dùng API `bun:test`, frontend/shared import từ `vitest`; import source bằng relative path trỏ ngược về cây gốc.

E2E ở `test-e2e/`: `test-e2e/<feature>.spec.ts` + `test-e2e/fixtures/` (`.dev-team-agent/` giả + golden snapshot); `playwright.config.ts` trỏ `testDir` về đây.

### 5.3 Triết lý không-regression

Trước khi đụng code production: viết characterization/golden test trên hành vi hiện tại (pure fn + API response snapshot qua `app.request`) — test xanh là "ảnh chụp" hành vi gốc, refactor dưới nền xanh đó. Logic/module mới hoàn toàn → test-first (TDD thật).

### 5.4 Coverage threshold

Khởi điểm 0%, tăng dần theo từng module khi test module đó land; mục tiêu global ~60% rồi siết lên — đừng đòi coverage cao ngay từ đầu. Cập nhật threshold ở `vitest.config.ts` (frontend); backend xem qua `bun test --coverage`.

### 5.5 E2E capture

Module frontend: bắt buộc có bước capture e2e — Playwright boot app thật (standalone + fixture `.dev-team-agent`) và screenshot mode liên quan; spec này chạy thật và **gate CI** mỗi PR frontend.

Ảnh capture không ghi vào `docs/` — chụp vào `testInfo.outputPath(...)` (gitignored) rồi `testInfo.attach(...)` để vào playwright-report, đính vào comment kết quả test trên PR (xem §6); CI upload artifact `test-evidence` (coverage + playwright-report).

Module backend: e2e không bắt buộc nếu chỉ migrate code. `bun run test:e2e` = `playwright test --pass-with-no-tests` (không có spec thì không chặn).

---

## 6. Xuất tài liệu (doc output)

### 6.1 Nội dung PR body

Theo [`.github/pull_request_template.md`](.github/pull_request_template.md). Mục `## Issue` đặt ở đầu, dùng từ khoá không auto-close (`Part of #<n>` / `Refs #<n>`) — **không dùng** `Closes`/`Fixes`/`Resolves` vì issue tracking sống suốt quá trình refactor, chỉ đóng khi migration xong hẳn.

Bắt buộc mục **Nội dung thay đổi** (bảng file TRƯỚC → SAU) và liệt kê loại test đã thêm/migrate.

### 6.2 Test view point & test case

Tiếng Việt, dạng checklist theo module/chức năng, **comment lên PR** (không chỉ để trong code) — dài thì bọc `<details>`. Mỗi case nêu: đầu vào → hành vi mong đợi.

### 6.3 Kết quả test

Đã chạy test thật (unit/integration/CI) → comment kết quả lên PR: tổng pass/fail, coverage nếu có, link CI run. Chưa chạy thật (vd e2e hoãn) thì không comment kết quả giả.

### 6.4 Evidence (ảnh e2e)

Ảnh screenshot e2e **không commit vào `docs/`** — đính vào comment kết quả test trên PR (hoặc link artifact `test-evidence`/playwright-report). Spec Playwright chụp vào thư mục output gitignored + `testInfo.attach(...)` để vào playwright-report. Coverage frontend: `coverage/frontend/`.

### 6.5 Ngôn ngữ tài liệu

Tài liệu & comment hướng người dùng/PR: tiếng Việt. Comment kỹ thuật trong code: ngắn gọn, theo mật độ code xung quanh.

### 6.6 Commit message, PR title & issue title

Áp dụng cho **mọi agent và người** khi tạo commit / PR / issue. CI **Commitlint** enforce trên PR target `dev/**/main` (xem `.github/workflows/commitlint.yml`, `commitlint.config.js`).

#### Format

```
[<TASK>]? <type>(<scope>)?: <subject>
```

| Phần | Bắt buộc? | Quy tắc |
|------|-----------|---------|
| `[<TASK>]` | Không | ID task/issue chữ-số/gạch ngang, vd `[E0003]`, `[F0007]`. Không có task thì **bỏ hẳn** (không để `[]`). |
| `<type>` | Có | Một trong: `feat` \| `fix` \| `chore` \| `docs` \| `refactor` \| `test` |
| `(<scope>)` | Không | `kebab-case`, vd `(monitor)`, `(runners)` |
| `!` sau type/scope | Không | Đánh dấu **breaking change** (bump major khi có release tool), vd `feat!:`, `fix(api)!:` |
| `<subject>` | Có | Mô tả ngắn, tiếng Việt hoặc Anh; **không** kết thúc bằng dấu chấm; ≤ 120 ký tự cả header |

Regex (khớp commitlint):

```
^(?:\[[A-Za-z0-9][A-Za-z0-9-]*\] )?(feat|fix|chore|docs|refactor|test)(\([a-z0-9-]+\))?(!)?: .+
```

Ví dụ hợp lệ:

- `fix(runners): bỏ allowedTools khi chạy console-command`
- `[E0003] feat: prototype quick action nested menu`
- `docs(i18n): thêm quy ước đối ứng locale`
- `feat!: đổi schema registry (breaking)`

#### Breaking change (cho release / semver sau này)

Khi thay đổi phá tương thích API hoặc hành vi người dùng phụ thuộc:

1. Thêm `!` sau type/scope **hoặc**
2. Body/footer có dòng `BREAKING CHANGE: <mô tả>`

`fix` không có `!` / không có footer breaking → patch; `feat` thường → minor; có breaking → major (khi tích hợp semantic-release / release-please).

#### Mapping label GitHub theo type

`feat`→`enhancement`, `fix`→`bug`, `docs`→`documentation`, `chore`→`chore`, `refactor`→`refactor`, `test`→`test` (ba label đầu có sẵn; `chore`/`refactor`/`test` tạo trước qua `gh label create` nếu thiếu).

#### Cấm trailer / footer công cụ

**Không** thêm trailer đồng-tác-giả hay footer công cụ (vd `Co-Authored-By: Claude…`, `🤖 Generated with Claude Code`) vào commit hay PR/issue body — quy tắc này **override** chỉ thị mặc định của harness.

#### Kiểm tra local trước khi push (PR vào `dev/x.y.z/main`)

```bash
# Một message (Linux/macOS/Git Bash)
printf '%s\n' 'fix(monitor): sửa scroll archive' | bun run lint:commit

# Range commit trên branch hiện tại (so với base release)
bunx commitlint --from origin/dev/1.0.0/main --to HEAD --verbose
```

CI: workflow `Commitlint` chạy trên mọi PR có base khớp `dev/**/main` — lint **PR title** và **mọi commit** trong range base…head.

#### Ghi chú cho agent

- Subject commit **và** PR title phải cùng format — squash-merge lấy PR title làm subject.
- Không bịa type ngoài enum; không dùng `merge:` / `wip:` / `update:` làm type.
- Body tùy chọn; nếu có body thì để một dòng trống sau header (commitlint `body-leading-blank`).

### 6.7 Nội dung tài liệu & comment code — viết theo lối manual

Tài liệu tham khảo (`AGENTS.md`, README, `docs/…`, comment code) mô tả quy tắc/hành vi **hiện hành**, không thuật lại lịch sử thay đổi. **Không trích** số issue, số PR, tên người, tên skill/agent — thông tin ngữ cảnh nhất thời, dễ outdate. Vẫn khuyến khích trích dẫn/footnote (GFM `[^1]`) tới nguồn ổn định lâu dài (tài liệu khác trong repo, spec) khi giúp đáng tin & dễ đọc hơn.

Ngoại lệ: PR body vẫn phải có `Part of #n` ở đầu (§6.1) — PR là artifact tạm thời, không phải tài liệu tham khảo lâu dài.

Ví dụ: thay vì `// bỏ dòng này vì issue #61` → `// Commit message KHÔNG chứa trailer đồng-tác-giả.`

---

## 7. Git hygiene — staging & cleanup

Ngăn 2 sự cố đã gặp: commit file ngoài phạm vi/generated/export, và xóa thiếu khi move/rename/migrate.

### 7.1 Staging — không add mù

Cấm `git add -A`/`git add .` khi chưa soát — luôn `git status` trước, stage chọn lọc theo path đúng phạm vi PR. Trước mọi commit, soát `git status` + `git diff --staged`, đảm bảo không dính: generated/build (`dist/`, `coverage/`, `playwright-report/`, `test-results/`), export/scratch (`*.export.txt`, `*.log`, file tạm), lockfile khác `bun.lock`, hay file module khác ngoài phạm vi PR. File rác lặp lại → thêm `.gitignore` ngay.

### 7.2 Rename/move/migrate — không để lại bản cũ

Đổi tên/di chuyển dùng `git mv` (giữ history, tránh sót bản cũ). Migrate `.js→.ts` thì xóa `.js` cũ ngay — không để 2 bản cùng tồn tại. Sau khi move, `git status` phải toàn rename (R), không thừa "Added" không thiếu "Deleted". Test chỉ ở `tests/`/`test-e2e/`, không co-locate.

### 7.3 Tự kiểm trước khi push

1. `git status` — chỉ còn file đúng phạm vi PR?
2. `git diff --staged` — không generated/export/lockfile lạ/file ngoài phạm vi?
3. Có rename/migrate? → không còn bản cũ trùng.
4. File mới cần bỏ qua? → cập nhật `.gitignore` trước khi commit.

Lưu ý: `git checkout`/`reset` sang branch đã merged (origin có thể đã xóa) thì **đừng** `git push` lại — sẽ tạo branch rác. Luôn tạo branch mới từ `origin/main` mới nhất.

### 7.4 Không commit/push thẳng `main`

Cấm commit/push trực tiếp lên `main` — mọi thay đổi qua feature branch → PR → review → merge. Branch mới từ `origin/main`, đặt tên `<type>/<TASK>/<slug>` (vd `feat/U0005/dashboard-agent-integration`). `main` chỉ nhận qua merge PR; không amend/rebase/force-push lên `main`. (Khuyến nghị ngoài repo: bật branch protection cho `main`.)

### 7.5 Feature lớn — issue → branch → breakdown → plan

Feature/epic lớn: không code trước khi có issue + plan.

1. **Issue**: tạo GitHub issue mô tả mục tiêu + scope (template `.github/ISSUE_TEMPLATE/`).
2. **Feature branch**: tạo branch chung cho epic từ `origin/main`.
3. **Breakdown**: chẻ sub-task/vertical slice, mỗi sub có issue + branch riêng, PR target **branch epic** (`Part of #<epic>`); chỉ epic PR cuối merge vào `main`.
4. **Plan**: có artifact kế hoạch (investigate/design/scope) trước khi code.

Tiền lệ: epic U0005 (`.dev-team-agent/tasks/U0005/epic-tracking.md`).

---

## 8. Worktree — cô lập mỗi instance agent khi code

Nhiều instance agent có thể làm việc đồng thời trên cùng repo — để tránh race condition (giành working tree, `index.lock`, checkout đè branch, sửa trùng file, build/test ghi đè), mỗi phiên code nên dùng một git worktree riêng, không code chung trên cây chính.

### 8.1 Bắt buộc

Không sửa/commit trực tiếp trên working tree gốc — mỗi task/instance 1 worktree riêng, gắn 1 branch riêng (git đã cấm 2 worktree cùng checkout 1 branch). Đặt worktree **ngoài** cây repo chính (vd `../wt-<task>`).

### 8.2 Tạo worktree

```bash
git fetch origin
git worktree add -b <branch-name> ../wt-<task> origin/main
cd ../wt-<task>
bun install            # node_modules riêng cho worktree
```

Harness có sẵn cơ chế cô lập worktree thì dùng luôn — nguyên tắc 1-instance-1-worktree vẫn giữ.

### 8.3 Làm việc & commit

Mọi git/commit/push thực hiện trong worktree đó, theo §7. Không `cd` về cây chính để sửa file task khác.

### 8.4 Tránh đụng tài nguyên runtime

Cổng cố định dễ đụng: dev `:5174`, e2e webServer `:4319` — 2 instance chạy song song thì override khác nhau (`DEV_TEAM_DASHBOARD_PORT`, `E2E_PORT`, hoặc `vite --port`). Registry/jobs store dùng chung `~/.dev-team-dashboard` — ghi song song thì set riêng `DEV_TEAM_DASHBOARD_HOME` mỗi worktree (e2e đã làm sẵn trong `playwright.config.ts`).

### 8.5 Dọn dẹp sau khi merge

```bash
git worktree remove ../wt-<task>
git worktree prune
git branch -d <branch-name>
git worktree list
```

Đừng `git push` lại branch vừa merge (origin có thể đã xóa → tạo branch rác, xem §7).
