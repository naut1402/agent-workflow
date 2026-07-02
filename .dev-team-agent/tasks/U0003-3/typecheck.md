# Typecheck — U0003-3

## Lệnh đã chạy

```bash
bun run typecheck          # vue-tsc --noEmit
bun test tests/server tests/mcp
bun run test:fe            # vitest (tests/src + tests/shared)
```

## Kết quả

| Lệnh | Trạng thái | Ghi chú |
|---|---|---|
| `bun run typecheck` | **CLEAN** | Không lỗi TS sau khi bổ sung `pushGitWorkspace` vào HTTP test stubs |
| `bun test tests/server tests/mcp` | **PASS** | 219 tests, 0 fail |
| `bun run test:fe` | **PASS** | 110 tests (gồm `tests/shared/lib/host.test.ts`) |

## Files test mới / cập nhật

| File | Mô tả |
|---|---|
| `tests/server/git/push.test.ts` | Mock `runGit`: scoped add, no-git, URL mismatch, no changes |
| `tests/server/runners/claude-code-cli.test.ts` | `resolveEffectiveFlags` env vs cli-session |
| `tests/server/runners/runners.test.ts` | Preset server + legacy merge + defaultRunnerId regression |
| `tests/shared/lib/host.test.ts` | Vitest `isLocalDashboardHost` |
| `tests/server/http/*.test.ts` | Stub `pushGitWorkspace` trong fake registry |

## Known issues

Không có lỗi typecheck mới.
