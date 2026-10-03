// Tbefa5f4c · Nhóm D (TC-D01 … TC-D13) — adapter transcript Claude CLI (F4).
//
// Bề mặt: `readNewToolCalls(filePath, fromLine)` + `textOfToolInput(input)`.
//
// Hai bất biến nhóm này gác:
//   - `null` (không đọc được) và `[]` (đọc được, không có gì mới) là HAI câu trả
//     lời khác nhau — `ingestJobToolCalls` xử lý khác nhau (TC-D08 vs TC-D12),
//   - con trỏ `totalLines` không được nhảy qua một dòng chưa ghi xong, nếu không
//     các lượt của dòng đó mất vĩnh viễn (TC-D06).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  readNewToolCalls,
  textOfToolInput,
} from '../../../../src/features/runner/business/claudeToolTranscript.js'

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-cli-transcript-'))
  file = path.join(dir, 'session.jsonl')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

/** §4.1 `FX-CLI` — 4 dòng: Bash · tool_result · text+Grep · Read (sidechain). */
const FX_CLI: unknown[] = [
  {
    type: 'assistant',
    timestamp: '2026-09-30T01:00:00.000Z',
    isSidechain: false,
    message: {
      content: [
        {
          type: 'tool_use',
          name: 'Bash',
          input: { command: 'cd /data/project/agent-workflow/.dev-team-agent/tasks/T1 && cat request.md' },
        },
      ],
    },
  },
  {
    type: 'user',
    timestamp: '2026-09-30T01:00:01.000Z',
    message: { content: [{ type: 'tool_result', content: '...' }] },
  },
  {
    type: 'assistant',
    timestamp: '2026-09-30T01:00:02.000Z',
    isSidechain: false,
    message: {
      content: [
        { type: 'text', text: 'ok' },
        { type: 'tool_use', name: 'Grep', input: { pattern: 'appendLog', path: 'src' } },
      ],
    },
  },
  {
    type: 'assistant',
    timestamp: '2026-09-30T01:00:03.000Z',
    isSidechain: true,
    message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/repo/src/a.ts' } }] },
  },
]

function writeLines(rows: unknown[], opts: { trailingNewline?: boolean } = {}): void {
  const body = rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')
  fs.writeFileSync(file, opts.trailingNewline === false ? body : `${body}\n`)
}

describe('Nhóm D — readNewToolCalls (transcript Claude CLI)', () => {
  test('TC-D01: trích đúng các lượt tool_use', async () => {
    writeLines(FX_CLI)
    const result = await readNewToolCalls(file, 0)
    expect(result).not.toBeNull()
    expect(result!.calls).toHaveLength(3)
    expect(result!.calls[0]).toEqual({
      name: 'Bash',
      at: '2026-09-30T01:00:00.000Z',
      text: 'cd /data/project/agent-workflow/.dev-team-agent/tasks/T1 && cat request.md',
      sidechain: false,
    })
  })

  test('TC-D02: bỏ entry không phải assistant, bỏ block không phải tool_use', async () => {
    writeLines(FX_CLI)
    const result = await readNewToolCalls(file, 0)
    // Dòng `user` mang `tool_result` — không lượt nào được sinh từ nó.
    expect(result!.calls.map((c) => c.name)).toEqual(['Bash', 'Grep', 'Read'])
    expect(result!.calls.some((c) => c.text === '...')).toBe(false)
    // Block `type:'text'` ở dòng 3 bị bỏ, chỉ lấy block `tool_use`.
    expect(result!.calls.some((c) => c.text === 'ok')).toBe(false)
  })

  test('TC-D03: cờ sidechain — thiếu khoá là false, không undefined', async () => {
    writeLines(FX_CLI)
    const result = await readNewToolCalls(file, 0)
    expect(result!.calls[2].sidechain).toBe(true)
    expect(result!.calls[0].sidechain).toBe(false)

    // Thiếu hẳn khoá `isSidechain` → false (không undefined): `sidechain` là thứ
    // thống kê dùng để tách lượt subagent ra.
    writeLines([
      {
        type: 'assistant',
        timestamp: '2026-09-30T02:00:00.000Z',
        message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] },
      },
    ])
    const plain = await readNewToolCalls(file, 0)
    expect(plain!.calls[0].sidechain).toBe(false)
    expect(plain!.calls[0].sidechain).not.toBe(undefined)
  })

  test('TC-D04: ⚠️ con trỏ dòng — đọc lần hai trên file không đổi trả 0 lượt', async () => {
    writeLines(FX_CLI)
    const first = await readNewToolCalls(file, 0)
    const n = first!.totalLines
    expect(n).toBe(4)

    const second = await readNewToolCalls(file, n)
    expect(second!.calls).toHaveLength(0)
    expect(second!.totalLines).toBe(n)
  })

  test('TC-D05: chỉ đọc phần mới sau khi transcript dài thêm', async () => {
    writeLines(FX_CLI)
    const n = (await readNewToolCalls(file, 0))!.totalLines

    fs.appendFileSync(
      file,
      `${JSON.stringify({
        type: 'assistant',
        timestamp: '2026-09-30T01:00:04.000Z',
        message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/repo/b.ts' } }] },
      })}\n`,
    )

    const second = await readNewToolCalls(file, n)
    expect(second!.calls).toHaveLength(1)
    expect(second!.calls[0].name).toBe('Edit')
    expect(second!.totalLines).toBe(n + 1)
  })

  test('TC-D06: dòng JSON hỏng bị skip và con trỏ DỪNG trước nó', async () => {
    writeLines([...FX_CLI, '{"type":"assistant","mess'], { trailingNewline: false })
    const result = await readNewToolCalls(file, 0)
    expect(result).not.toBeNull()
    expect(result!.calls).toHaveLength(3)
    // Dòng dở dang thường là dòng CLI đang ghi — con trỏ nhảy qua nó là mất lượt.
    expect(result!.totalLines).toBe(4)
  })

  test('TC-D06b: 🆕 ⚠️ dòng hỏng ở GIỮA file KHÔNG giữ con trỏ — chống ghi lặp mỗi lần resume', async () => {
    // Chỉ dòng vật lý CUỐI mới có thể còn dở dang. Giữ con trỏ ở một dòng hỏng
    // giữa file thì mọi lượt phía sau nó được thu lại ở MỌI job resume cùng
    // session — vòng lặp vẫn chạy tiếp, nên lượt vừa trả về cũng chính là lượt
    // lần sau trả về lần nữa.
    const rows = [FX_CLI[0], '{"type":"assistant","mess', FX_CLI[2], FX_CLI[3]]
    writeLines(rows)

    const first = await readNewToolCalls(file, 0)
    expect(first!.calls).toHaveLength(3)
    // 4 dòng vật lý, dòng hỏng ở index 1 — con trỏ phải vượt qua hết.
    expect(first!.totalLines).toBe(4)

    // Job thứ hai trên cùng transcript không đổi: 0 lượt mới, không ghi lặp.
    const second = await readNewToolCalls(file, first!.totalLines)
    expect(second!.calls).toHaveLength(0)
    expect(second!.totalLines).toBe(4)
  })

  test('TC-D06c: 🆕 dòng hỏng giữa file + dòng cuối dở dang → con trỏ dừng ở dòng cuối', async () => {
    // Hai ca trên không loại trừ nhau: dòng hỏng giữa file bị bỏ qua, dòng cuối
    // dở dang vẫn phải giữ được con trỏ.
    writeLines([FX_CLI[0], '{"type":"assistant","mess', FX_CLI[2], '{"type":"assist'], {
      trailingNewline: false,
    })
    const result = await readNewToolCalls(file, 0)
    expect(result!.calls).toHaveLength(2)
    expect(result!.totalLines).toBe(3)
  })

  test('TC-D07: dòng rỗng giữa file bị skip, số lượt không đổi', async () => {
    writeLines([FX_CLI[0], '', FX_CLI[2], FX_CLI[3]])
    const result = await readNewToolCalls(file, 0)
    expect(result).not.toBeNull()
    expect(result!.calls).toHaveLength(3)
  })

  test('TC-D08: file không tồn tại → null (KHÁC với mảng rỗng)', async () => {
    const result = await readNewToolCalls(path.join(dir, 'khong-co.jsonl'), 0)
    expect(result).toBeNull()
  })

  test('TC-D09: ưu tiên khoá text theo thứ tự command → pattern → file_path → query', async () => {
    writeLines([
      {
        type: 'assistant',
        timestamp: '2026-09-30T03:00:00.000Z',
        message: {
          content: [
            { type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } },
            { type: 'tool_use', name: 'Grep', input: { pattern: 'foo' } },
            { type: 'tool_use', name: 'Read', input: { file_path: '/a/b.ts' } },
            { type: 'tool_use', name: 'WebSearch', input: { query: 'zod' } },
          ],
        },
      },
    ])
    const result = await readNewToolCalls(file, 0)
    expect(result!.calls.map((c) => c.text)).toEqual(['ls -la', 'foo', '/a/b.ts', 'zod'])
  })

  test('TC-D10: input không có khoá nào trong danh sách → JSON.stringify', async () => {
    const input = { foo: 1, bar: 'x' }
    writeLines([
      {
        type: 'assistant',
        timestamp: '2026-09-30T03:00:00.000Z',
        message: { content: [{ type: 'tool_use', name: 'Weird', input }] },
      },
    ])
    const result = await readNewToolCalls(file, 0)
    expect(result!.calls[0].text).toBe(JSON.stringify(input))
    expect(result!.calls[0].text).not.toBe('')
    expect(textOfToolInput(input)).toBe(JSON.stringify(input))
  })

  test('TC-D11: ⚠️ giữ nguyên xuống dòng (heredoc không bị cắt còn dòng đầu)', async () => {
    const command = `cd /repo && bun <<'EOF'\nconst x = 1  // grep\nconsole.log("cat")\nEOF\ngrep -n done out.txt`
    writeLines([
      {
        type: 'assistant',
        timestamp: '2026-09-30T04:00:00.000Z',
        message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] },
      },
    ])
    const result = await readNewToolCalls(file, 0)
    expect(result!.calls[0].text).toBe(command)
    expect(result!.calls[0].text.split('\n')).toHaveLength(5)
  })

  test('TC-D12: file rỗng → 0 lượt, totalLines 0, không throw', async () => {
    fs.writeFileSync(file, '')
    const result = await readNewToolCalls(file, 0)
    expect(result).not.toBeNull()
    expect(result!.calls).toHaveLength(0)
    // Con trỏ phải đứng ở 0: đặt nó ở 1 thì dòng đầu tiên CLI ghi sau đó không
    // bao giờ được đọc.
    expect(result!.totalLines).toBe(0)
  })

  test('TC-D13: fromLine lớn hơn số dòng hiện có (file bị xoay/rút ngắn)', async () => {
    writeLines(FX_CLI)
    const result = await readNewToolCalls(file, 999)
    expect(result).not.toBeNull()
    expect(result!.calls).toHaveLength(0)
    expect(result!.totalLines).toBe(4)
  })
})
