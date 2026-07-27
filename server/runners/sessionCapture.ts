import crypto from 'node:crypto'

export type SessionCaptureMode = 'preset-uuid' | 'parse-json' | 'none'

export interface CursorJsonOutput {
  session_id?: string
  result?: string
}

/** Parse cursor-agent JSON stdout; tolerates leading/trailing whitespace. */
export function parseCursorJsonOutput(stdout: string): CursorJsonOutput {
  const trimmed = stdout.trim()
  if (!trimmed) return {}
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    return {
      session_id: typeof parsed.session_id === 'string' ? parsed.session_id : undefined,
      result: typeof parsed.result === 'string' ? parsed.result : undefined,
    }
  } catch {
    return {}
  }
}

/** Build cursor headless argv with JSON output for session capture. */
export function buildCursorJsonArgs(flags: string[], prompt: string): string[] {
  const base = Array.isArray(flags) ? [...flags] : []
  if (!base.includes('-p')) base.push('-p')
  if (!base.some((f) => f === '--output-format' || f.startsWith('--output-format='))) {
    base.push('--output-format', 'json')
  }
  base.push(prompt)
  return base
}

/** Mint a v4 UUID for Claude `--session-id`. */
export function mintSessionId(): string {
  return crypto.randomUUID()
}

export interface SessionPrepareInput {
  capture: SessionCaptureMode
  sessionId?: string
  resumeSessionId?: string
}

export interface SessionPrepareResult {
  sessionId?: string
  resumeSessionId?: string
  /** Pre-assigned id for preset-uuid capture before spawn. */
  presetSessionId?: string
}

/**
 * Map ExecuteRequest session fields + capture mode into provider invocation
 * fields. preset-uuid generates an id when starting fresh.
 */
export function prepareSessionInvocation(input: SessionPrepareInput): SessionPrepareResult {
  if (input.capture === 'none') {
    return {
      sessionId: input.sessionId,
      resumeSessionId: input.resumeSessionId,
    }
  }

  if (input.resumeSessionId || (input.sessionId && input.capture !== 'preset-uuid')) {
    return {
      resumeSessionId: input.resumeSessionId || input.sessionId,
    }
  }

  if (input.capture === 'preset-uuid') {
    const preset = input.sessionId || mintSessionId()
    return { sessionId: preset, presetSessionId: preset }
  }

  // parse-json: session id arrives after CLI exits — no preset.
  return {}
}
