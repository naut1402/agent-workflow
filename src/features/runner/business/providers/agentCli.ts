/**
 * Agent CLI family — Claude / Cursor / Codex (and future AI CLIs).
 * Distinct from `console-command` (argv-only, never default AI runner).
 */

import type { RunnerProvider, ExecuteResult, ExecuteRequest, ProviderFamily } from '../types.js'

export type { ProviderFamily }

/** Built-in Agent CLI provider ids. */
export const AGENT_CLI_PROVIDER_IDS = [
  'claude-code-cli',
  'cursor-cli',
  'codex-cli',
] as const

export type AgentCliProviderId = (typeof AGENT_CLI_PROVIDER_IDS)[number]

export interface AgentCliCapabilities {
  supportsAgentFile: boolean
  supportsStreaming: boolean
  maxConcurrency: number
  /** How session ids are obtained (mirrors SessionCaptureMode). */
  sessionCapture: 'preset-uuid' | 'parse-json' | 'none'
  /** Whether this provider can supply token usage in ExecuteResult. */
  supportsTokenUsage: boolean
}

/** Agent CLI providers implement RunnerProvider plus family metadata. */
export interface AgentCliProvider extends RunnerProvider {
  family: 'agent-cli'
  agentCapabilities(): AgentCliCapabilities
}

export function isAgentCliProviderId(providerId: string): boolean {
  return (AGENT_CLI_PROVIDER_IDS as readonly string[]).includes(providerId)
}

export function isAgentCliProvider(provider: RunnerProvider | null | undefined): provider is AgentCliProvider {
  if (!provider) return false
  const candidate = provider as Partial<AgentCliProvider>
  if (typeof candidate.agentCapabilities !== 'function') return false
  if (candidate.family === 'agent-cli') return true
  return isAgentCliProviderId(provider.providerId)
}

export function providerFamilyOf(providerId: string): ProviderFamily {
  if (providerId === 'console-command') return 'console-command'
  if (providerId === 'anthropic-api' || providerId.endsWith('-api')) return 'ai-api'
  if (isAgentCliProviderId(providerId)) return 'agent-cli'
  return 'console-command'
}

/** Token usage optionally returned by Agent CLI execute(). */
export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  totalTokens?: number
  model?: string
  /** Heuristic estimate when CLI does not report usage. */
  estimated?: boolean
}

export type ExecuteResultWithUsage = ExecuteResult & { tokenUsage?: TokenUsage }

export type { ExecuteRequest }
