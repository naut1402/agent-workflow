# Design — U0003-2: [F0003.2] Git workspace onboarding trên server

## §1. Tổng quan

Task U0003-2 (issue #41) mở rộng dashboard để **đăng ký project bằng Git HTTPS URL**: server shallow-clone repo vào `DEV_TEAM_DASHBOARD_HOME/workspaces/<id>/`, validate tồn tại `.dev-team-agent/`, lưu registry với `kind: 'git'` và `source`, rồi cung cấp **sync** (`git pull` hoặc re-clone khi fail) qua REST, CLI và UI.

Giải pháp được chọn: **module `server/git/workspace.ts`** (spawn `git`, validate URL mirror `fetchUrlSafe`) + **mở rộng `server/registry.ts`** (`addFromGit`, `syncGitProject`) + **Zod SSOT** tại `shared/schemas/project.ts`; `project.path` vẫn là canonical `.dev-team-agent` để `resolveProjectRoot` và toàn bộ API task/artifact **không đổi contract**. Luồng local (`kind: 'local'`) giữ nguyên; entry registry cũ thiếu `kind` được normalize khi load.

Phụ thuộc #40 (U0003): `POST /api/projects` và `POST /api/projects/:id/sync` là mutating — khi `DEV_TEAM_API_TOKEN` set sẽ đi qua auth middleware/helper đã có; không implement lại auth.

## §2. Investigation Summary

| Phát hiện | Ảnh hưởng design |
|---|---|
| `Project.kind` luôn `'local'`; không có `source` | Mở rộng interface + Zod; normalize legacy khi `loadRegistry` |
| `POST /api/projects` chỉ nhận `{ path, name? }` | Mở rộng body: `gitUrl` XOR `path`; Zod `AddProjectRequest` |
| Không có sync endpoint / CLI / git helper | Tạo `server/git/workspace.ts`, route `:id/sync`, `scripts/workspace-sync.ts` |
| `ProjectBar` form path-only | Tab Local / Git URL; nút Sync khi `kind === 'git'` |
| MCP `add_project` chỉ `path` | Optional `gitUrl`, `branch`; delegate cùng registry |
| `fetchUrlSafe` + `isPrivateHostname` có sẵn | `validateGitUrl` tái sử dụng guard HTTPS/private — **không** fetch HTTP |
| `spawn` pattern có trong `claude-code-cli.ts` | `runGit(args, cwd)` tương tự, timeout, capture stderr |
| `resolveProjectRoot` trả `project.path` | Clone root ≠ registry path; chỉ lưu canonical `.dev-team-agent` |
| CI không gọi network thật | Test **mock** `spawn`; fixture local tmp |
| #40 auth tại `createApiHandler` | Endpoint mới tự động protected khi token set; không thêm public path |
| Concurrent sync — medium risk | In-process mutex per `projectId` trong `syncGitProject` |
| Remove project không xóa clone dir | Chấp nhận MVP; ghi trong deploy doc |
| Branch mặc định | `'main'`; message gợi ý thử branch khác nếu clone fail |
| Private repo / SSH | Out of scope MVP |

**Quyết định từ investigate §7 (không blocking):**

- `path` + `gitUrl` đồng thời → **400** mutual exclusive.
- Clone dir: `registryHome()/workspaces/<projectId>/` (không volume `./workspaces` riêng).
- MCP: implement `gitUrl` (effort thấp, cùng validation path).
- Idempotent add cùng `gitUrl` → trả project hiện có (mirror idempotent `path`).

## §3. So sánh giải pháp

| Giải pháp | Ưu điểm | Nhược điểm | Lý do chọn/loại |
|---|---|---|---|
| **A — Module `git/workspace.ts` + registry mở rộng, `path` = `.dev-team-agent`** | Một SSOT validation; blast radius thấp; monitor/API không đổi | Thêm module + schema; cần lock sync | ✅ **Được chọn** — đơn giản, an toàn, khớp investigate |
| **B — Shell script ngoài (`git clone` trong bash) gọi từ API** | Ít TypeScript | Khó test/mock; duplicate validation REST vs CLI; Windows shell khác biệt | ❌ Không nhất quán với convention spawn TS |
| **C — Lưu `gitUrl` trong registry, clone on-demand mỗi request** | Không tốn disk | Chậm; không mirror workspace cho orchestrator đọc artifact | ❌ Sai use-case dashboard (persistent workspace) |
| **D — Registry file riêng `git-projects.json`** | Tách concern | Hai nguồn truth; `resolveProjectRoot` phức tạp | ❌ Over-engineering |

| Giải pháp validate URL | Ưu điểm | Nhược điểm | Lý do |
|---|---|---|---|
| Pure fn `validateGitUrl` + `isPrivateHostname` (không fetch) | Nhanh; đủ cho public HTTPS; mirror guard `fetchUrlSafe` | Không verify repo tồn tại trước clone | ✅ Chọn — clone là bước validate thực tế |
| HEAD request trước clone | Phát hiện sớm 404 | SSRF surface; Git host không luôn hỗ trợ HEAD | ❌ |

| Giải pháp sync fail | Ưu điểm | Nhược điểm | Lý do |
|---|---|---|---|
| `git pull` → fail → xóa dir + shallow re-clone | Self-heal corruption/shallow issues | Mất thay đổi local trong clone (đúng thiết kế mirror) | ✅ Chọn — khớp issue |
| Chỉ `git pull`, báo lỗi | Đơn giản | Workspace hỏng kẹt | ❌ |

| Giải pháp UI add form | Ưu điểm | Nhược điểm | Lý do |
|---|---|---|---|
| Tab Local / Git URL trong `ProjectBar` | UX rõ; ít file mới | Component dài hơn | ✅ Chọn |
| Modal riêng `GitProjectDialog.vue` | Tách component | Scope thừa cho MVP | ❌ Defer |

## §4. Implementation Details

### 4.1 Files cần sửa

| File | Thay đổi | Lý do |
|---|---|---|
| `shared/schemas/project.ts` **(mới)** | Zod: `ProjectKind`, `GitSource`, `Project`, `AddProjectRequest`, `SyncProjectResponse`; helpers `normalizeProject`, `parseAddProjectRequest` | SSOT schema registry + API body; dùng chung BE/FE/test |
| `shared/git/url.ts` **(mới)** | `validateGitUrl(urlStr): { ok, url, error? }` — https-only + `isPrivateHostname` | Tách pure validation; import từ workspace + test vitest |
| `server/git/workspace.ts` **(mới)** | `workspaceDir(id)`, `cloneShallow`, `pullOrReclone`, `cleanupWorkspace`, `runGit` (injectable cho test) | Logic git tập trung; spawn pattern |
| `server/git/syncLock.ts` **(mới)** | `withProjectSyncLock(id, fn)` — Map in-process mutex | Tránh race concurrent sync |
| `server/registry.ts` | Mở rộng `Project`; `normalizeRegistryProjects` trong `loadRegistry`; `add` branch local; `addFromGit`; `syncGitProject`; export qua `RegistryContext` | Single source of truth REST + MCP + CLI |
| `server/http/routes/registry.ts` | Parse body qua Zod; route `POST /api/projects/:id/sync` **trước** `app.all` catch-all | HTTP surface issue #41 |
| `scripts/workspace-sync.ts` **(mới)** | CLI `--project=<id>`; sync one hoặc all `kind==='git'` | `bun run workspace:sync` |
| `package.json` | Script `"workspace:sync": "bun scripts/workspace-sync.ts"` | CLI entry |
| `src/api/client.ts` | `addGitProject(gitUrl, branch?, name?)`; `syncProject(id)`; type `Project` từ schema nếu cần | FE API wrappers |
| `src/features/monitor/components/ProjectBar.vue` | Tab Local/Git; form gitUrl+branch; badge git; nút Sync + `lastSyncAt` tooltip | UI acceptance |
| `mcp/server.ts` | Tool schema: `path` optional, `gitUrl` optional, refine exactly-one; `handleAddProject` delegate `addFromGit` | MCP parity |
| `docs/deploy.md` | Ghi chú `workspaces/` under home, `git` trong PATH/Dockerfile | Operator doc |
| `Dockerfile` (từ #40) | `RUN apt-get install -y git` (hoặc tương đương Alpine) | Container có binary git |
| `tests/shared/schemas/project.test.ts` **(mới)** | Vitest Zod schemas | SSOT |
| `tests/shared/git/url.test.ts` **(mới)** | Vitest `validateGitUrl` rejects | Guard parity `fetchUrlSafe` |
| `tests/server/git/workspace.test.ts` **(mới)** | Mock `runGit`: clone args, cleanup, pull→reclone | Domain git |
| `tests/server/registry.test.ts` | `addFromGit`, legacy normalize, idempotent URL, `syncGitProject` | Registry regression |
| `tests/server/http/api.golden.test.ts` | POST gitUrl mocked; sync 404/400; local POST regression; auth 401 khi token set | Contract |
| `tests/mcp/server.test.ts` | `add_project { gitUrl }` mocked | MCP |

**Không sửa contract:** `resolveProjectRoot`, task routes, artifact routes, knowledge API.

### 4.2 Logic thay đổi

#### 4.2.1 Zod schema — `shared/schemas/project.ts`

```ts
import { z } from 'zod'

export const ProjectKind = z.enum(['local', 'git'])
export type ProjectKind = z.infer<typeof ProjectKind>

export const GitSource = z.object({
  type: z.literal('git'),
  url: z.string().url(),
  branch: z.string().min(1),
  lastSyncAt: z.string().datetime().optional(),
})
export type GitSource = z.infer<typeof GitSource>

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  kind: ProjectKind.default('local'),
  path: z.string(), // canonical .dev-team-agent absolute path
  addedAt: z.string(),
  default: z.boolean(),
  source: GitSource.optional(),
})
export type Project = z.infer<typeof Project>

/** Normalize legacy entry thiếu kind/source khi đọc registry. */
export function normalizeProject(raw: unknown): Project {
  const base = Project.safeParse(raw)
  if (base.success) return base.data
  // fallback permissive cho field cũ
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return Project.parse({
    ...o,
    kind: o.kind ?? 'local',
    source: o.kind === 'git' ? o.source : undefined,
  })
}

export const AddProjectRequest = z
  .object({
    path: z.string().min(1).optional(),
    gitUrl: z.string().min(1).optional(),
    branch: z.string().min(1).optional(),
    name: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    const hasPath = Boolean(v.path?.trim())
    const hasGit = Boolean(v.gitUrl?.trim())
    if (hasPath === hasGit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'exactly one of path or gitUrl is required',
      })
    }
  })

export const SyncProjectResponse = z.object({
  project: Project,
  syncedAt: z.string(),
})
```

`loadRegistry()` sau `JSON.parse`: map `data.projects` qua `normalizeProject`.

#### 4.2.2 URL validation — `shared/git/url.ts`

```ts
import { isPrivateHostname } from '../sanitize.js'

export type ValidateGitUrlResult =
  | { ok: true; url: string; normalizedUrl: string }
  | { ok: false; error: string }

export function validateGitUrl(urlStr: string): ValidateGitUrlResult {
  const trimmed = urlStr.trim()
  if (!trimmed) return { ok: false, error: 'gitUrl is required' }
  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    return { ok: false, error: 'invalid URL' }
  }
  if (u.protocol !== 'https:') return { ok: false, error: 'only https URLs allowed' }
  if (isPrivateHostname(u.hostname)) return { ok: false, error: 'private hosts not allowed' }
  // Chuẩn hóa: bỏ trailing slash path rỗng để idempotent compare
  const normalizedUrl = u.origin + u.pathname.replace(/\/$/, '') + u.search
  return { ok: true, url: trimmed, normalizedUrl }
}
```

**Không** gọi `fetch` — clone là bước xác thực repo + `.dev-team-agent`.

#### 4.2.3 Git workspace — `server/git/workspace.ts`

```ts
// workspaceDir(id) → path.join(registryHome(), 'workspaces', id)
// runGit(args, { cwd, timeoutMs=120_000 }) → spawn('git', args, { shell: win32 })
//   reject on non-zero exit; return { stdout, stderr }

export async function cloneShallow(opts: {
  url: string
  branch: string
  targetDir: string
  runGit?: typeof defaultRunGit
}): Promise<void> {
  fs.mkdirSync(path.dirname(opts.targetDir), { recursive: true })
  await opts.runGit!(
    ['clone', '--depth', '1', '-b', opts.branch, opts.url, opts.targetDir],
    { cwd: path.dirname(opts.targetDir) },
  )
}

export async function pullOrReclone(opts: {
  cloneRoot: string
  url: string
  branch: string
  runGit?: typeof defaultRunGit
}): Promise<'pulled' | 'recloned'> {
  try {
    await opts.runGit!(['pull', 'origin', opts.branch], { cwd: opts.cloneRoot })
    return 'pulled'
  } catch {
    await cleanupWorkspace(opts.cloneRoot)
    await cloneShallow({
      url: opts.url,
      branch: opts.branch,
      targetDir: opts.cloneRoot,
      runGit: opts.runGit,
    })
    return 'recloned'
  }
}

export function cleanupWorkspace(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

/** Sau clone: validateProjectPath(cloneRoot) → canonical .dev-team-agent path */
export function resolveCloneWorkspace(cloneRoot: string): ValidateResult {
  return validateProjectPath(cloneRoot)
}
```

**Clone layout:** `workspaces/<projectId>/` là **project root** (chứa `.dev-team-agent/` bên trong hoặc chính là `.dev-team-agent` — `validateProjectPath` xử lý cả hai).

**Project id:** Tạo tạm `slug(name)-pending` trước clone **hoặc** derive từ `makeId(name, canonicalPath)` sau validate — **chọn:** clone vào dir tạm `workspaces/.tmp-<hash>` rồi rename thành `workspaces/<finalId>/` sau khi có canonical path; nếu rename fail thì cleanup.

**Đơn giản hóa MVP (được chọn):** Pre-generate `id = makeId(derivedName, normalizedGitUrl + branch)` (hash URL+branch, không cần path trước clone). Clone thẳng vào `workspaces/<id>/`. Sau clone gọi `validateProjectPath`; fail → cleanup + 400.

#### 4.2.4 Registry — `addFromGit` và `syncGitProject`

```ts
export function addFromGit({
  gitUrl,
  branch = 'main',
  name,
}: { gitUrl: string; branch?: string; name?: string }): AddResult {
  const v = validateGitUrl(gitUrl)
  if (!v.ok) return { ok: false, status: 400, error: v.error }

  const reg = loadRegistry()
  const branchResolved = (branch?.trim() || 'main')

  // Idempotent: cùng normalized url + branch
  const existing = reg.projects.find(
    (p) => p.kind === 'git' && p.source?.url === v.normalizedUrl && p.source.branch === branchResolved,
  )
  if (existing) return { ok: true, project: existing }

  const derivedName = name?.trim() || inferNameFromGitUrl(v.normalizedUrl) // basename repo sans .git
  const provisionalId = makeId(derivedName, `${v.normalizedUrl}#${branchResolved}`)
  const cloneRoot = workspaceDir(provisionalId)

  try {
    cloneShallow({ url: v.normalizedUrl, branch: branchResolved, targetDir: cloneRoot })
    const validated = validateProjectPath(cloneRoot, derivedName)
    if ('error' in validated) {
      cleanupWorkspace(cloneRoot)
      return { ok: false, status: 400, error: validated.error }
    }

    const project: Project = {
      id: makeId(validated.name, validated.path),
      name: validated.name,
      kind: 'git',
      path: validated.path,
      addedAt: new Date().toISOString(),
      default: reg.projects.length === 0,
      source: {
        type: 'git',
        url: v.normalizedUrl,
        branch: branchResolved,
        lastSyncAt: new Date().toISOString(),
      },
    }

    // Nếu id đổi sau makeId(path): rename workspace dir provisionalId → project.id
    if (project.id !== provisionalId) {
      const finalDir = workspaceDir(project.id)
      fs.renameSync(cloneRoot, finalDir)
    }

    reg.projects.push(project)
    saveRegistry(reg)
    return { ok: true, project }
  } catch (e) {
    cleanupWorkspace(cloneRoot)
    const msg = String(e?.message || e)
    return {
      ok: false,
      status: 400,
      error: msg.includes('branch') ? `git clone failed (branch '${branchResolved}'?): ${msg}` : `git clone failed: ${msg}`,
    }
  }
}

export async function syncGitProject(id: string): Promise<AddResult & { syncedAt?: string }> {
  return withProjectSyncLock(id, async () => {
    const project = get(id)
    if (!project) return { ok: false, status: 404, error: 'unknown project' }
    if (project.kind !== 'git' || !project.source) {
      return { ok: false, status: 400, error: 'not a git project' }
    }

    const cloneRoot = path.dirname(project.path) // parent of .dev-team-agent
    // Nếu path basename === '.dev-team-agent', cloneRoot = dirname(path)
    // Nếu path chính là workspace (edge), dùng workspaceDir(id) làm fallback

    try {
      await pullOrReclone({
        cloneRoot,
        url: project.source.url,
        branch: project.source.branch,
      })
      const revalidated = validateProjectPath(cloneRoot)
      if ('error' in revalidated) {
        return { ok: false, status: 500, error: 'workspace invalid after sync' }
      }

      const reg = loadRegistry()
      const idx = reg.projects.findIndex((p) => p.id === id)
      const syncedAt = new Date().toISOString()
      reg.projects[idx] = {
        ...reg.projects[idx],
        path: revalidated.path,
        source: { ...project.source, lastSyncAt: syncedAt },
      }
      saveRegistry(reg)
      return { ok: true, project: reg.projects[idx], syncedAt }
    } catch (e) {
      return { ok: false, status: 500, error: `sync failed: ${e}` }
    }
  })
}
```

**`add()` local (giữ nguyên):** Chỉ nhận `path`; set `kind: 'local'`; không `source`. Entry cũ không có `kind` → `normalizeProject` gán `'local'`.

**`createRegistryContext`:** Thêm `addFromGit`, `syncGitProject` vào `registry` object.

**Helper `inferNameFromGitUrl`:** `new URL(url).pathname` → basename bỏ `.git`.

**Xác định `cloneRoot` khi sync:** Luôn `path.dirname(project.path)` vì `validateProjectPath` trả canonical `.dev-team-agent`; project root là thư mục cha. Nếu không khớp `workspaceDir(id)`, ưu tiên `workspaceDir(id)` nếu tồn tại trên disk (phòng rename id).

#### 4.2.5 HTTP routes — `server/http/routes/registry.ts`

```ts
app.post('/api/projects/:id/sync', async (c) => {
  const id = c.req.param('id')
  const { registry } = c.get('ctx')
  const result = await registry.syncGitProject(id)
  if ('error' in result) return j(c, result.status || 400, { error: result.error })
  emitAudit({ op: 'update', entity: 'project', identifier: id, projectId: id, detail: 'git-sync' })
  return j(c, 200, { project: result.project, syncedAt: result.syncedAt })
})

app.post('/api/projects', async (c) => {
  const parsed = AddProjectRequest.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return j(c, 400, { error: parsed.error.issues[0]?.message || 'invalid body' })
  const body = parsed.data
  const result = body.gitUrl
    ? registry.addFromGit({ gitUrl: body.gitUrl, branch: body.branch, name: body.name })
    : registry.add({ path: body.path, name: body.name })
  // ... 201 / error như hiện tại
})
```

**Thứ tự đăng ký:** `POST /api/projects/:id/sync` trước `app.all('/api/projects', 405)`.

**Auth (#40):** Không whitelist — khi `DEV_TEAM_API_TOKEN` set, client (UI qua `apiFetch`, curl, CLI script) phải gửi `Authorization: Bearer` hoặc `X-Dev-Team-Token`. CLI `workspace-sync.ts` đọc `DEV_TEAM_API_TOKEN` từ env và gọi **trực tiếp** `syncGitProject` từ registry (không qua HTTP) — không cần token khi chạy local script; nếu sau này thêm HTTP mode thì gắn header.

#### 4.2.6 CLI — `scripts/workspace-sync.ts`

```ts
// Parse process.argv: --project=<id> optional
// import { syncGitProject, list } from '../server/registry.js'
// if --project: sync one; else: list().projects.filter(p => p.kind==='git').forEach sync
// exit 1 nếu bất kỳ sync fail; log JSON hoặc human line per project
```

#### 4.2.7 Frontend — `ProjectBar.vue`

- State: `addTab: 'local' | 'git'` (default `'local'`).
- Tab switch trong `.project-add-form`.
- Git tab: input `gitUrl` (placeholder `https://github.com/org/repo.git`), `branch` (placeholder `main`, optional), `name` optional.
- `submitAdd`: nếu tab git → `addGitProject(gitUrl, branch, name)`; else giữ `addProject(path, name)`.
- List item: nếu `p.kind === 'git'` hiển thị icon/badge `git` nhỏ; nút **Đồng bộ** (title hiện `lastSyncAt` nếu có).
- `onSync(project)`: `syncProject(project.id)` → `emit('changed')`; hiển thị lỗi tiếng Việt.

#### 4.2.8 MCP — `mcp/server.ts`

```ts
const AddProjectInput = z.object({
  path: z.string().optional(),
  gitUrl: z.string().optional(),
  branch: z.string().optional(),
  name: z.string().optional(),
}).superRefine(/* exactly one path | gitUrl */)

export function handleAddProject(input: z.infer<typeof AddProjectInput>) {
  const result = input.gitUrl
    ? addFromGit({ gitUrl: input.gitUrl, branch: input.branch, name: input.name })
    : add({ path: input.path!, name: input.name })
  // ...
}
```

Cập nhật mô tả tool: path **hoặc** gitUrl bắt buộc.

#### 4.2.9 Deploy / Docker

- `docs/deploy.md`: thêm mục **Git workspaces** — clone lưu tại `$DEV_TEAM_DASHBOARD_HOME/workspaces/`; cần `git` trong PATH; volume `dashboard-home` phải đủ dung lượng; private repo chưa hỗ trợ.
- `Dockerfile`: cài `git` package (blocker đã ghi investigate).

### 4.3 DB changes (nếu có)

Không có database. **Registry JSON** (`projects.json`) mở rộng:

| Field | Trước | Sau |
|---|---|---|
| `projects[].kind` | Luôn `'local'` (implicit) | `'local' \| 'git'`; legacy → `'local'` khi load |
| `projects[].source` | Không có | Optional `{ type:'git', url, branch, lastSyncAt? }` chỉ khi `kind==='git'` |
| `projects[].path` | Canonical `.dev-team-agent` | **Không đổi semantics** |

**Disk layout mới:**

```
$DEV_TEAM_DASHBOARD_HOME/
  projects.json
  workspaces/
    <project-id>/          # git clone root (chứa .dev-team-agent/)
      .dev-team-agent/
        ...
```

Không migration script — `normalizeProject` khi đọc đủ backward compat.

### 4.4 Edge cases

| Edge case | Xử lý |
|---|---|
| `path` và `gitUrl` cùng lúc / cả hai thiếu | Zod `AddProjectRequest` → 400 |
| `http://` URL | `validateGitUrl` → 400 `only https URLs allowed` |
| Private host (`127.0.0.1`, `localhost`, …) | `validateGitUrl` → 400 `private hosts not allowed` |
| Clone OK nhưng không có `.dev-team-agent` | `validateProjectPath` fail → cleanup dir → 400 |
| Branch sai / repo không public | `git clone` stderr → 400 message có gợi ý kiểm tra branch |
| `branch` omitted | Default `'main'` |
| Add trùng `gitUrl`+`branch` | Trả project hiện có (idempotent) |
| Add trùng URL khác branch | Project mới (id khác) |
| Sync project `kind:local` | 400 `not a git project` |
| Sync unknown id | 404 |
| `git pull` fail (conflict, missing ref) | `pullOrReclone` → cleanup + shallow re-clone |
| Re-clone cũng fail | 500; dir có thể trống — operator add lại |
| Concurrent sync cùng id | `withProjectSyncLock` — request thứ hai chờ hoặc 409 (chọn **chờ** queue đơn giản) |
| Remove git project | Chỉ gỡ registry; **không** xóa `workspaces/<id>/` (MVP) |
| Registry entry `kind:git` nhưng mất dir trên disk | Sync sẽ re-clone; add mới nếu cần |
| `DEV_TEAM_API_TOKEN` set | POST add/sync cần token qua HTTP; GET list vẫn theo policy #40 |
| Windows dev | `spawn` với `shell: true` trên win32 (pattern sẵn có) |
| Project id đổi sau rename workspace | `fs.renameSync` provisional → final; test cover |

## §5. Test Notes

### Normal flow

1. `validateGitUrl('https://github.com/org/repo.git')` → ok; `http://` và `https://127.0.0.1/x` → reject.
2. `addFromGit` (mock `cloneShallow` + fixture tmp có `.dev-team-agent`) → `kind:'git'`, `source.url`, `path` canonical.
3. `POST /api/projects` `{ gitUrl, branch }` mocked → 201 + shape Zod `Project`.
4. Sau add → `GET /api/tasks?project=<id>` → 200 (fixture tasks trong clone tmp).
5. `POST /api/projects/:id/sync` mock pull ok → `lastSyncAt` cập nhật, 200 `SyncProjectResponse`.
6. `POST /api/projects` `{ path }` → `kind:'local'`, không `source` (regression).
7. MCP `add_project { gitUrl }` mocked → cùng kết quả REST.
8. `bun run workspace:sync --project=<id>` (mock registry) → exit 0.

### Abnormal flow

1. Sync local project → 400.
2. Sync unknown id → 404.
3. Clone fail (mock throw) → 400, workspace dir cleaned.
4. Pull fail → mock re-clone path được gọi.
5. Body invalid (cả path+gitUrl) → 400.
6. Khi `DEV_TEAM_API_TOKEN=test`: POST add/sync không header → 401; có Bearer → 201/200.

### Regression risk

- `resolveProjectRoot` / monitor polling — đảm bảo `path` vẫn trỏ `.dev-team-agent` sau git add.
- `loadRegistry` entry cũ không `kind` — vẫn list/get bình thường.
- Idempotent `path` local add không bị ảnh hưởng.

**CI:** Mọi test git **mock** `runGit` / `cloneShallow` — không network thật (theo `docs/knowhow/ci-cd-testing.md`).

## §6. Out of scope

- Epic #39 tổng thể (chỉ #41).
- Implement lại #40 (auth, health, Docker) — chỉ **tích hợp** auth có sẵn và bổ sung `git` vào Dockerfile/doc.
- Git SSH URL, credential store, `GIT_TOKEN` cho private repo.
- Xóa thư mục clone khi `remove` project.
- Orchestrator chạy bên trong clone — dashboard chỉ đọc/ghi artifact như local.
- UI settings nhập API token (thuộc #40).
- E2E với repo GitHub public thật (có thể P1 sau; MVP mock).
- Background auto-sync cron — chỉ manual Sync + CLI.

## §7. Schedule

| Phase | Ước tính | Ghi chú |
|---|---|---|
| Schema + `validateGitUrl` + test vitest | 0.5 ngày | SSOT trước |
| `server/git/workspace.ts` + registry `addFromGit`/`syncGitProject` | 1 ngày | Mock spawn TDD |
| HTTP routes + golden test + auth matrix | 0.5 ngày | Phụ thuộc #40 merged |
| CLI `workspace:sync` | 0.25 ngày | |
| FE ProjectBar + api client | 0.5 ngày | Tab + Sync |
| MCP + test | 0.25 ngày | |
| deploy.md + Dockerfile git | 0.25 ngày | |
| Review + fix CI | 0.5 ngày | `bun run test:all` |

**Tổng ước tính:** ~3.5 ngày dev (1 implementer).
