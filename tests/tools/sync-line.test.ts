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

/**
 * Dựng **hai dòng đối xứng** với cây đầy: dòng source (`main`, `dev/x.y.z/main`)
 * và dòng test (`test/main`, `test/x.y.z/main`). Commit mới chỉ ở
 * `dev/1.1.4/main` ⇒ đúng một cặp cần sync.
 */
function setupPairedLines(): { work: string; origin: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-sync-pair-'))
  tmpDirs.push(base)
  const origin = path.join(base, 'origin.git')
  const work = path.join(base, 'work')

  git(base, 'init', '--bare', '--initial-branch=main', origin)
  git(base, 'clone', origin, work)
  git(work, 'config', 'user.email', 'ci@example.com')
  git(work, 'config', 'user.name', 'CI')

  commit(work, 'src/app.ts', '// v1\n', 'feat: khởi tạo')
  for (const ref of ['main', 'dev/1.1.3/main', 'dev/1.1.4/main', 'test/main', 'test/1.1.3/main', 'test/1.1.4/main']) {
    git(work, 'push', 'origin', `HEAD:refs/heads/${ref}`)
  }

  // Commit CHỈ ở dev/1.1.4/main → chỉ test/1.1.4/main cần nhận.
  git(work, 'checkout', '-B', 'dev/1.1.4/main', 'origin/dev/1.1.4/main')
  commit(work, 'src/feature.ts', '// mới\n', 'feat: thêm feature của 1.1.4')
  git(work, 'push', 'origin', 'HEAD:refs/heads/dev/1.1.4/main')
  git(work, 'fetch', 'origin')

  return { work, origin }
}

describe('sync-line.sh — TARGETS_OVERRIDE (sync theo cặp source ↔ test)', () => {
  test('chỉ dòng test CÙNG version nhận commit; dòng test version khác không bị đụng', () => {
    const { work, origin } = setupPairedLines()
    const before113 = git(origin, 'rev-parse', 'refs/heads/test/1.1.3/main')

    const r = runSync(work, {
      SRC_REF: 'dev/1.1.4/main',
      TARGETS_OVERRIDE: 'test/1.1.4/main',
      EXTRA_FILE: '',
    })

    expect(r.code).toBe(0)
    expect(git(origin, 'ls-tree', '-r', '--name-only', 'refs/heads/test/1.1.4/main')).toContain('src/feature.ts')
    // Bẫy chính của chế độ này: discover theo namespace sẽ merge 1.1.4 vào cả 1.1.3.
    expect(git(origin, 'rev-parse', 'refs/heads/test/1.1.3/main')).toBe(before113)
    expect(git(origin, 'ls-tree', '-r', '--name-only', 'refs/heads/test/1.1.3/main')).not.toContain('src/feature.ts')
  })

  test('TARGETS_OVERRIDE bỏ hẳn discover — 🚫 không merge vào dòng test khác dù namespace khớp', () => {
    const { work, origin } = setupPairedLines()
    const r = runSync(work, {
      SRC_REF: 'dev/1.1.4/main',
      TARGETS_OVERRIDE: 'test/1.1.4/main',
      EXTRA_FILE: '',
    })

    expect(r.code).toBe(0)
    const targetRows = r.summary.split('\n').filter((l) => /^\| `/.test(l))
    expect(targetRows).toHaveLength(1)
    expect(targetRows[0]).toContain('test/1.1.4/main')
    expect(git(origin, 'rev-parse', 'refs/heads/test/main')).toBe(git(origin, 'rev-parse', 'refs/heads/main'))
  })

  test('TARGETS_OVERRIDE cũng bỏ EXTRA_FILE — target khai trong file KHÔNG được sync', () => {
    const { work, origin } = setupPairedLines()
    const extra = path.join(work, 'extra-targets.yml')
    fs.writeFileSync(extra, 'extra_targets:\n  - test/1.1.3/main\n', 'utf8')
    const before113 = git(origin, 'rev-parse', 'refs/heads/test/1.1.3/main')

    const r = runSync(work, {
      SRC_REF: 'dev/1.1.4/main',
      TARGETS_OVERRIDE: 'test/1.1.4/main',
      EXTRA_FILE: extra,
    })

    expect(r.code).toBe(0)
    expect(git(origin, 'rev-parse', 'refs/heads/test/1.1.3/main')).toBe(before113)
  })

  test('TARGETS_OVERRIDE trỏ branch không tồn tại → ghi "missing", exit 0 (không phải "đã sync")', () => {
    const { work } = setupPairedLines()
    const r = runSync(work, {
      SRC_REF: 'dev/1.1.4/main',
      TARGETS_OVERRIDE: 'test/9.9.9/main',
      EXTRA_FILE: '',
    })

    expect(r.code).toBe(0)
    expect(r.summary).toContain('missing')
    expect(r.summary).not.toContain('synced')
  })

  test('lượt hai không tạo merge commit rỗng', () => {
    const { work, origin } = setupPairedLines()
    const env = { SRC_REF: 'dev/1.1.4/main', TARGETS_OVERRIDE: 'test/1.1.4/main', EXTRA_FILE: '' }
    runSync(work, env)
    const after1 = git(origin, 'rev-parse', 'refs/heads/test/1.1.4/main')

    git(work, 'fetch', 'origin')
    const second = runSync(work, env)

    expect(second.code).toBe(0)
    expect(second.summary).toContain('skipped')
    expect(git(origin, 'rev-parse', 'refs/heads/test/1.1.4/main')).toBe(after1)
  })
})

/**
 * Hai dòng đối xứng, nhưng dòng source **đã cắt** `tests/` (Đợt 5 của epic).
 * Đây là ca mà `git merge` xoá sạch test trên dòng test — im lặng, không conflict.
 */
function setupAfterCut(): { work: string; origin: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-sync-cut-'))
  tmpDirs.push(base)
  const origin = path.join(base, 'origin.git')
  const work = path.join(base, 'work')

  git(base, 'init', '--bare', '--initial-branch=main', origin)
  git(base, 'clone', origin, work)
  git(work, 'config', 'user.email', 'ci@example.com')
  git(work, 'config', 'user.name', 'CI')

  fs.mkdirSync(path.join(work, 'src'), { recursive: true })
  fs.writeFileSync(path.join(work, 'src/app.ts'), '// v1\n', 'utf8')
  commit(work, 'tests/a.test.ts', '// a\n', 'chore: khởi tạo')
  git(work, 'add', 'src')
  git(work, 'commit', '-m', 'chore: src')
  for (const ref of ['main', 'dev/1.1.4/main', 'test/1.1.4/main']) {
    git(work, 'push', 'origin', `HEAD:refs/heads/${ref}`)
  }

  // Dòng test thêm test riêng (thứ PHẢI không bị mất).
  git(work, 'checkout', '-B', 'test/1.1.4/main', 'origin/test/1.1.4/main')
  commit(work, 'tests/b.test.ts', '// b\n', 'test: thêm b ở dòng test')
  git(work, 'push', 'origin', 'HEAD:refs/heads/test/1.1.4/main')

  // Dòng source CẮT tests/ + đổi code.
  git(work, 'checkout', '-B', 'dev/1.1.4/main', 'origin/dev/1.1.4/main')
  git(work, 'rm', '-r', '-q', 'tests')
  git(work, 'commit', '-m', 'chore: cắt tests khỏi dòng source')
  fs.writeFileSync(path.join(work, 'src/app.ts'), '// v2\n', 'utf8')
  git(work, 'add', 'src')
  git(work, 'commit', '-m', 'feat: đổi code')
  git(work, 'push', 'origin', 'HEAD:refs/heads/dev/1.1.4/main')
  git(work, 'fetch', 'origin')

  return { work, origin }
}

describe('sync-line.sh — PRESERVE_PATHS (dòng source đã cắt tests/)', () => {
  const ENV = { SRC_REF: 'dev/1.1.4/main', TARGETS_OVERRIDE: 'test/1.1.4/main', EXTRA_FILE: '' }

  test('🚫 KHÔNG khai PRESERVE_PATHS → test dòng test KHÔNG sửa bị xoá im lặng (ca hồi quy)', () => {
    const { work, origin } = setupAfterCut()
    expect(runSync(work, ENV).code).toBe(0)

    const files = git(origin, 'ls-tree', '-r', '--name-only', 'refs/heads/test/1.1.4/main')
    // `a.test.ts` có từ trước merge-base và dòng test KHÔNG sửa ⇒ git coi phép xoá
    // của dòng source là không tranh chấp và áp thẳng. 🚫 Không conflict, không cảnh báo.
    expect(files).not.toContain('tests/a.test.ts')
    // `b.test.ts` do dòng test tự thêm SAU merge-base nên sống sót. Đây mới là chỗ
    // nguy: mất đúng những file dòng test không đụng tới — tức gần như toàn bộ suite.
    expect(files).toContain('tests/b.test.ts')
  })

  test('khai PRESERVE_PATHS → code đi sang, test của dòng test GIỮ NGUYÊN', () => {
    const { work, origin } = setupAfterCut()
    const r = runSync(work, { ...ENV, PRESERVE_PATHS: 'tests test-e2e reports' })

    expect(r.code).toBe(0)
    const files = git(origin, 'ls-tree', '-r', '--name-only', 'refs/heads/test/1.1.4/main')
    // Test của dòng test còn đủ — cả file có từ trước lẫn file dòng test tự thêm.
    expect(files).toContain('tests/a.test.ts')
    expect(files).toContain('tests/b.test.ts')
    // Code mới của dòng source đã sang.
    expect(git(origin, 'show', 'refs/heads/test/1.1.4/main:src/app.ts')).toContain('v2')
  })

  test('commit sync là commit HAI CHA — quan hệ tổ tiên còn đúng nên lượt sau skip được', () => {
    const { work, origin } = setupAfterCut()
    const env = { ...ENV, PRESERVE_PATHS: 'tests test-e2e reports' }
    expect(runSync(work, env).code).toBe(0)

    const parents = git(origin, 'rev-list', '--parents', '-n', '1', 'refs/heads/test/1.1.4/main').split(' ')
    expect(parents).toHaveLength(3) // commit + 2 cha
    expect(parents).toContain(git(origin, 'rev-parse', 'refs/heads/dev/1.1.4/main'))

    const after1 = git(origin, 'rev-parse', 'refs/heads/test/1.1.4/main')
    git(work, 'fetch', 'origin')
    const second = runSync(work, env)
    expect(second.code).toBe(0)
    expect(second.summary).toContain('skipped')
    expect(git(origin, 'rev-parse', 'refs/heads/test/1.1.4/main')).toBe(after1)
  })

  test('dòng source thêm file dưới vùng bảo lưu → 🚫 không lọt sang dòng test', () => {
    const { work, origin } = setupAfterCut()
    // Giai đoạn đệm: có người vẫn commit test vào dòng source.
    git(work, 'checkout', '-B', 'dev/1.1.4/main', 'origin/dev/1.1.4/main')
    commit(work, 'tests/lot.test.ts', '// lọt\n', 'test: commit sai chỗ ở dòng source')
    git(work, 'push', 'origin', 'HEAD:refs/heads/dev/1.1.4/main')
    git(work, 'fetch', 'origin')

    expect(runSync(work, { ...ENV, PRESERVE_PATHS: 'tests test-e2e reports' }).code).toBe(0)
    const files = git(origin, 'ls-tree', '-r', '--name-only', 'refs/heads/test/1.1.4/main')
    expect(files).not.toContain('tests/lot.test.ts')
    expect(files).toContain('tests/b.test.ts')
  })
})

describe('sync-line.sh — PRESERVE_PATHS giữ được file lẻ, không chỉ thư mục', () => {
  test('.gitignore của target không bị bản của source ghi đè', () => {
    const { work, origin } = setupAfterCut()

    // Dòng source chặn /tests/ (đúng việc của nó sau Đợt 5); dòng test phải track.
    git(work, 'checkout', '-B', 'dev/1.1.4/main', 'origin/dev/1.1.4/main')
    commit(work, '.gitignore', '/tests/\n/test-e2e/\n', 'chore: source ignore cây overlay')
    git(work, 'push', 'origin', 'HEAD:refs/heads/dev/1.1.4/main')

    git(work, 'checkout', '-B', 'test/1.1.4/main', 'origin/test/1.1.4/main')
    commit(work, '.gitignore', 'node_modules/\n', 'chore: gitignore dòng test')
    git(work, 'push', 'origin', 'HEAD:refs/heads/test/1.1.4/main')
    git(work, 'fetch', 'origin')

    expect(runSync(work, {
      SRC_REF: 'dev/1.1.4/main',
      TARGETS_OVERRIDE: 'test/1.1.4/main',
      EXTRA_FILE: '',
      PRESERVE_PATHS: 'tests test-e2e reports .gitignore',
    }).code).toBe(0)

    const gi = git(origin, 'show', 'refs/heads/test/1.1.4/main:.gitignore')
    expect(gi).toContain('node_modules/')
    expect(gi).not.toContain('/tests/')
    // Và test vẫn còn — hai phép bảo lưu không đè nhau.
    expect(git(origin, 'ls-tree', '-r', '--name-only', 'refs/heads/test/1.1.4/main')).toContain('tests/b.test.ts')
  })
})
