import { spawn } from '../../../../backend/lib/processHelper.js'

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
  // xem docs/architecture/code/runner.md §14
  /** Written to the child's stdin (then stdin is closed) instead of being passed in argv. */
  stdinInput?: string
}

export function runCliProcess(cliPath: string, args: string[], options: RunCliProcessOptions): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, {
      cwd: options.cwd,
      env: options.env,
      // xem docs/architecture/code/runner.md §15
      shell: process.platform === 'win32',
      stdio: [options.stdin, 'pipe', 'pipe'],
    })

    options.onStart?.({ pid: child.pid ?? null })

    if (options.stdinInput != null && child.stdin) {
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

