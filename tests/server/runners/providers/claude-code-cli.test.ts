import { describe, expect, test } from 'bun:test'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildClaudeInvocation,
  createLocalConsoleProvider,
} from '../../../../server/runners/providers/claude-code-cli.js'
import type { CredentialProfile, ResolvedAgent } from '../../../../server/runners/types.js'

// Runs the shared local-console provider against real short-lived shell
// scripts — no node:child_process mocking convention exists in this codebase
// (see runners.test.ts) — so the job-log structure (payload / runner response
// / result sections) is verified against actual process output, not a mocked
// stdout string.

const credential: CredentialProfile = {
  id: 'cli-session-implicit',
  provider: 'claude-code-cli',
  label: 'CLI session',
  secretRef: 'cli-session',
}

const resolvedAgent: ResolvedAgent = {
  ref: 'project/quick-action-improve-doc',
  name: 'Improve doc',
  description: '',
  systemPrompt: '',
  skills: [],
  model: 'test-model',
}

function fakeCliPath(): string {
  return path.join(import.meta.dir, 'fakeCli.mjs')
}

function nodeCli(mode: string): { cliPath: string; flags: string[] } {
  return { cliPath: process.execPath, flags: [fakeCliPath(), mode] }
}

function makeLogPath(home: string): string {
  const jobsDir = path.join(home, 'jobs')
  fs.mkdirSync(jobsDir, { recursive: true })
  const logPath = path.join(jobsDir, `${crypto.randomUUID()}.log`)
  fs.writeFileSync(logPath, '', 'utf8')
  return logPath
}

describe('createLocalConsoleProvider — job log structure', () => {
  test('success: log has payload, runner response, and result sections', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-provider-'))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-workspace-'))
    try {
      const { cliPath, flags } = nodeCli('hello')
      const logPath = makeLogPath(home)

      const provider = createLocalConsoleProvider({
        providerId: 'claude-code-cli',
        defaultCliPath: cliPath,
        claudeStyleArgs: false,
      })

      const result = await provider.execute(
        {
          jobId: 'job-1',
          resolvedAgent,
          userPrompt: 'Cải thiện tài liệu design.md',
          workspace,
          produces: [],
          timeoutMs: 5000,
          metadata: { logPath },
        },
        { cliPath, flags },
        credential,
      )

      expect(result.ok).toBe(true)
      expect(result.exitCode).toBe(0)

      const log = fs.readFileSync(logPath, 'utf8')
      expect(log).toContain('=== Payload gửi cho runner ===')
      expect(log).toContain('Agent: project/quick-action-improve-doc')
      expect(log).toContain(`Workspace: ${workspace}`)
      expect(log).toContain('--- Prompt ---')
      expect(log).toContain('Cải thiện tài liệu design.md')
      expect(log).toContain('=== Phản hồi của runner (stdout/stderr) ===')
      expect(log).toContain('hello from runner')
      expect(log).toContain('=== Kết quả ===')
      expect(log).toContain('ok: true')
      expect(log).toContain('exitCode: 0')

      // Payload is written before the response section, which precedes the result footer.
      const payloadIdx = log.indexOf('=== Payload')
      const responseIdx = log.indexOf('=== Phản hồi')
      const resultIdx = log.indexOf('=== Kết quả')
      expect(payloadIdx).toBeLessThan(responseIdx)
      expect(responseIdx).toBeLessThan(resultIdx)
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  // Regression: prompt must NOT be delivered as an argv element. On Windows the
  // provider spawns with shell:true (to run the claude.cmd shim), and Node does
  // not quote argv under shell:true there — cmd.exe would split a multi-line
  // prompt on whitespace so `claude -p` only received the first token ("Bạn").
  // The prompt now goes on stdin instead.
  test('claude style: prompt delivered on stdin, never in argv', async () => {
    const multiLinePrompt =
      'Bạn đang ở thư mục task U0005-4.\n' +
      'Đọc file design.md rồi cải thiện phần mô tả.\n' +
      'Nhiều dòng có dấu cách tiếng Việt.'

    const invocation = buildClaudeInvocation({
      flags: ['--bare'],
      prompt: multiLinePrompt,
      allowedTools: 'Read,Edit',
      dangerouslySkipPermissions: true,
      sessionId: 'sess-123',
    })

    // Prompt lives only on stdin.
    expect(invocation.stdinInput).toBe(multiLinePrompt)
    // No argv element contains or equals the prompt (nor any of its tokens
    // that would leak content).
    for (const arg of invocation.args) {
      expect(arg).not.toBe(multiLinePrompt)
      expect(arg.includes('thư mục')).toBe(false)
    }
    // Flags/values are intact and in order; `-p` is a bare print-mode flag.
    expect(invocation.args).toEqual([
      '--bare',
      '-p',
      '--allowedTools',
      'Read,Edit',
      '--dangerously-skip-permissions',
      '--session-id',
      'sess-123',
    ])
  })

  test('claude style: resume session id is emitted (mutually exclusive with session-id)', () => {
    const invocation = buildClaudeInvocation({
      flags: [],
      prompt: 'nội dung bất kỳ',
      resumeSessionId: 'resume-xyz',
    })
    expect(invocation.args).toEqual(['-p', '--resume', 'resume-xyz'])
    expect(invocation.stdinInput).toBe('nội dung bất kỳ')
  })

  // Real spawn, cross-platform (no `claude` needed): use node itself as the
  // fake CLI, pointing at a tiny script that echoes its argv and everything it
  // read from stdin. Proves the multi-line Vietnamese prompt arrives on stdin
  // in full and never leaks into argv. FAILS with the old code (prompt was
  // args=[...,'-p',prompt]); PASSES after the stdin fix — OS-independent.
  test('integration: real spawn pipes full multi-line prompt to stdin, not argv', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-provider-'))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-workspace-'))
    try {
      // Fake CLI written to a .mjs file (avoids -e inline-quoting hazards).
      const fakeCli = path.join(home, 'fake-cli.mjs')
      fs.writeFileSync(
        fakeCli,
        [
          "process.stdout.write('ARGV:' + JSON.stringify(process.argv.slice(2)) + '\\n')",
          "let data = ''",
          "process.stdin.setEncoding('utf8')",
          "process.stdin.on('data', (c) => { data += c })",
          "process.stdin.on('end', () => {",
          "  process.stdout.write('STDIN_START\\n' + data + '\\nSTDIN_END\\n')",
          '})',
          '',
        ].join('\n'),
        'utf8',
      )

      const multiLinePrompt =
        'Bạn đang ở thư mục task U0005-4.\n' +
        'Đọc file design.md rồi cải thiện phần mô tả.\n' +
        'Nhiều dòng có dấu cách tiếng Việt.'

      const provider = createLocalConsoleProvider({
        providerId: 'claude-code-cli',
        defaultCliPath: process.execPath,
        claudeStyleArgs: true,
      })

      let output = ''
      const result = await provider.execute(
        {
          jobId: 'job-stdin',
          resolvedAgent,
          userPrompt: multiLinePrompt,
          workspace,
          produces: [],
          timeoutMs: 10000,
        },
        // flags = [fakeCli] → spawn `node <fakeCli> -p ...`; node runs the
        // script and passes the remaining flags through as its argv.
        { cliPath: process.execPath, flags: [fakeCli] },
        credential,
        (chunk) => {
          output += chunk
        },
      )

      expect(result.ok).toBe(true)
      expect(result.exitCode).toBe(0)

      // Whole prompt arrived on stdin — every line, verbatim.
      expect(output).toContain('STDIN_START')
      expect(output).toContain('STDIN_END')
      expect(output).toContain(multiLinePrompt)
      for (const line of multiLinePrompt.split('\n')) {
        expect(output).toContain(line)
      }

      // argv carries only flags — no prompt content leaked in.
      const argvLine = output.split('\n').find((l) => l.startsWith('ARGV:'))
      expect(argvLine).toBeTruthy()
      const argv = JSON.parse(argvLine!.slice('ARGV:'.length)) as string[]
      expect(argv).toContain('-p')
      expect(argv.some((a) => a === multiLinePrompt)).toBe(false)
      expect(argv.some((a) => a.includes('thư mục'))).toBe(false)
      expect(argv.some((a) => a.includes('Đọc'))).toBe(false)
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('failure: result section records exitCode + error from stderr', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-provider-'))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-workspace-'))
    try {
      const { cliPath, flags } = nodeCli('fail')
      const logPath = makeLogPath(home)

      const provider = createLocalConsoleProvider({
        providerId: 'claude-code-cli',
        defaultCliPath: cliPath,
        claudeStyleArgs: false,
      })

      const result = await provider.execute(
        {
          jobId: 'job-2',
          resolvedAgent,
          userPrompt: 'Task sẽ fail',
          workspace,
          produces: [],
          timeoutMs: 5000,
          metadata: { logPath },
        },
        { cliPath, flags },
        credential,
      )

      expect(result.ok).toBe(false)
      expect(result.exitCode).toBe(1)
      expect(result.error).toContain('boom')

      const log = fs.readFileSync(logPath, 'utf8')
      expect(log).toContain('=== Kết quả ===')
      expect(log).toContain('ok: false')
      expect(log).toContain('exitCode: 1')
      expect(log).toContain('error: boom')
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('spawn error (bad cliPath): result footer still appended with the error', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-provider-'))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-workspace-'))
    try {
      const badCliPath = path.join(home, 'does-not-exist-binary')
      const logPath = makeLogPath(home)

      const provider = createLocalConsoleProvider({
        providerId: 'claude-code-cli',
        defaultCliPath: badCliPath,
        claudeStyleArgs: false,
      })

      const result = await provider.execute(
        {
          jobId: 'job-3',
          resolvedAgent,
          userPrompt: 'Task với cliPath sai',
          workspace,
          produces: [],
          timeoutMs: 5000,
          metadata: { logPath },
        },
        { cliPath: badCliPath, flags: [] },
        credential,
      )

      expect(result.ok).toBe(false)
      expect(result.exitCode == null || result.exitCode === 1).toBe(true)
      expect(result.error).toBeTruthy()

      const log = fs.readFileSync(logPath, 'utf8')
      expect(log).toContain('=== Payload gửi cho runner ===')
      expect(log).toContain('=== Kết quả ===')
      expect(log).toContain('ok: false')
      expect(log).toContain('exitCode:')
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})
