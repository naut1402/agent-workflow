// Tbefa5f4c · Nhóm E (TC-E01 … TC-E10) — adapter `agent-sdk-sessions` (F5).
//
// KHÔNG phải nhánh hiếm: 131 job đo được chạy trên provider không phải
// `claude-code-cli`, và `request.md` nói rõ phạm vi gồm cả job từ khung chat.
// Vì vậy nhóm này phủ ngang nhóm D.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  agentSdkSessionPath,
  readSessionToolCalls,
} from '../../../../src/features/runner/business/agentSdkToolCalls.js'
import { registryHome } from '../../../../src/backend/registry.js'

let home: string
let prevHome: string | undefined

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-sdk-sessions-'))
  prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

/** Ghi `agent-sdk-sessions/<id>.json` — `raw` cho phép dựng JSON hỏng. */
function writeSession(sessionId: string, body: unknown, raw?: string): string {
  const dir = path.join(registryHome(), 'agent-sdk-sessions')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${sessionId}.json`)
  fs.writeFileSync(file, raw ?? JSON.stringify(body))
  return file
}

describe('Nhóm E — readSessionToolCalls (agent-sdk-sessions)', () => {
  test('TC-E01: shape OpenAI — `arguments` parse rồi lấy khoá `command`', async () => {
    writeSession('s-1', {
      sessionId: 's-1',
      messages: [
        { role: 'assistant', tool_calls: [{ function: { name: 'Bash', arguments: '{"command":"ls -la"}' } }] },
      ],
    })
    const calls = await readSessionToolCalls('s-1')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ name: 'Bash', at: null, text: 'ls -la', sidechain: false })
  })

  test('TC-E02: shape Anthropic — block `tool_use`', async () => {
    writeSession('s-2', {
      sessionId: 's-2',
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'Bash', input: { command: 'grep -rn foo src' } }],
        },
      ],
    })
    const calls = await readSessionToolCalls('s-2')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ name: 'Bash', at: null, text: 'grep -rn foo src', sidechain: false })
  })

  test('TC-E03: hai shape trong cùng file, giữ đúng thứ tự mảng', async () => {
    writeSession('s-3', {
      messages: [
        { role: 'assistant', tool_calls: [{ function: { name: 'Bash', arguments: '{"command":"ls -la"}' } }] },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'foo' } }],
        },
        { role: 'assistant', tool_calls: [{ function: { name: 'Read', arguments: '{"file_path":"/a.ts"}' } }] },
      ],
    })
    const calls = await readSessionToolCalls('s-3')
    expect(calls.map((c) => c.name)).toEqual(['Bash', 'Grep', 'Read'])
    expect(calls.map((c) => c.text)).toEqual(['ls -la', 'foo', '/a.ts'])
  })

  test('TC-E04: `arguments` không parse được → dùng nguyên chuỗi, không throw', async () => {
    writeSession('s-4', {
      messages: [{ role: 'assistant', tool_calls: [{ function: { name: 'Bash', arguments: '{command:' } }] }],
    })
    const calls = await readSessionToolCalls('s-4')
    expect(calls).toHaveLength(1)
    expect(calls[0].text).toBe('{command:')
  })

  test('TC-E05: `at` luôn null — file này không giữ mốc thời gian từng lượt', async () => {
    writeSession('s-5', {
      messages: [
        { role: 'assistant', tool_calls: [{ function: { name: 'Bash', arguments: '{"command":"ls"}' } }] },
        { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'pwd' } }] },
      ],
    })
    const calls = await readSessionToolCalls('s-5')
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((c) => c.at === null)).toBe(true)
  })

  test('TC-E06: file không tồn tại → [] (không throw)', async () => {
    expect(await readSessionToolCalls('chua-co')).toEqual([])
  })

  test('TC-E07: file JSON hỏng → [] (không throw)', async () => {
    writeSession('s-7', null, '{"messages":')
    expect(await readSessionToolCalls('s-7')).toEqual([])
  })

  test('TC-E08: ⚠️ sessionId không được thoát thư mục', async () => {
    // File mồi đặt NGOÀI `agent-sdk-sessions/` — nếu lọt vào kết quả thì adapter
    // đã đọc ngoài thư mục của mình.
    const decoy = {
      messages: [{ role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'MOI' } }] }],
    }
    fs.writeFileSync(path.join(home, 'passwd.json'), JSON.stringify(decoy))
    fs.mkdirSync(path.join(registryHome(), 'agent-sdk-sessions', 'a'), { recursive: true })
    fs.writeFileSync(
      path.join(registryHome(), 'agent-sdk-sessions', 'a', 'b.json'),
      JSON.stringify(decoy),
    )

    for (const bad of ['../../etc/passwd', '../passwd', 'a/b', 'a\\b', 'x\0y']) {
      expect(agentSdkSessionPath(bad)).toBeNull()
      expect(await readSessionToolCalls(bad)).toEqual([])
    }
  })

  test('TC-E09: message không có lượt tool nào → []', async () => {
    writeSession('s-9', {
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'hi' }] }],
    })
    expect(await readSessionToolCalls('s-9')).toEqual([])
  })

  test('TC-E10: thứ tự mảng = thứ tự thời gian (bigram ở nhóm J dựa vào đây)', async () => {
    writeSession('s-10', {
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'cat a.md' } }] },
        { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'grep x b.md' } }] },
        { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'cat c.md' } }] },
      ],
    })
    const calls = await readSessionToolCalls('s-10')
    expect(calls.map((c) => c.text)).toEqual(['cat a.md', 'grep x b.md', 'cat c.md'])
  })
})
