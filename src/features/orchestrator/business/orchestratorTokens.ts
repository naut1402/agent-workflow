import { randomBytes } from 'node:crypto'
import type { TaskRef } from './decisionLoop.js'

// xem docs/architecture/code/orchestrator.md §8
const tokens = new Map<string, TaskRef>()

export function mintOrchestratorToken(ref: TaskRef): string {
  const token = randomBytes(24).toString('base64url')
  tokens.set(token, ref)
  return token
}

export function resolveOrchestratorToken(token: string): TaskRef | null {
  return tokens.get(token) ?? null
}

export function revokeOrchestratorTokensFor(ref: { root: string; taskId: string }): void {
  for (const [token, r] of tokens) {
    if (r.root === ref.root && r.taskId === ref.taskId) tokens.delete(token)
  }
}
