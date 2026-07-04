# PR — U0003-2 / #41

## Branch đề xuất

`feat/U0003-2-git-workspace-onboarding`

## Commit message

```
feat(registry): add git workspace onboarding via HTTPS URL

Refs: #39
Refs: #41
```

## Base branch

`feat/U0003/main` — #40 (PR #45) đã merge vào integration branch này, chưa có trên `main`.

---

## PR description (paste vào GitHub)

## Issue

- Refs #39
- Refs #41

## Module / Phạm vi

`server/registry`, `server/git`, `shared/schemas`, `ProjectBar` — Git workspace onboarding trên server (shallow clone HTTPS, sync, CLI, UI tab Git URL).

## Nội dung thay đổi

- Mở rộng registry: `Project.kind` (`local` | `git`), `source` cho git project; `addFromGit`, `syncGitProject` với mutex in-process.
- Module `server/git/workspace.ts`: shallow clone, `pullOrReclone`, validate URL HTTPS + chặn private host.
- REST: `POST /api/projects` nhận `gitUrl` XOR `path`; `POST /api/projects/:id/sync`.
- CLI `bun run workspace:sync [--project=<id>]`, MCP `add_project` optional `gitUrl`.
- UI `ProjectBar`: tab Local / Git URL, badge git, nút **Đồng bộ** + tooltip `lastSyncAt`.
- `project.path` vẫn canonical `.dev-team-agent` — monitor/API task không đổi contract.

| Trước | Sau | Ghi chú |
|-------|-----|---------|
| — | `shared/schemas/project.ts` | Zod SSOT: `Project`, `AddProjectRequest`, `SyncProjectResponse`, `normalizeProject` |
| — | `shared/git/url.ts` | `validateGitUrl` — HTTPS-only, chặn private host |
| — | `server/git/workspace.ts` | `cloneShallow`, `pullOrReclone`, `runGit` (injectable mock) |
| — | `server/git/syncLock.ts` | `withProjectSyncLock` — mutex per project id |
| `server/registry.ts` | `server/registry.ts` | `addFromGit`, `syncGitProject`, legacy `kind` normalize |
| `server/http/routes/registry.ts` | `server/http/routes/registry.ts` | Route sync trước catch-all; body Zod |
| — | `scripts/workspace-sync.ts` | CLI sync một hoặc tất cả git projects |
| `package.json` | `package.json` | Script `workspace:sync` |
| `mcp/server.ts` | `mcp/server.ts` | `add_project` nhận `gitUrl` optional |
| `src/api/client.ts` | `src/api/client.ts` | `addGitProject`, `syncProject` |
| `src/features/monitor/components/ProjectBar.vue` | `src/features/monitor/components/ProjectBar.vue` | Tab Git URL, badge, nút Đồng bộ |
| — | `docs/deploy.md` §6 | Ghi chú Git workspaces + yêu cầu `git` binary |
| — | `tests/shared/schemas/project.test.ts` | Vitest Zod schemas |
| — | `tests/shared/git/url.test.ts` | Vitest URL guard |
| — | `tests/server/git/workspace.test.ts` | Bun test clone/pull/reclone (mock) |
| `tests/server/registry.test.ts` | `tests/server/registry.test.ts` | `addFromGit`, idempotent, sync |
| `tests/server/http/api.golden.test.ts` | `tests/server/http/api.golden.test.ts` | Sync 404/400, validation 400 |
| `tests/mcp/server.test.ts` | `tests/mcp/server.test.ts` | MCP `add_project { gitUrl }` |

## Test view point & test case

<details>
<summary>Test view point & test case</summary>

- [ ] **TC-01**: `validateGitUrl` chấp nhận HTTPS public (`https://github.com/org/repo.git`)
- [ ] **TC-02**: `validateGitUrl` chuẩn hóa trailing slash
- [ ] **TC-03**: `validateGitUrl` từ chối HTTP
- [ ] **TC-04**: `validateGitUrl` từ chối private host (`127.0.0.1`, `localhost`)
- [ ] **TC-05**: `AddProjectRequest` — exactly one `path` hoặc `gitUrl`
- [ ] **TC-06**: `normalizeProject` legacy thiếu `kind` → `local`
- [ ] **TC-07**: `addFromGit` tạo project `kind: git` với `source`
- [ ] **TC-08**: `addFromGit` idempotent cùng URL + branch
- [ ] **TC-10**: `addFromGit` clone fail → cleanup workspace
- [ ] **TC-14**: `POST /api/projects` local path regression → `kind: local`
- [ ] **TC-16**: `syncGitProject` cập nhật `lastSyncAt`
- [ ] **TC-17**: `pullOrReclone` — pull fail → re-clone
- [ ] **TC-18**: Sync local project → 400
- [ ] **TC-19**: Sync unknown id → 404
- [ ] **TC-20**: MCP `add_project { gitUrl }` mocked
- [ ] **TC-21**: MCP thiếu path và gitUrl → error
- [ ] **Regression**: `resolveProjectRoot` / monitor polling — `path` vẫn trỏ `.dev-team-agent`

**Lệnh chạy test (comment PR):**

```bash
bun run typecheck
bun test tests/server tests/mcp
bun run test:fe
```

</details>

## Loại test đã thêm/migrate

- [x] Unit (bun test — backend) ở `tests/server` · `tests/mcp`
- [x] Unit (vitest — frontend) ở `tests/shared`
- [x] Integration API (Hono `app.request`) — golden partial
- [ ] E2E (playwright) — MVP mock git, không network thật

## Notes for reviewer

- **[should]** `mcp/server.ts` — schema `AddProjectInput` trùng lặp `AddProjectRequest`; nên import từ `shared/schemas/project.ts`.
- **[should]** Thiếu golden test POST `gitUrl` happy path → 201 qua HTTP stack.
- **[should]** Thiếu test clone OK nhưng không có `.dev-team-agent` → cleanup.
- **[should]** Chưa có test CLI `workspace-sync.ts` và vitest `ProjectBar`.
- **[should]** Circular import `registryHome` ↔ `workspace.ts` — cân nhắc tách `server/paths.ts`.
- **[should]** `Dockerfile` cài `git` defer khi merge đầy đủ #40 — doc §6 đã ghi chú.
- **[imo]** `validateGitUrl` dùng `ok: boolean` thay vì `'error' in result` — refactor sau.
- **[imo]** `addFromGit` chưa lock concurrent cùng URL — documented MVP limitation.

## Checklist

- [x] Không thay đổi contract `resolveProjectRoot` / task API
- [x] Typecheck CLEAN; 198 backend + 107 frontend tests PASS
- [x] Tuân thủ coding conventions (Zod SSOT, defensive FS, mock git CI)
- [x] Git hygiene — không commit generated/dist
- [x] Rebase lên `origin/feat/U0003/main` (bao gồm #40)

## Related

- Epic: Refs #39
- Issue: Refs #41
- Parent: U0003 / #40 (PR #45 merged vào `feat/U0003/main`)
- Design doc: `.dev-team-agent/tasks/U0003-2/design.md`
