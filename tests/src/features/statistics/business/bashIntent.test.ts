// Tbefa5f4c · Nhóm I (TC-I01 … TC-I21) — `splitCommandSegments` / `classifySegment` (F9).
//
// Bash là 91% lượt tool đo được và mỗi lệnh trung bình nối ~5 đoạn, nên MỌI con
// số tần suất trong báo cáo phụ thuộc vào việc cắt đoạn này đúng.
//
// ⚠️ File đặt ở `tests/src/features/statistics/business` (bun) theo `design.md`
// §5 — source F9 nằm ở `src/features/statistics/lib/` nhưng module thuần nên
// chạy được dưới cả hai runner. Chọn MỘT chỗ; xem test-result.md.
import { describe, expect, test } from 'bun:test'
import {
  classifyBashCall,
  classifySegment,
  primaryIntentOf,
  splitCommandSegments,
} from '../../../../../src/features/statistics/lib/bashIntent.js'

/** §4.4 `FX-HEREDOC` — nguồn lệch số ở `investigate.md` §6.9. */
const FX_HEREDOC = `cd /repo && bun <<'EOF'
const x = 1  // grep
console.log("cat")
EOF
grep -n done out.txt`

describe('Nhóm I — splitCommandSegments', () => {
  test('TC-I01: cắt theo &&, ;, ||', () => {
    expect(splitCommandSegments('cd /r && cat a.md; grep x b.md || ls -la')).toEqual([
      'cd /r',
      'cat a.md',
      'grep x b.md',
      'ls -la',
    ])
  })

  test('TC-I02: cắt theo pipe và newline', () => {
    expect(splitCommandSegments('cat a.md | grep x\nls -la')).toEqual(['cat a.md', 'grep x', 'ls -la'])
  })

  test('TC-I03: ⚠️ heredoc bị nuốt TRỌN (E7)', () => {
    const segments = splitCommandSegments(FX_HEREDOC)
    expect(segments).toHaveLength(3)
    expect(segments[0]).toBe('cd /repo')
    expect(segments[1]).toContain("bun <<'EOF'")
    expect(segments[1]).toContain('console.log("cat")')
    expect(segments[2]).toBe('grep -n done out.txt')
    // Thân heredoc 🚫 KHÔNG được đẻ ra đoạn `grep` / `cat` giả.
    expect(segments.filter((s) => s.startsWith('grep'))).toEqual(['grep -n done out.txt'])
    expect(segments.some((s) => s.startsWith('cat'))).toBe(false)
  })

  test('TC-I04: bốn kiểu nhãn heredoc đều nuốt trọn thân', () => {
    expect(splitCommandSegments('bun <<EOF\ncat x\nEOF\nls')).toEqual(['bun <<EOF\ncat x\nEOF', 'ls'])
    expect(splitCommandSegments("bun <<'EOF'\ncat x\nEOF\nls")).toEqual(["bun <<'EOF'\ncat x\nEOF", 'ls'])
    expect(splitCommandSegments('bun <<"EOF"\ncat x\nEOF\nls')).toEqual(['bun <<"EOF"\ncat x\nEOF', 'ls'])
    // `<<-` cho phép nhãn đóng thụt tab.
    expect(splitCommandSegments('bun <<-EOF\ncat x\n\tEOF\nls')).toEqual(['bun <<-EOF\ncat x\n\tEOF', 'ls'])
  })

  test('TC-I05: nhãn đóng chỉ khớp khi đứng MỘT MÌNH trên dòng', () => {
    const segments = splitCommandSegments("bun <<'EOF'\necho EOF now\ngrep z\nEOF\nls -la")
    expect(segments).toHaveLength(2)
    expect(segments[0]).toContain('echo EOF now')
    expect(segments[0]).toContain('grep z')
    expect(segments[1]).toBe('ls -la')
  })

  test('TC-I06: heredoc không đóng → nuốt tới hết chuỗi, không đoạn giả, không treo', () => {
    const segments = splitCommandSegments("bun <<'EOF'\nconsole.log(1)")
    expect(segments).toHaveLength(1)
    expect(segments[0]).toContain('console.log(1)')
  })

  test('TC-I07: ⚠️ KHÔNG cắt bên trong chuỗi trích dẫn (§7-Q1)', () => {
    // Bất biến shell thật: `grep 'a|b' f` chạy MỘT lệnh.
    expect(splitCommandSegments(`grep 'a|b' f.txt && cat "x;y.md"`)).toEqual([
      `grep 'a|b' f.txt`,
      `cat "x;y.md"`,
    ])
  })

  test('TC-I08: bỏ tiền tố gán biến', () => {
    expect(splitCommandSegments('FOO=bar cmd -x')).toEqual(['cmd -x'])
  })

  test('TC-I09: gán biến đứng một mình không phải lệnh', () => {
    expect(splitCommandSegments('TOKEN=abc')).toEqual(['TOKEN=abc'])
    expect(classifySegment('TOKEN=abc')).toBeNull()
  })

  test('TC-I10: bỏ đoạn rỗng và trim', () => {
    const segments = splitCommandSegments('cat a.md &&  && ls')
    expect(segments).toEqual(['cat a.md', 'ls'])
    expect(segments.every((s) => s === s.trim() && s.length > 0)).toBe(true)
  })

  test('TC-I11: chuỗi rỗng → []', () => {
    expect(splitCommandSegments('')).toEqual([])
  })
})

describe('Nhóm I — classifySegment', () => {
  test('TC-I12: phân loại `read`', () => {
    for (const cmd of ['cat a.md', 'head -5 a.md', 'tail -f log', 'bat a.md', 'less a.md', "sed -n '1,10p' f"]) {
      expect({ cmd, intent: classifySegment(cmd) }).toEqual({ cmd, intent: 'read' })
    }
  })

  test('TC-I13: ⚠️ `sed` phân loại theo cờ', () => {
    expect(classifySegment("sed -i 's/a/b/' f")).toBe('write')
    expect(classifySegment("sed -n '1p' f")).toBe('read')
    expect(classifySegment("sed 's/a/b/' f")).toBeNull()
  })

  test('TC-I14: mỗi binary ra đúng nhãn', () => {
    const table: Array<[string, string | null]> = [
      ['grep x f', 'grep'],
      ['rg x f', 'grep'],
      ['ag x f', 'grep'],
      ['ack x f', 'grep'],
      ['ls -la', 'list'],
      ['tree src', 'list'],
      ['find . -name x', 'find'],
      ['fd x', 'find'],
      ['curl https://x', 'curl'],
      ['wget https://x', 'curl'],
      ['git status', 'git'],
      ['bun run test', 'script'],
      ['node x.js', 'script'],
      ['python x.py', 'script'],
      ['python3 x.py', 'script'],
      ['sh x.sh', 'script'],
      ['bash x.sh', 'script'],
      ['cd /r', 'cd'],
      ['tee out.txt', 'write'],
      ['mv a b', 'write'],
      ['cp a b', 'write'],
      ['rm a', 'write'],
      ['mkdir d', 'write'],
      ['touch f', 'write'],
    ]
    expect(table.map(([cmd]) => [cmd, classifySegment(cmd)])).toEqual(table)
  })

  test('TC-I15: redirect là `write`', () => {
    expect(classifySegment('echo x > out.txt')).toBe('write')
  })

  test('TC-I16: đoạn có thân heredoc → `script`', () => {
    const segments = splitCommandSegments(FX_HEREDOC)
    expect(classifySegment(segments[1])).toBe('script')
  })

  test('TC-I17: binary lạ → null', () => {
    expect(classifySegment('foobarbaz --x')).toBeNull()
  })
})

describe('Nhóm I — classifyBashCall', () => {
  test('TC-I18: gom tập ý định + hasAbsoluteCd', () => {
    const r = classifyBashCall('cd /data/project/x && cat a.md && grep y b.md')
    expect([...r.intents].sort()).toEqual(['cd', 'grep', 'read'])
    expect(r.segments).toHaveLength(3)
    expect(r.hasAbsoluteCd).toBe(true)
  })

  test('TC-I19: ⚠️ `intents` là tập HỢP, `segments` thì không', () => {
    const r = classifyBashCall('cat a && cat b && cat c')
    expect(r.intents.filter((i) => i === 'read')).toHaveLength(1)
    expect(r.segments).toHaveLength(3)
  })

  test('TC-I20: `cd` tương đối → hasAbsoluteCd false', () => {
    const r = classifyBashCall('cd ../x && ls')
    expect(r.intents).toContain('cd')
    expect(r.hasAbsoluteCd).toBe(false)
  })

  test('TC-I21: không phân loại được đoạn nào → intents rỗng', () => {
    const r = classifyBashCall('foo && bar')
    expect(r.intents).toEqual([])
    expect(r.segments).toHaveLength(2)
  })

  test('primaryIntentOf bỏ qua `cd` trừ khi đó là thứ duy nhất lệnh làm', () => {
    // 74% lượt Bash mở đầu bằng `cd` tuyệt đối chỉ vì cwd reset — lấy nó làm nhãn
    // thì mọi cặp bigram thành `cd → cd` và che mất vòng lặp read/grep.
    expect(primaryIntentOf('cd /r && cat a.md')).toBe('read')
    expect(primaryIntentOf('cd /r')).toBe('cd')
    expect(primaryIntentOf('foobarbaz')).toBeNull()
  })
})
