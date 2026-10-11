import { spawn } from '../../../../backend/lib/processHelper.js'

/**
 * Tiến trình con cục bộ của provider chạy lệnh (Agent CLI, console command):
 * spawn, gom stdout/stderr, timeout và dựng thông điệp lỗi.
 */

export interface ProcResult {
  exitCode: number | null
  stdout: string
  stderr: string
  killed: boolean
}

export interface RunCliProcessOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  /** `'ignore'` ⇒ không mở stdin (console command); `'pipe'` ⇒ ghi `stdinInput` (nếu có) rồi đóng. */
  stdin: 'pipe' | 'ignore'
  onLog?: (chunk: string) => void
  onStart?: (info: { pid: number | null }) => void
  /** When set, written to the child's stdin (then stdin is closed) instead of
   * being passed as an argv element. Required for the claude headless prompt:
   * on Windows we must spawn with `shell: true` (to run the `claude.cmd` shim,
   * see CVE-2024-27980), but Node does NOT quote argv elements under
   * `shell: true` on Windows — it space-joins them for cmd.exe, so a
   * multi-line/whitespace prompt in argv gets split and `claude -p` only
   * receives the first token. Piping the prompt via stdin sidesteps quoting
   * entirely (`cat prompt | claude -p`). */
  stdinInput?: string
}

export function runCliProcess(cliPath: string, args: string[], options: RunCliProcessOptions): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, {
      cwd: options.cwd,
      env: options.env,
      // win32: shell:true runs the .cmd shim; child.pid is cmd.exe — cancel must
      // use taskkill /T to kill the whole tree (see jobQueue cancelJob).
      shell: process.platform === 'win32',
      stdio: [options.stdin, 'pipe', 'pipe'],
    })

    options.onStart?.({ pid: child.pid ?? null })

    if (options.stdinInput != null && child.stdin) {
      // Guard against EPIPE / write-after-end (e.g. the CLI exits before
      // draining stdin) so a broken pipe never leaves the Promise hanging or
      // crashes the process with an unhandled 'error'.
      child.stdin.on('error', () => {
        /* ignore broken pipe — close/error handlers below settle the Promise */
      })
      child.stdin.end(options.stdinInput)
    } else {
      child.stdin?.end()
    }

    let stdout = ''
    let stderr = ''
    const onLog = options.onLog

    child.stdout?.on('data', (chunk) => {
      const text = String(chunk)
      stdout += text
      onLog?.(text)
    })
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk)
      stderr += text
      onLog?.(text)
    })

    let killed = false
    const timer =
      options.timeoutMs > 0
        ? setTimeout(() => {
            killed = true
            child.kill('SIGTERM')
          }, options.timeoutMs)
        : null

    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })

    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ exitCode: killed ? -1 : code, stdout, stderr, killed })
    })
  })
}

/** Thông điệp lỗi của lần chạy thất bại: timeout, rồi stderr/stdout (≤ 1000 ký tự), rồi exit code. */
export function formatProcessFailure(procResult: ProcResult, timeoutMs: number): string {
  if (procResult.killed) return `process timed out after ${timeoutMs}ms`
  const fromStreams = [procResult.stderr, procResult.stdout].filter(Boolean).join('\n').trim()
  if (fromStreams) return fromStreams.slice(0, 1000)
  return `exit code ${procResult.exitCode ?? 'unknown'}`
}

