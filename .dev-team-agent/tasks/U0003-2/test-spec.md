# Test Spec — U0003-2

## 1. Phạm vi test

Feature **Git workspace onboarding**: đăng ký project bằng HTTPS Git URL (shallow clone), sync (`git pull` / re-clone), REST `POST /api/projects` và `POST /api/projects/:id/sync`, CLI `bun run workspace:sync`, UI `ProjectBar` tab Git + nút Đồng bộ, MCP `add_project { gitUrl }`.

| Tầng | Runner | File chính |
|---|---|---|
| Schema / URL guard | vitest | `tests/shared/schemas/project.test.ts`, `tests/shared/git/url.test.ts` |
| Git workspace domain | bun test | `tests/server/git/workspace.test.ts` |
| Registry | bun test | `tests/server/registry.test.ts` |
| HTTP contract | bun test | `tests/server/http/api.golden.test.ts` |
| MCP | bun test | `tests/mcp/server.test.ts` |
| Frontend UI | vitest (đề xuất) | `tests/src/features/monitor/ProjectBar.test.ts` (chưa có) |
| CLI | bun test (đề xuất) | `tests/scripts/workspace-sync.test.ts` (chưa có) |

**Lưu ý CI:** Mọi thao tác `git` phải **mock** `runGit` — không gọi network thật.

---

## 2. Test cases

### TC-01: validateGitUrl chấp nhận HTTPS public
- **Type**: Normal
- **Input**: `https://github.com/org/repo.git`
- **Expected output**: `{ ok: true, normalizedUrl: 'https://github.com/org/repo.git' }`
- **Setup**: Không
- **Notes**: Đã cover vitest `tests/shared/git/url.test.ts`

### TC-02: validateGitUrl chuẩn hóa trailing slash
- **Type**: Boundary
- **Input**: `https://github.com/org/repo.git/`
- **Expected output**: `normalizedUrl` không có slash cuối path
- **Setup**: Không
- **Notes**: Đã cover vitest

### TC-03: validateGitUrl từ chối HTTP
- **Type**: Abnormal
- **Input**: `http://github.com/org/repo.git`
- **Expected output**: `{ ok: false, error: 'only https URLs allowed' }`
- **Setup**: Không
- **Notes**: Đã cover vitest + golden API

### TC-04: validateGitUrl từ chối private host
- **Type**: Abnormal
- **Input**: `https://127.0.0.1/repo.git`, `https://localhost/repo.git`
- **Expected output**: `{ ok: false, error: 'private hosts not allowed' }`
- **Setup**: Không
- **Notes**: Đã cover vitest

### TC-05: AddProjectRequest — exactly one path hoặc gitUrl
- **Type**: Boundary
- **Input**: `{}`, `{ path, gitUrl }`, `{ path }`, `{ gitUrl }`
- **Expected output**: Chỉ single-field parse success; còn lại fail message `exactly one of path or gitUrl is required`
- **Setup**: Không
- **Notes**: Đã cover vitest + golden API (path+gitUrl)

### TC-06: normalizeProject legacy thiếu kind
- **Type**: Regression
- **Input**: Registry entry cũ không có `kind`
- **Expected output**: `kind: 'local'`, `source: undefined`
- **Setup**: `saveRegistry` với entry legacy
- **Notes**: Đã cover `registry.test.ts`

### TC-07: addFromGit tạo project kind git với source
- **Type**: Normal
- **Input**: `gitUrl: 'https://github.com/org/my-repo.git'`, `branch: 'main'`, mock `runGit` tạo `.dev-team-agent` trong clone dir
- **Expected output**: `{ ok: true, project.kind: 'git', project.source.url, project.path` chứa `.dev-team-agent` }
- **Setup**: `DEV_TEAM_DASHBOARD_HOME` tmp
- **Notes**: Đã cover `registry.test.ts`

### TC-08: addFromGit idempotent cùng URL + branch
- **Type**: Normal
- **Input**: Gọi `addFromGit` hai lần cùng `gitUrl` + `branch`
- **Expected output**: Lần hai trả cùng `project.id`, không duplicate registry
- **Setup**: Mock clone
- **Notes**: Đã cover `registry.test.ts`

### TC-09: addFromGit URL khác branch → project mới
- **Type**: Normal
- **Input**: Cùng `gitUrl`, `branch: 'main'` vs `branch: 'develop'`
- **Expected output**: Hai `project.id` khác nhau
- **Setup**: Mock clone
- **Notes**: Chưa có test riêng — nên bổ sung

### TC-10: addFromGit clone fail → cleanup workspace
- **Type**: Abnormal
- **Input**: Mock `runGit` throw `branch not found`
- **Expected output**: `{ ok: false, status: 400 }`, error chứa `git clone failed`, thư mục `workspaces/` đã xóa
- **Setup**: Tmp home
- **Notes**: Đã cover `registry.test.ts` (chưa assert dir cleaned)

### TC-11: addFromGit clone OK nhưng thiếu `.dev-team-agent`
- **Type**: Abnormal
- **Input**: Mock clone không tạo `.dev-team-agent`
- **Expected output**: `{ ok: false, status: 400 }`, workspace dir cleaned
- **Setup**: Tmp home
- **Notes**: **Chưa cover** — cần bổ sung (design §4.4)

### TC-12: branch omitted → default `main`
- **Type**: Boundary
- **Input**: `addFromGit({ gitUrl })` không truyền branch
- **Expected output**: `source.branch === 'main'`
- **Setup**: Mock clone
- **Notes**: Implicit trong TC-07; nên assert explicit

### TC-13: rename workspace provisionalId → finalId khi id đổi
- **Type**: Boundary
- **Input**: `name` explicit khác derived → `makeId(validated.name, path)` ≠ provisionalId
- **Expected output**: Thư mục `workspaces/<finalId>/` tồn tại, provisional dir không còn
- **Setup**: Mock clone + tên custom
- **Notes**: Chưa có test riêng

### TC-14: POST /api/projects local path regression
- **Type**: Regression
- **Input**: `{ path: <dir có .dev-team-agent> }`
- **Expected output**: `201`, `kind: 'local'`, không `source`
- **Setup**: Golden fixture `localProj`
- **Notes**: Đã cover `api.golden.test.ts`

### TC-15: POST /api/projects gitUrl happy path (HTTP)
- **Type**: Normal
- **Input**: `{ gitUrl, branch }` với mock git
- **Expected output**: `201`, body `project` parse được `Project` schema, `kind: 'git'`
- **Setup**: Tmp registry + mock
- **Notes**: **Chưa cover golden** — chỉ unit registry

### TC-16: syncGitProject cập nhật lastSyncAt
- **Type**: Normal
- **Input**: Git project đã add, mock pull ok
- **Expected output**: `{ ok: true, syncedAt }`, `project.source.lastSyncAt` mới hơn trước sync
- **Setup**: `addFromGit` trước
- **Notes**: Đã cover `registry.test.ts`

### TC-17: pullOrReclone — pull fail → re-clone
- **Type**: Abnormal
- **Input**: Mock pull throw, clone success
- **Expected output**: Return `'recloned'`, `.dev-team-agent` vẫn tồn tại
- **Setup**: Tmp workspace dir
- **Notes**: Đã cover `workspace.test.ts`

### TC-18: POST /api/projects/:id/sync local project
- **Type**: Abnormal
- **Input**: Sync id project `kind: 'local'`
- **Expected output**: `400`, `error: 'not a git project'`
- **Setup**: Add local qua API
- **Notes**: Đã cover golden

### TC-19: POST /api/projects/:id/sync unknown id
- **Type**: Abnormal
- **Input**: `POST /api/projects/nope/sync`
- **Expected output**: `404`
- **Setup**: Không
- **Notes**: Đã cover golden

### TC-20: MCP add_project gitUrl mocked
- **Type**: Normal
- **Input**: `handleAddProject({ gitUrl: 'https://github.com/org/mcp-repo.git' })`
- **Expected output**: Không `isError`, project trong list
- **Setup**: Mock `runGit` / `addFromGit`
- **Notes**: Đã cover `mcp/server.test.ts`

### TC-21: MCP add_project thiếu path và gitUrl
- **Type**: Abnormal
- **Input**: `{}` hoặc `{ path, gitUrl }`
- **Expected output**: `isError: true`
- **Setup**: Không
- **Notes**: Đã cover

### TC-22: CLI workspace:sync một project
- **Type**: Normal
- **Input**: `bun scripts/workspace-sync.ts --project=<git-id>`
- **Expected output**: Exit 0, stdout chứa `synced at`
- **Setup**: Mock `syncGitProject` success
- **Notes**: **Chưa cover**

### TC-23: CLI workspace:sync all git projects
- **Type**: Normal
- **Input**: Không `--project`, registry có 2 project `kind:'git'`
- **Expected output**: Exit 0, log mỗi id
- **Setup**: Mock sync
- **Notes**: **Chưa cover**

### TC-24: CLI workspace:sync fail → exit 1
- **Type**: Abnormal
- **Input**: `--project=<id>`, sync trả error
- **Expected output**: Exit 1, stderr có message
- **Setup**: Mock sync fail
- **Notes**: **Chưa cover**

### TC-25: GET /api/tasks sau git add — monitor không đổi contract
- **Type**: Regression
- **Input**: Add git project (mock), `GET /api/tasks?project=<id>`
- **Expected output**: `200`, tasks đọc từ canonical `path`
- **Setup**: Fixture tasks trong clone mock
- **Notes**: Chưa cover end-to-end HTTP; risk thấp vì `path` semantics giữ nguyên

### TC-26: Auth token khi DEV_TEAM_API_TOKEN set
- **Type**: Abnormal
- **Input**: POST add/sync không header vs có `Authorization: Bearer`
- **Expected output**: `401` / `201|200`
- **Setup**: Env token (sau merge #40)
- **Notes**: Deferred — ghi trong `typecheck.md`

### TC-27: UI ProjectBar — tab Git URL submit
- **Type**: Normal
- **Input**: Chọn tab Git, nhập URL + branch, click Thêm
- **Expected output**: Gọi `addGitProject`, emit `changed`, hiện badge `git`
- **Setup**: Mock fetch / api module
- **Notes**: **Chưa cover** vitest

### TC-28: UI ProjectBar — nút Đồng bộ
- **Type**: Normal
- **Input**: Click ↻ trên project `kind:'git'`
- **Expected output**: Gọi `syncProject(id)`, tooltip `lastSyncAt`; lỗi hiện tiếng Việt
- **Setup**: Mock api
- **Notes**: **Chưa cover** vitest

### TC-29: Concurrent sync cùng project id
- **Type**: Boundary
- **Input**: Hai `syncGitProject(id)` đồng thời
- **Expected output**: Cả hai complete, không corrupt registry (queue lock)
- **Setup**: Mock pull chậm
- **Notes**: Chưa cover — design chọn queue chờ

### TC-30: remove git project không xóa clone dir
- **Type**: Regression (documented MVP)
- **Input**: `remove(id)` project git
- **Expected output**: Registry gỡ; `workspaces/<id>/` vẫn trên disk
- **Setup**: Add git mock, remove
- **Notes**: Manual / doc acceptance — out of scope auto cleanup

---

## 3. Coverage matrix

| Acceptance Criteria (issue #41 / design) | TC liên quan | Trạng thái |
|---|---|---|
| AC-1: `Project.kind` + `source` cho git | TC-06, TC-07 | [x] unit |
| AC-2: `POST /api/projects { gitUrl }` → clone → path | TC-07, TC-15 | [~] unit ok, golden thiếu |
| AC-3: `POST /api/projects/:id/sync` pull/reclone | TC-16, TC-17, TC-18, TC-19 | [x] |
| AC-4: CLI `workspace:sync` | TC-22, TC-23, TC-24 | [ ] chưa có test |
| AC-5: UI tab Git + Sync | TC-27, TC-28 | [ ] chưa có test |
| AC-6: MCP `add_project` gitUrl | TC-20, TC-21 | [x] |
| HTTPS-only + chặn private host | TC-03, TC-04 | [x] |
| Idempotent cùng URL+branch | TC-08 | [x] |
| Legacy registry không `kind` | TC-06 | [x] |
| Local add regression | TC-14 | [x] |
| Clone fail / missing `.dev-team-agent` cleanup | TC-10, TC-11 | [~] TC-11 thiếu |
| Auth khi token set (#40) | TC-26 | [ ] deferred |

---

## 4. Regression risk

| Khu vực | Rủi ro | Hành động đề xuất |
|---|---|---|
| `resolveProjectRoot` / monitor polling | `path` sai sau git add → tasks 404 | TC-25; manual chọn project git trên UI |
| `loadRegistry` entry cũ | Parse fail hoặc mất project | TC-06 |
| Idempotent local `add({ path })` | Duplicate hoặc kind sai | TC-14 |
| `POST /api/projects` catch-all 405 | Route sync bị shadow | Đảm bảo sync route trước `app.all` — review code |
| Registry atomic write | Corrupt JSON khi concurrent add+sync | TC-29 optional stress |
| Docker thiếu `git` binary | Clone fail production | Manual verify image sau #40 |
| Disk đầy `workspaces/` | Clone/sync 500 | Manual ops — ghi `deploy.md` |

---

## 5. Lệnh chạy test (PR comment)

```bash
bun run typecheck
bun test tests/server tests/mcp
bun run test:fe
# Sau bổ sung test CLI/UI:
# bun test tests/scripts
# bun run test:fe -- tests/src/features/monitor
```

Kết quả hiện tại (implement): typecheck PASS, 198 backend PASS, 107 frontend PASS — xem `typecheck.md`.
