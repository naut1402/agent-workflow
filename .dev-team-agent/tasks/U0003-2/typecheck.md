# Typecheck & Test — U0003-2

## Typecheck

```
bun run typecheck  → PASS (vue-tsc --noEmit)
```

## Backend tests (`bun test tests/server tests/mcp`)

```
198 pass, 0 fail (25 files)
```

Modules mới/cập nhật:
- `tests/shared/schemas/project.test.ts` — Zod SSOT
- `tests/shared/git/url.test.ts` — validateGitUrl guards
- `tests/server/git/workspace.test.ts` — mock runGit, clone/pull/reclone
- `tests/server/registry.test.ts` — addFromGit, syncGitProject, legacy normalize
- `tests/server/http/api.golden.test.ts` — POST git/local, sync 404/400
- `tests/mcp/server.test.ts` — add_project gitUrl mocked

## Frontend tests (`bun run test:fe`)

```
107 pass, 0 fail (22 files)
```

## Ghi chú

- Mọi test git **mock** `runGit` — không gọi network thật trong CI.
- Auth #40 (`DEV_TEAM_API_TOKEN`) chưa merge trên branch — matrix 401 chưa áp dụng; endpoint mới sẽ inherit auth khi #45 merge.

## Status

**CLEAN**
