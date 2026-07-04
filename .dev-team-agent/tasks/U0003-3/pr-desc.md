# PR — U0003-3 / #42

## Branch đề xuất

`feat/U0003-3/main`

## Commit message

```
feat(runners): hybrid server CLI + dev workspace push

Add claude-code-server preset, git push for .dev-team-agent artifacts,
workspace:push CLI, cli-session warning banner, and deploy docs.

Refs #42

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

## Base branch

`feat/U0003/main` — U0003-2 (#41) đã merge PR #47; U0003-3 (#42) stack trên integration branch này.

---

## PR description (paste vào GitHub)

## Issue

Refs #42

Part of #39

## Module / Phạm vi

`server/runners`, `server/git/push`, `scripts/workspace-push`, `RunnerConfigPanel` — Luồng A (server runner headless `claude-code-server` + credential env) và Luồng B (`workspace:push` đẩy artifact `.dev-team-agent/` lên remote, tuỳ chọn trigger server sync).

## Nội dung thay đổi

- Thêm preset `claude-code-server` + credential `claude-server-env` (`env:ANTHROPIC_API_KEY`); `ensureBuiltinRunners()` / `ensureBuiltinCredentials()` merge idempotent khi load store cũ; `defaultRunnerId` giữ `claude-code-local`.
- Module `server/git/push.ts`: push scoped `.dev-team-agent/`, validate git remote/branch; CLI `bun run workspace:push` mirror `workspace-sync`; flag `--sync-server` optional.
- UI banner cảnh báo `cli-session` trên non-localhost (`isLocalDashboardHost`).
- `docs/deploy.md` §7–§10: runner server, dev push/sync, conflict policy, orchestrator chọn runner; `docker-compose.yml` gợi ý `ANTHROPIC_API_KEY`.

| Trước | Sau | Ghi chú |
|-------|-----|---------|
| — | `server/git/push.ts` | `findGitRoot`, `pushDevTeamArtifacts`, `pushGitWorkspace`, `triggerServerSync` |
| — | `scripts/workspace-push.ts` | CLI `--project=`, `--message=`, `--sync-server=` |
| — | `server/runners/flagUtils.ts` | `resolveEffectiveFlags` tách ra testable |
| — | `src/shared/lib/host.ts` | `isLocalDashboardHost` — whitelist localhost |
| `server/runners/registry.ts` | `server/runners/registry.ts` | `BUILTIN_SERVER_RUNNER`, `ensureBuiltinRunners()` |
| `server/runners/credentials.ts` | `server/runners/credentials.ts` | `BUILTIN_SERVER_CREDENTIAL`, `ensureBuiltinCredentials()` |
| `server/runners/providers/claude-code-cli.ts` | `server/runners/providers/claude-code-cli.ts` | Import `flagUtils` thay logic inline |
| `server/registry.ts` | `server/registry.ts` | Export `pushGitWorkspace` qua `RegistryContext` |
| `package.json` | `package.json` | Script `workspace:push` |
| `docker-compose.yml` | `docker-compose.yml` | `ANTHROPIC_API_KEY` optional |
| `docs/deploy.md` | `docs/deploy.md` | §7 Runner server, §8 Dev push/sync, §9 Conflict, §10 Orchestrator |
| `src/features/runner/components/RunnerConfigPanel.vue` | `src/features/runner/components/RunnerConfigPanel.vue` | Banner cảnh báo `cli-session` tiếng Việt |
| — | `tests/server/git/push.test.ts` | Mock `runGit`: scoped add, no-git, URL mismatch, no changes |
| — | `tests/server/runners/claude-code-cli.test.ts` | `--bare` giữ/bỏ theo credential |
| `tests/server/runners/runners.test.ts` | `tests/server/runners/runners.test.ts` | Preset server, legacy merge, `defaultRunnerId` regression |
| — | `tests/shared/lib/host.test.ts` | Vitest `isLocalDashboardHost` |
| `tests/server/http/app.request.test.ts` | `tests/server/http/app.request.test.ts` | Stub `pushGitWorkspace` |
| `tests/server/http/auth.test.ts` | `tests/server/http/auth.test.ts` | Stub `pushGitWorkspace` |
| `tests/server/http/createApiHandler.test.ts` | `tests/server/http/createApiHandler.test.ts` | Stub `pushGitWorkspace` |
| `tests/server/http/health.test.ts` | `tests/server/http/health.test.ts` | Stub `pushGitWorkspace` |

## Test view point & test case

<details>
<summary>Test view point & test case</summary>

- [ ] **TC-01**: Fresh install có `claude-code-local` + `claude-code-server`; `defaultRunnerId === 'claude-code-local'`
- [ ] **TC-02**: Legacy `runners.json` thiếu server preset → merge idempotent + persisted
- [ ] **TC-03**: Legacy `credentials.json` thiếu `claude-server-env` → merge (khuyến nghị bổ sung test — xem review)
- [ ] **TC-04**: `resolveEffectiveFlags` giữ `--bare` với env credential
- [ ] **TC-05**: `resolveEffectiveFlags` bỏ `--bare` với `cli-session`
- [ ] **TC-06**: Push scoped `.dev-team-agent/` khi có thay đổi
- [ ] **TC-07**: Push không commit khi porcelain rỗng
- [ ] **TC-08**: Push từ chối path ngoài git repo
- [ ] **TC-09**: Push từ chối origin URL mismatch (`kind: git`)
- [ ] **TC-10**: Push từ chối detached HEAD (logic có, test chưa automate)
- [ ] **TC-11**: Push từ chối khi không có remote origin (logic có, test chưa automate)
- [ ] **TC-12**: Push từ chối branch mismatch (logic có, test chưa automate)
- [ ] **TC-13**: `kind: local` trong git repo — push OK
- [ ] **TC-14**: `submitJob` default runner vẫn `claude-code-local`
- [ ] **TC-15**: `isLocalDashboardHost` whitelist localhost / từ chối remote & LAN IP
- [ ] **TC-16**: UI banner cli-session trên non-localhost (manual P1)
- [ ] **TC-17**: CLI `workspace:push --project=<id>` (manual)
- [ ] **TC-18**: CLI `--sync-server` trigger server sync (manual)
- [ ] **TC-19**: Server smoke test Luồng A — `claude-code-server` + `ANTHROPIC_API_KEY` (manual acceptance)
- [ ] **TC-20**: E2E Luồng B — dev push + server sync → monitor thấy artifact (manual)
- [ ] **TC-21**: Provider registry không có SSH (#44 regression)
- [ ] **TC-22**: `bun run test:all` xanh

**Regression:** `defaultRunnerId`, `syncGitProject` (#41), credential CRUD, provider registry (#44).

</details>

## Loại test đã thêm/migrate

- [x] Unit (bun test — backend) ở `tests/server` · `tests/mcp`
- [x] Unit (vitest — frontend) ở `tests/src` · `tests/shared`
- [ ] Integration API (Hono `app.request`) — chỉ stub registry
- [ ] E2E (playwright) — manual operator theo `docs/deploy.md` §7–§8

## Kết quả test (local)

| Lệnh | Kết quả |
|------|---------|
| `bun run typecheck` | CLEAN |
| `bun test tests/server tests/mcp` | 219 pass |
| `bun run test:fe` | 110 pass |

## Notes for reviewer

- **[should]** `server/git/push.ts`: `git commit` chưa giới hạn pathspec — nếu operator đã stage file khác, commit có thể gộp ngoài ý muốn. Cân nhắc `git commit -m msg -- <devTeamRel>`.
- **[should]** `resolveDevTeamRelativePath` dùng `slice(-2)` — layout sâu hơn `mono/pkg/.dev-team-agent` có thể sai path.
- **[should]** Thiếu characterization test: detached HEAD, no origin, branch mismatch, legacy credentials merge, `triggerServerSync` mock fetch.
- **[imo]** `RunnerConfigPanel` vitest P1 chưa có; builtin preset re-seed sau khi user xóa — ghi chú doc §7 nếu cần.
- Review recommendation: **APPROVE** — không blocker; các `[should]` là hardening/follow-up.

## Checklist

- [x] Không thay đổi hành vi public runner contract (`RunnerProvider` giữ nguyên)
- [x] Test xanh local (`typecheck.md`)
- [x] Tuân thủ `.claude/rules/coding-conventions.md`
- [x] Git hygiene: không commit generated/dist
- [x] File mới đặt đúng layout `server/`, `tests/`, `src/shared/`

## Related

- Issue: #42 (subtask epic #39)
- Parent: #41 (git workspace — base branch), #40 (server-ready)
- Design: `.dev-team-agent/tasks/U0003-3/design.md`
