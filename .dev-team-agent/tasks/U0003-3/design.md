# Design — U0003-3: [F0003.3] Runner hybrid — server CLI + dev sync

## §1. Tổng quan

Task U0003-3 (issue #42, epic #39) hoàn thiện **Luồng A** (server runner headless qua preset `claude-code-server` + credential `env:ANTHROPIC_API_KEY`) và **Luồng B** (dev chạy orchestrator local rồi đẩy artifact `.dev-team-agent/` lên remote qua `workspace:push`), dựa trên nền #40 (server-ready) và #41 (git workspace).

Giải pháp được chọn: **mở rộng default store runners/credentials** (preset server + profile env) kèm **`ensureBuiltin*()` idempotent** khi load file cũ; **module `server/git/push.ts`** mirror pattern `workspace.ts`/`workspace-sync.ts`; **banner cảnh báo cli-session** trong `RunnerConfigPanel.vue` khi dashboard không chạy trên localhost; **mở rộng `docs/deploy.md`** (runner server, push/sync, conflict policy, hướng dẫn orchestrator chọn runner). `defaultRunnerId` **giữ** `claude-code-local`; không implement Luồng C (#44).

## §2. Investigation Summary

| Phát hiện | Ảnh hưởng design |
|---|---|
| Chỉ có `claude-code-local` + `cli-session` trong default store | Thêm `claude-code-server` + `claude-server-env`; logic `--bare`/env **đã có** trong `claude-code-cli.ts` — không sửa provider |
| `cli-session` tự bỏ `--bare` (`resolveEffectiveFlags`) | Preset server **bắt buộc** credential `env:*`, không `cli-session` |
| Legacy `runners.json`/`credentials.json` không tự nhận preset mới | `ensureBuiltinRunners()` / `ensureBuiltinCredentials()` merge idempotent trong `load*()` |
| `workspace:sync` có; `workspace:push` chưa có | Tạo `server/git/push.ts` + `scripts/workspace-push.ts` |
| `runner-cli.mjs` đã hỗ trợ `--runner <id>` | Chỉ document orchestrator; không đổi CLI |
| `syncGitProject` + mutex có sẵn (#41) | Push dev không lock phân tán; conflict **chỉ doc** |
| UI `RunnerConfigPanel` không check hostname | Thêm `isLocalDashboardHost()` + banner tiếng Việt |
| `ANTHROPIC_API_KEY` chưa trong deploy/compose | Bổ sung env optional + prerequisite `claude` trong PATH |
| Không có câu hỏi blocking (investigate §7) | Không tạo `qa.md` |

**Quyết định MVP (từ investigate §7):**

- `workspace:push` commit **scoped** `.dev-team-agent/**` — không stage toàn repo.
- Flag `--sync-server=<url>` **tuỳ chọn**; mặc định operator chạy 2 bước (push → sync); doc rõ cả hai.
- `kind: 'local'` trên dev registry **được phép** push nếu `project.path` nằm trong git repo có `origin` remote.
- Doc orchestrator là **section trong `deploy.md`**, không tạo file `orchestrator-runners.md` riêng.
- Không set `claude-code-server` làm default qua env `DEV_TEAM_DEFAULT_RUNNER` — operator dùng UI **Set default** hoặc `--runner` explicit.

**Mapping acceptance criteria (issue #42):**

| AC | Đáp ứng trong design |
|---|---|
| Server job + env credential → `succeeded` | Preset `claude-code-server` + `env:ANTHROPIC_API_KEY` + smoke test UI/API; prerequisite `claude` + env documented |
| Dev push → server dashboard thấy artifact | `workspace:push` → (tuỳ chọn `--sync-server`) → `syncGitProject` → monitor poll `GET /api/tasks` |
| Luồng C (#44) không break | Chỉ **thêm** preset/credential/CLI/doc; không đổi `RunnerProvider` contract; `file:` credential giữ nguyên |

## §3. So sánh giải pháp

| Giải pháp | Ưu điểm | Nhược điểm | Lý do chọn/loại |
|---|---|---|---|
| **A — Mở rộng default store + `ensureBuiltin*()` idempotent** | Fresh install đủ preset; legacy tự merge; `defaultRunnerId` không đổi | Hai điểm seed (`default*()` + `ensure*()`) | ✅ **Được chọn** — UX tốt, backward compatible |
| **B — Chỉ sửa `defaultRunners()`/`emptyStore()`, không merge load** | Code đơn giản | Install cũ không có preset server | ❌ Risk High (investigate §6) |
| **C — Migration script one-shot** | Rõ ràng cho operator | Thêm bước manual; dễ quên | ❌ Kém hơn idempotent merge |

| Giải pháp push artifact | Ưu điểm | Nhược điểm | Lý do |
|---|---|---|---|
| **`server/git/push.ts` + CLI mirror `workspace-sync.ts`** | Test mock `runGit`; reuse `defaultRunGit` win32 shell | Thêm module | ✅ Chọn — nhất quán #41 |
| Shell script `git-push-artifacts.sh` | Nhanh viết | Khó test; duplicate validation | ❌ |
| REST `POST /api/projects/:id/push` trên server | Centralized | Server không có quyền git trên máy dev; sai hướng | ❌ |

| Giải pháp end-to-end sau push | Ưu điểm | Nhược điểm | Lý do |
|---|---|---|---|
| **`--sync-server` optional + doc 2 bước** | Linh hoạt; CI không cần server thật | Operator có thể quên sync | ✅ Chọn — investigate khuyến nghị |
| Luôn auto-gọi server sync | UX một lệnh | Cần URL/token; fail opaque khi server down | ❌ Bắt buộc network trong CLI mặc định |

| Giải pháp conflict đồng thời | Ưu điểm | Nhược điểm | Lý do |
|---|---|---|---|
| **Doc policy "1 task = 1 runner active"** | Zero code; đủ MVP | Không enforce runtime | ✅ Chọn |
| Distributed lock trên task-id | An toàn hơn | Scope vượt #42; phức tạp | ❌ Defer |

| Giải pháp UI cảnh báo cli-session | Ưu điểm | Nhược điểm | Lý do |
|---|---|---|---|
| **`shared/lib/host.ts` + banner trong panel** | Pure fn vitest; tái sử dụng | Thêm file nhỏ | ✅ Chọn |
| Inline check trong component | Ít file | Khó test; duplicate nếu dùng chỗ khác | ❌ |
| Block save runner cli-session trên server | Hard enforce | Quá aggressive; operator có thể cố ý test | ❌ Chỉ warn |

| Giải pháp doc orchestrator | Ưu điểm | Nhược điểm | Lý do |
|---|---|---|---|
| **Section trong `deploy.md`** | Một nơi operator đọc | File dài hơn | ✅ Chọn — investigate §7 |
| File `docs/knowhow/orchestrator-runners.md` riêng | Tách topic | Fragment doc; thêm link | ❌ MVP |

## §4. Implementation Details

### 4.1 Files cần sửa

| File | Thay đổi | Lý do |
|---|---|---|
| `server/runners/registry.ts` | `defaultRunners()`: thêm runner `claude-code-server`; `ensureBuiltinRunners()`; gọi ensure trong `loadRunners()` | Preset Luồng A; legacy idempotent |
| `server/runners/credentials.ts` | `emptyStore()`: thêm profile `claude-server-env`; `ensureBuiltinCredentials()`; gọi ensure trong `loadCredentials()` | Credential `env:ANTHROPIC_API_KEY` |
| `server/git/push.ts` **(mới)** | `findGitRoot`, `pushDevTeamArtifacts`, `pushGitWorkspace`, `triggerServerSync` | Logic push Luồng B |
| `server/registry.ts` | Export `pushGitWorkspace` qua `RegistryContext` (delegate `push.ts`) | Parity REST future / CLI |
| `scripts/workspace-push.ts` **(mới)** | CLI `--project=`, `--sync-server=`, `--message=` | Entry `bun run workspace:push` |
| `package.json` | `"workspace:push": "bun scripts/workspace-push.ts"` | Script surface |
| `src/shared/lib/host.ts` **(mới)** | `isLocalDashboardHost(hostname?: string): boolean` | Whitelist localhost / 127.0.0.1 / [::1] |
| `src/features/runner/components/RunnerConfigPanel.vue` | Computed `showCliSessionWarning`; banner cảnh báo tiếng Việt | AC Luồng A UI |
| `docs/deploy.md` | §7 Runner server; §8 Dev push/sync; §9 Conflict policy; §10 Orchestrator runner; bảng luồng A/B/C | Operator doc |
| `docker-compose.yml` | Comment + `ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}` optional | Gợi ý env server runner |
| `tests/server/runners/runners.test.ts` | Assert preset server + env profile; `defaultRunnerId` vẫn local; ensure merge legacy | Regression + AC |
| `tests/server/runners/claude-code-cli.test.ts` **(mới)** | Export/test `resolveEffectiveFlags` (hoặc test qua provider helper) | `--bare` vs cli-session |
| `tests/server/git/push.test.ts` **(mới)** | Mock `runGit`: staged paths, no-git, URL mismatch, no changes | Domain push |
| `tests/shared/lib/host.test.ts` **(mới)** | Vitest `isLocalDashboardHost` | UI helper |
| `tests/src/features/runner/RunnerConfigPanel.test.ts` **(mới, P1)** | Vitest: warning khi non-local + cli-session | FE optional |

**Không sửa:** `server/runners/providers/claude-code-cli.ts` (logic đủ), `providerRegistry.ts` (SSH #44), `runner-cli.mjs` (chỉ doc), `Dockerfile` (git/ssh đã có).

### 4.2 Logic thay đổi

#### 4.2.1 Builtin presets — `server/runners/registry.ts`

Thêm constant (có thể export cho test):

```ts
export const BUILTIN_SERVER_RUNNER: RunnerConfig = {
  id: 'claude-code-server',
  name: 'Claude Code CLI (server headless)',
  provider: 'claude-code-cli',
  credentialId: 'claude-server-env',
  enabled: true,
  maxConcurrency: 1,
  config: {
    cliPath: 'claude',
    flags: ['--bare'],
    timeoutMs: 600_000,
    allowedTools: 'Read,Write,Bash,Grep,Glob',
  },
}
```

`defaultRunners()` — runners array gồm **cả** `claude-code-local` (giữ nguyên) **và** `BUILTIN_SERVER_RUNNER`. `defaultRunnerId: 'claude-code-local'` **không đổi**.

```ts
function ensureBuiltinRunners(store: RunnersStore): RunnersStore {
  const builtins = [/* claude-code-server only — local đã có trong file cũ */]
  let changed = false
  for (const b of builtins) {
    if (!store.runners.some((r) => r.id === b.id)) {
      store.runners.push({ ...b })
      changed = true
    }
  }
  if (changed) saveRunners(store)
  return store
}

export function loadRunners(): RunnersStore {
  // ... parse existing ...
  const store = /* parsed or defaultRunners() */
  return ensureBuiltinRunners(store)
}
```

**Lưu ý:** Nếu file corrupt → `defaultRunners()` đã có đủ cả hai; `ensureBuiltinRunners` no-op.

#### 4.2.2 Builtin credential — `server/runners/credentials.ts`

```ts
export const BUILTIN_SERVER_CREDENTIAL: CredentialProfile = {
  id: 'claude-server-env',
  provider: 'claude-code-cli',
  label: 'Anthropic API Key (env)',
  secretRef: 'env:ANTHROPIC_API_KEY',
}

function emptyStore(): CredentialsStore {
  return {
    version: CREDENTIALS_VERSION,
    profiles: [
      { id: 'claude-default', /* cli-session — giữ nguyên */ },
      BUILTIN_SERVER_CREDENTIAL,
    ],
  }
}

function ensureBuiltinCredentials(store: CredentialsStore): CredentialsStore {
  if (!store.profiles.some((p) => p.id === 'claude-server-env')) {
    store.profiles.push({ ...BUILTIN_SERVER_CREDENTIAL })
    saveCredentials(store)
  }
  return store
}
```

Gọi `ensureBuiltinCredentials` cuối `loadCredentials()`.

**API contract không đổi:** `GET /api/runners/credentials` vẫn chỉ trả `secretRef` string, không lộ `process.env` value.

#### 4.2.3 Git push — `server/git/push.ts`

```ts
import path from 'node:path'
import { validateGitUrl } from '../../shared/git/url.js'
import { defaultRunGit, type RunGitFn } from './workspace.js'

export const DEFAULT_PUSH_MESSAGE = 'chore(dev-team): sync orchestrator artifacts'

/** Walk từ startDir lên đến khi gặp .git/ hoặc hết filesystem. */
export function findGitRoot(startDir: string): string | null {
  let dir = path.resolve(startDir)
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Relative path .dev-team-agent từ git root (cho git add). */
export function resolveDevTeamRelativePath(projectPath: string, gitRoot: string): string {
  const rel = path.relative(gitRoot, path.resolve(projectPath))
  // project.path thường là .../.dev-team-agent hoặc .../repo/.dev-team-agent
  if (rel === '.dev-team-agent' || rel.endsWith(`${path.sep}.dev-team-agent`)) {
    return rel.split(path.sep).slice(-2).join('/') // normalize to ".dev-team-agent" hoặc "pkg/.dev-team-agent"
  }
  // Fallback: nếu path basename là .dev-team-agent
  if (path.basename(projectPath) === '.dev-team-agent') {
    return path.relative(gitRoot, projectPath).replace(/\\/g, '/')
  }
  throw new Error('project path is not under a .dev-team-agent directory')
}

export type PushResult =
  | { ok: true; pushed: boolean; commit?: string; branch: string }
  | { ok: false; status: number; error: string }

export async function pushDevTeamArtifacts(opts: {
  gitRoot: string
  devTeamRel: string
  branch: string
  message?: string
  runGit?: RunGitFn
}): Promise<PushResult> {
  const run = opts.runGit ?? defaultRunGit
  const cwd = opts.gitRoot
  const msg = opts.message?.trim() || DEFAULT_PUSH_MESSAGE

  // git add -- <devTeamRel>  (scoped, không add .)
  await run(['add', '--', opts.devTeamRel], { cwd })

  const status = await run(['status', '--porcelain', '--', opts.devTeamRel], { cwd })
  if (!status.stdout.trim()) {
    return { ok: true, pushed: false, branch: opts.branch }
  }

  await run(['commit', '-m', msg], { cwd })
  const rev = await run(['rev-parse', 'HEAD'], { cwd })
  await run(['push', 'origin', opts.branch], { cwd })
  return { ok: true, pushed: true, commit: rev.stdout.trim(), branch: opts.branch }
}

export async function pushGitWorkspace(
  project: Project,
  opts?: { message?: string; runGit?: RunGitFn },
): Promise<PushResult> {
  const gitRoot = findGitRoot(project.path)
  if (!gitRoot) {
    return { ok: false, status: 400, error: 'project path is not inside a git repository' }
  }

  const run = opts?.runGit ?? defaultRunGit
  let devTeamRel: string
  try {
    devTeamRel = resolveDevTeamRelativePath(project.path, gitRoot)
  } catch (e) {
    return { ok: false, status: 400, error: String((e as Error).message) }
  }

  // Remote + branch
  let originUrl: string
  try {
    const r = await run(['remote', 'get-url', 'origin'], { cwd: gitRoot })
    originUrl = r.stdout.trim()
  } catch {
    return { ok: false, status: 400, error: 'git remote origin not configured' }
  }

  const branchRes = await run(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: gitRoot })
  const branch = branchRes.stdout.trim()
  if (!branch || branch === 'HEAD') {
    return { ok: false, status: 400, error: 'detached HEAD — checkout a branch before push' }
  }

  // Validate URL khi dev registry có kind git + source (optional strict)
  if (project.kind === 'git' && project.source?.url) {
    const local = validateGitUrl(originUrl.includes('://') ? originUrl : `https://${originUrl}`)
    const expected = validateGitUrl(project.source.url)
    if (local.ok && expected.ok && local.normalizedUrl !== expected.normalizedUrl) {
      return {
        ok: false,
        status: 400,
        error: `origin URL does not match project source (${expected.normalizedUrl})`,
      }
    }
    if (project.source.branch && project.source.branch !== branch) {
      return {
        ok: false,
        status: 400,
        error: `current branch '${branch}' does not match project source branch '${project.source.branch}'`,
      }
    }
  }

  return pushDevTeamArtifacts({
    gitRoot,
    devTeamRel,
    branch,
    message: opts?.message,
    runGit: run,
  })
}
```

**Wrapper registry** — `server/registry.ts`:

```ts
import { pushGitWorkspace as pushGitWorkspaceImpl } from './git/push.js'

export async function pushGitWorkspace(
  id: string,
  opts?: { message?: string; runGit?: RunGitFn },
): Promise<PushResult> {
  const project = get(id)
  if (!project) return { ok: false, status: 404, error: 'unknown project' }
  return pushGitWorkspaceImpl(project, opts)
}
```

Thêm vào `createRegistryContext().registry`.

**Không** dùng `withProjectSyncLock` cho push (chạy trên máy dev, single-writer assumption).

#### 4.2.4 Optional server sync — `triggerServerSync` trong `push.ts` hoặc `workspace-push.ts`

```ts
export async function triggerServerSync(opts: {
  serverBaseUrl: string
  projectId: string
  token?: string
}): Promise<{ ok: boolean; error?: string }> {
  const base = opts.serverBaseUrl.replace(/\/$/, '')
  const url = `${base}/api/projects/${encodeURIComponent(opts.projectId)}/sync?project=${encodeURIComponent(opts.projectId)}`
  const headers: Record<string, string> = {}
  const token = opts.token ?? process.env.DEV_TEAM_API_TOKEN?.trim()
  if (token) {
    headers.Authorization = `Bearer ${token}`
    headers['X-Dev-Team-Token'] = token
  }
  const res = await fetch(url, { method: 'POST', headers })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, error: `server sync failed: ${res.status} ${body}`.slice(0, 500) }
  }
  return { ok: true }
}
```

Dùng `fetch` native (Bun/Node 18+). Không import `apiFetch` FE.

#### 4.2.5 CLI — `scripts/workspace-push.ts`

Mirror `workspace-sync.ts`:

```ts
// Parse argv:
//   --project=<id>     (bắt buộc)
//   --message=<text>   (optional)
//   --sync-server=<url> (optional; fallback env DEV_TEAM_SERVER_URL)
//
// Flow:
//   1. pushGitWorkspace(projectId, { message })
//   2. Nếu --sync-server hoặc DEV_TEAM_SERVER_URL: triggerServerSync
//   3. Log human-readable; exit 1 on failure

import { get, pushGitWorkspace } from '../server/registry.js'
import { triggerServerSync } from '../server/git/push.js'

async function main() {
  const projectId = parseRequired('--project=')
  const project = get(projectId)
  if (!project) { console.error(`unknown project: ${projectId}`); process.exit(1) }

  const result = await pushGitWorkspace(projectId, { message: parseOptional('--message=') })
  if (!result.ok) { console.error(result.error); process.exit(1) }
  if (result.pushed) {
    console.log(`${projectId}: pushed ${result.commit} to origin/${result.branch}`)
  } else {
    console.log(`${projectId}: no changes under .dev-team-agent`)
  }

  const syncUrl = parseOptional('--sync-server=') ?? process.env.DEV_TEAM_SERVER_URL?.trim()
  if (syncUrl) {
    const sync = await triggerServerSync({ serverBaseUrl: syncUrl, projectId })
    if (!sync.ok) { console.error(sync.error); process.exit(1) }
    console.log(`${projectId}: server sync OK`)
  }
}
```

**Hai bước thủ công (doc):**

```bash
# Trên máy dev
bun run workspace:push --project=my-repo

# Trên server (hoặc từ dev với token)
bun run workspace:sync --project=my-repo
# hoặc: curl -X POST -H "Authorization: Bearer $TOKEN" \
#   "https://dashboard.example.com/api/projects/my-repo/sync?project=my-repo"
```

#### 4.2.6 UI cảnh báo — `src/shared/lib/host.ts` + `RunnerConfigPanel.vue`

```ts
/** Hostname được coi là local dashboard (cli-session hợp lệ). */
export function isLocalDashboardHost(hostname?: string): boolean {
  const h = (hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '')).toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'
}
```

`RunnerConfigPanel.vue`:

```ts
import { isLocalDashboardHost } from '../../../shared/lib/host.js'

const selectedCredential = computed(() =>
  credentials.value.find((c) => c.id === draft.value.credentialId),
)

const showCliSessionWarning = computed(() => {
  if (isLocalDashboardHost()) return false
  return selectedCredential.value?.secretRef === 'cli-session'
})
```

Template (sau `err-banner`, trước layout):

```html
<div v-if="showCliSessionWarning" class="warn-banner" role="alert">
  Credential <strong>cli-session</strong> cần phiên đăng nhập Claude Code trên máy này và
  <strong>không hoạt động</strong> trên server headless. Trên server, dùng runner
  <code>claude-code-server</code> với biến môi trường <code>ANTHROPIC_API_KEY</code>.
</div>
```

Style `.warn-banner` tương tự `.err-banner` nhưng màu warning (amber) — tái dùng pattern banner có sẵn.

**Không** chặn save/smoke test — chỉ cảnh báo.

#### 4.2.7 Deploy doc — mở rộng `docs/deploy.md`

Thêm các section sau §6 Git workspaces:

**§7 — Runner server (Luồng A)**

- Prerequisite: binary `claude` trong `PATH` trên host/container (dashboard **không** cài Claude Code).
- Set `ANTHROPIC_API_KEY` trong môi trường process dashboard (compose example).
- Preset `claude-code-server`: `flags: ['--bare']`, credential `claude-server-env` → `env:ANTHROPIC_API_KEY`.
- Trên server production: UI **Runner → Set default** chọn `claude-code-server` (hoặc truyền `--runner claude-code-server` trong orchestrator).
- Smoke test: Runner panel → chọn `claude-code-server` → **Smoke test** → kỳ vọng `succeeded` khi env + CLI OK.
- Khi `ANTHROPIC_API_KEY` unset: job fail — kiểm tra log job + env.

**§8 — Dev push & server sync (Luồng B)**

- Workflow: orchestrator local (`claude-code-local` + `cli-session`) → artifact trong `.dev-team-agent/` → `bun run workspace:push --project=<id>` → server `workspace:sync` hoặc UI **Đồng bộ**.
- Project id trên dev và server **nên trùng** khi cùng repo git.
- Flag `--sync-server=https://dashboard.example.com` gọi `POST /api/projects/:id/sync` (cần `DEV_TEAM_API_TOKEN` nếu server bật auth).
- `kind: 'local'` trên dev OK nếu path nằm trong git repo có remote.

**§9 — Conflict policy**

- **Một task chỉ nên có một runner active** tại một thời điểm (dev local **hoặc** server headless).
- Không implement distributed lock trong MVP — operator tránh chạy đồng thời cùng `task-id`.
- Nếu push và server job ghi cùng artifact: last-write-wins trên git; server `sync` pull có thể ghi đè mirror.

**§10 — Orchestrator chọn runner**

| Môi trường | Runner | Credential | CLI |
|---|---|---|---|
| Dev workstation | `claude-code-local` (default) | `cli-session` | `runner-cli.mjs submit ...` (không `--runner`) |
| Server / CI headless | `claude-code-server` | `env:ANTHROPIC_API_KEY` | `runner-cli.mjs submit --runner claude-code-server ...` |
| Remote SSH (#44) | `claude-code-ssh` | `file:` key | *Out of scope #42* |

Gợi ý env orchestrator (doc only, không implement đọc env trong dashboard): `DEV_TEAM_RUNNER_ID=claude-code-server` trên server.

**Bảng tổng hợp luồng A / B / C:**

| Luồng | Mô tả | Task |
|---|---|---|
| A | Server chạy job headless | #42 (this) |
| B | Dev local + push artifact | #42 (this) |
| C | SSH remote runner | #44 (OUT) |

#### 4.2.8 `docker-compose.yml`

```yaml
environment:
  # ... existing ...
  ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}  # optional — Luồng A server runner
```

Comment trong file: chỉ cần khi dùng smoke test / orchestrator headless trên container.

#### 4.2.9 Export `resolveEffectiveFlags` cho test (tuỳ chọn)

Nếu `resolveEffectiveFlags` hiện private trong `claude-code-cli.ts`, **hoặc** export named từ module, **hoặc** test gián tiếp qua thin wrapper `server/runners/flagUtils.ts` — implementer chọn cách ít diff nhất; test bắt buộc cover behavior:

- `['--bare']` + credential `env:ANTHROPIC_API_KEY` → giữ `--bare`
- `['--bare']` + `cli-session` → loại `--bare`

### 4.3 DB changes (nếu có)

Không có database. **On-disk JSON** mở rộng (backward-compatible):

| Store | Entry mới | Ghi chú |
|---|---|---|
| `runners.json` | `claude-code-server` | `ensureBuiltinRunners` merge nếu thiếu |
| `credentials.json` | `claude-server-env` (`secretRef: env:ANTHROPIC_API_KEY`) | `ensureBuiltinCredentials` merge nếu thiếu |
| `defaultRunnerId` | Vẫn `claude-code-local` | Không đổi semantics |

Không migration script — idempotent load đủ.

### 4.4 Edge cases

| Edge case | Xử lý |
|---|---|
| Fresh install (không có runners.json) | `defaultRunners()` có cả local + server |
| Legacy runners.json thiếu server preset | `ensureBuiltinRunners` append + save |
| User xóa `claude-code-server` | Cho phép; ensure chỉ thêm nếu **thiếu id** — không re-add nếu user cố ý xóa trong cùng session load (chỉ check id absent at load time — nếu user xóa và save, lần load sau sẽ re-seed; **chấp nhận** hoặc ghi doc "không xóa builtin") |
| `ANTHROPIC_API_KEY` unset trên server | `resolveSecretRef` → `value: null`; CLI fail; smoke test `failed` + log |
| Container không có `claude` binary | Job failed runtime — documented prerequisite |
| `workspace:push` ngoài git repo | 400 `not inside a git repository` |
| Không có `origin` remote | 400 `git remote origin not configured` |
| Detached HEAD | 400 yêu cầu checkout branch |
| Không có thay đổi dưới `.dev-team-agent/` | Exit 0, log `no changes`; không commit/push |
| `kind:git` URL/branch mismatch | 400 với message rõ |
| `kind:local` dev, server `kind:git` | Push OK nếu cùng repo remote; operator đảm bảo project id khớp server |
| `--sync-server` without token khi server auth on | 401 — CLI exit 1 + gợi ý set `DEV_TEAM_API_TOKEN` |
| Windows dev | `defaultRunGit` `shell: win32` — reuse |
| Concurrent push + server job cùng task | Doc §9 — không lock |
| LAN IP truy cập dashboard (`192.168.x.x`) | **Cảnh báo** cli-session (không coi là local) |
| Credential API | Không trả env value — không đổi |
| #44 SSH provider | Không đăng ký provider mới — không regression |

## §5. Test Notes

### P0 — Bắt buộc pass trước merge

| # | Module | Test case | Kỳ vọng | AC |
|---|---|---|---|---|
| 1 | `runners.test.ts` | Fresh `loadRunners()` | Có `claude-code-local` + `claude-code-server`; `defaultRunnerId === 'claude-code-local'` | A |
| 2 | `runners.test.ts` | Fresh `loadCredentials()` | Có `claude-default` + `claude-server-env`; `secretRef === 'env:ANTHROPIC_API_KEY'` | A |
| 3 | `runners.test.ts` | Legacy file chỉ local → `loadRunners()` | Sau load có thêm `claude-code-server` persisted | A |
| 4 | `claude-code-cli.test.ts` | `resolveEffectiveFlags` + env credential | Giữ `--bare` | A |
| 5 | `claude-code-cli.test.ts` | `resolveEffectiveFlags` + cli-session | Bỏ `--bare` | A |
| 6 | `push.test.ts` | Mock git: có thay đổi under `.dev-team-agent` | `git add -- <rel>`, `commit`, `push origin <branch>` | B |
| 7 | `push.test.ts` | Không phải git repo | `{ ok: false, status: 400 }` | B |
| 8 | `push.test.ts` | `kind:git` origin URL mismatch | 400 | B |
| 9 | `push.test.ts` | Porcelain rỗng | `{ ok: true, pushed: false }` | B |
| 10 | `runners.test.ts` | `submitJob` default runner | Vẫn `claude-code-local` (regression) | C |
| 11 | `host.test.ts` | `isLocalDashboardHost('localhost'/'127.0.0.1'/'app.example.com')` | true/true/false | A |
| 12 | CI | `bun run test:all` không spawn CLI thật | Suite xanh (knowhow ci-cd-testing §3) | — |

### P1 — Tuỳ chọn / manual

| # | Test | Ghi chú |
|---|---|---|
| 1 | `RunnerConfigPanel.test.ts` vitest | `showCliSessionWarning` khi hostname mock ≠ local + cli-session |
| 2 | `workspace-push.ts` integration mock registry | Exit code 0/1 |
| 3 | Manual: server có `claude` + `ANTHROPIC_API_KEY` → smoke test succeeded | Acceptance deploy |
| 4 | Manual: dev push + server sync → monitor thấy `investigate.md` mới | E2E operator |
| 5 | Manual: `workspace:push --sync-server=...` với token | Optional flag |

### Regression risk

- `defaultRunnerId` và job queue default — test #10 bắt buộc.
- `syncGitProject` (#41) — không sửa logic; chạy lại `registry.test.ts`.
- Credential CRUD delete-last guard — thêm profile không phá `deleteCredential('claude-default')` flow khi còn ≥2 profiles.
- `runners.test.ts` `listRunners().runners.length` assertions — cập nhật expected count (2 default runners).

### Test view point (cho PR comment)

- [ ] Preset server + env credential có trong store mặc định và sau legacy load
- [ ] `defaultRunnerId` vẫn `claude-code-local`
- [ ] Push scoped `.dev-team-agent/`; từ chối non-git / no origin
- [ ] UI banner cli-session trên non-localhost (manual hoặc vitest P1)
- [ ] `docs/deploy.md` có đủ §7–§10 và bảng luồng
- [ ] `bun run test:all` xanh

## §6. Out of scope

- Luồng C — SSH remote runner (#44): `claude-code-ssh`, `kind: ssh`, `pull-cache`.
- Cài đặt binary `claude` vào Docker image (chỉ document prerequisite).
- UI settings nhập `ANTHROPIC_API_KEY` (credential đọc từ env process).
- Distributed lock / task-level mutex giữa dev push và server job.
- `DEV_TEAM_DEFAULT_RUNNER` env auto-switch default runner.
- Private repo push credential (`GIT_TOKEN`) — ngoài MVP #41.
- E2E Playwright smoke job thật / push network thật trong CI.
- File doc riêng `docs/knowhow/orchestrator-runners.md`.
- Thay đổi `runner-cli.mjs` code (chỉ doc).
- Đăng ký SSH provider trong `providerRegistry.ts`.

## §7. Schedule

| Phase | Ước tính | Ghi chú |
|---|---|---|
| Builtin presets + `ensureBuiltin*()` + tests runners | 0.5 ngày | TDD characterization |
| `server/git/push.ts` + registry wrapper + `push.test.ts` | 0.75 ngày | Mock `runGit` |
| CLI `workspace-push.ts` + `triggerServerSync` | 0.25 ngày | Mirror workspace-sync |
| UI `host.ts` + RunnerConfigPanel banner | 0.25 ngày | Vitest P1 tuỳ chọn |
| `claude-code-cli` flags test | 0.25 ngày | Export helper nếu cần |
| `docs/deploy.md` + `docker-compose.yml` | 0.25 ngày | §7–§10 |
| Review + `bun run test:all` | 0.5 ngày | Fix CI regression counts |

**Tổng ước tính:** ~2.75 ngày dev (1 implementer).
