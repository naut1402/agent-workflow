Reviewed commit: 5cfe7076c3479b634eae75897b586927d57a1003

# Review — U0003-2: Git workspace onboarding trên server

## Phạm vi đã review

- Commit `5cfe707` — `feat(registry): git workspace onboarding via HTTPS URL`
- Đối chiếu `design.md` §4–§5, `typecheck.md` (typecheck + 198 backend / 107 frontend tests PASS)
- Project rules: coding + test (Zod SSOT, defensive FS, mock git trong CI)

---

## Findings

### [should] mcp/server.ts:32-48 — Schema `AddProjectInput` trùng lặp `AddProjectRequest`

  Context: Quy ước project yêu cầu Zod schema là single source of truth tại `shared/schemas/`. MCP định nghĩa lại `superRefine` exactly-one path|gitUrl thay vì import `AddProjectRequest` / `parseAddProjectRequest` từ `shared/schemas/project.ts`. Hai schema có thể lệch khi sửa sau này.
  Suggestion: `import { AddProjectRequest } from '../shared/schemas/project.js'` và dùng `AddProjectRequest.safeParse(input)` trong `handleAddProject`.

### [should] tests/server/http/api.golden.test.ts — Thiếu golden test POST gitUrl happy path → 201

  Context: Design §5 yêu cầu `POST /api/projects { gitUrl, branch }` mocked → 201 + shape `Project`. Hiện chỉ có regression local path, validation 400, sync 404/400; happy path git chỉ cover ở `tests/server/registry.test.ts` (unit), không qua HTTP stack Hono.
  Suggestion: Thêm test inject `runGit` mock (hoặc spy `addFromGit`) qua fixture tmp + assert 201, `kind:'git'`, `source.url`.

### [should] tests/server/registry.test.ts — Thiếu test clone OK nhưng không có `.dev-team-agent`

  Context: Design §4.4: clone thành công nhưng `validateProjectPath` fail → cleanup dir → 400. `mockRunGit` hiện luôn tạo `.dev-team-agent`, không cover nhánh lỗi quan trọng cho operator.
  Suggestion: Mock `runGit` clone không tạo `.dev-team-agent`, assert `r.ok === false`, `status 400`, và `workspaceDir` đã bị `cleanupWorkspace`.

### [should] tests/ — Không có test cho `scripts/workspace-sync.ts`

  Context: Design §5 item 8 và §4.2.6 yêu cầu CLI `bun run workspace:sync --project=<id>` exit 0 khi mock. Script mới chưa có characterization test.
  Suggestion: Thêm `tests/scripts/workspace-sync.test.ts` (bun test) mock `syncGitProject` / registry list, assert exit code và stdout.

### [should] tests/src/ — Không có unit test `ProjectBar.vue` (tab Git / nút Đồng bộ)

  Context: Rule test yêu cầu module frontend có vitest khi logic UI mới. `ProjectBar` thêm tab Git URL, badge, sync — chưa có test composable hoặc component.
  Suggestion: Tách `submitAdd`/`onSync` logic ra composable testable, hoặc vitest + `@vue/test-utils` smoke test tab switch và gọi `addGitProject`/`syncProject`.

### [should] server/git/workspace.ts:4 — Circular import `registryHome` ↔ `registry.ts`

  Context: `workspace.ts` import `registryHome` từ `registry.ts`; `registry.ts` import `cloneShallow`/`workspaceDir` từ `workspace.ts`. Hiện chạy được (tests xanh) nhưng coupling dễ gãy khi refactor.
  Suggestion: Tách `registryHome()` sang `server/paths.ts` hoặc `shared/paths.ts` để domain git không phụ thuộc registry CRUD.

### [should] docs/deploy.md — Dockerfile `git` package chưa có trong repo

  Context: Design §4.1 liệt kê `Dockerfile` cài `git`; commit chỉ cập nhật `docs/deploy.md`. Không có `Dockerfile` trên branch (phụ thuộc #40). Doc đã ghi chú đúng nhưng container build chưa enforce.
  Suggestion: Khi merge #40, bổ sung `RUN apt-get install -y git` (hoặc Alpine equivalent) và cross-link từ deploy.md.

### [imo] shared/git/url.ts:3-5 — Discriminant union kiểu `ok: boolean`

  Context: Coding conventions khuyên tránh boolean discriminant vì vue-tsc narrow kém; nên dùng `kind: 'ok'|'err'` hoặc `'error' in result`. `registry.ts` đã dùng `'error' in result` cho `AddResult` nhưng `validateGitUrl` vẫn `ok: boolean`.
  Suggestion: Đồng bộ pattern `'error' in v` cho `ValidateGitUrlResult` ở refactor sau (không blocking MVP).

### [imo] server/registry.ts:259-334 — `addFromGit` không có lock khi concurrent cùng URL

  Context: Design chỉ mutex `syncGitProject`. Hai request đồng thời add cùng `gitUrl+branch` có thể cùng qua idempotent check trước khi clone xong → race trên `workspaces/<id>/`.
  Suggestion: Reuse `withProjectSyncLock` với key `git-add:${normalizedUrl}#${branch}` hoặc chấp nhận documented limitation MVP.

### [imo] server/registry.ts:362-370 — `syncGitProject` không guard `idx < 0`

  Context: Sau `loadRegistry()`, nếu project bị remove giữa lock wait và update (hiếm), `reg.projects[idx]` có thể undefined.
  Suggestion: `if (idx < 0) return { ok: false, status: 404, error: 'unknown project' }`.

---

## Điểm tích cực

- Khớp design: Zod SSOT `shared/schemas/project.ts`, `validateGitUrl` HTTPS + private host, shallow clone + pull/reclone, idempotent URL+branch, `resolveCloneRoot` fallback `workspaceDir(id)`.
- `project.path` vẫn canonical `.dev-team-agent` — `resolveProjectRoot` không đổi contract.
- Legacy registry normalize `kind: 'local'` khi thiếu field.
- HTTP route sync đăng ký trước catch-all 405; audit log `git-sync`.
- UI tiếng Việt: tab Git URL, badge, nút Đồng bộ + tooltip `lastSyncAt`.
- MCP parity `gitUrl` optional; CLI `workspace:sync` script trong `package.json`.
- Typecheck CLEAN; backend/frontend tests PASS; git operations mock, không network CI.

## PHPStan / Typecheck

Không áp dụng PHP (TypeScript project). `typecheck.md` báo **CLEAN** — không có lỗi typecheck mới.

## Security

- URL validation: chỉ `https:`, chặn private host qua `isPrivateHostname` — phù hợp mirror `fetchUrlSafe`, không fetch HTTP trước clone.
- Project id sinh từ `slug` + hash — không path traversal qua `workspaceDir`.
- Mutating endpoints inherit auth #40 khi `DEV_TEAM_API_TOKEN` set (matrix 401 deferred — ghi trong typecheck.md).

## Scope discipline

Thay đổi nằm trong file list design §4.1. Không refactor ngoài scope. `Dockerfile` defer #40 — chấp nhận được.

---

## Summary

- [must]: 0 findings
- [should]: 6 findings
- [imo]: 3 findings

Recommendation: **APPROVE**
