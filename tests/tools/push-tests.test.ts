import { afterAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..', '..')
const SCRIPT = path.join(ROOT, '.github/scripts/push-tests.sh')

/**
 * `push-tests.sh` là đường duy nhất đưa cây test từ worktree **dòng source**
 * (nơi chạy được suite) sang **dòng test** (nơi test phải nằm). Không có nó thì
 * bước `test-implementer` phải mô tả một chuỗi thao tác worktree bằng tay, và
 * đó là chỗ sai nhiều nhất của cả phương án tách dòng.
 *
 * Test chạy trên repo git thật trong tmp: logic ở đây là logic git (worktree,
 * orphan, ref remote), mock lại thì không còn kiểm được gì.
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

function write(cwd: string, file: string, body: string): void {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true })
  fs.writeFileSync(path.join(cwd, file), body, 'utf8')
}

function run(cwd: string, ...args: string[]) {
  return spawnSync('bash', [SCRIPT, ...args], { cwd, encoding: 'utf8' })
}

/**
 * Dựng hai dòng branch rời nhau trong một origin:
 *   dòng source: main ← dev/1.1.4/main   (có package.json + .github/scripts, KHÔNG có tests/)
 *   dòng test:   test/main ← test/1.1.4/main (orphan, chỉ tests/ + test-e2e/ + reports/)
 */
function setupLines(): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-push-tests-'))
  tmpDirs.push(base)
  const origin = path.join(base, 'origin.git')
  const work = path.join(base, 'work')

  git(base, 'init', '--bare', '--initial-branch=main', '-q', origin)
  // `file://` để `git fetch --depth` không bị bỏ qua như với local transport.
  git(base, 'clone', '-q', `file://${origin}`, work)
  git(work, 'config', 'user.email', 'ci@example.com')
  git(work, 'config', 'user.name', 'CI')

  write(work, 'package.json', '{"name":"x"}\n')
  write(work, 'src/a.ts', 'export const a = 1\n')
  fs.mkdirSync(path.join(work, '.github/scripts'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, '.github/scripts/test-ref.ts'), path.join(work, '.github/scripts/test-ref.ts'))
  git(work, 'add', '-A')
  git(work, 'commit', '-qm', 'init')
  git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main')
  git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/dev/1.1.4/main')

  // Dòng test: cây orphan dựng trong worktree riêng (đúng thủ tục git-pr.md §4.3).
  const boot = path.join(base, 'boot')
  git(work, 'worktree', 'add', '-q', '--detach', boot, 'main')
  git(boot, 'checkout', '-q', '--orphan', 'test/main')
  git(boot, 'rm', '-r', '--cached', '.', '-q')
  write(boot, 'tests/cu.test.ts', '// cũ\n')
  write(boot, 'test-e2e/cu.spec.ts', '// cũ\n')
  write(boot, 'reports/coverage-baseline.json', '{}\n')
  git(boot, 'add', 'tests', 'test-e2e', 'reports')
  git(boot, 'commit', '-qm', 'test: dựng dòng test gốc')
  git(boot, 'push', '-q', 'origin', 'HEAD:refs/heads/test/main')
  git(boot, 'push', '-q', 'origin', 'HEAD:refs/heads/test/1.1.4/main')
  git(work, 'worktree', 'remove', '--force', boot)

  git(work, 'switch', '-q', '-c', 'dev/1.1.4/main', '--track', 'origin/dev/1.1.4/main')
  return work
}

/** Cây test "đã viết xong" trong worktree dòng source (untracked — đó là cây overlay). */
function writeLocalTests(work: string): void {
  write(work, 'tests/moi.test.ts', '// mới\n')
  write(work, 'test-e2e/moi.spec.ts', '// mới\n')
}

function treeOf(work: string, ref: string): string[] {
  git(work, 'fetch', '-q', '--no-tags', 'origin', `+refs/heads/${ref}:refs/remotes/origin/${ref}`)
  return git(work, 'ls-tree', '-r', '--name-only', `origin/${ref}`).split('\n').filter(Boolean).sort()
}

describe('push-tests.sh — đẩy cây test sang dòng test', () => {
  test('cắt branch task từ dòng test của version và commit đúng 2 thư mục', () => {
    const work = setupLines()
    writeLocalTests(work)

    const r = run(work, 'test/1.1.4/T0000abcd_x', '[T0000abcd] test(x): thêm test')
    expect(r.stderr + r.stdout).toContain('test/1.1.4/T0000abcd_x')
    expect(r.status).toBe(0)

    // `reports/` của dòng test giữ nguyên; `src/` + `package.json` của dòng
    // source KHÔNG được lọt sang.
    expect(treeOf(work, 'test/1.1.4/T0000abcd_x')).toEqual([
      'reports/coverage-baseline.json',
      'test-e2e/moi.spec.ts',
      'tests/moi.test.ts',
    ])
  })

  test('commit message được giữ nguyên, tác giả là người chạy', () => {
    const work = setupLines()
    writeLocalTests(work)
    run(work, 'test/1.1.4/T0000abcd_x', '[T0000abcd] test(x): thêm test')

    git(work, 'fetch', '-q', '--no-tags', 'origin', '+refs/heads/test/1.1.4/T0000abcd_x:refs/remotes/origin/test/1.1.4/T0000abcd_x')
    expect(git(work, 'log', '-1', '--format=%s', 'origin/test/1.1.4/T0000abcd_x')).toBe('[T0000abcd] test(x): thêm test')
  })

  test('worktree dòng source không bị đụng — không commit lạ, không đổi branch', () => {
    const work = setupLines()
    const before = git(work, 'rev-parse', 'HEAD')
    writeLocalTests(work)
    run(work, 'test/1.1.4/T0000abcd_x', '[T0000abcd] test(x): thêm test')

    expect(git(work, 'rev-parse', 'HEAD')).toBe(before)
    expect(git(work, 'branch', '--show-current')).toBe('dev/1.1.4/main')
    // Worktree tạm đã được dọn.
    expect(git(work, 'worktree', 'list').split('\n')).toHaveLength(1)
  })

  test('chạy lại khi không đổi gì → exit 0, không tạo commit rỗng', () => {
    const work = setupLines()
    writeLocalTests(work)
    run(work, 'test/1.1.4/T0000abcd_x', '[T0000abcd] test(x): thêm test')
    const first = treeOf(work, 'test/1.1.4/T0000abcd_x')

    const r = run(work, 'test/1.1.4/T0000abcd_x', '[T0000abcd] test(x): lần hai')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('không khác')
    expect(git(work, 'log', '--oneline', 'origin/test/1.1.4/T0000abcd_x').split('\n')).toHaveLength(2)
    expect(treeOf(work, 'test/1.1.4/T0000abcd_x')).toEqual(first)
  })

  test('xoá test ở local rồi đẩy lại → file biến mất ở dòng test (thay cây, không merge)', () => {
    const work = setupLines()
    writeLocalTests(work)
    write(work, 'tests/bo.test.ts', '// sẽ bị bỏ\n')
    run(work, 'test/1.1.4/T0000abcd_x', '[T0000abcd] test(x): lần đầu')
    expect(treeOf(work, 'test/1.1.4/T0000abcd_x')).toContain('tests/bo.test.ts')

    fs.rmSync(path.join(work, 'tests/bo.test.ts'))
    const r = run(work, 'test/1.1.4/T0000abcd_x', '[T0000abcd] test(x): bỏ bớt')
    expect(r.status).toBe(0)
    expect(treeOf(work, 'test/1.1.4/T0000abcd_x')).not.toContain('tests/bo.test.ts')
  })

  test('rác runtime của e2e không bị đẩy lên', () => {
    const work = setupLines()
    writeLocalTests(work)
    write(work, 'test-e2e/.runtime/home/state.json', '{"local":true}\n')

    run(work, 'test/1.1.4/T0000abcd_x', '[T0000abcd] test(x): thêm test')
    expect(treeOf(work, 'test/1.1.4/T0000abcd_x').some((f) => f.includes('.runtime'))).toBe(false)
  })
})

describe('push-tests.sh — từ chối rõ ràng thay vì đẩy nhầm', () => {
  test('thiếu tham số → exit 2 kèm cách dùng', () => {
    const work = setupLines()
    const r = run(work, 'test/1.1.4/T0000abcd_x')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('Cách dùng')
  })

  test.each([
    ['dev/1.1.4/T0000abcd_x', 'branch dòng source'],
    ['test/1.1.4/main', 'branch dòng version, không phải branch task'],
    ['T0000abcd_x', 'thiếu hẳn tiền tố'],
  ])('%s → từ chối (%s)', (branch) => {
    const work = setupLines()
    writeLocalTests(work)
    const r = run(work, branch, 'test: x')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('test/x.y.z/{taskID}_{slug}')
  })

  test('dòng test của version chưa tồn tại → nêu cách mở dòng, không tự tạo', () => {
    const work = setupLines()
    writeLocalTests(work)
    const r = run(work, 'test/9.9.9/T0000abcd_x', 'test: x')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('test/9.9.9/main')
    // Không được im lặng tạo dòng version mới.
    expect(spawnSync('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/test/9.9.9/main'], { cwd: work }).status).not.toBe(0)
  })

  test('chưa có tests/ ở local → dừng, không đẩy cây rỗng lên dòng test', () => {
    const work = setupLines()
    const r = run(work, 'test/1.1.4/T0000abcd_x', 'test: x')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('tests/')
  })

  test('chạy từ cây orphan của dòng test → dừng kèm lý do (không có package.json)', () => {
    const work = setupLines()
    git(work, 'fetch', '-q', '--no-tags', 'origin', '+refs/heads/test/main:refs/remotes/origin/test/main')
    const orphan = path.join(work, '..', 'orphan')
    git(work, 'worktree', 'add', '-q', '--detach', orphan, 'origin/test/main')

    const r = run(orphan, 'test/1.1.4/T0000abcd_x', 'test: x')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('package.json')
    expect(r.stderr).toContain('dòng source')
  })
})
