/**
 * Shared job-log framing (header/footer) so LogsPanel shows clear job context.
 */

export interface JobLogHeaderInput {
  jobId: string
  providerId?: string
  runnerId?: string
  connectionId?: string
  projectId?: string
  taskId?: string
  stepId?: string
  sessionId?: string | null
  resumeSessionId?: string | null
  workspace?: string
  startedAt?: string
  mode?: string
}

export function formatJobLogHeader(input: JobLogHeaderInput): string {
  const lines = [
    '=== Job metadata ===',
    `jobId: ${input.jobId}`,
    `startedAt: ${input.startedAt || new Date().toISOString()}`,
  ]
  if (input.mode) lines.push(`mode: ${input.mode}`)
  if (input.providerId) lines.push(`provider: ${input.providerId}`)
  if (input.runnerId) lines.push(`runnerId: ${input.runnerId}`)
  if (input.connectionId) lines.push(`connectionId: ${input.connectionId}`)
  if (input.projectId) lines.push(`projectId: ${input.projectId}`)
  if (input.taskId) lines.push(`taskId: ${input.taskId}`)
  if (input.stepId) lines.push(`stepId: ${input.stepId}`)
  if (input.sessionId) lines.push(`sessionId: ${input.sessionId}`)
  if (input.resumeSessionId) lines.push(`resumeSessionId: ${input.resumeSessionId}`)
  if (input.workspace) lines.push(`workspace: ${input.workspace}`)
  lines.push('')
  return lines.join('\n')
}

export interface JobLogFooterInput {
  ok: boolean
  exitCode: number | null
  durationMs: number
  sessionId?: string | null
  error?: string
  artifactsFound?: string[]
  tokenUsage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    estimated?: boolean
  }
}

export function formatJobLogFooter(input: JobLogFooterInput): string {
  const lines = [
    '',
    '=== Kết quả ===',
    `ok: ${input.ok}`,
    `exitCode: ${input.exitCode ?? 'null'}`,
    `durationMs: ${input.durationMs}`,
  ]
  if (input.sessionId) lines.push(`sessionCaptured: ${input.sessionId}`)
  if (input.artifactsFound?.length) lines.push(`artifactsFound: ${input.artifactsFound.join(', ')}`)
  if (input.tokenUsage) {
    const u = input.tokenUsage
    const parts = [
      u.inputTokens != null ? `in=${u.inputTokens}` : null,
      u.outputTokens != null ? `out=${u.outputTokens}` : null,
      u.totalTokens != null ? `total=${u.totalTokens}` : null,
      u.estimated ? 'estimated' : null,
    ].filter(Boolean)
    if (parts.length) lines.push(`tokenUsage: ${parts.join(' ')}`)
  }
  if (input.error) lines.push(`error: ${input.error}`)
  return lines.join('\n') + '\n'
}
