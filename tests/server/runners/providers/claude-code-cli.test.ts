import { describe, expect, test } from 'bun:test'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createLocalConsoleProvider } from '../../../../server/runners/providers/claude-code-cli.js'
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

function writeScript(dir: string, name: string, body: string): string {
  const file = path.join(dir, name)
  fs.writeFileSync(file, body, { mode: 0o755 })
  return file
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
      const script = writeScript(home, 'ok.sh', '#!/bin/sh\necho "hello from runner"\nexit 0\n')
      const logPath = makeLogPath(home)

      const provider = createLocalConsoleProvider({
        providerId: 'claude-code-cli',
        defaultCliPath: script,
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
        { cliPath: script, flags: [] },
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

  test('failure: result section records exitCode + error from stderr', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-provider-'))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-workspace-'))
    try {
      const script = writeScript(home, 'fail.sh', '#!/bin/sh\necho "boom" 1>&2\nexit 1\n')
      const logPath = makeLogPath(home)

      const provider = createLocalConsoleProvider({
        providerId: 'claude-code-cli',
        defaultCliPath: script,
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
        { cliPath: script, flags: [] },
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
      expect(result.exitCode).toBe(null)
      expect(result.error).toBeTruthy()

      const log = fs.readFileSync(logPath, 'utf8')
      expect(log).toContain('=== Payload gửi cho runner ===')
      expect(log).toContain('=== Kết quả ===')
      expect(log).toContain('ok: false')
      expect(log).toContain('exitCode: null')
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})
