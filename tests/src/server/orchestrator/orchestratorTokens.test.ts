import { describe, expect, test } from 'bun:test'
import {
  mintOrchestratorToken,
  resolveOrchestratorToken,
  revokeOrchestratorTokensFor,
} from '../../../../src/features/orchestrator/business/orchestratorTokens.js'

// Lớp dữ liệu dưới cùng của xác thực API REST (TC-09/TC-10): token → `TaskRef`,
// vòng đời gắn với job orchestrator — không dùng JWT (design §3.3).

describe('mintOrchestratorToken / resolveOrchestratorToken', () => {
  test('token vừa mint resolve đúng ref đã đưa vào', () => {
    const ref = { taskId: 'A1', root: '/tmp/root-a', projectId: 'p1' }
    const token = mintOrchestratorToken(ref)
    expect(resolveOrchestratorToken(token)).toEqual(ref)
  })

  test('hai lần mint cho cùng ref ⇒ hai token khác nhau (không tái dùng)', () => {
    const ref = { taskId: 'A2', root: '/tmp/root-a', projectId: '' }
    const t1 = mintOrchestratorToken(ref)
    const t2 = mintOrchestratorToken(ref)
    expect(t1).not.toBe(t2)
    expect(resolveOrchestratorToken(t1)).toEqual(ref)
    expect(resolveOrchestratorToken(t2)).toEqual(ref)
  })

  test('token không tồn tại/bịa ra ⇒ null', () => {
    expect(resolveOrchestratorToken('token-bia-dat-hoan-toan')).toBeNull()
  })
})

describe('revokeOrchestratorTokensFor', () => {
  test('thu hồi đúng token của (root, taskId) — không đụng token của task khác', () => {
    const refA = { taskId: 'B1', root: '/tmp/root-b', projectId: '' }
    const refB = { taskId: 'B2', root: '/tmp/root-b', projectId: '' }
    const tokenA = mintOrchestratorToken(refA)
    const tokenB = mintOrchestratorToken(refB)

    revokeOrchestratorTokensFor(refA)

    expect(resolveOrchestratorToken(tokenA)).toBeNull()
    expect(resolveOrchestratorToken(tokenB)).toEqual(refB)
  })

  // TC-08 ở lớp dữ liệu: taskId trùng tên nhưng khác root là hai entry riêng biệt.
  test('taskId trùng tên nhưng khác root ⇒ thu hồi root này không đụng root kia', () => {
    const refX = { taskId: 'SAME', root: '/tmp/root-x', projectId: '' }
    const refY = { taskId: 'SAME', root: '/tmp/root-y', projectId: '' }
    const tokenX = mintOrchestratorToken(refX)
    const tokenY = mintOrchestratorToken(refY)

    revokeOrchestratorTokensFor(refX)

    expect(resolveOrchestratorToken(tokenX)).toBeNull()
    expect(resolveOrchestratorToken(tokenY)).toEqual(refY)
  })

  test('thu hồi khi chưa từng mint ⇒ không throw', () => {
    expect(() => revokeOrchestratorTokensFor({ taskId: 'khong-ton-tai', root: '/tmp/khong-ton-tai' })).not.toThrow()
  })
})
