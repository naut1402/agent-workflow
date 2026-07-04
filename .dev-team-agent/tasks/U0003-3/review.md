Reviewed commit: e451150d126ea27f36b9585ef91f5407a28a369b

# Review — U0003-3: Runner hybrid — server CLI + dev sync

## Đối chiếu acceptance criteria

| AC | Trạng thái | Ghi chú |
|---|---|---|
| Server job + env credential → `succeeded` | ✅ Đạt (code + doc) | Preset `claude-code-server` + `claude-server-env`; smoke test manual theo `docs/deploy.md` §7 |
| Dev push → server dashboard thấy artifact | ✅ Đạt | `workspace:push` + `--sync-server` optional; doc 2 bước §8 |
| `defaultRunnerId` không đổi | ✅ Đạt | Vẫn `claude-code-local`; test `submitJob` regression |
| UI cảnh báo cli-session | ✅ Đạt | `isLocalDashboardHost` + banner tiếng Việt |
| Docs §7–§10 | ✅ Đạt | `docs/deploy.md` đủ section + bảng luồng A/B/C |
| Tests P0 | ✅ Đạt (có gap nhỏ) | `typecheck.md`: typecheck + 219 bun + 110 vitest pass |
| Không regression SSH #44 | ✅ Đạt | `providerRegistry.ts` chỉ `claude-code-cli`; không đăng ký SSH provider |

**PHPStan:** Không áp dụng (dự án TypeScript). `typecheck.md` báo **CLEAN**.

---

## Findings

[should] server/git/push.ts:54 — `git commit` không giới hạn pathspec
  Context: Design §4.2.3 yêu cầu commit **scoped** `.dev-team-agent/**`. Hiện chỉ `git add -- <devTeamRel>` nhưng `git commit -m msg` sẽ commit **mọi** file đã staged trong index — nếu operator đã `git add` file khác trước đó, push có thể gộp commit ngoài ý muốn.
  Suggestion: Dùng `await run(['commit', '-m', msg, '--', opts.devTeamRel], { cwd })` hoặc kiểm tra `git diff --cached --name-only` chỉ chứa path dưới `devTeamRel` trước khi commit.

[should] server/git/push.ts:23-24 — `resolveDevTeamRelativePath` chỉ lấy 2 segment cuối
  Context: `rel.split(path.sep).slice(-2).join('/')` đúng cho `.dev-team-agent` và `pkg/.dev-team-agent`, nhưng sai với layout sâu hơn (ví dụ `mono/pkg/.dev-team-agent` → `pkg/.dev-team-agent`). `git add` sẽ miss path thật.
  Suggestion: Khi `rel.endsWith('.dev-team-agent')`, trả `rel.replace(/\\/g, '/')` thay vì `slice(-2)`; hoặc ghi rõ limitation trong doc nếu chỉ hỗ trợ tối đa một cấp cha.

[should] tests/server/git/push.test.ts — Thiếu edge case P0 từ design §4.4
  Context: Logic đã implement (detached HEAD, no origin, branch mismatch) nhưng chưa có characterization test — regression risk khi refactor `pushGitWorkspace`.
  Suggestion: Bổ sung mock test cho: `rev-parse --abbrev-ref` → `HEAD`; `remote get-url` throw; `project.source.branch` ≠ current branch.

[should] tests/server/runners/runners.test.ts — Thiếu test legacy `credentials.json`
  Context: Design §5 P0 #3 chỉ cover legacy `runners.json`; `ensureBuiltinCredentials` merge idempotent chưa được assert tương tự (file chỉ `claude-default` → sau load có `claude-server-env` persisted).
  Suggestion: Mirror test legacy runners: write credentials.json thiếu `claude-server-env`, gọi `loadCredentials()`, assert profile mới + file persisted.

[should] tests/server/git/push.test.ts — Không cover `triggerServerSync`
  Context: Luồng `--sync-server` là một phần AC Luồng B; hiện chỉ test qua CLI manual. Mock `fetch` giúp bắt lỗi URL/token/header sớm.
  Suggestion: Test `triggerServerSync` với mock `globalThis.fetch`: 200 OK, 401 với message slice, header `Authorization` + `X-Dev-Team-Token` khi có token.

[imo] tests/src/features/runner/RunnerConfigPanel.test.ts — Chưa có (P1)
  Context: Design §5 đánh dấu optional; banner UI chỉ cover manual / `host.test.ts` gián tiếp.
  Suggestion: Vitest mount component với mock `window.location.hostname` + credential `cli-session` để lock regression UI.

[imo] server/runners/registry.ts:55-65 — `ensureBuiltinRunners` re-seed preset đã xóa
  Context: User xóa `claude-code-server` và save → lần `loadRunners()` sau sẽ thêm lại. Design §4.4 chấp nhận; có thể gây nhầm operator cố ý gỡ preset.
  Suggestion: Ghi chú trong `docs/deploy.md` §7: builtin preset tự merge khi thiếu id.

[imo] scripts/workspace-push.ts — Không mirror `workspace-sync` sync-all mode
  Context: `workspace-sync` không có `--project` sẽ sync mọi `kind:git`; push bắt buộc `--project=`. Hợp lý vì push chạy trên dev (single repo), không cần parity.
  Suggestion: Không cần sửa; có thể ghi một dòng trong doc §8.

---

## Điểm tích cực

- Implementation khớp design: `BUILTIN_SERVER_RUNNER` / `BUILTIN_SERVER_CREDENTIAL`, `ensureBuiltin*()` idempotent, `push.ts` mirror pattern `workspace.ts`, CLI mirror `workspace-sync.ts`.
- Tách `resolveEffectiveFlags` sang `flagUtils.ts` — diff nhỏ, testable, provider vẫn dùng đúng contract.
- `defaultRunnerId` và `submitJob` default regression được giữ (`runners.test.ts:197`).
- UI banner đúng copy tiếng Việt, `role="alert"`, style amber tách biệt `.err-banner`.
- `docs/deploy.md` §7–§10 + `docker-compose.yml` `ANTHROPIC_API_KEY` optional đầy đủ.
- HTTP test stubs cập nhật `pushGitWorkspace` — typecheck sạch.

---

## Summary
- [must]: 0 findings
- [should]: 5 findings
- [imo]: 3 findings

Recommendation: **APPROVE**

Không có blocker security/logic. Các `[should]` chủ yếu là hardening commit scope và bổ sung characterization test — nên xử lý ở round review tiếp hoặc follow-up nhỏ trước merge nếu team muốn coverage đủ design §5 P0 edge cases.
