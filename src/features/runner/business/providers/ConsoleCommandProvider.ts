import type { CredentialProfile } from '../types.js'
import { formatJobLogHeader } from '../jobLogFormat.js'
import { NoMcpDelivery } from '../mcpDelivery/NoMcpDelivery.js'
import type {
  ExecuteRequest,
  ExecuteResult,
  ProviderCatalogInfo,
  RunnerProvider,
  TranscriptFormat,
} from './RunnerProvider.js'
import { formatProcessFailure, runCliProcess, type ProcResult } from './cliProcess.js'
import { collectProducedArtifacts, createJobLogAppender, describeExecuteResult, jobLogHeaderMeta } from './providerJobReport.js'

/**
 * Split a free-form command-line string into argv tokens.
 * Supports single/double quotes; backslash escapes the next character.
 * Empty / whitespace-only input → [].
 */
export function splitCommandArgs(input: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: "'" | '"' | null = null
  let escaped = false
  for (const ch of input) {
    if (escaped) {
      cur += ch
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur)
        cur = ''
      }
      continue
    }
    cur += ch
  }
  if (escaped) cur += '\\'
  if (cur) out.push(cur)
  return out
}

export interface ConsoleInvocationInput {
  flags?: string[]
  /** Extra argv from the job prompt — shell-split, not wrapped as one blob. */
  userPrompt?: string
}

export interface ConsoleInvocation {
  args: string[]
}

/** Pure builder: `cliPath [...flags] [...split(userPrompt)]` — no AI agent flags. */
export function buildConsoleInvocation(input: ConsoleInvocationInput): ConsoleInvocation {
  const flags = Array.isArray(input.flags) ? input.flags.map(String) : []
  const extra = input.userPrompt?.trim() ? splitCommandArgs(input.userPrompt.trim()) : []
  return { args: [...flags, ...extra] }
}

function describePayload(opts: {
  workspace: string
  cliPath: string
  args: string[]
  userPrompt: string
  metadata?: Record<string, unknown>
}): string {
  const meta = opts.metadata || {}
  const lines = [
    formatJobLogHeader({
      jobId: String(meta.jobId || ''),
      providerId: 'console-command',
      ...jobLogHeaderMeta(meta),
      workspace: opts.workspace,
      mode: 'console-command',
    }).trimEnd(),
    '=== Payload gửi cho runner ===',
    'Mode: console-command (argv thuần, không agent / allowedTools)',
    `Workspace: ${opts.workspace}`,
    `CLI: ${[opts.cliPath, ...opts.args].join(' ')}`,
  ]
  if (opts.userPrompt.trim()) {
    lines.push('--- Extra args (từ prompt) ---', opts.userPrompt.trim())
  }
  lines.push('', '=== Phản hồi của runner (stdout/stderr) ===', '')
  return lines.join('\n')
}

/**
 * Generic local console command — spawn `cliPath` with connection flags +
 * shell-split job prompt as argv. Does not inject AI agent system prompts,
 * `-p`, or `--allowedTools`.
 */
export class ConsoleCommandProvider implements RunnerProvider {
  readonly providerId = 'console-command'
  readonly family = 'console-command' as const
  /** Lệnh console không phải agent AI — jobQueue bỏ qua agentRef, không ghép system prompt. */
  readonly acceptsAgent = false
  readonly mcpDelivery = new NoMcpDelivery()
  readonly transcriptFormat: TranscriptFormat = 'none'
  readonly catalog: ProviderCatalogInfo = {
    kind: 'local-console',
    label: 'Console command',
    modelListing: 'none',
  }

  validateRunnerConfig(config: Record<string, unknown> | undefined) {
    const errors: string[] = []
    if (!config?.cliPath) errors.push('cliPath is required')
    return { ok: errors.length === 0, errors }
  }

  validateCredential(_profile?: CredentialProfile) {
    // local-console jobs use an implicit cli-session credential — nothing to validate.
    return { ok: true, errors: [] }
  }

  capabilities() {
    return {
      supportsAgentFile: false,
      supportsStreaming: false,
      maxConcurrency: 1,
    }
  }

  async execute(
    req: ExecuteRequest,
    runnerConfig: Record<string, any>,
    _credential: CredentialProfile,
    onLog?: (chunk: string) => void,
    onStart?: (info: { pid: number | null }) => void,
  ): Promise<ExecuteResult> {
    const started = Date.now()
    const cliPath = String(runnerConfig.cliPath || 'sh')
    const flags = Array.isArray(runnerConfig.flags) ? runnerConfig.flags.map(String) : []
    // Ignore resolvedAgent.systemPrompt — console commands are not AI agents.
    const { args } = buildConsoleInvocation({ flags, userPrompt: req.userPrompt || '' })

    const logPath = req.metadata?.logPath as string | undefined
    const appendLog = createJobLogAppender(logPath)

    appendLog(
      describePayload({
        workspace: req.workspace,
        cliPath,
        args,
        userPrompt: req.userPrompt || '',
        metadata: req.metadata,
      }),
    )

    const wrappedOnLog = (chunk: string) => {
      onLog?.(chunk)
      appendLog(chunk)
    }

    const timeoutMs = req.timeoutMs || runnerConfig.timeoutMs || 600_000
    let procResult: ProcResult
    try {
      procResult = await runCliProcess(cliPath, args, {
        cwd: req.workspace,
        env: { ...process.env },
        timeoutMs,
        stdin: 'ignore',
        onLog: wrappedOnLog,
        onStart,
      })
    } catch (err: any) {
      const result: ExecuteResult = {
        ok: false,
        exitCode: null,
        durationMs: Date.now() - started,
        logPath,
        error: String(err.message || err),
      }
      appendLog(describeExecuteResult(result))
      return result
    }

    const artifactsFound = collectProducedArtifacts(req.workspace, req.produces)

    const ok = procResult.exitCode === 0 && !procResult.killed
    const result: ExecuteResult = {
      ok,
      exitCode: procResult.exitCode,
      durationMs: Date.now() - started,
      logPath,
      artifactsFound,
      error: ok ? undefined : formatProcessFailure(procResult, timeoutMs),
      timedOut: procResult.killed,
      stdout: procResult.stdout,
    }
    appendLog(describeExecuteResult(result))
    return result
  }
}
