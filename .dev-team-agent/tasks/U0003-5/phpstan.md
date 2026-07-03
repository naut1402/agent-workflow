# U0003-5 — Implementer report (Sub-issue #44 / F0003.5)

## 1. Summary of changes

Đã implement **SSH remote runner + pull cache** (#44):

- Schema Zod: `shared/schemas/runner-ssh.ts`, `shared/schemas/project.ts`
- Provider `claude-code-ssh` + shared `claude-shared.ts` (DRY với CLI)
- `server/workspace/sshSync.ts` — `pullArtifacts`, `testSshConnection`, `buildSshArgs`
- Registry: `kind: ssh`, `addSshProject`, `resolveProjectRoot` → `artifactCache`
- `jobQueue` post-job pull hook cho SSH jobs
- API: `POST /api/runners/:id/test-ssh`, `POST /api/projects/:id/pull-cache`, mở rộng `POST /api/projects`
- UI: `RunnerConfigPanel` (form SSH + test), `ProjectBar` (tab SSH, badge, pull cache)
- Tests T44-01..T44-09 + stubs cross-platform (`tests/fixtures/bin/*.mjs`)
- Docs: `docs/ssh-remote.md`, section trong `docs/deploy.md`

## 2. Commands run + outputs

### 2.1 Typecheck

```bash
npx vue-tsc --noEmit
```

Exit code: **0** (pass)

### 2.2 Backend tests (bun)

```bash
bun test tests/server tests/mcp
```

Exit code: **0**

```
191 pass
0 fail
413 expect() calls
Ran 191 tests across 26 files.
```

SSH-specific files:

- `tests/server/runners/ssh-provider.test.ts`
- `tests/server/workspace/sshSync.test.ts`
- `tests/server/http/runners.ssh.test.ts`
- `tests/server/registry.test.ts` (SSH section)

## 3. Status

| Gate | Result |
|------|--------|
| `vue-tsc --noEmit` | ✅ CLEAN |
| `bun test tests/server tests/mcp` | ✅ CLEAN (191 pass) |
| PHPStan | N/A — dự án TS/Bun |

## 4. Known issues

- Không chạy `test:fe` / `test:e2e` trong phase implementer này (ngoài scope gate P0 #44 backend).
- Trên Windows dev, stub SSH/rsync dùng `SSH_STUB_SCRIPT` / `RSYNC_STUB_SCRIPT` (node `.mjs`); production dùng binary `ssh`/`rsync` thật.

## 5. QA

Không có — design §4 đủ rõ, không tạo `qa.md`.
