import { describe, expect, test } from 'bun:test'
import { mintMcpToken, resolveMcpToken, revokeMcpTokensFor } from '../../../../src/features/orchestrator/business/mcpTokens.js'

// Lớp dữ liệu dưới cùng của xác thực kênh MCP (TC-09/TC-10): token → `TaskRef`,
// vòng đời gắn với job orchestrator — không dùng JWT (design §3.3).

describe('mintMcpToken / resolveMcpToken', () => {
  test('token vừa mint resolve đúng ref đã đưa vào', () => {
    const ref = { taskId: 'A1', root: '/tmp/root-a', projectId: 'p1' }
    const token = mintMcpToken(ref)
    expect(resolveMcpToken(token)).toEqual(ref)
  })

  test('hai lần mint cho cùng ref ⇒ hai token khác nhau (không tái dùng)', () => {
    const ref = { taskId: 'A2', root: '/tmp/root-a', projectId: '' }
    const t1 = mintMcpToken(ref)
    const t2 = mintMcpToken(ref)
    expect(t1).not.toBe(t2)
    expect(resolveMcpToken(t1)).toEqual(ref)
    expect(resolveMcpToken(t2)).toEqual(ref)
  })

  test('token không tồn tại/bịa ra ⇒ null', () => {
    expect(resolveMcpToken('token-bia-dat-hoan-toan')).toBeNull()
  })
})

describe('revokeMcpTokensFor', () => {
  test('thu hồi đúng token của (root, taskId) — không đụng token của task khác', () => {
    const refA = { taskId: 'B1', root: '/tmp/root-b', projectId: '' }
    const refB = { taskId: 'B2', root: '/tmp/root-b', projectId: '' }
    const tokenA = mintMcpToken(refA)
    const tokenB = mintMcpToken(refB)

    revokeMcpTokensFor(refA)

    expect(resolveMcpToken(tokenA)).toBeNull()
    expect(resolveMcpToken(tokenB)).toEqual(refB)
  })

  // TC-08 ở lớp dữ liệu: taskId trùng tên nhưng khác root là hai entry riêng biệt.
  test('taskId trùng tên nhưng khác root ⇒ thu hồi root này không đụng root kia', () => {
    const refX = { taskId: 'SAME', root: '/tmp/root-x', projectId: '' }
    const refY = { taskId: 'SAME', root: '/tmp/root-y', projectId: '' }
    const tokenX = mintMcpToken(refX)
    const tokenY = mintMcpToken(refY)

    revokeMcpTokensFor(refX)

    expect(resolveMcpToken(tokenX)).toBeNull()
    expect(resolveMcpToken(tokenY)).toEqual(refY)
  })

  test('thu hồi khi chưa từng mint ⇒ không throw', () => {
    expect(() => revokeMcpTokensFor({ taskId: 'khong-ton-tai', root: '/tmp/khong-ton-tai' })).not.toThrow()
  })
})
