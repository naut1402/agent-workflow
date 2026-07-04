# Test Spec — U0003-3

## 1. Phạm vi test

Task hoàn thiện **Luồng A** (server runner headless `claude-code-server` + credential `env:ANTHROPIC_API_KEY`) và **Luồng B** (`bun run workspace:push` đẩy artifact `.dev-team-agent/` lên git remote, tuỳ chọn trigger server sync).

| Module | Phương pháp | File test |
|---|---|---|
| Builtin runners/credentials | Unit (bun) | `tests/server/runners/runners.test.ts` |
| `--bare` vs cli-session flags | Unit (bun) | `tests/server/runners/claude-code-cli.test.ts` |
| Git push domain | Unit mock `runGit` (bun) | `tests/server/git/push.test.ts` |
| Localhost helper | Unit (vitest) | `tests/shared/lib/host.test.ts` |
| UI cli-session warning | Manual / P1 vitest | `RunnerConfigPanel.vue` |
| Type safety | `vue-tsc` | `typecheck.md` |
| E2E operator | Manual | `docs/deploy.md` §7–§8 |

**Regression:** `defaultRunnerId`, `submitJob` default runner, `syncGitProject` (#41), provider registry (#44 SSH chưa đăng ký).

---

## 2. Test cases

### TC-01: Fresh install có preset server + env credential
- **Type**: Normal
- **Input**: `DEV_TEAM_DASHBOARD_HOME` trống; gọi `loadRunners()` / `loadCredentials()`
- **Expected output**:
  - Runners: `claude-code-local`, `claude-code-server`
  - `defaultRunnerId === 'claude-code-local'`
  - `claude-code-server.config.flags` chứa `--bare`
  - Credential `claude-server-env.secretRef === 'env:ANTHROPIC_API_KEY'`
- **Setup**: `beforeEach` xóa `runners.json` / `credentials.json` trong temp home
- **Notes**: Đã automate — `runners.test.ts`

### TC-02: Legacy runners.json thiếu server preset được merge
- **Type**: Regression
- **Input**: File `runners.json` chỉ có `claude-code-local`
- **Expected output**: Sau `loadRunners()` có thêm `claude-code-server`; file persisted trên disk
- **Setup**: Ghi legacy JSON vào temp home
- **Notes**: Đã automate — `runners.test.ts`

### TC-03: Legacy credentials.json thiếu server profile được merge
- **Type**: Regression
- **Input**: File `credentials.json` chỉ có `claude-default`
- **Expected output**: Sau `loadCredentials()` có `claude-server-env`; file persisted
- **Setup**: Ghi legacy JSON vào temp home
- **Notes**: **Chưa automate** — khuyến nghị bổ sung (xem `review.md`)

### TC-04: `resolveEffectiveFlags` giữ `--bare` với env credential
- **Type**: Normal
- **Input**: `flags: ['--bare']`, credential `secretRef: 'env:ANTHROPIC_API_KEY'`
- **Expected output**: `['--bare']`
- **Setup**: —
- **Notes**: Đã automate — `claude-code-cli.test.ts`

### TC-05: `resolveEffectiveFlags` bỏ `--bare` với cli-session
- **Type**: Normal
- **Input**: `flags: ['--bare', '--other']`, credential `secretRef: 'cli-session'`
- **Expected output**: `['--other']`
- **Setup**: —
- **Notes**: Đã automate — `claude-code-cli.test.ts`

### TC-06: Push scoped `.dev-team-agent` khi có thay đổi
- **Type**: Normal
- **Input**: Project `kind: 'local'`, path trong git repo; mock `status --porcelain` có diff
- **Expected output**:
  - `git add -- .dev-team-agent`
  - `git commit`, `git push origin <branch>`
  - `{ ok: true, pushed: true, commit, branch }`
- **Setup**: Temp dir có `.git/` + `.dev-team-agent/`
- **Notes**: Đã automate — `push.test.ts`

### TC-07: Push không commit khi không có thay đổi
- **Type**: Boundary
- **Input**: Mock `status --porcelain` rỗng sau `git add`
- **Expected output**: `{ ok: true, pushed: false, branch }`; không gọi `commit`/`push`
- **Setup**: Temp git repo
- **Notes**: Đã automate — `push.test.ts`

### TC-08: Push từ chối path ngoài git repo
- **Type**: Abnormal
- **Input**: Project path không có `.git` ancestor
- **Expected output**: `{ ok: false, status: 400, error: 'project path is not inside a git repository' }`
- **Setup**: Temp dir không phải git repo
- **Notes**: Đã automate — `push.test.ts`

### TC-09: Push từ chối origin URL mismatch (kind git)
- **Type**: Abnormal
- **Input**: `project.kind === 'git'`, `source.url` khác `git remote get-url origin`
- **Expected output**: `{ ok: false, status: 400 }`, message chứa `origin URL does not match`
- **Setup**: Mock `runGit` remote + rev-parse
- **Notes**: Đã automate — `push.test.ts`

### TC-10: Push từ chối detached HEAD
- **Type**: Abnormal
- **Input**: `git rev-parse --abbrev-ref HEAD` → `HEAD`
- **Expected output**: `{ ok: false, status: 400, error: chứa 'detached HEAD' }`
- **Setup**: Mock `runGit`
- **Notes**: **Chưa automate** — logic có trong `push.ts:87-88`

### TC-11: Push từ chối khi không có remote origin
- **Type**: Abnormal
- **Input**: `git remote get-url origin` throw
- **Expected output**: `{ ok: false, status: 400, error: 'git remote origin not configured' }`
- **Setup**: Mock `runGit`
- **Notes**: **Chưa automate**

### TC-12: Push từ chối branch mismatch (kind git)
- **Type**: Abnormal
- **Input**: `project.source.branch === 'develop'`, current branch `main`
- **Expected output**: `{ ok: false, status: 400 }`, message branch mismatch
- **Setup**: Mock `runGit`
- **Notes**: **Chưa automate**

### TC-13: `kind: 'local'` trong git repo — push OK
- **Type**: Normal
- **Input**: Local project path = `.dev-team-agent` trong repo có origin
- **Expected output**: Push thành công (không validate URL khi không phải kind git)
- **Setup**: Mock git commands
- **Notes**: Đã automate — `push.test.ts`

### TC-14: `submitJob` default runner vẫn local
- **Type**: Regression
- **Input**: `submitJob({ agentRef: 'noref', workspace })` không truyền `runnerId`
- **Expected output**: `job.runnerId === 'claude-code-local'`
- **Setup**: Fresh runners store
- **Notes**: Đã automate — `runners.test.ts`

### TC-15: `isLocalDashboardHost` whitelist
- **Type**: Boundary
- **Input**: `localhost`, `127.0.0.1`, `[::1]`, `::1`, `app.example.com`, `192.168.1.10`
- **Expected output**: Local variants → `true`; remote/LAN → `false`
- **Setup**: Truyền hostname explicit (không dùng `window`)
- **Notes**: Đã automate — `host.test.ts`

### TC-16: UI banner cli-session trên non-localhost
- **Type**: Normal
- **Input**: Dashboard host `dashboard.example.com`; runner credential `cli-session` được chọn
- **Expected output**: Banner cảnh báo tiếng Việt hiển thị; không chặn save/smoke test
- **Setup**: Deploy server hoặc vitest mock `window.location.hostname`
- **Notes**: Manual P1; chưa có vitest component test

### TC-17: CLI `workspace:push --project=<id>`
- **Type**: Normal
- **Input**: Project id hợp lệ trong registry; có thay đổi dưới `.dev-team-agent/`
- **Expected output**: Exit 0; log `pushed <commit> to origin/<branch>`
- **Setup**: Dev machine có git write access + remote
- **Notes**: Manual / integration

### TC-18: CLI `--sync-server` trigger server sync
- **Type**: Normal
- **Input**: `--sync-server=https://dashboard.example.com` hoặc `DEV_TEAM_SERVER_URL`; `DEV_TEAM_API_TOKEN` nếu auth bật
- **Expected output**: Sau push thành công, log `server sync OK`; server mirror cập nhật artifact
- **Setup**: Server dashboard chạy + token
- **Notes**: Manual; unit mock `triggerServerSync` khuyến nghị

### TC-19: Server smoke test Luồng A
- **Type**: Normal (acceptance)
- **Input**: Server có `claude` trong PATH + `ANTHROPIC_API_KEY` set; chọn runner `claude-code-server`
- **Expected output**: Smoke test job `succeeded`
- **Setup**: `docker-compose.yml` hoặc bare metal theo `docs/deploy.md` §7
- **Notes**: Manual — prerequisite ngoài dashboard

### TC-20: End-to-end Luồng B — dev push + server sync → monitor thấy artifact
- **Type**: Normal (acceptance)
- **Input**: Orchestrator local tạo `investigate.md`; `workspace:push` → server `workspace:sync`
- **Expected output**: `GET /api/tasks` trên server hiển thị artifact mới
- **Setup**: Cùng repo git; project id khớp dev/server
- **Notes**: Manual E2E operator

### TC-21: Provider registry không regression #44
- **Type**: Regression
- **Input**: `listProviderIds()`
- **Expected output**: Chỉ chứa `claude-code-cli`; không có `claude-code-ssh`
- **Setup**: —
- **Notes**: Đã automate — `runners.test.ts` provider registry describe

### TC-22: CI full chain
- **Type**: Regression
- **Input**: `bun run test:all`
- **Expected output**: typecheck pass; bun test pass; vitest pass; playwright pass
- **Setup**: CI hoặc local clone sạch
- **Notes**: Không spawn CLI thật trong unit suite

---

## 3. Coverage matrix

| Acceptance Criteria | TC liên quan | Trạng thái |
|---|---|---|
| AC-A: Server job + env credential → succeeded | TC-01, TC-04, TC-19 | [x] unit / [ ] manual smoke |
| AC-B: Dev push → server thấy artifact | TC-06–TC-13, TC-17–TC-20 | [x] unit core / [ ] E2E manual |
| AC-C: `defaultRunnerId` unchanged | TC-01, TC-14 | [x] |
| AC-D: UI cli-session warning | TC-15, TC-16 | [x] helper / [ ] UI |
| AC-E: Docs §7–§10 | TC-19, TC-20 | [x] doc review |
| AC-F: Không break SSH #44 | TC-21 | [x] |
| AC-G: `bun run test:all` xanh | TC-22 | [x] per `typecheck.md` |

---

## 4. Regression risk

| Khu vực | Rủi ro | Hành động kiểm tra |
|---|---|---|
| `defaultRunnerId` / job queue default | Orchestrator dev gọi nhầm server runner | TC-14 |
| `syncGitProject` (#41) | Push không sửa sync logic nhưng dùng chung registry | Chạy lại `tests/server/registry.test.ts` |
| Credential CRUD delete-last | Thêm profile mới phá guard xóa cuối | TC-01 + `deleteCredential` test hiện có |
| `resolveEffectiveFlags` refactor | `--bare` leak vào cli-session | TC-04, TC-05 |
| `git commit` scope | File staged ngoài `.dev-team-agent` bị commit kèm | Manual: stage file khác → chạy push; xem `review.md` |
| Concurrent dev push + server job | Last-write-wins, không lock | Manual theo `docs/deploy.md` §9 |
| Container thiếu `claude` binary | Job fail runtime | TC-19 negative — log job |
| `ANTHROPIC_API_KEY` unset | Smoke test failed | TC-19 negative |
| SSH provider (#44) | Đăng ký sớm provider mới | TC-21 |
