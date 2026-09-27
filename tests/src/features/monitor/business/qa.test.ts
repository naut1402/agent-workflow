import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createQa } from '../../../../../src/features/monitor/business/tasks/qa'

let dirs: string[] = []
async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-'))
  dirs.push(d)
  return d
}
afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })))
  dirs = []
})

describe('createQa', () => {
  test('tạo qa.md mới đúng khuôn chọn-đáp-án (TC-A1)', async () => {
    const root = await tmp()
    const res = await createQa(root, 'T1', {
      questions: [{ prompt: 'Chọn màu?', choices: ['Đỏ', 'Xanh'] }],
    })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('unreachable')
    expect(res.created).toBe(1)
    const content = await fs.readFile(res.path, 'utf8')
    expect(content).toBe('## Q1\nChọn màu?\n\n**Lựa chọn:**\n- A. Đỏ\n- B. Xanh\n\n**Trả lời:**\n')
  })

  test('gọi 2 nguồn khác nhau (mô phỏng dashboard/MCP) cho ra cùng định dạng (TC-A2)', async () => {
    const root = await tmp()
    const question = { prompt: 'Tiếp tục?', choices: ['Có', 'Không'] }
    const a = await createQa(root, 'TA', { questions: [question] })
    const b = await createQa(root, 'TB', { questions: [question] })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (!a.ok || !b.ok) throw new Error('unreachable')
    const [contentA, contentB] = await Promise.all([
      fs.readFile(a.path, 'utf8'),
      fs.readFile(b.path, 'utf8'),
    ])
    expect(contentA).toBe(contentB)
  })

  test('append + tiếp số khi task đã có QA từ trước, không mất câu cũ (TC-A3)', async () => {
    const root = await tmp()
    const first = await createQa(root, 'T3', {
      questions: [{ prompt: 'Câu 1?', choices: ['A', 'B'] }],
    })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('unreachable')
    await fs.writeFile(first.path, `${(await fs.readFile(first.path, 'utf8')).trimEnd()}\n\n**Trả lời:** A\n`)

    const second = await createQa(root, 'T3', {
      questions: [{ prompt: 'Câu 2?', choices: ['C', 'D'] }],
    })
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error('unreachable')
    expect(second.created).toBe(1)

    const content = await fs.readFile(first.path, 'utf8')
    expect(content).toContain('## Q1\nCâu 1?')
    expect(content).toContain('**Trả lời:** A')
    expect(content).toContain('## Q2\nCâu 2?')
    expect(content.match(/^##\s+Q\d/gm)).toHaveLength(2)
  })

  test('câu hỏi <2 lựa chọn bị từ chối, không ghi file (TC-A4)', async () => {
    const root = await tmp()
    const res = await createQa(root, 'T4', {
      questions: [{ prompt: 'Chỉ 1 lựa chọn?', choices: ['A'] }],
    })
    expect(res.ok).toBe(false)
    await expect(fs.access(path.join(root, 'tasks', 'T4', 'qa.md'))).rejects.toThrow()
  })

  test('danh sách câu hỏi rỗng bị từ chối (TC-A5)', async () => {
    const root = await tmp()
    const res = await createQa(root, 'T5', { questions: [] })
    expect(res.ok).toBe(false)
    await expect(fs.access(path.join(root, 'tasks', 'T5'))).rejects.toThrow()
  })

  test('taskId path traversal bị từ chối, không ghi ra ngoài phạm vi task (TC-A6)', async () => {
    const root = await tmp()
    const res = await createQa(root, '../evil', {
      questions: [{ prompt: 'x?', choices: ['A', 'B'] }],
    })
    expect(res.ok).toBe(false)
    if (!('error' in res)) throw new Error('unreachable')
    expect(res.error).toBe('invalid task id')
    await expect(fs.access(path.join(root, 'tasks'))).rejects.toThrow()
  })
})
