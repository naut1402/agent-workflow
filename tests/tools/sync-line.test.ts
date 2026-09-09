import { afterAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..', '..')
const SCRIPT = path.join(ROOT, '.github/scripts/sync-line.sh')

/**
 * `sync-line.sh` là script gốc `sync-from-main.sh` đã tham số hoá theo dòng
 * branch (`SRC_REF` / `TARGET_NS`). Bẫy chỉ xuất hiện ở dòng test:
 * `git for-each-ref refs/remotes/origin/test` **có** trả về chính `test/main`,
 * nên thiếu bước loại `SRC_REF` là script tự merge nó vào chính nó.
 *
 * Test chạy trên repo git thật trong tmp — logic ở đây là logic git, mock lại
 * thì không còn kiểm được gì.
 */

const tmpDirs: string[] = []

afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} → ${r.status}\n${r.stderr}`)
  return r.stdout.trim()
}

function commit(cwd: string, file: string, body: string, msg: string): void {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true })
  fs.writeFileSync(path.join(cwd, file), body, 'utf8')
  git(cwd, 'add', file)
  git(cwd, 'commit', '-m', msg)
}

/**
 * Dựng bare origin + một clone làm việc, với dòng test hai tầng:
 *   test/main (gốc dòng)  ←  test/1.1.3/main, test/1.1.4/main
 * `test/main` có một commit mà hai dòng version chưa có ⇒ có việc để sync.
 */
function setupTestLine(): { work: string; origin: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-sync-line-'))
  tmpDirs.push(base)
  const origin = path.join(base, 'origin.git')
  const work = path.join(base, 'work')

  git(base, 'init', '--bare', '--initial-branch=test/main', origin)
  git(base, 'clone', origin, work)
  git(work, 'config', 'user.email', 'ci@example.com')
  git(work, 'config', 'user.name', 'CI')

  commit(work, 'tests/a.test.ts', '// a\n', 'test: thêm a')
  git(work, 'push', 'origin', 'HEAD:refs/heads/test/main')

  for (const v of ['1.1.3', '1.1.4']) {
    git(work, 'push', 'origin', 'HEAD:refs/heads/test/' + v + '/main')
  }

  // Commit mới CHỈ ở test/main → hai dòng version cần sync.
  git(work, 'checkout', '-B', 'test/main', 'origin/test/main')
  commit(work, 'tests/b.test.ts', '// b\n', 'test: thêm b')
  git(work, 'push', 'origin', 'HEAD:refs/heads/test/main')
  git(work, 'fetch', 'origin')

  return { work, origin }
}

function runSync(work: string, env: Record<string, string>): { code: number; summary: string; out: string } {
  const summaryFile = path.join(work, '..', `summary-${Math.random().toString(36).slice(2)}.md`)
  const r = spawnSync('bash', [SCRIPT], {
    cwd: work,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_STEP_SUMMARY: summaryFile,
      ...env,
    },
  })
  return {
    code: r.status ?? 1,
    summary: fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, 'utf8') : '',
    out: `${r.stdout}\n${r.stderr}`,
  }
}

describe('sync-line.sh — dòng test', () => {
  test('SRC_REF không nằm trong danh sách target (không tự merge vào chính nó)', () => {
    const { work } = setupTestLine()
    const r = runSync(work, { SRC_REF: 'test/main', TARGET_NS: 'test', EXTRA_FILE: '' })

    expect(r.code).toBe(0)
    // Bảng summary có một dòng cho mỗi target. `test/main` là SRC_REF nên không
    // được xuất hiện như một target.
    const targetRows = r.summary.split('\n').filter((l) => /^\| `test\//.test(l))
    expect(targetRows.length).toBe(2)
    expect(targetRows.some((l) => l.startsWith('| `test/main`'))).toBe(false)
    expect(r.out).toContain('test/1.1.3/main')
    expect(r.out).toContain('test/1.1.4/main')
  })

  test('merge sạch thì push — hai dòng version nhận được commit của test/main', () => {
    const { work, origin } = setupTestLine()
    expect(runSync(work, { SRC_REF: 'test/main', TARGET_NS: 'test', EXTRA_FILE: '' }).code).toBe(0)

    for (const v of ['1.1.3', '1.1.4']) {
      const files = git(origin, 'ls-tree', '-r', '--name-only', `refs/heads/test/${v}/main`)
      expect(files).toContain('tests/b.test.ts')
    }
  })

  test('target đã chứa SRC_REF → skipped, không tạo merge commit rỗng', () => {
    const { work, origin } = setupTestLine()
    runSync(work, { SRC_REF: 'test/main', TARGET_NS: 'test', EXTRA_FILE: '' })
    const before = git(origin, 'rev-parse', 'refs/heads/test/1.1.3/main')

    git(work, 'fetch', 'origin')
    const second = runSync(work, { SRC_REF: 'test/main', TARGET_NS: 'test', EXTRA_FILE: '' })

    expect(second.code).toBe(0)
    expect(second.summary).toContain('skipped')
    expect(git(origin, 'rev-parse', 'refs/heads/test/1.1.3/main')).toBe(before)
  })

  test('TARGET_NS không có branch nào → thoát 0, ghi rõ không có target', () => {
    const { work } = setupTestLine()
    const r = runSync(work, { SRC_REF: 'test/main', TARGET_NS: 'khong-ton-tai', EXTRA_FILE: '' })

    expect(r.code).toBe(0)
    expect(r.summary).toContain('_(none)_')
  })

  test('EXTRA_FILE rỗng → không đọc auto-merge-targets.yml của dòng source', () => {
    const { work } = setupTestLine()
    // File này khai target của dòng source. Nếu script vẫn đọc nó khi
    // EXTRA_FILE='' thì dòng test sẽ nhận cả cây source vào cây orphan.
    fs.mkdirSync(path.join(work, '.github'), { recursive: true })
    fs.writeFileSync(
      path.join(work, '.github/auto-merge-targets.yml'),
      'extra_targets:\n  - dev/9.9.9/main\n',
      'utf8',
    )

    const r = runSync(work, { SRC_REF: 'test/main', TARGET_NS: 'test', EXTRA_FILE: '' })
    expect(r.out).not.toContain('dev/9.9.9/main')
    expect(r.summary).not.toContain('dev/9.9.9/main')
  })

  test('header summary nêu đúng cặp dòng đang sync', () => {
    const { work } = setupTestLine()
    const r = runSync(work, { SRC_REF: 'test/main', TARGET_NS: 'test', EXTRA_FILE: '' })
    expect(r.summary).toContain('Sync test/main → test/**/main')
  })
})
