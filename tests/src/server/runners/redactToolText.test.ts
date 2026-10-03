// Tbefa5f4c · Nhóm F (TC-F01 … TC-F29) — `redactToolText`.
//
// ⚠️ Expected của nhóm này lấy NGUYÊN từ `test-spec.md` §5.F.1/§5.F.2/§5.F.3 —
// không ca nào được sinh bằng cách chạy hàm rồi chép output. Hàm này đã rò hai
// lớp khác nhau qua hai vòng review; test viết theo hành vi quan sát từ code
// hiện tại chỉ là đóng dấu chứng nhận cho bug tiếp theo.
//
// Hai bất biến, hai `expect` RIÊNG (§5.F.0):
//   O1 — secret biến mất.
//   O2 — token KHÔNG phải secret còn nguyên văn. Chính O2 bắt `--api-keyapi-key`,
//        lỗi mà O1 bỏ lọt hoàn toàn vì secret vẫn biến mất đúng.
import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import {
  prepareCalls,
  redactToolText,
} from '../../../../src/features/runner/business/toolCallCapture.js'
import { SENSITIVE_KEY_RE } from '../../../../src/shared/log/schema.js'

// ── Oracle §5.F.0 ────────────────────────────────────────────────────────────

const tokensOf = (s: string): string[] => s.split(/\s+/).filter(Boolean)

/** O1 — bất biến THỨ NHẤT: mọi secret biến mất khỏi output. */
function o1(out: string, secrets: string[]): boolean {
  return secrets.every((v) => !out.includes(v))
}

/**
 * O2 — bất biến THỨ HAI: token của input không nằm trong `mutable` và không chứa
 * secret nào thì phải có mặt Y NGUYÊN trong output.
 *
 * 🚫 Cố ý KHÔNG kiểm "số token không đổi": nó không nằm trong hợp đồng và đỏ giả
 * ở ca scheme.
 */
function o2(input: string, out: string, secrets: string[], mutable: string[]): boolean {
  const outTokens = tokensOf(out)
  return tokensOf(input).every((tok) => {
    if (mutable.includes(tok)) return true
    if (secrets.some((s) => tok.includes(s))) return true
    return outTokens.includes(tok)
  })
}

interface RedactCase {
  input: string
  secrets: string[]
  /** Token của input ĐƯỢC PHÉP khác ở output — mặc định rỗng, chỉ ca scheme khai. */
  mutable?: string[]
}

/** Chạy O1 và O2 thành hai assertion tách rời. */
function expectRedacted({ input, secrets, mutable = [] }: RedactCase): string {
  const out = redactToolText(input)
  expect({ case: input, o1: o1(out, secrets), out }).toEqual({ case: input, o1: true, out })
  expect({ case: input, o2: o2(input, out, secrets, mutable), out }).toEqual({
    case: input,
    o2: true,
    out,
  })
  return out
}

/** O3 — ca "giữ nguyên văn". */
function expectVerbatim(input: string): void {
  expect({ case: input, out: redactToolText(input) }).toEqual({ case: input, out: input })
}

// ── §5.F.2 — ca BẮT BUỘC: rỗ hết secret ──────────────────────────────────────

describe('Nhóm F · §5.F.2 — secret phải biến mất (O1 + O2)', () => {
  test('TC-F01: header Authorization trong nháy đơn', () => {
    const secret = 'sk-ant-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const out = expectRedacted({
      input: `curl -H 'Authorization: ${'Bearer'} ${secret}' http://localhost:3000/api/x`,
      secrets: [secret],
      mutable: ['Bearer'],
    })
    // Tên header phải sống sót thì nhóm I/J mới phân loại được ý định `curl`.
    expect(out).toContain("'Authorization:")
    expect(out).toContain('http://localhost:3000/api/x')
  })

  test('TC-F02: hoa thường không ảnh hưởng', () => {
    const secret = 'sk-ant-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const out = expectRedacted({
      input: `--header "authorization: bearer ${secret}"`,
      secrets: [secret],
      mutable: ['bearer'],
    })
    expect(out).toContain('--header')
  })

  test('TC-F12: 🆕 ⚠️ `--api-key` đứng SAU cờ ngắn `-s`', () => {
    // Cờ ngắn đứng trước là đúng lớp lỗi vòng 2 bỏ lọt: regex global ăn luôn
    // `-s --api-key` làm một match và để nguyên giá trị.
    const out = expectRedacted({ input: 'curl -s --api-key sk_live_abc123', secrets: ['sk_live_abc123'] })
    // O2 ở ca này là cái bắt `--api-keyapi-key`.
    expect(tokensOf(out)).toContain('--api-key')
    expect(tokensOf(out)).toContain('-s')
  })

  test('TC-F13: 🆕 ⚠️ `--password` sau `-v`, giá trị 7 ký tự không chữ số', () => {
    // Ngưỡng của `token` trần 🚫 không áp cho tên nhạy cảm.
    const out = expectRedacted({ input: 'curl -v --password hunter2', secrets: ['hunter2'] })
    expect(tokensOf(out)).toContain('-v')
    expect(tokensOf(out)).toContain('--password')
  })

  test('TC-F14: 🆕 ⚠️ `--secret` sau `--silent`', () => {
    const out = expectRedacted({ input: 'curl --silent --secret s3cr3tvalue', secrets: ['s3cr3tvalue'] })
    // 🚫 Không được nuốt `--silent` làm giá trị của gì.
    expect(tokensOf(out)).toContain('--silent')
  })

  test('TC-F15: 🆕 ⚠️ header nháy, tên nhạy cảm HAI TỪ (`X-Api-Key`)', () => {
    // Ca chứng minh `api[-_]?key` không bị tách theo `-`.
    const out = expectRedacted({ input: 'curl -H "X-Api-Key: sk-abc123xyz987"', secrets: ['sk-abc123xyz987'] })
    expect(out).toContain('"X-Api-Key:')
  })

  test('TC-F03: 🔧 gán biến môi trường — tên nhạy cảm KHÔNG có ngưỡng độ dài', () => {
    const out = expectRedacted({ input: 'export GITHUB_API_KEY=sk-live-0001', secrets: ['sk-live-0001'] })
    expect(out).toContain('GITHUB_API_KEY=[redacted]')
    expect(tokensOf(out)).toContain('export')
  })

  test('TC-F04: 🔧 body JSON — khoá `x_api_key` khớp nhờ biên `_api_key`', () => {
    const out = expectRedacted({ input: `curl -d '{"x_api_key":"sk-live-2"}'`, secrets: ['sk-live-2'] })
    expect(out).toContain('[redacted]')
    expect(tokensOf(out)).toContain('-d')
  })

  test('TC-F16: 🆕 ⚠️ scheme nằm trong GIÁ TRỊ của khoá', () => {
    const out = expectRedacted({
      input: `--data-raw 'token=Bearer sk-live-xyz'`,
      secrets: ['sk-live-xyz'],
      mutable: ["'token=Bearer"],
    })
    // Chữ `Bearer` biến mất và đó là ĐÚNG — nó bị redact CÙNG token.
    expect(out).toContain('token=[redacted] [redacted]')
    expect(out).not.toContain('Bearer')
    expect(tokensOf(out)).toContain('--data-raw')
  })

  test('TC-F17: 🆕 ⚠️ `Bearer` + token KHÔNG chữ số vẫn rỗ (rule scheme vô điều kiện)', () => {
    const out = expectRedacted({
      input: 'echo "Authorization: Bearer sk-leaky-token-value"',
      secrets: ['sk-leaky-token-value'],
      mutable: ['Bearer'],
    })
    expect(tokensOf(out)).toContain('echo')
  })

  test('TC-F18: 🆕 ⚠️ `Bearer` + token NGẮN (6 ký tự, không chữ số) vẫn rỗ', () => {
    const out = expectRedacted({
      input: 'grep "Authorization: Bearer sk-abc"',
      secrets: ['sk-abc'],
      mutable: ['Bearer'],
    })
    expect(tokensOf(out)).toContain('grep')
  })

  test('TC-F19: 🆕 cờ nhạy cảm NGOÀI `curl` — rule không gắn với binary', () => {
    const out = expectRedacted({ input: 'aws --password hunter2', secrets: ['hunter2'] })
    expect(tokensOf(out)).toContain('aws')
    expect(tokensOf(out)).toContain('--password')
  })

  test('TC-F09: nhiều secret trong một lệnh', () => {
    const a = 'sk-aaa-111111111'
    const b = 'sk-bbb-222222222'
    const c = 'sk-ccc-333333333'
    expectRedacted({
      input: `curl -H 'Authorization: Bearer ${a}' -H 'Authorization: Bearer ${b}' -d 'API_KEY=${c}'`,
      secrets: [a, b, c],
      mutable: ['Bearer'],
    })
  })

  test('TC-F08: redact chạy TRƯỚC khi cắt trần text', () => {
    const secret = 'sk-live-longsecret9'
    const long = `echo ${'a'.repeat(88)} --api-key ${secret} ${'b'.repeat(3000)}`
    expect(long.indexOf(secret)).toBeGreaterThan(90)
    expect(long.length).toBeGreaterThan(2048)

    const { calls } = prepareCalls([{ name: 'Bash', at: null, text: long, sidechain: false }])
    const stored = calls[0].text
    expect(stored.length).toBeLessThanOrEqual(2048)
    // Secret nằm ở vị trí ~100 nên vẫn lọt vào phần được giữ nếu redact chạy SAU.
    expect(stored.includes(secret)).toBe(false)
    expect(stored).toContain('[redacted]')
  })
})

// ── §5.F.3 — ca BẮT BUỘC: giữ nguyên văn ────────────────────────────────────

describe('Nhóm F · §5.F.3 — lệnh sạch phải còn NGUYÊN VĂN (O3)', () => {
  test('TC-F20: 🆕 ⚠️ `--patch` / `--path` không khớp tên nhạy cảm', () => {
    expectVerbatim('git diff --patch HEAD')
    expectVerbatim('git diff --path src/a.ts')
  })

  test('TC-F21: 🆕 ⚠️ `PATH=` — `PATH` không phải `PAT`', () => {
    expectVerbatim('PATH=/usr/local/bin cmd')
  })

  test('TC-F22: 🆕 ⚠️ `token` trần DƯỚI ngưỡng — 5 ca, mỗi ca phá một điều kiện', () => {
    expectVerbatim('grep -rn token src/') // chứa `/`
    expectVerbatim('grep -n token schema.ts') // có đuôi file
    expectVerbatim('grep -rn token loggingPrefs') // không có chữ số
    expectVerbatim('rg token README.md') // có đuôi file
    expectVerbatim('grep -c token package.json') // có đuôi file
  })

  test('TC-F23: 🆕 `--timeout` không bị nhận nhầm là cờ nhạy cảm', () => {
    expectVerbatim('bun test tests/mcp --timeout 30000')
  })

  test('TC-F24: 🆕 `--max-time` + URL có chữ `api`', () => {
    expectVerbatim('curl -s --max-time 30 https://api.example.com/v1/tasks')
  })

  test('TC-F06: ⚠️ 🚫 KHÔNG redact SHA git', () => {
    expectVerbatim('git show b7f858a0d1c2e3f4a5b6c7d8e9f0a1b2c3d4e5f6')
  })

  test('TC-F05: ⚠️ 🚫 KHÔNG redact path dài', () => {
    expectVerbatim('cat /data/project/agent-workflow/.dev-team-agent/tasks/Tbefa5f4c/design.md')
  })

  test('TC-F07: ⚠️ 🚫 KHÔNG redact chuỗi dài không cạnh khoá nhạy cảm', () => {
    expectVerbatim("grep -rn 'abcdefghijklmnopqrstuvwxyz0123456789' src")
  })

  test('TC-F10: lệnh sạch không đổi', () => {
    expectVerbatim('ls -la && cat README.md')
  })
})

// ── §5.F.4 — thứ tự rule & ngưỡng ───────────────────────────────────────────

describe('Nhóm F · §5.F.4 — thứ tự rule và ngưỡng', () => {
  test('TC-F25: 🆕 ⚠️ `Bearer` bị tiêu thụ TRƯỚC — không còn chữ scheme trong output', () => {
    const out = redactToolText(`curl -H 'Authorization: Bearer sk-live-9'`)
    expect(out).not.toContain('sk-live-9')
    // `[redacted] Bearer` hay `Bearer [redacted]` nghĩa là rule sau đã ghi đè chữ
    // scheme — ĐỎ.
    expect(out.toLowerCase()).not.toContain('bearer')
  })

  test('TC-F26: 🆕 `basic` cũng vô điều kiện', () => {
    const out = redactToolText(`curl -H 'Authorization: Basic YWJj'`)
    expect(out).not.toContain('YWJj')
  })

  test('TC-F27: 🆕 ngưỡng `token` trần — ca ĐẠT ngưỡng', () => {
    // 8 ký tự · có chữ số · không `/` · không đuôi file.
    const out = redactToolText(`token ab12cdef`)
    expect(out).not.toContain('ab12cdef')
    expect(out).toContain('[redacted]')
    // Dạng `token=…` không đi qua ngưỡng này — xem TC-F28.
    expect(redactToolText(`--data 'token=ab12cdef'`)).toBe(`--data 'token=[redacted]'`)
  })

  test('TC-F28: 🔧 ngưỡng `token` CHỈ áp cho dạng cách bởi dấu cách, `token=` redact vô điều kiện', () => {
    // ⚠️ Spec gốc chờ cả 4 ca `token=<value yếu>` giữ NGUYÊN VĂN. Đó là spec cho
    // phép rò: `token` là khoá nhạy cảm nên `KEY_VALUE_RE` phải redact bất kể
    // value trông "yếu" tới đâu — một PAT ngắn vẫn là PAT. Case sửa theo hành vi
    // an toàn, KHÔNG nới code cho test cũ xanh.
    //
    // Ngưỡng `looksLikeCredential` tồn tại cho dạng `token <value>` (AUTH_SCHEME_RE),
    // nơi `token` còn là một từ tiếng Anh bình thường — `grep -n token schema.ts`
    // không được thành `token [redacted]`.
    const spaced = [
      'token ab12cde', // 7 ký tự
      'token abcdefgh', // không chữ số
      'token ab12/cdef', // có `/`
      'token ab12cd.ts', // có đuôi file
    ]
    // Bốn điều kiện là AND. Chấm cả bốn trong MỘT assertion để biết điều kiện nào
    // gãy, thay vì dừng ở ca đầu tiên.
    expect(Object.fromEntries(spaced.map((c) => [c, redactToolText(c)]))).toEqual(
      Object.fromEntries(spaced.map((c) => [c, c])),
    )

    // Cùng 4 value đó sau `token=` thì redact hết — trừ ca `/` vì `looksLikePath`
    // giữ lại đường dẫn (mất path là mất chính dữ liệu bảng lệnh cần đếm).
    expect(Object.fromEntries(spaced.map((c) => c.replace(' ', '=')).map((c) => [c, redactToolText(c)]))).toEqual({
      'token=ab12cde': 'token=[redacted]',
      'token=abcdefgh': 'token=[redacted]',
      'token=ab12/cdef': 'token=ab12/cdef',
      'token=ab12cd.ts': 'token=[redacted]',
    })
  })

  test('TC-F29: 🆕 ⚠️ khoá nhạy cảm sau khoá KHÔNG nhạy cảm — match ngoài không được nuốt mất', () => {
    // Lỗ rò thật: `KEY_VALUE_RE` global khớp tại khoá đầu tiên (`https`), và span
    // đã khớp thì không bao giờ được xét lại ⇒ `api_key=abc123` lọt nguyên văn.
    // Bản vá rescan value của khoá không nhạy cảm, nên ca này phải xanh mãi.
    const out = redactToolText(`curl "https://api.x.com/v1?api_key=abc123"`)
    expect(out).not.toContain('abc123')
    expect(out).toBe(`curl "https://api.x.com/v1?api_key=[redacted]"`)

    // Cùng hình dạng, khoá nhạy cảm nằm giữa query string.
    expect(redactToolText(`curl -s "http://h/p?token=abc12345&page=2"`)).toBe(
      `curl -s "http://h/p?token=[redacted]&page=2"`,
    )
  })

  test('TC-F30: 🆕 ⚠️ `curl -u user:pass` — credential ở flag basic-auth', () => {
    expect(redactToolText('curl -u user:pass https://api.x.com')).toBe('curl -u [redacted] https://api.x.com')
    expect(redactToolText(`curl -u 'admin:s3cret' https://api.x.com`)).not.toContain('s3cret')
    expect(redactToolText('curl --user admin:s3cret https://api.x.com')).toBe(
      'curl --user [redacted] https://api.x.com',
    )
    expect(redactToolText('curl --user=admin:s3cret https://api.x.com')).toBe(
      'curl --user=[redacted] https://api.x.com',
    )
  })

  test('TC-F31: 🆕 ⚠️ userinfo trong URL — `scheme://user:pass@host`', () => {
    expect(redactToolText('git clone https://user:pass@github.com/org/repo.git')).toBe(
      'git clone https://[redacted]@github.com/org/repo.git',
    )
    // Không chỉ http(s): scheme nào cũng mang được userinfo.
    expect(redactToolText('psql postgres://admin:p4ssw0rd@db.internal:5432/app')).not.toContain('p4ssw0rd')
    expect(redactToolText('ssh://deploy:hunter2@git.example.com:22/repo')).not.toContain('hunter2')
  })

  test('TC-F11: 🔧 đúng MỘT `SENSITIVE_KEY_RE`, có biên — không bản sao, không tách tên', () => {
    // Một nguồn duy nhất, export từ `shared/log/schema.ts`.
    expect(SENSITIVE_KEY_RE).toBeInstanceOf(RegExp)
    expect(SENSITIVE_KEY_RE.source).toBe('(token|pat|secret|password|api[-_]?key|authorization)')

    const source = fs.readFileSync(
      path.join(import.meta.dir, '../../../../src/features/runner/business/toolCallCapture.ts'),
      'utf8',
    )
    // Regex tên nhạy cảm phải DỰNG TỪ `SENSITIVE_KEY_RE.source`, không chép tay.
    expect(source).toContain('SENSITIVE_KEY_RE.source')
    expect(source).not.toContain(SENSITIVE_KEY_RE.source)
    // 🚫 Không nhánh nào tách tên theo `-`/`_` rồi test từng phần — cách đó xé
    // đôi khoá hai từ `api[-_]?key`.
    expect(source).not.toMatch(/\.split\(\s*['"][-_]['"]\s*\)/)
    expect(source).not.toMatch(/\.split\(\s*\/\[-_\]\//)

    // Hệ quả quan sát được phải ĐỒNG THỜI đúng.
    expect(redactToolText('export GITHUB_API_KEY=sk-live-0001')).not.toContain('sk-live-0001')
    expect(redactToolText(`curl -d '{"x_api_key":"sk-live-2"}'`)).not.toContain('sk-live-2')
    expect(redactToolText('curl -H "X-Api-Key: sk-abc123xyz987"')).not.toContain('sk-abc123xyz987')
    expect(redactToolText('git diff --patch HEAD')).toBe('git diff --patch HEAD')
    expect(redactToolText('PATH=/usr/local/bin cmd')).toBe('PATH=/usr/local/bin cmd')
  })

  test('TC-F29: 🆕 ⚠️ O2 là cổng ĐỘC LẬP với O1', () => {
    // Output mô phỏng lỗi `--api-keyapi-key`: secret VẪN biến mất (O1 xanh) nhưng
    // token cờ bị chèo chữ khoá (O2 đỏ). Nếu O2 bị gộp vào O1 thì lỗi này lọt.
    const input = 'curl -s --api-key sk_live_abc123'
    const secrets = ['sk_live_abc123']
    const buggy = 'curl -s --api-keyapi-key [redacted]'
    expect(o1(buggy, secrets)).toBe(true)
    expect(o2(input, buggy, secrets, [])).toBe(false)

    // Và O2 phải chạy cho TOÀN BỘ ca §5.F.2 — mỗi ca một assertion riêng ở các
    // test phía trên; ở đây khẳng định lại trên ca đại diện.
    const real = redactToolText(input)
    expect(o1(real, secrets)).toBe(true)
    expect(o2(input, real, secrets, [])).toBe(true)
  })
})
