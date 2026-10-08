import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildClaudeInvocation,
  createLocalConsoleProvider,
} from '../../../../../src/features/runner/business/providers/claude-code-cli.js'
import { upsertMcpServer } from '../../../../../src/features/mcp/business/registry.js'
import type { CredentialProfile, ResolvedAgent } from '../../../../../src/features/runner/business/types.js'

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
      // resolvedAgent.systemPrompt is empty — buildPrompt() must return userPrompt
      // untouched, so no path-convention preamble or "## Agent instructions" wrapper.
      expect(log).not.toContain('## Agent instructions')
      expect(log).not.toContain('Quy ước path')
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

  test('claude style: model is forwarded as --model when set', () => {
    const invocation = buildClaudeInvocation({
      flags: ['--bare'],
      prompt: 'nội dung bất kỳ',
      allowedTools: 'Read,Edit',
      dangerouslySkipPermissions: true,
      sessionId: 'sess-123',
      model: 'opus',
    })
    expect(invocation.args).toEqual([
      '--bare',
      '-p',
      '--allowedTools',
      'Read,Edit',
      '--dangerously-skip-permissions',
      '--model',
      'opus',
      '--session-id',
      'sess-123',
    ])
  })

  test('claude style: no model set → no --model in argv', () => {
    const invocation = buildClaudeInvocation({
      flags: [],
      prompt: 'nội dung bất kỳ',
      resumeSessionId: 'resume-xyz',
    })
    expect(invocation.args).not.toContain('--model')
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

  test('integration: runnerConfig.model is spawned as --model <value> in real argv', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-provider-'))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-workspace-'))
    try {
      const fakeCli = path.join(home, 'fake-cli.mjs')
      fs.writeFileSync(
        fakeCli,
        [
          "process.stdout.write('ARGV:' + JSON.stringify(process.argv.slice(2)) + '\\n')",
          'process.stdin.resume()',
          "process.stdin.on('end', () => process.exit(0))",
          '',
        ].join('\n'),
        'utf8',
      )

      const provider = createLocalConsoleProvider({
        providerId: 'claude-code-cli',
        defaultCliPath: process.execPath,
        claudeStyleArgs: true,
      })

      let output = ''
      const result = await provider.execute(
        {
          jobId: 'job-model',
          resolvedAgent,
          userPrompt: 'prompt bất kỳ',
          workspace,
          produces: [],
          timeoutMs: 10000,
        },
        { cliPath: process.execPath, flags: [fakeCli], model: 'opus' },
        credential,
        (chunk) => {
          output += chunk
        },
      )

      expect(result.ok).toBe(true)
      const argvLine = output.split('\n').find((l) => l.startsWith('ARGV:'))
      expect(argvLine).toBeTruthy()
      const argv = JSON.parse(argvLine!.slice('ARGV:'.length)) as string[]
      expect(argv).toContain('--model')
      expect(argv[argv.indexOf('--model') + 1]).toBe('opus')
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('regression: cursor/codex (non-claude-style) never receive --model even if runnerConfig.model is set', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-provider-'))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-workspace-'))
    try {
      const fakeCli = path.join(home, 'fake-cli.mjs')
      fs.writeFileSync(
        fakeCli,
        [
          "process.stdout.write('ARGV:' + JSON.stringify(process.argv.slice(2)) + '\\n')",
          'process.stdin.resume()',
          "process.stdin.on('end', () => process.exit(0))",
          '',
        ].join('\n'),
        'utf8',
      )

      const provider = createLocalConsoleProvider({
        providerId: 'cursor-cli',
        defaultCliPath: process.execPath,
        claudeStyleArgs: false,
      })

      let output = ''
      const result = await provider.execute(
        {
          jobId: 'job-cursor-model',
          resolvedAgent,
          userPrompt: 'prompt bất kỳ',
          workspace,
          produces: [],
          timeoutMs: 10000,
        },
        { cliPath: process.execPath, flags: [fakeCli], model: 'opus' },
        credential,
        (chunk) => {
          output += chunk
        },
      )

      expect(result.ok).toBe(true)
      const argvLine = output.split('\n').find((l) => l.startsWith('ARGV:'))
      expect(argvLine).toBeTruthy()
      const argv = JSON.parse(argvLine!.slice('ARGV:'.length)) as string[]
      expect(argv).not.toContain('--model')
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  // #177: cursor-cli used to put the prompt in argv; on Windows shell:true
  // that truncates to the first token ("##"), so nl-chat-builder only saw
  // "## Agent instructions". Prompt must go on stdin; --resume must be argv.
  test('cursor parse-json: prompt on stdin, --resume in argv, result extracted from JSON', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-provider-'))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-workspace-'))
    try {
      const fakeCli = path.join(home, 'fake-cursor.mjs')
      fs.writeFileSync(
        fakeCli,
        [
          "process.stdout.write('ARGV:' + JSON.stringify(process.argv.slice(2)) + '\\n')",
          "let data = ''",
          "process.stdin.setEncoding('utf8')",
          "process.stdin.on('data', (c) => { data += c })",
          "process.stdin.on('end', () => {",
          "  process.stdout.write('STDIN_START\\n' + data + '\\nSTDIN_END\\n')",
          "  process.stdout.write(JSON.stringify({",
          "    type: 'result', subtype: 'success', is_error: false,",
          "    result: '===DRAFT_READY===\\n```json\\n{\"taskId\":\"t1\",\"prompt\":\"p\"}\\n```',",
          "    session_id: 'captured-sess',",
          "  }) + '\\n')",
          '})',
          '',
        ].join('\n'),
        'utf8',
      )

      const multiLinePrompt =
        '## Agent instructions\n\nBạn là nl-chat-builder.\n\n## Task\n\nNgười dùng (lượt 1): tạo task cập nhật deploy'

      const provider = createLocalConsoleProvider({
        providerId: 'cursor-cli',
        defaultCliPath: process.execPath,
        claudeStyleArgs: false,
        sessionCapture: 'parse-json',
      })

      let output = ''
      const result = await provider.execute(
        {
          jobId: 'job-cursor-stdin',
          resolvedAgent,
          userPrompt: multiLinePrompt,
          workspace,
          produces: [],
          timeoutMs: 10000,
          resumeSessionId: 'prev-sess-99',
        },
        { cliPath: process.execPath, flags: [fakeCli] },
        credential,
        (chunk) => {
          output += chunk
        },
      )

      expect(result.ok).toBe(true)
      expect(result.exitCode).toBe(0)
      expect(result.sessionId).toBe('captured-sess')
      expect(result.stdout).toContain('===DRAFT_READY===')
      expect(result.stdout).toContain('"taskId":"t1"')

      expect(output).toContain(multiLinePrompt)
      expect(output).toContain('## Agent instructions')
      expect(output).toContain('Người dùng (lượt 1): tạo task cập nhật deploy')

      const argvLine = output.split('\n').find((l) => l.startsWith('ARGV:'))
      expect(argvLine).toBeTruthy()
      const argv = JSON.parse(argvLine!.slice('ARGV:'.length)) as string[]
      expect(argv).toContain('-p')
      expect(argv).toContain('--output-format')
      expect(argv).toContain('json')
      expect(argv).toContain('--trust')
      expect(argv).toContain('--resume')
      expect(argv).toContain('prev-sess-99')
      expect(argv.some((a) => a === multiLinePrompt)).toBe(false)
      expect(argv.some((a) => a.includes('Agent instructions'))).toBe(false)
      expect(argv.some((a) => a.includes('nl-chat-builder'))).toBe(false)
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

  test('timeout-kill: error is a clear timeout message, not raw CLI output', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-provider-'))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-workspace-'))
    try {
      const { cliPath, flags } = nodeCli('hang')
      const provider = createLocalConsoleProvider({
        providerId: 'claude-code-cli',
        defaultCliPath: cliPath,
        claudeStyleArgs: false,
      })

      const result = await provider.execute(
        {
          jobId: 'job-timeout',
          resolvedAgent,
          userPrompt: 'test',
          workspace,
          produces: [],
          timeoutMs: 150,
          metadata: {},
        },
        { cliPath, flags },
        credential,
      )

      expect(result.ok).toBe(false)
      expect(result.exitCode).toBe(-1)
      expect(result.timedOut).toBe(true)
      expect(result.error).toBe('process timed out after 150ms')
      expect(result.error).not.toContain('Execution error')
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

// Chat rounds resume the same agent's session, so the agent instructions are
// already in the conversation — re-sending them every message is noise.
describe('createLocalConsoleProvider — agent instructions on resume', () => {
  const agentWithPrompt: ResolvedAgent = { ...resolvedAgent, systemPrompt: 'BẠN LÀ AGENT DESIGNER' }

  async function runOnce(metadata: Record<string, unknown>, resumeSessionId?: string): Promise<string> {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-provider-preamble-'))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-workspace-preamble-'))
    try {
      const { cliPath, flags } = nodeCli('ok')
      const logPath = makeLogPath(home)
      const provider = createLocalConsoleProvider({
        providerId: 'claude-code-cli',
        defaultCliPath: cliPath,
        claudeStyleArgs: false,
      })
      await provider.execute(
        {
          jobId: 'job-preamble',
          resolvedAgent: agentWithPrompt,
          userPrompt: 'sửa lại phần A',
          workspace,
          produces: [],
          timeoutMs: 5000,
          metadata: { logPath, ...metadata },
          ...(resumeSessionId ? { resumeSessionId } : {}),
        },
        { cliPath, flags },
        credential,
      )
      return fs.readFileSync(logPath, 'utf8')
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  }

  test('a chat-feedback round on a resumed session sends only the message', async () => {
    const log = await runOnce({ isChatFeedback: true }, 'sess-1')
    expect(log).not.toContain('## Agent instructions')
    expect(log).not.toContain('BẠN LÀ AGENT DESIGNER')
    expect(log).toContain('sửa lại phần A')
  })

  test('a fresh run still sends the instructions', async () => {
    const log = await runOnce({})
    expect(log).toContain('## Agent instructions')
    expect(log).toContain('BẠN LÀ AGENT DESIGNER')
  })

  // #225 vấn đề 1: a real CLI child process runs with cwd=workspace (task folder), not
  // the repo root the agent markdown was written for — without the preamble the model
  // follows literal `.dev-team-agent/tasks/<id>/...` paths and writes one directory too
  // deep. Preamble must come before the agent's own instructions so the model reads it
  // first.
  test('a fresh run prepends the path-convention preamble before the agent instructions', async () => {
    const log = await runOnce({})
    expect(log).toContain('Quy ước path')
    expect(log).toContain('cwd')
    const preambleIdx = log.indexOf('Quy ước path')
    const agentInstructionsIdx = log.indexOf('## Agent instructions')
    const systemPromptIdx = log.indexOf('BẠN LÀ AGENT DESIGNER')
    expect(preambleIdx).toBeGreaterThan(-1)
    expect(preambleIdx).toBeGreaterThan(agentInstructionsIdx)
    expect(preambleIdx).toBeLessThan(systemPromptIdx)
  })

  test("a pipeline step resuming another step's session still sends them (different agent)", async () => {
    // No isChatFeedback: this is a run-step job, whose agent differs from the
    // agent that opened the session.
    const log = await runOnce({ pipelineStepId: 'implement' }, 'sess-1')
    expect(log).toContain('## Agent instructions')
  })

  test('isChatFeedback without a resumed session still sends them (nothing to inherit)', async () => {
    const log = await runOnce({ isChatFeedback: true })
    expect(log).toContain('## Agent instructions')
  })
})

// Bug A (test-spec.md TC-05…TC-14, bản REST v2) — orchestrator job cấp
// token/base URL cho tiến trình con qua ENV VAR (`buildChildEnv`), thay
// `--mcp-config` của bản MCP cũ (design §1/§4.2 bản v2). Real spawn (không
// mock child_process — không có cách nào trong codebase, xem comment đầu
// file), fake CLI echo cả argv lẫn 2 biến env quan tâm để chấm đúng giá trị
// thật đi qua OS.
describe('claude-code-cli — env token/base URL cho job orchestrator (Bug A)', () => {
  const savedEnv = { ...process.env }
  const SELF_BASE_URL = 'http://127.0.0.1:54999'

  afterEach(() => {
    process.env = { ...savedEnv }
  })

  function argvEnvEchoCli(home: string): string {
    const fakeCli = path.join(home, 'fake-cli-argv-env.mjs')
    fs.writeFileSync(
      fakeCli,
      [
        "process.stdout.write('ARGV:' + JSON.stringify(process.argv.slice(2)) + '\\n')",
        "process.stdout.write('ENV:' + JSON.stringify({",
        '  token: process.env.DASHBOARD_ORCHESTRATOR_TOKEN ?? null,',
        '  baseUrl: process.env.DASHBOARD_ORCHESTRATOR_BASE_URL ?? null,',
        "}) + '\\n')",
        'process.stdin.resume()',
        "process.stdin.on('end', () => process.exit(0))",
        '',
      ].join('\n'),
      'utf8',
    )
    return fakeCli
  }

  async function runWith(metadata: Record<string, unknown> | undefined, providerId = 'claude-code-cli') {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-provider-'))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-workspace-'))
    try {
      const fakeCli = argvEnvEchoCli(home)
      const provider = createLocalConsoleProvider({
        providerId,
        defaultCliPath: process.execPath,
        claudeStyleArgs: providerId === 'claude-code-cli',
      })

      let output = ''
      const result = await provider.execute(
        {
          jobId: 'job-orch-env',
          resolvedAgent,
          userPrompt: 'quyết định điều phối',
          workspace,
          produces: [],
          timeoutMs: 10000,
          metadata,
        },
        { cliPath: process.execPath, flags: [fakeCli] },
        credential,
        (chunk) => {
          output += chunk
        },
      )
      expect(result.ok).toBe(true)
      const argvLine = output.split('\n').find((l) => l.startsWith('ARGV:'))
      const envLine = output.split('\n').find((l) => l.startsWith('ENV:'))
      return {
        argv: JSON.parse(argvLine!.slice('ARGV:'.length)) as string[],
        env: JSON.parse(envLine!.slice('ENV:'.length)) as { token: string | null; baseUrl: string | null },
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  }

  test('job orchestrator đủ điều kiện ⇒ tiến trình con nhận đúng token + base URL qua env, KHÔNG qua argv', async () => {
    process.env.DEV_TEAM_SELF_BASE_URL = SELF_BASE_URL
    const { argv, env } = await runWith({ orchestratorJob: true, orchestratorToken: 'tok-abc-123' })

    expect(env.token).toBe('tok-abc-123')
    expect(env.baseUrl).toBe(SELF_BASE_URL)
    // Không còn `--mcp-config`/JSON nào trong argv — token/URL chỉ đi qua env.
    expect(argv).not.toContain('--mcp-config')
    expect(argv.some((a) => a.includes('tok-abc-123'))).toBe(false)
  })

  test('job step THƯỜNG (không phải orchestratorJob) ⇒ KHÔNG set 2 biến env', async () => {
    process.env.DEV_TEAM_SELF_BASE_URL = SELF_BASE_URL
    const { env } = await runWith({ pipelineStepId: 'implementer' })
    expect(env.token).toBeNull()
    expect(env.baseUrl).toBeNull()
  })

  test('orchestratorJob nhưng thiếu orchestratorToken ⇒ KHÔNG set 2 biến env', async () => {
    process.env.DEV_TEAM_SELF_BASE_URL = SELF_BASE_URL
    const { env } = await runWith({ orchestratorJob: true })
    expect(env.token).toBeNull()
    expect(env.baseUrl).toBeNull()
  })

  test('orchestratorJob + token nhưng server chưa biết base URL của chính nó ⇒ KHÔNG set 2 biến env', async () => {
    delete process.env.DEV_TEAM_SELF_BASE_URL
    const { env } = await runWith({ orchestratorJob: true, orchestratorToken: 'tok-xyz' })
    expect(env.token).toBeNull()
    expect(env.baseUrl).toBeNull()
  })

  // Khác biệt có chủ đích so với bản MCP cũ (từng gate riêng `claude-code-cli`,
  // TC-12 cũ khẳng định provider khác KHÔNG có kênh trực tiếp) — env injection
  // đặt ở tầng `execute()` DÙNG CHUNG cho cả 3 provider CLI (`createLocalConsoleProvider`),
  // nên giờ `cursor-cli`/`codex-cli` cũng nhận được token/base URL để tự chạy
  // shell command, không cần hỗ trợ riêng giao thức MCP.
  test('provider khác claude-code-cli (vd cursor-cli) cũng nhận được token/base URL qua env — áp dụng chung mọi provider CLI', async () => {
    process.env.DEV_TEAM_SELF_BASE_URL = SELF_BASE_URL
    const { env } = await runWith({ orchestratorJob: true, orchestratorToken: 'tok-abc-123' }, 'cursor-cli')
    expect(env.token).toBe('tok-abc-123')
    expect(env.baseUrl).toBe(SELF_BASE_URL)
  })
})

/**
 * TC-54…TC-61 · TC-98 · TC-99 — tiêu thụ MCP ở `claude-code-cli`.
 *
 * ⚠️ Provider này dùng chung cho CẢ 3 CLI, nên mọi job agent-cli (kể cả NL-chat
 * và mọi bước pipeline) đi qua đường dựng argv dưới đây. TC-54 so sánh MẢNG
 * ARGV ĐẦY ĐỦ chứ không dùng "chứa": đó là gate của bất biến "không bật MCP ⇒
 * argv không đổi một byte".
 */
describe('claude-code-cli — argv MCP (buildClaudeInvocation)', () => {
  const BASE_INPUT = {
    flags: ['--bare'],
    prompt: 'nội dung bất kỳ',
    allowedTools: 'Read,Edit',
    dangerouslySkipPermissions: true,
    sessionId: 'sess-123',
    model: 'opus',
  }
  /** argv hiện có, trước khi MCP tồn tại — giá trị tham chiếu của TC-54/55/56. */
  const ARGV_WITHOUT_MCP = [
    '--bare',
    '-p',
    '--allowedTools',
    'Read,Edit',
    '--dangerously-skip-permissions',
    '--model',
    'opus',
    '--session-id',
    'sess-123',
  ]

  // TC-54 — ⚠️ gate bắt buộc xanh
  test('TC-54: không có `mcpConfigPath` ⇒ argv HỆT như trước', () => {
    const invocation = buildClaudeInvocation(BASE_INPUT)
    expect(invocation.args).toEqual(ARGV_WITHOUT_MCP)
    expect(invocation.args).not.toContain('--mcp-config')
    expect(invocation.args).not.toContain('--strict-mcp-config')
  })

  // TC-55
  test('TC-55: `mcpConfigPath` rỗng hoặc không khai ⇒ coi như không có', () => {
    expect(buildClaudeInvocation({ ...BASE_INPUT, mcpConfigPath: '' }).args).toEqual(ARGV_WITHOUT_MCP)
    expect(buildClaudeInvocation({ ...BASE_INPUT, mcpConfigPath: undefined }).args).toEqual(ARGV_WITHOUT_MCP)
  })

  // TC-56
  test('TC-56: có `mcpConfigPath` ⇒ đúng cờ, đúng vị trí (trước `--model`)', () => {
    const configPath = path.join(os.tmpdir(), 'mcp-runtime', 'job-1.json')
    const args = buildClaudeInvocation({ ...BASE_INPUT, mcpConfigPath: configPath }).args

    expect(args).toEqual([
      '--bare',
      '-p',
      '--allowedTools',
      'Read,Edit',
      '--dangerously-skip-permissions',
      '--mcp-config',
      configPath,
      '--strict-mcp-config',
      '--model',
      'opus',
      '--session-id',
      'sess-123',
    ])
    // `--strict-mcp-config` đi kèm BẮT BUỘC: thiếu nó thì job còn ăn thêm MCP
    // server cấu hình sẵn trên máy chạy dashboard.
    expect(args.indexOf('--mcp-config')).toBeLessThan(args.indexOf('--model'))
    expect(args[args.indexOf('--mcp-config') + 1]).toBe(configPath)
    expect(args[args.indexOf('--mcp-config') + 2]).toBe('--strict-mcp-config')
  })
})

describe('claude-code-cli — execute() với MCP', () => {
  const CANARY = 'sk-CANARY-do-not-log-0123456789'
  const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

  let home: string
  let workspace: string

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mcp-exec-home-'))
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mcp-exec-ws-'))
    process.env.DEV_TEAM_DASHBOARD_HOME = home
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
    else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  function runtimeDir(): string {
    return path.join(home, 'mcp-runtime')
  }
  function runtimeFiles(): string[] {
    try {
      return fs.readdirSync(runtimeDir())
    } catch {
      return []
    }
  }
  function seedServer(id: string, env: Record<string, string> = {}) {
    upsertMcpServer({
      id,
      label: id,
      enabled: true,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', `@fake/${id}`],
      env,
    })
  }

  function mcpProvider(over: Partial<Parameters<typeof createLocalConsoleProvider>[0]> = {}) {
    return createLocalConsoleProvider({
      providerId: 'claude-code-cli',
      defaultCliPath: process.execPath,
      claudeStyleArgs: true,
      ...over,
    })
  }

  async function run(
    provider: ReturnType<typeof createLocalConsoleProvider>,
    runnerConfig: Record<string, any>,
    opts: { logPath?: string; onLog?: (c: string) => void; timeoutMs?: number; jobId?: string } = {},
  ) {
    return provider.execute(
      {
        jobId: opts.jobId ?? 'job-mcp-1',
        resolvedAgent,
        userPrompt: 'chạy thử',
        workspace,
        produces: [],
        timeoutMs: opts.timeoutMs ?? 10_000,
        metadata: opts.logPath ? { logPath: opts.logPath } : {},
      },
      runnerConfig,
      credential,
      opts.onLog,
    )
  }

  // TC-57 — E1: bất biến "không bật MCP ⇒ không file nào chạm đĩa"
  test('TC-57: connection không khai `mcpServers` ⇒ không file nào được sinh, log không nhắc MCP', async () => {
    seedServer('on1')
    const logPath = makeLogPath(home)
    const { cliPath, flags } = nodeCli('mcp-echo')

    const result = await run(mcpProvider(), { cliPath, flags }, { logPath })

    expect(result.ok).toBe(true)
    expect(fs.existsSync(runtimeDir())).toBe(false)
    expect(result.stdout).not.toContain('--mcp-config')
    const log = fs.readFileSync(logPath, 'utf8')
    expect(log).not.toContain('MCP')
  })

  // TC-58 — AC-3
  test('TC-58: có MCP ⇒ cờ vào argv thật, file tồn tại LÚC CHẠY và biến mất sau khi xong', async () => {
    seedServer('on1')
    const { cliPath, flags } = nodeCli('mcp-echo')

    const result = await run(mcpProvider(), { cliPath, flags, mcpServers: ['on1'] })

    expect(result.ok).toBe(true)
    // stdout của fake CLI = argv thật mà tiến trình con nhận được.
    const argv = result.stdout!.trim().split('\n')
    const idx = argv.indexOf('--mcp-config')
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(argv[idx + 2]).toBe('--strict-mcp-config')
    expect(argv).toContain('mcp-config-exists=true')

    // Dọn ở `finally` — sau khi execute trả về, không còn file nào.
    expect(runtimeFiles()).toEqual([])
  })

  // TC-59 — E4: dọn ở MỌI đường thoát
  test('TC-59 (a): job thoát mã khác 0 ⇒ vẫn dọn, kết quả lỗi giữ nguyên ngữ nghĩa', async () => {
    seedServer('on1')
    const { cliPath, flags } = nodeCli('fail')

    const result = await run(mcpProvider(), { cliPath, flags, mcpServers: ['on1'] })

    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.error).toContain('boom')
    expect(runtimeFiles()).toEqual([])
  })

  test('TC-59 (b): `runProcess` ném ⇒ vẫn dọn, ExecuteResult mang lỗi', async () => {
    seedServer('on1')
    const cliPath = path.join(home, 'khong-ton-tai-binary')

    const result = await run(mcpProvider(), { cliPath, flags: [], mcpServers: ['on1'] })

    expect(result.ok).toBe(false)
    expect(result.exitCode).toBeNull()
    expect(String(result.error).length).toBeGreaterThan(0)
    expect(runtimeFiles()).toEqual([])
  })

  test('TC-59 (c): job bị giết giữa chừng (timeout/cancel) ⇒ vẫn dọn', async () => {
    seedServer('on1')
    const { cliPath, flags } = nodeCli('hang')

    const result = await run(mcpProvider(), { cliPath, flags, mcpServers: ['on1'] }, { timeoutMs: 600 })

    expect(result.ok).toBe(false)
    expect(result.timedOut).toBe(true)
    expect(runtimeFiles()).toEqual([])
  }, 20_000)

  // TC-60 — G6
  test('TC-60: log job chỉ lộ id + đường dẫn, 🚫 không canary, 🚫 không nội dung file', async () => {
    seedServer('on1', { TOKEN: CANARY })
    const logPath = makeLogPath(home)
    const { cliPath, flags } = nodeCli('mcp-echo')

    await run(mcpProvider(), { cliPath, flags, mcpServers: ['on1'] }, { logPath })

    const log = fs.readFileSync(logPath, 'utf8')
    const mcpLines = log.split('\n').filter((l) => l.startsWith('[runner] MCP:'))
    expect(mcpLines).toHaveLength(1)
    expect(mcpLines[0]).toMatch(/^\[runner\] MCP: 1 server \(on1\) → .+job-.*\.json$/)
    expect(log).not.toContain(CANARY)
    // Nội dung JSON của file config không bao giờ được chép vào log.
    expect(log).not.toContain('"mcpServers"')
  })

  // TC-61 — E3
  test('TC-61: provider có delivery `unsupported` ⇒ argv không đổi, không file nào', async () => {
    seedServer('on1')
    const { cliPath, flags } = nodeCli('mcp-echo')

    const result = await run(
      mcpProvider({ mcpDelivery: 'unsupported' }),
      { cliPath, flags, mcpServers: ['on1'] },
    )

    expect(result.ok).toBe(true)
    const argv = result.stdout!.trim().split('\n')
    expect(argv).not.toContain('--mcp-config')
    expect(argv).not.toContain('--strict-mcp-config')
    expect(fs.existsSync(runtimeDir())).toBe(false)
  })

  /**
   * TC-98 / TC-99 — ⚠️ ca chống rò secret.
   *
   * TC-60 chỉ phủ dòng log do dashboard tự ghi; đường stdout/stderr của tiến
   * trình con là kênh khác, và `ExecuteResult.error` là kênh thứ ba (chảy vào
   * `jobs/<id>.json` + payload `job.failed` → events.jsonl → SSE). Ba ca không
   * thay thế nhau.
   */
  describe('TC-98 / TC-99: tiến trình con in canary ra stderr', () => {
    async function runLeaky() {
      seedServer('on1', { TOKEN: CANARY })
      const logPath = makeLogPath(home)
      const chunks: string[] = []
      const { cliPath, flags } = nodeCli('mcp-leak')
      const result = await run(
        mcpProvider(),
        { cliPath, flags, mcpServers: ['on1'] },
        { logPath, onLog: (c) => chunks.push(c) },
      )
      return { result, log: fs.readFileSync(logPath, 'utf8'), streamed: chunks.join('') }
    }

    test('TC-98: log job và `onLog` đều mask', async () => {
      const { log, streamed } = await runLeaky()

      expect(log).not.toContain(CANARY)
      expect(log).toContain('***')
      expect(log).toContain('401 Unauthorized: Bearer ***')
      expect(streamed).not.toContain(CANARY)
      expect(streamed).toContain('***')
    })

    /**
     * TC-SEC-49 ⭐ (#385 SEC-10) — bộ lọc mask CÓ TRẠNG THÁI giữ lại
     * `max(len(secret)) - 1` ký tự, nên 🚫 `flush()` ở nhánh LỖI là nuốt mất
     * đuôi log — đúng đoạn người dùng cần để biết job hỏng vì sao.
     *
     * Hai vế trong cùng một ca: (a) đuôi log có mặt ở cả `onLog` lẫn file log;
     * (b) dòng tổng kết kết quả đứng SAU đuôi đó — thứ tự dòng 🚫 đảo.
     */
    test('TC-SEC-49: tiến trình con lỗi giữa chừng ⇒ đuôi log 🚫 bị nuốt, thứ tự 🚫 đảo', async () => {
      seedServer('on1', { TOKEN: CANARY })
      const logPath = makeLogPath(home)
      const chunks: string[] = []
      const { cliPath, flags } = nodeCli('mcp-split-leak')

      const result = await run(
        mcpProvider(),
        { cliPath, flags, mcpServers: ['on1'] },
        { logPath, onLog: (c) => chunks.push(c) },
      )
      const streamed = chunks.join('')
      const log = fs.readFileSync(logPath, 'utf8')

      expect(result.ok).toBe(false)
      // (a) đuôi có mặt, và secret vắt qua HAI chunk vẫn 🚫 lọt mảnh nào.
      expect(streamed).toContain('DUOI-LOG-CUOI-CUNG')
      expect(log).toContain('DUOI-LOG-CUOI-CUNG')
      expect(streamed).not.toContain(CANARY)
      expect(log).not.toContain(CANARY)
      expect(log).not.toContain(CANARY.slice(0, 12))
      expect(log).toContain('401 Unauthorized: Bearer ***')
      // (b) dòng tổng kết nằm SAU đuôi log.
      expect(log.indexOf('DUOI-LOG-CUOI-CUNG')).toBeLessThan(log.indexOf('exitCode'))
    }, 20_000)

    /**
     * TC-SEC-50 (#385 SEC-11) — job 🚫 bật MCP ⇒ chuỗi log y hệt hành vi cũ.
     *
     * 📌 Khai rõ theo `test-spec.md` §2.3: 🚫 `mcpServers` **và** 🚫 `orchestratorJob`
     * (job điều phối tự gắn entry `dev-team-dashboard`, #453), nên bất biến thật
     * là *🚫 ids VÀ 🚫 extras*.
     *
     * Bề mặt đo: SỐ LẦN gọi `onLog` và NỘI DUNG từng chunk. Bộ lọc rỗng phải trả
     * nguyên chunk tức thì — giữ lại một ký tự thôi là hai chunk bị ghép làm một.
     */
    test('TC-SEC-50: 🚫 MCP, 🚫 orchestratorJob ⇒ `onLog` nhận đúng từng chunk, 🚫 trễ', async () => {
      seedServer('on1', { TOKEN: CANARY })
      const chunks: string[] = []
      const { cliPath, flags } = nodeCli('two-chunks')

      const result = await provider0ChunkRun(cliPath, flags, chunks)

      expect(result.ok).toBe(true)
      expect(result.maskedStdout).toBeUndefined()
      // Hai lần ghi tách biệt ⇒ hai chunk riêng, 🚫 ghép, 🚫 giữ lại ký tự nào.
      expect(chunks.length).toBeGreaterThanOrEqual(2)
      expect(chunks.join('')).toContain('CHUNK-MOT\n')
      expect(chunks.join('')).toContain('CHUNK-HAI\n')
      expect(chunks.some((c) => c.includes('CHUNK-MOT') && !c.includes('CHUNK-HAI'))).toBe(true)
      expect(chunks.join('')).not.toContain('***')
    }, 20_000)

    /** Lượt chạy 🚫 khai `mcpServers` và 🚫 `orchestratorJob` — xem TC-SEC-50. */
    async function provider0ChunkRun(
      cliPath: string,
      flags: string[],
      chunks: string[],
    ) {
      return mcpProvider().execute(
        {
          jobId: 'job-no-mcp',
          resolvedAgent,
          userPrompt: 'chạy thử',
          workspace,
          produces: [],
          timeoutMs: 10_000,
          metadata: {},
        },
        { cliPath, flags },
        credential,
        (c: string) => chunks.push(c),
      )
    }

    test('TC-99: `ExecuteResult.error` cũng phải mask', async () => {
      const { result } = await runLeaky()

      expect(result.ok).toBe(false)
      expect(String(result.error).length).toBeGreaterThan(0)
      expect(result.error).toContain('***')
      expect(result.error).not.toContain(CANARY)
      // 🚫 Không assert gì về `result.stdout`: trường đó CỐ Ý để thô (payload
      // chức năng) — xem comment tại `claude-code-cli.ts` và `review.md` [imo].
    })
  })
})

/**
 * ═══ Tf2f484e2 · TC-D01 … TC-D06 — job điều phối thật sự có MCP ═════════════
 *
 * Bề mặt quan sát: argv thật mà tiến trình con nhận, NỘI DUNG file khai MCP lúc
 * chạy (fake CLI mode `mcp-dump` chép ra chỗ khác vì file bị dọn ở `finally`),
 * và log job.
 *
 * ⚠️ Đường này dùng chung cho MỌI job agent-CLI. TC-D03 là lý do duy nhất cho
 * phép đụng vào nó: nó chốt job thường không đổi một byte nào.
 */
describe('claude-code-cli — self-MCP cho job điều phối (Tf2f484e2)', () => {
  const TOKEN = 'orch-tok-CANARY-0123456789'
  const SELF_BASE_URL = 'http://127.0.0.1:54999'
  const SELF_ID = 'dev-team-dashboard'
  const REPO_ROOT = path.resolve(import.meta.dir, '../../../../..')

  const savedEnv = { ...process.env }
  let home: string
  let workspace: string
  let dumpPath: string

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-selfmcp-home-'))
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-selfmcp-ws-'))
    dumpPath = path.join(home, 'mcp-config-dump.json')
    process.env.DEV_TEAM_DASHBOARD_HOME = home
    process.env.DEV_TEAM_SELF_BASE_URL = SELF_BASE_URL
    process.env.MCP_CONFIG_DUMP = dumpPath
  })

  afterEach(() => {
    process.env = { ...savedEnv }
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  function runtimeDir(): string {
    return path.join(home, 'mcp-runtime')
  }

  function dumped(): any | null {
    try {
      return JSON.parse(fs.readFileSync(dumpPath, 'utf8'))
    } catch {
      return null
    }
  }

  /** Job điều phối mặc định — tuyến `mcp`, có token, base URL đã set ở env. */
  function orchestratorMeta(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      orchestratorJob: true,
      orchestratorMcpRoute: 'mcp',
      orchestratorToken: TOKEN,
      stepId: '__orchestrator__',
      ...over,
    }
  }

  async function runJob(
    metadata: Record<string, unknown>,
    runnerOver: Record<string, unknown> = {},
    opts: { logPath?: string; mode?: string } = {},
  ) {
    const { cliPath, flags } = nodeCli(opts.mode ?? 'mcp-dump')
    const provider = createLocalConsoleProvider({
      providerId: 'claude-code-cli',
      defaultCliPath: process.execPath,
      claudeStyleArgs: true,
    })
    const result = await provider.execute(
      {
        jobId: 'job-orch-mcp',
        resolvedAgent,
        userPrompt: 'quyết định điều phối',
        workspace,
        produces: [],
        timeoutMs: 15_000,
        metadata: opts.logPath ? { ...metadata, logPath: opts.logPath } : metadata,
      },
      { cliPath, flags, ...runnerOver },
      credential,
    )
    return { result, argv: String(result.stdout ?? '').trim().split('\n') }
  }

  // ── TC-D01 ────────────────────────────────────────────────────────────────
  test('TC-D01: tuyến `mcp` ⇒ argv có cờ, file khai mang entry dashboard mode full', async () => {
    const { result, argv } = await runJob(orchestratorMeta())
    expect(result.ok).toBe(true)

    // (a) cờ trỏ file khai, kèm `--strict-mcp-config` ngay sau.
    const idx = argv.indexOf('--mcp-config')
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(argv[idx + 2]).toBe('--strict-mcp-config')
    expect(argv).toContain('mcp-config-exists=true')

    // (b) entry `dev-team-dashboard` với mode `full` + token + base URL.
    const json = dumped()
    expect(Object.keys(json.mcpServers)).toEqual([SELF_ID])
    const entry = json.mcpServers[SELF_ID]
    expect(entry.type).toBe('stdio')
    expect(entry.env.DEVTEAM_MCP_MODE).toBe('full')
    expect(entry.env.DASHBOARD_ORCHESTRATOR_TOKEN).toBe(TOKEN)
    expect(entry.env.DASHBOARD_ORCHESTRATOR_BASE_URL).toBe(SELF_BASE_URL)
    // `env` giữ ở mức TỐI THIỂU: mọi giá trị ở đây bị gom vào danh sách mask,
    // nên khai thêm một đường dẫn là log nuốt mất đường dẫn đó (review [should]).
    expect(Object.keys(entry.env).sort()).toEqual([
      'DASHBOARD_ORCHESTRATOR_BASE_URL',
      'DASHBOARD_ORCHESTRATOR_TOKEN',
      'DEVTEAM_MCP_MODE',
    ])

    // (c) `command` + `args` trỏ entrypoint CÓ THẬT, và mode cũng khai trên argv
    // — `resolveMode` đọc argv TRƯỚC env nên đây mới là bảo đảm chắc chắn.
    expect(entry.command).toBe(process.execPath)
    expect(fs.existsSync(entry.args[0])).toBe(true)
    expect(path.resolve(entry.args[0])).toBe(path.join(REPO_ROOT, 'mcp', 'stdio.ts'))
    expect(entry.args).toContain('--mode=full')
  }, 30_000)

  // ── TC-D02 ────────────────────────────────────────────────────────────────
  test('TC-D02: tuyến `sentinel` / thiếu base URL / thiếu token ⇒ 🚫 không gắn gì, 🚫 không file nào chạm đĩa', async () => {
    const variants: Array<[string, () => Record<string, unknown>]> = [
      ['route sentinel', () => orchestratorMeta({ orchestratorMcpRoute: 'sentinel' })],
      ['thiếu token', () => orchestratorMeta({ orchestratorToken: undefined })],
      [
        'thiếu base URL',
        () => {
          delete process.env.DEV_TEAM_SELF_BASE_URL
          return orchestratorMeta()
        },
      ],
    ]
    for (const [label, build] of variants) {
      const { result, argv } = await runJob(build())
      expect(result.ok).toBe(true)
      expect(argv, label).not.toContain('--mcp-config')
      expect(argv, label).not.toContain('--strict-mcp-config')
      // Bất biến cũ: không khai server nào ⇒ không file nào chạm đĩa.
      expect(fs.existsSync(runtimeDir()), label).toBe(false)
      expect(dumped()).toBeNull()
      process.env.DEV_TEAM_SELF_BASE_URL = SELF_BASE_URL
    }
  }, 60_000)

  // ── TC-D03 ── guard: job THƯỜNG không đổi một chút nào ────────────────────
  test('TC-D03 (a): job step thường, runner KHÔNG khai mcpServers ⇒ argv + đĩa y như cũ', async () => {
    const logPath = makeLogPath(home)
    const { result, argv } = await runJob({ pipelineStepId: 'implementer' }, {}, { logPath })

    expect(result.ok).toBe(true)
    expect(argv).not.toContain('--mcp-config')
    expect(fs.existsSync(runtimeDir())).toBe(false)
    expect(fs.readFileSync(logPath, 'utf8')).not.toContain('MCP')
  }, 30_000)

  test('TC-D03 (b): job step thường, runner CÓ khai mcpServers ⇒ chỉ server người dùng, 🚫 không entry dashboard', async () => {
    upsertMcpServer({
      id: 'nguoi-dung',
      label: 'nguoi-dung',
      enabled: true,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@fake/nguoi-dung'],
      env: {},
    })
    const { result, argv } = await runJob({ pipelineStepId: 'implementer' }, { mcpServers: ['nguoi-dung'] })

    expect(result.ok).toBe(true)
    expect(argv).toContain('--mcp-config')
    expect(Object.keys(dumped().mcpServers)).toEqual(['nguoi-dung'])
    expect(dumped().mcpServers).not.toHaveProperty(SELF_ID)
  }, 30_000)

  test('TC-D03 (c): job điều phối tuyến `mcp` + runner có server riêng ⇒ CẢ HAI entry cùng vào file', async () => {
    upsertMcpServer({
      id: 'nguoi-dung',
      label: 'nguoi-dung',
      enabled: true,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@fake/nguoi-dung'],
      env: {},
    })
    const { result } = await runJob(orchestratorMeta(), { mcpServers: ['nguoi-dung'] })

    expect(result.ok).toBe(true)
    expect(Object.keys(dumped().mcpServers).sort()).toEqual([SELF_ID, 'nguoi-dung'].sort())
  }, 30_000)

  // ── TC-D04 ── trùng id với server người vận hành đã khai ──────────────────
  test('TC-D04: người dùng đã khai id `dev-team-dashboard` ⇒ đúng MỘT entry (của dashboard) + cảnh báo vào log', async () => {
    upsertMcpServer({
      id: SELF_ID,
      label: 'bản của người dùng',
      enabled: true,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@nguoi-dung/khac'],
      env: {},
    })
    const logPath = makeLogPath(home)
    const { result } = await runJob(orchestratorMeta(), { mcpServers: [SELF_ID] }, { logPath })

    expect(result.ok).toBe(true)
    // Map khoá theo id ⇒ 🚫 không cộng dồn: đúng một entry, và nó là của dashboard.
    const servers = dumped().mcpServers
    expect(Object.keys(servers)).toEqual([SELF_ID])
    expect(servers[SELF_ID].command).toBe(process.execPath)
    expect(servers[SELF_ID].env.DEVTEAM_MCP_MODE).toBe('full')

    // Ghi đè IM LẶNG là thứ không ai truy ngược được — phải có dòng log.
    const log = fs.readFileSync(logPath, 'utf8')
    expect(log).toContain('entry của người dùng bị entry tự gắn của dashboard ghi đè')
    expect(log).toContain(SELF_ID)
  }, 30_000)

  // ── TC-D05 ── token không lọt ra log dạng chữ rõ ──────────────────────────
  test('TC-D05: token đã mask trong log; file khai nằm trong thư mục dashboard, quyền chỉ chủ sở hữu', async () => {
    const logPath = makeLogPath(home)
    // Giữ lại file config để chấm quyền: `mcp-echo` không dọn, nhưng provider
    // dọn ở `finally`, nên quyền được chấm trên bản DUMP cùng thư mục + trên
    // chính thư mục `mcp-runtime` (không bị dọn).
    await runJob(orchestratorMeta(), {}, { logPath })

    const log = fs.readFileSync(logPath, 'utf8')
    expect(log.length).toBeGreaterThan(0)
    expect(log).not.toContain(TOKEN)
    // Dòng `[runner] MCP:` vẫn phải có (truy ngược được), chỉ là đã mask.
    expect(log).toContain('[runner] MCP:')
    expect(log).toContain(SELF_ID)
    // Nội dung file config 🚫 không bao giờ được chép vào log.
    expect(log).not.toContain('"mcpServers"')

    // Thư mục nằm dưới registryHome(), KHÔNG dưới workspace người dùng.
    expect(runtimeDir().startsWith(home)).toBe(true)
    expect(runtimeDir().startsWith(workspace)).toBe(false)
    if (process.platform !== 'win32') {
      expect(fs.statSync(runtimeDir()).mode & 0o777).toBe(0o700)
    }
  }, 30_000)

  test('TC-D05 (b): file khai có quyền 0600 LÚC CHẠY và biến mất sau khi job xong', async () => {
    // Quyền phải đúng lúc file còn sống — chấm sau khi job xong là chấm vào hư không.
    const probe = path.join(home, 'perm-probe.mjs')
    fs.writeFileSync(
      probe,
      [
        "import fs from 'node:fs'",
        "const i = process.argv.indexOf('--mcp-config')",
        'const f = i >= 0 ? process.argv[i + 1] : null',
        "process.stdout.write('MODE:' + (f ? (fs.statSync(f).mode & 0o777).toString(8) : 'none') + '\\n')",
        'process.stdin.resume()',
        "process.stdin.on('end', () => process.exit(0))",
        '',
      ].join('\n'),
      'utf8',
    )
    const provider = createLocalConsoleProvider({
      providerId: 'claude-code-cli',
      defaultCliPath: process.execPath,
      claudeStyleArgs: true,
    })
    const result = await provider.execute(
      {
        jobId: 'job-perm',
        resolvedAgent,
        userPrompt: 'x',
        workspace,
        produces: [],
        timeoutMs: 15_000,
        metadata: orchestratorMeta(),
      },
      { cliPath: process.execPath, flags: [probe] },
      credential,
    )
    expect(result.ok).toBe(true)
    if (process.platform !== 'win32') {
      expect(String(result.stdout)).toContain('MODE:600')
    }
    // Dọn ở `finally`: không còn file nào sau khi execute trả về.
    expect(fs.readdirSync(runtimeDir())).toEqual([])
  }, 30_000)

  // ── TC-D06 ── tương thích ngược với job ghi trước thay đổi này ────────────
  test('TC-D06: job metadata THIẾU khoá tuyến ⇒ xử như sentinel, 🚫 không gắn entry', async () => {
    const meta = orchestratorMeta()
    delete meta.orchestratorMcpRoute
    const { result, argv } = await runJob(meta)

    expect(result.ok).toBe(true)
    expect(argv).not.toContain('--mcp-config')
    expect(fs.existsSync(runtimeDir())).toBe(false)
  }, 30_000)

  // ── TC-F02 (ở cùng bề mặt runner) ── giá trị tuyến LẠ trong job file ──────
  test('TC-F02: giá trị `orchestratorMcpRoute` ngoài 2 giá trị hợp lệ ⇒ fail-safe về sentinel, 🚫 không ném', async () => {
    // File job là JSON tự do, không schema — người/công cụ khác sửa được.
    for (const bogus of ['MCP', 'mcp ', '', 'true', 0, null, {}, ['mcp']]) {
      const { result, argv } = await runJob(orchestratorMeta({ orchestratorMcpRoute: bogus }))
      expect(result.ok).toBe(true)
      expect(argv).not.toContain('--mcp-config')
      expect(fs.existsSync(runtimeDir())).toBe(false)
    }
  }, 90_000)
})

/**
 * ═══ #378 · Tdf943817 — cursor nhận MCP qua `<workspace>/.cursor/mcp.json` ═══
 *
 * TC-P5-05 (vế tích hợp) · TC-P5-22 · TC-P5-03 (vế tích hợp) · TC-P5-23.
 *
 * Bề mặt: argv THẬT mà tiến trình con nhận, sự tồn tại + NỘI DUNG file config
 * NGAY LÚC CHẠY (fake CLI chép ra chỗ khác vì file bị dọn ở `finally`), trạng
 * thái `<workspace>/.cursor/` sau khi job xong, và log job.
 */
describe('cursor-cli — MCP qua workspace config file (#378)', () => {
  const CURSOR_CANARY = 'sk-test-LEAKCANARY-0123456789'
  const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

  let home: string
  let workspace: string

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-cursor-exec-home-'))
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-cursor-exec-ws-'))
    process.env.DEV_TEAM_DASHBOARD_HOME = home
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
    else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
    delete process.env.CURSOR_CONFIG_DUMP
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  function cursorProvider() {
    return createLocalConsoleProvider({
      providerId: 'cursor-cli',
      defaultCliPath: process.execPath,
      claudeStyleArgs: false,
      sessionCapture: 'parse-json',
    })
  }

  function seedServer(id: string, env: Record<string, string> = {}) {
    upsertMcpServer({
      id,
      label: id,
      enabled: true,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', `@fake/${id}`],
      env,
    })
  }

  async function runCursor(
    runnerConfig: Record<string, any>,
    opts: { logPath?: string; onLog?: (c: string) => void } = {},
  ) {
    return cursorProvider().execute(
      {
        jobId: 'job-cursor-mcp',
        resolvedAgent,
        userPrompt: 'chạy thử',
        workspace,
        produces: [],
        timeoutMs: 10_000,
        metadata: opts.logPath ? { logPath: opts.logPath } : {},
      },
      runnerConfig,
      credential,
      opts.onLog,
    )
  }

  function argvOf(stdoutOrLog: string): string[] {
    const line = stdoutOrLog.split('\n').find((l) => l.startsWith('ARGV:'))
    if (!line) throw new Error('🚫 thấy dòng ARGV trong output')
    return JSON.parse(line.slice('ARGV:'.length)) as string[]
  }

  // TC-P5-05 ⭐ (vế tích hợp) · TC-P5-18 · TC-P5-21
  test('TC-P5-05: file tồn tại LÚC CHẠY, argv có `--approve-mcps` và 🚫 `--mcp-config`', async () => {
    seedServer('on1', { TOKEN: CURSOR_CANARY })
    const dump = path.join(home, 'cursor-config-dump.json')
    process.env.CURSOR_CONFIG_DUMP = dump
    const { cliPath, flags } = nodeCli('cursor-mcp-json')
    const chunks: string[] = []

    const result = await runCursor(
      { cliPath, flags, mcpServers: ['on1'] },
      { onLog: (c) => chunks.push(c) },
    )
    const output = chunks.join('')

    expect(result.ok).toBe(true)
    expect(output).toContain('cursor-config-exists=true')

    const argv = argvOf(output)
    expect(argv.filter((a) => a === '--approve-mcps')).toHaveLength(1)
    expect(argv).not.toContain('--mcp-config')
    expect(argv).not.toContain('--strict-mcp-config')
    // 🚫 Đường dẫn file config lọt vào argv ở bất kỳ dạng nào.
    expect(argv.some((a) => a.includes('.cursor'))).toBe(false)

    // Nội dung file lúc chạy là `{"mcpServers":{…}}` và mang giá trị ĐÃ GIẢI.
    const dumped = JSON.parse(fs.readFileSync(dump, 'utf8'))
    expect(Object.keys(dumped.mcpServers)).toEqual(['on1'])
    expect(JSON.stringify(dumped)).toContain(CURSOR_CANARY)

    // Dọn ở `finally` — workspace trở lại sạch.
    expect(fs.existsSync(path.join(workspace, '.cursor'))).toBe(false)
    expect(fs.readdirSync(workspace)).toEqual([])
  }, 20_000)

  /**
   * TC-P5-22 — dòng truy ngược. `--approve-mcps` ghi server vào danh sách phê
   * duyệt cục bộ `~/.cursor`, và tác dụng phụ đó TỒN TẠI SAU khi job kết thúc.
   * Đúng MỘT dòng: lặp lại là nhiễu, thiếu là người dùng 🚫 biết.
   */
  test('TC-P5-22: log có ĐÚNG 1 dòng truy ngược nêu workspace + tác dụng phụ ~/.cursor', async () => {
    seedServer('on1', { TOKEN: CURSOR_CANARY })
    const logPath = makeLogPath(home)
    const { cliPath, flags } = nodeCli('cursor-mcp-json')

    await runCursor({ cliPath, flags, mcpServers: ['on1'] }, { logPath })

    const log = fs.readFileSync(logPath, 'utf8')
    const mcpLines = log.split('\n').filter((l) => l.startsWith('[runner] MCP:'))
    // Hai dòng, mỗi dòng một việc: (1) dòng đếm/đường dẫn dùng chung với nhánh
    // claude, (2) dòng TRUY NGƯỢC riêng của cursor. Ca này khoá vế (2) là ĐÚNG MỘT.
    expect(mcpLines).toHaveLength(2)
    expect(mcpLines[0]).toMatch(/^\[runner\] MCP: 1 server \(on1\) → .+[/\\]\.cursor[/\\]mcp\.json$/)

    const traceLines = mcpLines.filter((l) => l.includes('--approve-mcps'))
    expect(traceLines).toHaveLength(1)
    expect(traceLines[0]).toContain('.cursor/mcp.json')
    expect(traceLines[0]).toContain('~/.cursor')
    expect(traceLines[0]).toContain('TỒN TẠI SAU')

    // TC-P5-23 — log 🚫 chứa canary, 🚫 chép nội dung file.
    expect(log).not.toContain(CURSOR_CANARY)
    expect(log).not.toContain('"mcpServers"')
  }, 20_000)

  /**
   * TC-P5-03 (vế tích hợp) — khai rõ `orchestratorJob !== true` **và** 🚫 `mcpServers`
   * ⇒ 🚫 ids VÀ 🚫 extras ⇒ argv 🚫 đổi một byte, 🚫 file nào chạm đĩa.
   */
  test('TC-P5-03: 🚫 MCP, 🚫 orchestratorJob ⇒ 🚫 `--approve-mcps`, 🚫 `.cursor`, 🚫 dòng log MCP', async () => {
    seedServer('on1')
    const logPath = makeLogPath(home)
    const { cliPath, flags } = nodeCli('cursor-mcp-json')
    const chunks: string[] = []

    const result = await runCursor({ cliPath, flags }, { logPath, onLog: (c) => chunks.push(c) })
    const output = chunks.join('')

    expect(result.ok).toBe(true)
    expect(output).toContain('cursor-config-exists=false')
    expect(argvOf(output)).not.toContain('--approve-mcps')
    expect(fs.existsSync(path.join(workspace, '.cursor'))).toBe(false)
    expect(fs.readdirSync(workspace)).toEqual([])
    expect(fs.readFileSync(logPath, 'utf8')).not.toContain('[runner] MCP:')
  }, 20_000)

  // TC-P5-13 (vế tích hợp) — job hỏng ⇒ `finally` vẫn dọn.
  test('TC-P5-13: tiến trình con lỗi ⇒ `.cursor` vẫn được dọn sạch', async () => {
    seedServer('on1', { TOKEN: CURSOR_CANARY })
    const { cliPath, flags } = nodeCli('fail')

    const result = await runCursor({ cliPath, flags, mcpServers: ['on1'] })

    expect(result.ok).toBe(false)
    expect(fs.existsSync(path.join(workspace, '.cursor'))).toBe(false)
    expect(fs.readdirSync(workspace)).toEqual([])
  }, 20_000)
})
