import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { COMMIT_LIMIT, type AnchorInput, type AnchorVerdict, classifyAnchor, isBlocking, main, readAnchor, renderAnchor } from '../../.github/scripts/test-anchor.js'

/**
 * Cổng neo SHA là chỗ **duy nhất** trả lời "baseline này đo trên cây source
 * nào". Ba bất biến phải test trực tiếp:
 *
 *  - 🚫 **không nhánh nào in "đạt"** ngoài `match` — "không so được" là cảnh báo
 *    hoặc chặn, không bao giờ là đạt (đúng lỗ mà force-push chui qua);
 *  - neo **không còn tồn tại** là ĐỎ, không phải "bỏ qua rồi coi như khớp";
 *  - "chưa có neo" (baseline cũ) **không** được đỏ vô cớ.
 *
 * Nhóm quan hệ tổ tiên dùng **repo git thật** (kèm `origin` là bare repo trên
 * đĩa, không cần mạng): mock lại `git` là mock lại chính contract đang test.
 */

const FULL = 'a'.repeat(40)

function input(over: Partial<AnchorInput> = {}): AnchorInput {
  return {
    anchorSha: FULL,
    anchorRef: 'dev/1.1.4/main',
    headSha: 'b'.repeat(40),
    headRef: 'dev/1.1.4/main',
    exists: true,
    isAncestor: false,
    isDescendant: false,
    ...over,
  }
}

describe('classifyAnchor — 7 kết luận, mỗi cái một nguyên nhân', () => {
  test('neo == head → match', () => {
    expect(classifyAnchor(input({ headSha: FULL }))).toBe('match')
  })

  test('neo là tổ tiên của head → behind (đúng ca TC-F4: test viết cho ref cũ)', () => {
    expect(classifyAnchor(input({ isAncestor: true }))).toBe('behind')
  })

  test('head là tổ tiên của neo → ahead ("test chờ source", KHÁC lệch pha)', () => {
    expect(classifyAnchor(input({ isDescendant: true }))).toBe('ahead')
  })

  test('không có quan hệ tổ tiên → diverged, không gộp vào behind', () => {
    expect(classifyAnchor(input())).toBe('diverged')
  })

  test('neo thuộc version khác → other-version (dòng test chưa chạy cho version này)', () => {
    expect(classifyAnchor(input({ anchorRef: 'dev/1.1.3/main', isAncestor: true }))).toBe('other-version')
  })

  test('baseline chưa có source_sha → no-anchor', () => {
    expect(classifyAnchor(input({ anchorSha: undefined }))).toBe('no-anchor')
  })

  test('object của neo không tới được → anchor-gone', () => {
    expect(classifyAnchor(input({ exists: false }))).toBe('anchor-gone')
  })
})

describe('classifyAnchor — thứ tự nhánh (nhánh sau không được che nhánh trước)', () => {
  test('neo mất tích thắng mọi phép so quan hệ: merge-base trả "false" trông y như diverged', () => {
    // Nếu đảo thứ tự, ca này ra 'diverged' → cảnh báo exit 0, tức là force-push
    // vẫn merge được. Đúng cái TC-E9 phải chặn.
    expect(classifyAnchor(input({ exists: false, isAncestor: false, isDescendant: false }))).toBe('anchor-gone')
  })

  test('không có neo thì không kết luận "mất neo" — hai thông điệp khác nhau', () => {
    expect(classifyAnchor(input({ anchorSha: undefined, exists: false }))).toBe('no-anchor')
  })

  test('lệch version được nói ra trước behind: người đọc cần lý do, không cần khoảng cách', () => {
    expect(classifyAnchor(input({ anchorRef: 'test/1.1.3/main', headRef: 'dev/1.1.4/main', isAncestor: true }))).toBe('other-version')
  })

  test('anchorRef không suy được version (`main`) thì bỏ qua nhánh version', () => {
    expect(classifyAnchor(input({ anchorRef: 'main', isAncestor: true }))).toBe('behind')
  })
})

describe('isBlocking', () => {
  test('mặc định chỉ anchor-gone chặn — cảnh báo neo cũ không chặn PR phát hành đợt đầu', () => {
    const warns: AnchorVerdict[] = ['behind', 'ahead', 'diverged', 'other-version', 'no-anchor']
    for (const v of warns) expect(isBlocking(v, false)).toBe(false)
    expect(isBlocking('anchor-gone', false)).toBe(true)
    expect(isBlocking('match', false)).toBe(false)
  })

  test('--strict: mọi kết luận khác match đều chặn (siết cổng = thêm cờ, không sửa script)', () => {
    const all: AnchorVerdict[] = ['behind', 'ahead', 'diverged', 'other-version', 'no-anchor', 'anchor-gone']
    for (const v of all) expect(isBlocking(v, true)).toBe(true)
    expect(isBlocking('match', true)).toBe(false)
  })
})

describe('renderAnchor', () => {
  test('luôn in bảng "đã so cái gì" — người đọc kiểm chứng lại được, không chỉ thấy chữ OK', () => {
    const i = input({ headSha: FULL, testAnchorSha: 'c'.repeat(40) })
    const md = renderAnchor('match', i, [])
    expect(md).toContain(FULL)
    expect(md).toContain('c'.repeat(40))
    expect(md).toContain('dev/1.1.4/main')
  })

  test('chỉ match được phép nói "đạt"; mọi kết luận khác không chứa chữ đó', () => {
    for (const v of ['behind', 'ahead', 'diverged', 'other-version', 'no-anchor', 'anchor-gone'] as AnchorVerdict[]) {
      const md = renderAnchor(v, input(), [])
      expect(md.includes('**đạt**')).toBe(false)
    }
    expect(renderAnchor('match', input({ headSha: FULL }), [])).toContain('**đạt**')
  })

  test('danh sách commit cắt ở 20 dòng nhưng vẫn nêu ĐỦ số commit chênh', () => {
    const commits = Array.from({ length: 25 }, (_, n) => `sha${n} [T1] feat: thay đổi ${n}`)
    const md = renderAnchor('behind', input({ isAncestor: true }), commits)
    expect(md).toContain('**25 commit source sau neo:**')
    expect(md).toContain('… và 5 commit nữa')
    expect(md).toContain('sha19')
    expect(md).not.toContain('sha20 ')
    expect(commits.length).toBeGreaterThan(COMMIT_LIMIT)
  })

  test('nửa neo cũng phải nói ra (E18) — phần thiếu không im lặng', () => {
    expect(renderAnchor('behind', input({ testAnchorSha: undefined }), [])).toContain('thiếu `test_sha`')
    expect(renderAnchor('no-anchor', input({ anchorSha: undefined, testAnchorSha: FULL }), [])).toContain('thiếu `source_sha`')
  })

  test('kết luận chặn mang dấu ❌, cảnh báo mang ⚠️ — đọc summary không phải đoán', () => {
    expect(renderAnchor('anchor-gone', input({ exists: false }), [])).toContain('❌')
    expect(renderAnchor('behind', input({ isAncestor: true }), [])).toContain('⚠️')
  })
})

describe('readAnchor', () => {
  test('baseline cũ (chỉ có ref + số) đọc ra neo rỗng, KHÔNG throw', () => {
    const a = readAnchor(JSON.stringify({ frontend: { lines: 60 }, source_ref: 'dev/1.1.3/main' }), 'b.json')
    expect(a).toEqual({ source_sha: undefined, test_sha: undefined, source_ref: 'dev/1.1.3/main' })
  })

  test('neo rỗng chuỗi bị coi là KHÔNG có neo, không phải neo hợp lệ', () => {
    expect(readAnchor(JSON.stringify({ source_sha: '' }), 'b.json').source_sha).toBeUndefined()
  })

  test('JSON hỏng → throw (không suy thành no-anchor rồi cho qua)', () => {
    expect(() => readAnchor('{ hỏng', 'b.json')).toThrow(/không phải JSON hợp lệ/)
  })
})

/**
 * Nhóm dùng git thật: quan hệ tổ tiên và "object còn hay mất" là contract của
 * git, không phải của script. `origin` là bare repo trên đĩa nên không cần mạng.
 */
describe('main — trên repo git thật', () => {
  let dir: string
  let repo: string
  let originPath: string
  const shas: Record<string, string> = {}
  let summaryFile: string
  const prevSummary = process.env.GITHUB_STEP_SUMMARY

  function git(cwd: string, ...args: string[]): string {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} → ${r.status}: ${r.stderr}`)
    return r.stdout.trim()
  }

  function commit(cwd: string, subject: string): string {
    git(cwd, 'commit', '--allow-empty', '-m', subject)
    return git(cwd, 'rev-parse', 'HEAD')
  }

  function baseline(target: string, extra: Record<string, unknown>): void {
    const f = path.join(target, 'reports', 'coverage-baseline.json')
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, `${JSON.stringify({ frontend: { lines: 60 }, source_ref: 'dev/1.1.4/main', ...extra }, null, 2)}\n`, 'utf8')
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-anchor-'))
    originPath = path.join(dir, 'origin.git')
    repo = path.join(dir, 'work')
    git(dir, 'init', '--bare', '--initial-branch=main', 'origin.git')
    git(dir, 'clone', '--quiet', originPath, 'work')
    git(repo, 'config', 'user.email', 'ci@example.com')
    git(repo, 'config', 'user.name', 'CI')
    git(repo, 'switch', '--quiet', '-c', 'dev/1.1.4/main')
    shas.a = commit(repo, '[T1] feat(a): commit đầu')
    shas.b = commit(repo, '[T2] feat(b): commit giữa')
    shas.c = commit(repo, '[T3] feat(c): head')
    git(repo, 'push', '--quiet', '-u', 'origin', 'dev/1.1.4/main')

    // Job summary là nơi người duyệt đọc — trỏ vào file tạm để kiểm được nội dung.
    summaryFile = path.join(dir, 'summary.md')
    process.env.GITHUB_STEP_SUMMARY = summaryFile
  })

  afterEach(() => {
    if (prevSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY
    else process.env.GITHUB_STEP_SUMMARY = prevSummary
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('neo == head → exit 0 và cảnh báo KHÔNG xuất hiện', () => {
    baseline(repo, { source_sha: shas.c, test_sha: 'd'.repeat(40) })
    expect(main(['--head-sha', shas.c, '--head-ref', 'dev/1.1.4/main'], repo)).toBe(0)
    expect(fs.readFileSync(summaryFile, 'utf8')).toContain('neo khớp head')
  })

  test('neo là tổ tiên của head → exit 0 + cảnh báo có SỐ COMMIT CHÊNH (TC-F4)', () => {
    baseline(repo, { source_sha: shas.a })
    expect(main(['--head-sha', shas.c, '--head-ref', 'dev/1.1.4/main'], repo)).toBe(0)
    const md = fs.readFileSync(summaryFile, 'utf8')
    expect(md).toContain('viết cho ref neo CŨ')
    expect(md).toContain('**2 commit source sau neo:**')
  })

  test('cùng dữ kiện đó + --strict → exit 1 (đổi cờ, không đổi thông điệp)', () => {
    baseline(repo, { source_sha: shas.a })
    expect(main(['--head-sha', shas.c, '--head-ref', 'dev/1.1.4/main', '--strict'], repo)).toBe(1)
    expect(fs.readFileSync(summaryFile, 'utf8')).toContain('viết cho ref neo CŨ')
  })

  test('neo đi trước head → "test chờ source", exit 0 (không đỏ như lệch pha)', () => {
    baseline(repo, { source_sha: shas.c })
    expect(main(['--head-sha', shas.a, '--head-ref', 'dev/1.1.4/main'], repo)).toBe(0)
    expect(fs.readFileSync(summaryFile, 'utf8')).toContain('test chờ source')
  })

  test('neo ở nhánh khác → "neo lệch nhánh", tách khỏi thông điệp neo cũ', () => {
    git(repo, 'switch', '--quiet', '-c', 'nhanh-khac', shas.a)
    const other = commit(repo, '[T9] feat: nhánh khác')
    baseline(repo, { source_sha: other })
    expect(main(['--head-sha', shas.c, '--head-ref', 'dev/1.1.4/main'], repo)).toBe(0)
    const md = fs.readFileSync(summaryFile, 'utf8')
    expect(md).toContain('neo lệch nhánh')
    expect(md).not.toContain('viết cho ref neo CŨ')
  })

  test('SHA neo bị force-push mất khỏi remote → exit 1 "không tìm thấy" (TC-E9)', () => {
    git(repo, 'switch', '--quiet', '-c', 'tam', shas.a)
    const dropped = commit(repo, '[T9] feat: commit sẽ bị force-push mất')
    git(repo, 'push', '--quiet', 'origin', 'tam')
    git(repo, 'push', '--quiet', '--force', 'origin', `${shas.a}:refs/heads/tam`)
    // Object phải mất **ở remote**: cổng kết luận theo cái remote thấy được, không
    // theo cái workspace này tình cờ còn (git giữ object không tới được tới khi gc).
    git(originPath, 'gc', '--prune=now', '--quiet')

    // `--no-local`: clone local mặc định HARDLINK cả object không tới được nên
    // clone thường không phản ánh được cái CI thấy.
    const fresh = path.join(dir, 'fresh')
    git(dir, 'clone', '--quiet', '--no-local', originPath, 'fresh')
    baseline(fresh, { source_sha: dropped })
    expect(main(['--head-sha', git(fresh, 'rev-parse', 'origin/dev/1.1.4/main'), '--head-ref', 'dev/1.1.4/main'], fresh)).toBe(1)
    expect(fs.readFileSync(summaryFile, 'utf8')).toContain('ref neo không tìm thấy')
  })

  test('SHA neo chưa từng tồn tại → cũng là exit 1, 🚫 không "không so được ⇒ coi như khớp"', () => {
    baseline(repo, { source_sha: 'f'.repeat(40) })
    expect(main(['--head-sha', shas.c, '--head-ref', 'dev/1.1.4/main'], repo)).toBe(1)
    expect(fs.readFileSync(summaryFile, 'utf8')).toContain('ref neo không tìm thấy')
  })

  test('baseline chưa có neo → exit 0 (baseline trước cơ chế neo KHÔNG được đỏ vô cớ)', () => {
    baseline(repo, {})
    expect(main(['--head-sha', shas.c, '--head-ref', 'dev/1.1.4/main'], repo)).toBe(0)
    expect(fs.readFileSync(summaryFile, 'utf8')).toContain('chưa có neo')
  })

  test('baseline hỏng → exit 2 (lỗi công cụ), KHÔNG phải exit 0 hay 1', () => {
    fs.mkdirSync(path.join(repo, 'reports'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'reports', 'coverage-baseline.json'), '{ hỏng', 'utf8')
    expect(main(['--head-sha', shas.c, '--head-ref', 'dev/1.1.4/main'], repo)).toBe(2)
  })

  test('thiếu hẳn baseline → exit 2 kèm thông điệp, không im lặng coi là no-anchor', () => {
    expect(main(['--head-sha', shas.c, '--head-ref', 'dev/1.1.4/main'], repo)).toBe(2)
  })

  test('không tới được remote → exit 2, KHÁC hẳn "neo không còn tồn tại"', () => {
    baseline(repo, { source_sha: 'f'.repeat(40) })
    git(repo, 'remote', 'set-url', 'origin', path.join(dir, 'khong-ton-tai.git'))
    expect(main(['--head-sha', shas.c, '--head-ref', 'dev/1.1.4/main'], repo)).toBe(2)
  })

  test('chạy ở local (không có biến của Actions) vẫn cho cùng kết luận', () => {
    delete process.env.GITHUB_STEP_SUMMARY
    baseline(repo, { source_sha: shas.a })
    expect(main(['--head-sha', shas.c, '--head-ref', 'dev/1.1.4/main'], repo)).toBe(0)
    expect(main(['--head-sha', shas.c, '--head-ref', 'dev/1.1.4/main', '--strict'], repo)).toBe(1)
  })

  test('không truyền head → suy từ repo đang đứng (dùng được ở máy dev)', () => {
    baseline(repo, { source_sha: shas.a })
    expect(main([], repo)).toBe(0)
    expect(fs.readFileSync(summaryFile, 'utf8')).toContain(shas.c)
  })

  test('cwd không phải git repo → exit 2 kèm thông điệp, không stack trace', () => {
    const plain = path.join(dir, 'khong-git')
    fs.mkdirSync(plain)
    expect(main(['--head-sha', shas.c], plain)).toBe(2)
  })
})

describe('readAnchor — đường đọc cùng ràng buộc với đường ghi', () => {
  const full = 'a'.repeat(40)

  test('SHA viết tắt trong baseline → THROW (exit 2), 🚫 không suy thành no-anchor', () => {
    // Baseline sửa tay được, nên SHA tắt vào được file qua đường khác. Khi đó
    // `cat-file -e` thành công nhưng so `===` luôn false ⇒ `behind` với "0 commit
    // source sau neo": cảnh báo sai chỗ, không truy ra được vì sao.
    expect(() => readAnchor(JSON.stringify({ source_sha: 'a3b60a5' }), 'b.json')).toThrow(/không phải SHA đầy đủ/)
    expect(() => readAnchor(JSON.stringify({ test_sha: 'deadbee' }), 'b.json')).toThrow(/test_sha/)
  })

  test('SHA không phải hex → THROW', () => {
    expect(() => readAnchor(JSON.stringify({ source_sha: 'z'.repeat(40) }), 'b.json')).toThrow(/không phải SHA đầy đủ/)
  })

  test('SHA đầy đủ chữ HOA → nhận, chuẩn hoá về chữ thường (so bằng chuỗi nên phải cùng dạng)', () => {
    expect(readAnchor(JSON.stringify({ source_sha: full.toUpperCase() }), 'b.json').source_sha).toBe(full)
  })

  test('baseline không có khoá neo → không throw, trả undefined (đó là no-anchor thật)', () => {
    const a = readAnchor(JSON.stringify({ frontend: { lines: 60 } }), 'b.json')
    expect(a.source_sha).toBeUndefined()
    expect(a.test_sha).toBeUndefined()
  })
})

describe('renderAnchor — thông điệp anchor-gone không khẳng định quá phạm vi biết được', () => {
  const input = {
    anchorSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    headRef: 'dev/1.1.4/main',
    exists: false,
    isAncestor: false,
    isDescendant: false,
  }

  test('nêu cả ba nguyên nhân, kể cả clone nông — 🚫 không quy hết về force-push', () => {
    const text = renderAnchor('anchor-gone', input, [])
    expect(text).toContain('force-push')
    expect(text).toContain('clone nông')
    expect(text).toMatch(/allowReachableSHA1InWant/)
    // Vẫn phải nói rõ là CHẶN, không được đọc thành cảnh báo.
    expect(text).toContain('chặn')
  })

  test('kèm cách kiểm nguyên nhân "chưa fetch đủ sâu" trước khi kết luận force-push', () => {
    const text = renderAnchor('anchor-gone', input, [])
    expect(text).toContain('fetch-depth: 0')
    expect(text).toContain('cat-file -e')
  })
})
