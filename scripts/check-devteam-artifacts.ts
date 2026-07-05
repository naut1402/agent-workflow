#!/usr/bin/env bun
// CI guard — chặn tái diễn việc artifact thật dưới `.dev-team-agent/**` bị
// commit vào git (root cause: `pushDevTeamArtifacts()` chạy `git add --
// .dev-team-agent` trên toàn thư mục; một khi ≥1 file đã tracked, `git add`
// tự động stage cả file mới/sửa trong đường dẫn đó bất kể `.gitignore`).
// Chạy độc lập với transport (bắt được cả `kind: 'git'` legacy).
import { execFileSync } from 'node:child_process'

// Chỉ 3 file skeleton được phép tracked trong git — mirror `.gitignore`
// (dòng giữ `.gitkeep` × 2 + `README.md`).
export const ALLOWED_TRACKED_FILES = new Set([
  '.dev-team-agent/.dev-state/.gitkeep',
  '.dev-team-agent/tasks/.gitkeep',
  '.dev-team-agent/README.md',
])

export type ListTrackedFiles = (cwd: string) => string[]

export function defaultListTrackedFiles(cwd: string): string[] {
  const out = execFileSync('git', ['ls-files', '.dev-team-agent'], { cwd, encoding: 'utf8' })
  return out.split('\n').map((l) => l.trim()).filter(Boolean)
}

export function checkDevTeamArtifacts(opts: {
  cwd?: string
  listTrackedFiles?: ListTrackedFiles
}): { ok: true } | { ok: false; unexpected: string[] } {
  const cwd = opts.cwd ?? process.cwd()
  const list = opts.listTrackedFiles ?? defaultListTrackedFiles
  const tracked = list(cwd)
  const unexpected = tracked.filter((f) => !ALLOWED_TRACKED_FILES.has(f))
  if (unexpected.length) return { ok: false, unexpected }
  return { ok: true }
}

function main() {
  const result = checkDevTeamArtifacts({})
  // `in`-operator narrowing (boolean-discriminant narrowing misbehaves under vue-tsc here).
  if ('unexpected' in result) {
    console.error('[check-devteam-artifacts] Phát hiện file KHÔNG hợp lệ đang tracked dưới .dev-team-agent/**:')
    for (const f of result.unexpected) console.error(`  - ${f}`)
    console.error(
      '\nChỉ được phép tracked: ' + [...ALLOWED_TRACKED_FILES].join(', ') +
        '\nXem docs/runbooks/cleanup-devteam-history.md để xoá các file này khỏi lịch sử git.',
    )
    process.exit(1)
  }
  console.log('[check-devteam-artifacts] OK — chỉ có skeleton files tracked dưới .dev-team-agent/**.')
}

if (import.meta.main) {
  main()
}
