import { afterAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..', '..')
const SCRIPT = path.join(ROOT, '.github/scripts/overlay-tests.sh')

/**
 * `overlay-tests.sh` **xoá rồi ghi đè** `tests/` + `test-e2e/`. Trong giai đoạn
 * đệm hai thư mục đó còn tracked trên dòng source, nên dev đang sửa dở một test
 * mà chạy lệnh này là mất trắng — và rule mới lại bảo chạy nó thường xuyên. Chốt
 * an toàn ở đây là thứ phải có test, không phải comment cảnh báo trong file.
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

function read(cwd: string, file: string): string {
  return fs.readFileSync(path.join(cwd, file), 'utf8')
}

function run(cwd: string, args: string[] = [], env: Record<string, string> = {}) {
  return spawnSync('bash', [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } })
}

/**
 * Dòng source `dev/1.1.4/main` **còn** `tests/` tracked (giai đoạn đệm) + dòng
 * test `test/1.1.4/main` mang một cây test khác hẳn.
 */
function setupLines(): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-overlay-'))
  tmpDirs.push(base)
  const origin = path.join(base, 'origin.git')
  const work = path.join(base, 'work')

  git(base, 'init', '--bare', '--initial-branch=main', '-q', origin)
  git(base, 'clone', '-q', `file://${origin}`, work)
  git(work, 'config', 'user.email', 'ci@example.com')
  git(work, 'config', 'user.name', 'CI')

  write(work, 'package.json', '{"name":"x"}\n')
  write(work, 'tests/cu.test.ts', '// bản trên dòng source\n')
  write(work, 'test-e2e/cu.spec.ts', '// bản trên dòng source\n')
  fs.mkdirSync(path.join(work, '.github/scripts'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, '.github/scripts/test-ref.ts'), path.join(work, '.github/scripts/test-ref.ts'))
  git(work, 'add', '-A')
  git(work, 'commit', '-qm', 'init')
  git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main')
  git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/dev/1.1.4/main')

  const boot = path.join(base, 'boot')
  git(work, 'worktree', 'add', '-q', '--detach', boot, 'main')
  git(boot, 'checkout', '-q', '--orphan', 'test/main')
  git(boot, 'rm', '-r', '--cached', '.', '-q')
  fs.rmSync(path.join(boot, 'tests/cu.test.ts'))
  write(boot, 'tests/dongtest.test.ts', '// bản trên dòng test\n')
  write(boot, 'test-e2e/dongtest.spec.ts', '// bản trên dòng test\n')
  git(boot, 'add', 'tests', 'test-e2e')
  git(boot, 'commit', '-qm', 'test: dựng dòng test gốc')
  git(boot, 'push', '-q', 'origin', 'HEAD:refs/heads/test/main')
  git(boot, 'push', '-q', 'origin', 'HEAD:refs/heads/test/1.1.4/main')
  git(work, 'worktree', 'remove', '--force', boot)

  git(work, 'switch', '-q', '-c', 'dev/1.1.4/main', '--track', 'origin/dev/1.1.4/main')
  return work
}

describe('overlay-tests.sh — chốt an toàn cho cây test đang bẩn', () => {
  test('có thay đổi chưa commit trong tests/ → dừng, không xoá gì', () => {
    const work = setupLines()
    write(work, 'tests/cu.test.ts', '// đang sửa dở, chưa commit\n')

    const r = run(work, ['test/1.1.4/main'])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('chưa commit')
    expect(read(work, 'tests/cu.test.ts')).toContain('đang sửa dở')
  })

  test('file test mới chưa add cũng được tính là bẩn', () => {
    const work = setupLines()
    write(work, 'tests/chua-add.test.ts', '// untracked\n')

    const r = run(work, ['test/1.1.4/main'])
    expect(r.status).toBe(1)
    expect(fs.existsSync(path.join(work, 'tests/chua-add.test.ts'))).toBe(true)
  })

  test('FORCE=1 → vẫn ghi đè, đúng ý người chạy', () => {
    const work = setupLines()
    write(work, 'tests/cu.test.ts', '// đang sửa dở, chưa commit\n')

    const r = run(work, ['test/1.1.4/main'], { FORCE: '1' })
    expect(r.status).toBe(0)
    expect(fs.existsSync(path.join(work, 'tests/cu.test.ts'))).toBe(false)
    expect(read(work, 'tests/dongtest.test.ts')).toContain('bản trên dòng test')
  })

  test('cây sạch → overlay bình thường, thay nguyên cây', () => {
    const work = setupLines()

    const r = run(work, ['test/1.1.4/main'])
    expect(r.status).toBe(0)
    // Bản của dòng source biến mất, bản của dòng test lên đúng chỗ cũ.
    expect(fs.existsSync(path.join(work, 'tests/cu.test.ts'))).toBe(false)
    expect(read(work, 'tests/dongtest.test.ts')).toContain('bản trên dòng test')
    expect(read(work, 'test-e2e/dongtest.spec.ts')).toContain('bản trên dòng test')
  })

  test('chạy lại lần hai cho cùng kết quả (idempotent), không cộng dồn', () => {
    const work = setupLines()
    run(work, ['test/1.1.4/main'])
    const after1 = fs.readdirSync(path.join(work, 'tests')).sort()

    // Lần hai: cây test lúc này khác HEAD của dòng source nên "bẩn" theo git —
    // đó chính là trạng thái sau overlay, phải ép mới chạy tiếp được.
    const r = run(work, ['test/1.1.4/main'], { FORCE: '1' })
    expect(r.status).toBe(0)
    expect(fs.readdirSync(path.join(work, 'tests')).sort()).toEqual(after1)
  })

  test('không truyền ref → suy dòng test từ tên branch source đang đứng', () => {
    const work = setupLines()
    const r = run(work)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('test/1.1.4/main')
    expect(read(work, 'tests/dongtest.test.ts')).toContain('bản trên dòng test')
  })

  test('ref test không tồn tại → phân biệt rõ với "test đỏ"', () => {
    const work = setupLines()
    const r = run(work, ['test/9.9.9/main'])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('test/9.9.9/main')
    expect(r.stderr).toContain('KHÔNG phải')
  })
})
