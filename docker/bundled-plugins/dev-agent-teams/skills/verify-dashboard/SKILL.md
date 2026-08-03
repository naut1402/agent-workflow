---
name: verify-dashboard
description: Chạy typecheck + test suite cho dashboard app. Reference skill — dùng bởi implementer agent (cc-plugin). App đã tách sang repo riêng (naut1402/agent-workflow); skill verify trong bản clone đó.
user-invocable: false
---

# Verify Dashboard

Quy trình xác minh thay cho PHPStan trên repo cc-plugin.

> **App đã tách repo.** Source dashboard giờ ở [naut1402/agent-workflow](https://github.com/naut1402/agent-workflow). Việc verify chạy trong **bản clone** tại `$DEV_TEAM_DASHBOARD_APP` (mặc định `~/.dev-team-dashboard/app`), không còn trong `plugins/dev-agent-teams/`.

## Thư mục app

`${DEV_TEAM_DASHBOARD_APP:-~/.dev-team-dashboard/app}` — bản clone của agent-workflow. Nếu chưa có, chạy `/dev-dashboard` (hoặc `git clone https://github.com/naut1402/agent-workflow "$APP_DIR"`) rồi `bun install`.

## Bước thực hiện

1. `cd "$APP_DIR"`.
2. `bun run typecheck` — phải exit 0.
3. `bun run test:all` — typecheck + server/mcp tests + frontend (vitest) + e2e (Playwright). Nếu môi trường không chạy được Playwright, tối thiểu `bun run test` (server/mcp) phải pass.
4. Ghi kết quả vào `.dev-team-agent/tasks/<task-id>/verify.md`:

```markdown
# Verify — <task-id>

## Typecheck
- Command: bun run typecheck
- Result: pass/fail
- Output: (tóm tắt lỗi nếu có)

## Tests
- Command: bun run test:all (hoặc bun run test nếu skip e2e)
- Result: pass/fail
- Details: (tóm tắt suite nào fail)
```

> Nếu thay đổi nằm ở phía cc-plugin (markdown skill/plugin manifest, không phải app), bỏ qua bước build app — chỉ kiểm tra JSON manifest hợp lệ và skill front-matter đúng.
