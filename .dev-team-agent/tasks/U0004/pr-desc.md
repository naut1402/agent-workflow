# PR — U0004: Pipeline Editor profile scope & round-trip

## Issue

Bug fix — lưu pipeline profile từ dashboard không phản ánh đúng setting vào project local (multi-project scope + mất `defaults`/`doc_reviewer`).

## Branch

`feat/U0004/pipeline-profile-roundtrip`

## PR

**https://github.com/naut1402/agent-workflow/pull/46** — **MERGED** (2026-07-02, `990b77d`)

## Worktree

Đã gỡ khỏi git (`worktree remove` + `branch -d`). Thư mục `wt-U0004` còn trên disk do process đang giữ — xóa thủ công sau khi đóng terminal/IDE trỏ vào đó.

## Tóm tắt

- **Bug A:** Truyền `projectId` → API profile / `pipeline-config-write` có `?project=`
- **Bug B:** Module `pipelineRoundTrip.ts` giữ `defaults`, `doc_reviewer`, step extras qua save/load

## Test

- `bun run typecheck` PASS
- `bun test` PASS
- `bun run test:fe` PASS
