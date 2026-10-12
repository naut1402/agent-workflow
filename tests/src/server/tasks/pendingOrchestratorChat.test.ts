import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  hasPendingOrchestratorChat,
  queueOrchestratorChat,
  takeOrchestratorChat,
} from '../../../../src/features/monitor/business/tasks/state.js'

/*
 * Ted0cf9ac — hàng chờ tin nhắn của nút điều phối (`pending_orchestrator_chat`,
 * D3/D5). Bề mặt chấm: file `.dev-state/<task>.json`.
 *
 * Khác `pending_feedback` của step (ghi đè): ở đây NỐI, giữ đúng thứ tự gửi, và
 * `prepend` trả lại tin đã lấy ra mà chưa gửi được về ĐẦU hàng (TC-22, TC-25).
 */

let root: string

function stateFile(taskId: string) {
  return path.join(root, '.dev-state', `${taskId}.json`)
}
function seed(taskId: string, state: Record<string, unknown> = {}) {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.writeFileSync(stateFile(taskId), JSON.stringify({ task_id: taskId, current_phase: 'x', ...state }), 'utf8')
}
function read(taskId: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(stateFile(taskId), 'utf8'))
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-pending-orch-chat-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('queueOrchestratorChat — nối, không ghi đè', () => {
  test('ba lần nối ⇒ đúng thứ tự gửi, queuedAt giữ mốc lần đầu, field khác của state không đổi', async () => {
    seed('Q1', { pending_feedback: { feedback: 'F1', stepId: 's' } })
    expect(await queueOrchestratorChat(root, 'Q1', ['M1'])).toBe(true)
    const firstAt = read('Q1').pending_orchestrator_chat.queuedAt
    await queueOrchestratorChat(root, 'Q1', ['M2'])
    await queueOrchestratorChat(root, 'Q1', ['M3'])
    const st = read('Q1')
    expect(st.pending_orchestrator_chat.messages).toEqual(['M1', 'M2', 'M3'])
    expect(st.pending_orchestrator_chat.queuedAt).toBe(firstAt)
    // TC-24: hàng chờ của step không bị đụng.
    expect(st.pending_feedback).toEqual({ feedback: 'F1', stepId: 's' })
    expect(st.current_phase).toBe('x')
  })

  test('prepend ⇒ tin trả lại đứng TRƯỚC tin mới đến trong lúc đó', async () => {
    seed('Q2')
    await queueOrchestratorChat(root, 'Q2', ['M3'])
    await queueOrchestratorChat(root, 'Q2', ['M1', 'M2'], { prepend: true })
    expect(read('Q2').pending_orchestrator_chat.messages).toEqual(['M1', 'M2', 'M3'])
  })

  test('không có .dev-state ⇒ false, không tạo file', async () => {
    expect(await queueOrchestratorChat(root, 'NOPE', ['M1'])).toBe(false)
    expect(fs.existsSync(stateFile('NOPE'))).toBe(false)
  })

  test('nối đồng thời nhiều tin ⇒ không mất tin nào (khoá state file)', async () => {
    seed('Q3')
    await Promise.all(Array.from({ length: 20 }, (_, i) => queueOrchestratorChat(root, 'Q3', [`M${i}`])))
    const msgs = read('Q3').pending_orchestrator_chat.messages as string[]
    expect(msgs).toHaveLength(20)
    expect(new Set(msgs).size).toBe(20)
  })
})

describe('takeOrchestratorChat / hasPendingOrchestratorChat', () => {
  test('lấy hết rồi xoá; lần lấy sau rỗng (TC-23)', async () => {
    seed('T1')
    await queueOrchestratorChat(root, 'T1', ['M1', 'M2'])
    expect(hasPendingOrchestratorChat(read('T1'))).toBe(true)
    expect(await takeOrchestratorChat(root, 'T1')).toEqual(['M1', 'M2'])
    expect(read('T1').pending_orchestrator_chat).toBeNull()
    expect(hasPendingOrchestratorChat(read('T1'))).toBe(false)
    expect(await takeOrchestratorChat(root, 'T1')).toEqual([])
  })

  test('file bị sửa tay: phần tử không phải string / rỗng bị bỏ khi đọc', async () => {
    seed('T2', { pending_orchestrator_chat: { messages: ['M1', 42, '', '   ', null, 'M2'], queuedAt: 'x' } })
    expect(hasPendingOrchestratorChat(read('T2'))).toBe(true)
    expect(await takeOrchestratorChat(root, 'T2')).toEqual(['M1', 'M2'])
  })

  test('messages không phải mảng / field thiếu ⇒ coi như rỗng', async () => {
    seed('T3', { pending_orchestrator_chat: { messages: 'M1' } })
    expect(hasPendingOrchestratorChat(read('T3'))).toBe(false)
    expect(await takeOrchestratorChat(root, 'T3')).toEqual([])
    expect(hasPendingOrchestratorChat({})).toBe(false)
    expect(await takeOrchestratorChat(root, 'NOPE')).toEqual([])
  })
})
