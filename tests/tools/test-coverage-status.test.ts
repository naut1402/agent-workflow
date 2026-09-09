import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  EXEMPTIONS_FILE,
  type Exemption,
  computeStatus,
  main,
  parseExemptions,
  renderStatus,
  revertedTaskIdOf,
  taskIdOf,
  typeOf,
} from '../../.github/scripts/test-coverage-status.js'

/**
 * "Version này còn task nào chưa có test" — trước đây không ai đọc ra được, vì
 * cổng phát hành chỉ biết dòng test *tồn tại / rỗng* ở mức version.
 *
 * Ba bất biến phải test trực tiếp:
 *
 *  - báo cáo ở **mức từng task**, không phải một con số tổng;
 *  - miễn trừ phải **tường minh** (lý do + người duyệt) và 🚫 không miễn cả
 *    version — sai định dạng là ĐỎ, không phải "miễn hết";
 *  - "không kéo được dòng test" ≠ "thiếu test", và exit 0 của lượt báo cáo
 *    🚫 **không** có nghĩa "đã đủ test".
 */

function ex(over: Partial<Exemption> = {}): Exemption {
  return { taskId: 'T1', version: '1.1.4', reason: 'Chỉ đổi tài liệu, không đụng code sản phẩm', approved_by: '@tech-lead', ...over }
}

function file(list: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...extra, exemptions: list })
}

describe('taskIdOf — đúng regex định danh task của git-pr.md §7', () => {
  test('subject chuẩn', () => {
    expect(taskIdOf('[T0313a84c] feat(ci): cổng neo SHA')).toBe('T0313a84c')
  })

  test('squash của GitHub thêm hậu tố `(#123)` vẫn nhận đúng task', () => {
    expect(taskIdOf('[Ta581d495] chore: tách test code sang dòng branch riêng (#286)')).toBe('Ta581d495')
  })

  test('subject không mang ngoặc / ngoặc rỗng / thiếu space → null (không đoán)', () => {
    expect(taskIdOf('feat: không có task id')).toBe(null)
    expect(taskIdOf('[] feat: ngoặc rỗng')).toBe(null)
    expect(taskIdOf('[T1]feat: thiếu space')).toBe(null)
    expect(taskIdOf('Merge pull request #286 from naut1402/x')).toBe(null)
  })

  test('định danh có gạch ngang vẫn hợp lệ (issue slug nội bộ)', () => {
    expect(taskIdOf('[hotfix-logs] fix: x')).toBe('hotfix-logs')
  })
})

describe('revertedTaskIdOf', () => {
  test('bóc được task id bên trong subject revert của GitHub', () => {
    expect(revertedTaskIdOf('Revert "[T1] feat(a): thêm x"')).toBe('T1')
  })

  test('không phải revert → null', () => {
    expect(revertedTaskIdOf('[T1] feat(a): thêm x')).toBe(null)
    expect(revertedTaskIdOf('Revert "feat: không có task"')).toBe(null)
  })
})

describe('typeOf — chỉ để HIỆN ứng viên miễn trừ, không tự miễn', () => {
  test('lấy type của conventional commit, kể cả có scope / dấu `!`', () => {
    expect(typeOf('[T1] docs(agent-rules): x')).toBe('docs')
    expect(typeOf('[T1] feat!: đổi contract')).toBe('feat')
    expect(typeOf('[T1] chore: x')).toBe('chore')
  })

  test('không theo format thì null, không đoán bừa', () => {
    expect(typeOf('[T1] sửa lỗi gì đó')).toBe(null)
  })
})

describe('parseExemptions — sai định dạng là ĐỎ, không phải "miễn hết"', () => {
  test('file rỗng hợp lệ (mảng rỗng) + khoá lạ như $comment không phá parse', () => {
    expect(parseExemptions(file([], { $comment: 'ghi chú' }), EXEMPTIONS_FILE)).toEqual([])
  })

  test('entry đủ field → nhận, giữ nguyên lý do để in cho người duyệt', () => {
    const [e] = parseExemptions(file([ex()]), EXEMPTIONS_FILE)
    expect(e).toEqual(ex())
  })

  for (const k of ['taskId', 'version', 'reason', 'approved_by'] as const) {
    test(`thiếu "${k}" → throw, nêu đúng entry và field`, () => {
      const bad = { ...ex() } as Record<string, unknown>
      delete bad[k]
      expect(() => parseExemptions(file([bad]), EXEMPTIONS_FILE)).toThrow(new RegExp(`entry #1.*"${k}"`))
    })

    test(`"${k}" rỗng/space cũng là thiếu (không chấp nhận entry khuyết)`, () => {
      expect(() => parseExemptions(file([{ ...ex(), [k]: '   ' }]), EXEMPTIONS_FILE)).toThrow(new RegExp(`entry #1.*"${k}"`))
    })
  }

  test('taskId wildcard → throw "không miễn trừ cấp version"', () => {
    expect(() => parseExemptions(file([ex({ taskId: '*' })]), EXEMPTIONS_FILE)).toThrow(/không miễn trừ cấp version/)
  })

  test('version wildcard → throw (miễn trừ phải khai đúng một version)', () => {
    expect(() => parseExemptions(file([ex({ version: '1.1.*' })]), EXEMPTIONS_FILE)).toThrow(/wildcard/)
  })

  test('lý do một chữ không phải lý do → throw', () => {
    expect(() => parseExemptions(file([ex({ reason: 'wip' })]), EXEMPTIONS_FILE)).toThrow(/reason quá ngắn/)
  })

  test('hai entry cùng task+version → throw, 🚫 không im lặng lấy entry cuối', () => {
    expect(() => parseExemptions(file([ex(), ex({ reason: 'Lý do khác nhưng cùng task' })]), EXEMPTIONS_FILE)).toThrow(/trùng với entry #1/)
  })

  test('JSON hỏng → throw kèm tên file + lỗi parse', () => {
    expect(() => parseExemptions('{ hỏng', EXEMPTIONS_FILE)).toThrow(/không phải JSON hợp lệ/)
  })

  test('thiếu hẳn khoá "exemptions" → throw (không suy thành mảng rỗng)', () => {
    expect(() => parseExemptions('{}', EXEMPTIONS_FILE)).toThrow(/thiếu khoá "exemptions"/)
  })

  test('"exemptions" không phải mảng → throw', () => {
    expect(() => parseExemptions('{"exemptions":{}}', EXEMPTIONS_FILE)).toThrow(/phải là mảng/)
  })
})

describe('computeStatus', () => {
  const base = { exemptions: [] as Exemption[], version: '1.1.4' }

  test('3 task merge, dòng test phủ 2 → đúng 1 task thiếu, có định danh', () => {
    const r = computeStatus({
      ...base,
      sourceSubjects: ['[T1] feat(a): x', '[T2] feat(b): y', '[T3] feat(c): z'],
      testSubjects: ['[T1] test(a): phủ x', '[T2] test(b): phủ y'],
    })
    expect(r.merged.map((t) => t.taskId)).toEqual(['T1', 'T2', 'T3'])
    expect(r.missing.map((t) => t.taskId)).toEqual(['T3'])
  })

  test('một task nhiều commit vẫn tính MỘT task, giữ đủ subject làm căn cứ', () => {
    const r = computeStatus({ ...base, sourceSubjects: ['[T1] feat: a', '[T1] fix: b', '[T1] docs: c'], testSubjects: [] })
    expect(r.merged).toHaveLength(1)
    expect(r.merged[0].subjects).toHaveLength(3)
    expect(r.merged[0].types).toEqual(['feat', 'fix', 'docs'])
    expect(r.missing).toHaveLength(1)
  })

  test('commit không mang task id → untagged, KHÔNG tính thiếu và KHÔNG bỏ im lặng', () => {
    const r = computeStatus({ ...base, sourceSubjects: ['[T1] feat: a', 'fix: quên task id'], testSubjects: ['[T1] test: a'] })
    expect(r.untagged).toEqual(['fix: quên task id'])
    expect(r.missing).toEqual([])
  })

  test('task đã revert không bị đòi test, và commit revert không rơi vào untagged', () => {
    const r = computeStatus({ ...base, sourceSubjects: ['[T1] feat: a', 'Revert "[T1] feat: a"'], testSubjects: [] })
    expect(r.reverted.map((t) => t.taskId)).toEqual(['T1'])
    expect(r.missing).toEqual([])
    expect(r.untagged).toEqual([])
  })

  test('miễn trừ hợp lệ loại task khỏi "thiếu", nhưng vẫn đếm tách bạch', () => {
    const r = computeStatus({
      sourceSubjects: ['[T1] docs: chỉ tài liệu', '[T2] feat: b'],
      testSubjects: [],
      exemptions: [ex({ taskId: 'T1' })],
      version: '1.1.4',
    })
    expect(r.missing.map((t) => t.taskId)).toEqual(['T2'])
    expect(r.exempt).toHaveLength(1)
  })

  test('miễn trừ của version khác KHÔNG áp dụng — vào staleExempt', () => {
    const r = computeStatus({
      sourceSubjects: ['[T1] docs: x'],
      testSubjects: [],
      exemptions: [ex({ taskId: 'T1', version: '1.1.3' })],
      version: '1.1.4',
    })
    expect(r.exempt).toEqual([])
    expect(r.staleExempt).toHaveLength(1)
    expect(r.missing.map((t) => t.taskId)).toEqual(['T1'])
  })

  test('miễn trừ mồ côi (task không có trên dòng version) được nêu để dọn', () => {
    const r = computeStatus({ sourceSubjects: ['[T1] feat: x'], testSubjects: [], exemptions: [ex({ taskId: 'T404' })], version: '1.1.4' })
    expect(r.orphanExempt.map((e) => e.taskId)).toEqual(['T404'])
  })

  test('miễn trừ có tầm ĐÚNG MỘT task — không nới cổng cho task khác', () => {
    const r = computeStatus({
      sourceSubjects: ['[T1] docs: x', '[T2] feat: y'],
      testSubjects: [],
      exemptions: [ex({ taskId: 'T1' })],
      version: '1.1.4',
    })
    expect(r.missing.map((t) => t.taskId)).toEqual(['T2'])
  })

  test('thứ tự task xác định (sort theo định danh) — báo cáo diff/dán được', () => {
    const subjects = ['[T9] feat: c', '[T1] feat: a', '[T5] feat: b']
    const a = computeStatus({ ...base, sourceSubjects: subjects, testSubjects: [] })
    const b = computeStatus({ ...base, sourceSubjects: [...subjects].reverse(), testSubjects: [] })
    expect(a.missing.map((t) => t.taskId)).toEqual(['T1', 'T5', 'T9'])
    expect(b.missing.map((t) => t.taskId)).toEqual(a.missing.map((t) => t.taskId))
  })
})

describe('renderStatus', () => {
  const opts = { version: '1.1.4', strict: false }

  test('liệt kê TỪNG task thiếu kèm định danh + subject, không chỉ con số tổng', () => {
    const r = computeStatus({ sourceSubjects: ['[T1] feat: a', '[T2] feat: b'], testSubjects: ['[T1] test: a'], exemptions: [], version: '1.1.4' })
    const md = renderStatus(r, opts)
    expect(md).toContain('`T2`')
    expect(md).toContain('[T2] feat: b')
    expect(md).not.toContain('| `T1` | `feat` | 1 | chưa thấy')
  })

  test('0 task → nói rõ "không có task nào", 🚫 không in "đủ test"', () => {
    const md = renderStatus(computeStatus({ sourceSubjects: [], testSubjects: [], exemptions: [], version: '1.1.4' }), opts)
    expect(md).toContain('Không có task nào')
    // 🚫 Không được đóng bằng dấu ✅: "0 task" không phải "đã phủ".
    expect(md).not.toContain('✅')
    expect(md).toContain('chưa kết luận được gì')
  })

  test('lý do miễn trừ + người duyệt hiện nguyên văn trong báo cáo', () => {
    const r = computeStatus({ sourceSubjects: ['[T1] docs: x'], testSubjects: [], exemptions: [ex({ taskId: 'T1' })], version: '1.1.4' })
    const md = renderStatus(r, opts)
    expect(md).toContain('Chỉ đổi tài liệu, không đụng code sản phẩm')
    expect(md).toContain('@tech-lead')
  })

  test('task đã có test được nêu KÈM CĂN CỨ (commit ở dòng test)', () => {
    const r = computeStatus({ sourceSubjects: ['[T1] feat: a'], testSubjects: ['[T1] test(a): phủ TC-01'], exemptions: [], version: '1.1.4' })
    expect(renderStatus(r, opts)).toContain('[T1] test(a): phủ TC-01')
  })

  test('dòng test chưa mở → nói rõ lý do, không để người đọc hiểu là từng task bị bỏ sót', () => {
    const r = computeStatus({ sourceSubjects: ['[T1] feat: a'], testSubjects: [], exemptions: [], version: '1.1.4' })
    const md = renderStatus(r, { ...opts, testLineMissing: true })
    expect(md).toContain('chưa mở')
    expect(md).toContain('`T1`')
  })

  test('chưa có test/main làm mốc → ghi chú số đếm có thể rộng hơn thực tế', () => {
    const r = computeStatus({ sourceSubjects: [], testSubjects: [], exemptions: [], version: '1.1.4' })
    expect(renderStatus(r, { ...opts, noTestTrunk: true })).toContain('rộng hơn thực tế')
  })

  test('mặc định nói thẳng exit 0 KHÔNG phải "đã đủ test"; --strict thì nói CHẶN', () => {
    const r = computeStatus({ sourceSubjects: ['[T1] feat: a'], testSubjects: [], exemptions: [], version: '1.1.4' })
    expect(renderStatus(r, opts)).toContain('không** phải "đã đủ test"')
    expect(renderStatus(r, { ...opts, strict: true })).toContain('**CHẶN**')
  })

  test('cùng dữ kiện, hai lượt render giống nhau từng byte', () => {
    const input = { sourceSubjects: ['[T2] feat: b', '[T1] feat: a'], testSubjects: ['[T1] test: a'], exemptions: [], version: '1.1.4' }
    expect(renderStatus(computeStatus(input), opts)).toBe(renderStatus(computeStatus(input), opts))
  })
})

/** Nguồn sự thật là lịch sử commit thật của hai dòng branch — dựng repo + origin tạm, không mock `git log`. */
describe('main — trên repo git thật', () => {
  let dir: string
  let repo: string
  let originPath: string
  let summaryFile: string
  const prevSummary = process.env.GITHUB_STEP_SUMMARY

  function git(cwd: string, ...args: string[]): string {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} → ${r.status}: ${r.stderr}`)
    return r.stdout.trim()
  }

  function line(branch: string, from: string, subjects: string[]): void {
    git(repo, 'switch', '--quiet', '-c', branch, from)
    for (const s of subjects) git(repo, 'commit', '--allow-empty', '-m', s)
    git(repo, 'push', '--quiet', 'origin', branch)
  }

  function exemptionsFile(list: unknown[]): void {
    const f = path.join(repo, EXEMPTIONS_FILE)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, `${file(list)}\n`, 'utf8')
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-test-status-'))
    originPath = path.join(dir, 'origin.git')
    repo = path.join(dir, 'work')
    git(dir, 'init', '--bare', '--initial-branch=main', 'origin.git')
    git(dir, 'clone', '--quiet', originPath, 'work')
    git(repo, 'config', 'user.email', 'ci@example.com')
    git(repo, 'config', 'user.name', 'CI')
    git(repo, 'commit', '--allow-empty', '-m', 'Release version 1.1.3')
    git(repo, 'push', '--quiet', '-u', 'origin', 'main')
    summaryFile = path.join(dir, 'summary.md')
    process.env.GITHUB_STEP_SUMMARY = summaryFile
  })

  afterEach(() => {
    if (prevSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY
    else process.env.GITHUB_STEP_SUMMARY = prevSummary
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('3 task merge, dòng test phủ 2 → báo cáo nêu đúng task thiếu, exit 0', () => {
    line('dev/1.1.4/main', 'main', ['[T1] feat: a', '[T2] feat: b', '[T3] feat: c'])
    line('test/main', 'main', [])
    line('test/1.1.4/main', 'test/main', ['[T1] test: a', '[T2] test: b'])

    expect(main(['--version', '1.1.4'], repo)).toBe(0)
    const md = fs.readFileSync(summaryFile, 'utf8')
    expect(md).toContain('| **thiếu test** | **1** |')
    expect(md).toContain('`T3`')
  })

  test('cùng dữ kiện + --strict → exit 1', () => {
    line('dev/1.1.4/main', 'main', ['[T1] feat: a'])
    line('test/main', 'main', [])
    line('test/1.1.4/main', 'test/main', [])
    expect(main(['--version', '1.1.4', '--strict'], repo)).toBe(1)
  })

  test('dòng test chưa tồn tại → mọi task là thiếu + nêu lý do, exit 0 (cổng cứng ở probe)', () => {
    line('dev/1.1.4/main', 'main', ['[T1] feat: a', '[T2] feat: b'])
    expect(main(['--version', '1.1.4'], repo)).toBe(0)
    const md = fs.readFileSync(summaryFile, 'utf8')
    expect(md).toContain('chưa mở')
    expect(md).toContain('| **thiếu test** | **2** |')
  })

  test('miễn trừ hợp lệ → task không bị tính thiếu, --strict cũng xanh', () => {
    line('dev/1.1.4/main', 'main', ['[T1] docs: chỉ tài liệu'])
    exemptionsFile([ex({ taskId: 'T1' })])
    expect(main(['--version', '1.1.4', '--strict'], repo)).toBe(0)
    expect(fs.readFileSync(summaryFile, 'utf8')).toContain('Chỉ đổi tài liệu')
  })

  test('miễn trừ sai định dạng → exit 1 (đỏ), KHÔNG bỏ qua entry lỗi rồi chấm tiếp', () => {
    line('dev/1.1.4/main', 'main', ['[T1] docs: x'])
    exemptionsFile([{ taskId: 'T1', version: '1.1.4' }])
    expect(main(['--version', '1.1.4'], repo)).toBe(1)
  })

  test('miễn trừ wildcard → exit 1', () => {
    line('dev/1.1.4/main', 'main', ['[T1] docs: x'])
    exemptionsFile([ex({ taskId: '*' })])
    expect(main(['--version', '1.1.4'], repo)).toBe(1)
  })

  test('không có file miễn trừ → hợp lệ, cổng chạy bình thường (dòng test cũ không có file này)', () => {
    line('dev/1.1.4/main', 'main', ['[T1] feat: a'])
    expect(fs.existsSync(path.join(repo, EXEMPTIONS_FILE))).toBe(false)
    expect(main(['--version', '1.1.4'], repo)).toBe(0)
  })

  test('không suy được version → exit 2 kèm cách dùng, không đoán', () => {
    git(repo, 'switch', '--quiet', '-c', 'dev/khong-version/main')
    expect(main([], repo)).toBe(2)
  })

  test('không kéo được dòng test (origin sai) → exit 2, KHÁC hẳn "thiếu test"', () => {
    line('dev/1.1.4/main', 'main', ['[T1] feat: a'])
    git(repo, 'remote', 'set-url', 'origin', path.join(dir, 'khong-ton-tai.git'))
    // Xoá ref local để buộc phải hỏi remote — đúng ca workspace CI chưa có ref.
    git(repo, 'update-ref', '-d', 'refs/remotes/origin/main')
    expect(main(['--version', '1.1.4'], repo)).toBe(2)
  })

  test('cwd không phải git repo → exit 2 kèm thông điệp, không stack trace', () => {
    const plain = path.join(dir, 'khong-git')
    fs.mkdirSync(plain)
    expect(main(['--version', '1.1.4'], plain)).toBe(2)
  })

  test('chạy ở local không có biến của Actions vẫn ra cùng kết luận', () => {
    delete process.env.GITHUB_STEP_SUMMARY
    line('dev/1.1.4/main', 'main', ['[T1] feat: a'])
    expect(main(['--version', '1.1.4'], repo)).toBe(0)
    expect(main(['--version', '1.1.4', '--strict'], repo)).toBe(1)
  })
})
