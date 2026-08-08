# Todo — chore-add-clone-repo-from-git

- **Issue / epic:** 1.0.3 (clone project từ Git + chọn branch)
- **Loại nợ:** other
- **Branch / PR tạo nợ:** `dev/1.0.3/chore-add-clone-repo-from-git` / [#192](https://github.com/naut1402/agent-workflow/pull/192)
- **Ngày tạo:** 2026-08-08

## Vì sao hoãn

PR ship nhanh ownership **project registry + clone** sang `monitor` (cùng UX task). Trong lúc chuyển đã đụng **file chung / feature khác** ngoài phạm vi monitor thuần — chưa tách boundary sạch (shell vs settings vs monitor) và chưa có refactor follow-up. Ghi nợ làm **evidence** khi refactor sau trên dòng `dev/1.0.3` (trước promote `dev/1.0.3/main` → `main` phải trả / xóa `docs/todo/`).

## Chi tiết chỉnh sửa (phần chung) — evidence

### Core / shell

| Path | Thay đổi | Vì sao đụng |
|------|----------|-------------|
| `src/App.vue` | `fetchProjects` đổi import `settingsApi` → `monitorApi` | Shell load danh sách project; trước gắn settings, sau gắn monitor |

### Feature khác — `settings`

| Path | Thay đổi | Vì sao đụng |
|------|----------|-------------|
| `src/features/settings/api.ts` | Gỡ `GET/POST/DELETE /api/projects*` | Chuyển ownership route sang monitor |
| `src/features/settings/controller.ts` | Gỡ `getProjects` / `createProject` / `deleteProject` / … | Cùng ownership |
| `src/features/settings/scripts/settingsApi.ts` | Chỉ còn `browseFs`; bỏ `fetchProjects` / `addProject` / `removeProject` | FE project không còn thuộc settings |
| `src/features/settings/business/index.ts` | Re-export `parseGithubRepoRef` / `resolveGithubTokenForRepo` | Peer surface PAT cho `monitor` clone (không phải registry) |

**Không đụng (giữ settings):** autoscan UI/API, GitHub tokens UI/API, `fs/browse`, locales Settings “Projects” tab (whitelist autoscan — khác registry CRUD).

### Feature chính — `monitor` (tham chiếu)

- `business/projects/cloneProject.ts` — clone + `setProjectBranch`; import PAT qua `settings/business/index`
- `api.ts` / `controller.ts` — sở hữu `/api/projects*` (+ `PATCH .../branch`)
- `scripts/monitorApi.ts` — FE project API
- `components/ProjectBar.vue`, locales, `schemas/taskCreate` + `business/tasks/create` — branch metadata task
- Test: `tests/.../ProjectBar.test.ts`

## Việc cần làm khi đối ứng

- [ ] **Boundary project registry:** thống nhất một feature sở hữu (monitor) trong `docs/implement/feature-organization-rule.md` / architecture — shell (`App.vue`) và peer chỉ gọi qua `monitor` business/`*Api`, không “lỡ” gắn lại settings
- [ ] **PAT / GitHub helpers:** cân nhắc module peer rõ (vd giữ export settings như hiện tại, hoặc `core`/shared nhỏ) để clone không import sâu schema settings; cập nhật convention nếu đổi
- [ ] **Autoscan vs registry:** autoscan vẫn ghi registry từ settings business — document hoặc tách contract “ai được `registry.add`” để tránh hai cửa vào
- [ ] **Branch metadata task:** `CreateTaskRequest.branch` / state / job metadata — review có cần API riêng hay gộp policy worktree sau; bổ sung test backend nếu giữ
- [ ] **Test nợ:** unit/integration cho `cloneProject` + `POST /api/projects` `{ gitUrl }` (hiện chủ yếu ProjectBar vitest + golden CRUD path cũ)
- [ ] Xóa **cả thư mục** `docs/todo/` khi không còn file nợ nào (bắt buộc trước merge version main)

## Ghi chú

- URL `/api/projects*` **không đổi** — chỉ đổi feature bind controller; golden HTTP cũ vẫn chạy.
- PR đã cố ý **không** mang knowledge-scan; nợ này không cover knowhow.
- Khi trả nợ: ưu tiên docs boundary + test clone trước khi đụng lại autoscan.
