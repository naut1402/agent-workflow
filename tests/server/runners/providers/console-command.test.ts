import { describe, expect, test } from 'bun:test'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildConsoleInvocation,
  createConsoleCommandProvider,
  splitCommandArgs,
} from '../../../../server/runners/providers/console-command.js'
import type { CredentialProfile, ResolvedAgent } from '../../../../server/runners/types.js'

const credential: CredentialProfile = {
  id: 'cli-session-implicit',
  provider: 'console-command',
  label: 'CLI session',
  secretRef: 'cli-session',
}

const resolvedAgent: ResolvedAgent = {
  ref: 'should-be-ignored',
  name: 'Ignored agent',
  description: '',
  systemPrompt: '## Agent instructions\nNEVER send this to the CLI',
  skills: [],
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

describe('splitCommandArgs', () => {
  test('splits on whitespace and keeps quoted tokens', () => {
    expect(splitCommandArgs(`--file design.md --msg "hello world"`)).toEqual([
      '--file',
      'design.md',
      '--msg',
      'hello world',
    ])
    expect(splitCommandArgs(`'a b' c\\ d`)).toEqual(['a b', 'c d'])
    expect(splitCommandArgs('   ')).toEqual([])
  })
})

describe('buildConsoleInvocation', () => {
  test('concatenates flags + shell-split prompt — no AI flags', () => {
    expect(
      buildConsoleInvocation({
        flags: ['--json'],
        userPrompt: '--path "my file.md" --force',
      }).args,
    ).toEqual(['--json', '--path', 'my file.md', '--force'])
    expect(buildConsoleInvocation({ flags: ['-n'], userPrompt: '' }).args).toEqual(['-n'])
  })
})

describe('createConsoleCommandProvider', () => {
  test('spawns plain argv and ignores agent system prompt / allowedTools', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-console-'))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-workspace-'))
    try {
      // Echo argv[1..] so we can assert what was actually passed.
      const script = writeScript(
        home,
        'echo-args.sh',
        '#!/bin/sh\nprintf "%s\\n" "$@"\nexit 0\n',
      )
      const logPath = makeLogPath(home)
      const provider = createConsoleCommandProvider()

      const result = await provider.execute(
        {
          jobId: 'job-console-1',
          resolvedAgent,
          userPrompt: '--file design.md "hello world"',
          workspace,
          produces: [],
          timeoutMs: 5000,
          metadata: { logPath },
        },
        {
          cliPath: script,
          flags: ['--json'],
          allowedTools: 'Read,Write,Bash',
        },
        credential,
      )

      expect(result.ok).toBe(true)
      expect(result.exitCode).toBe(0)
      expect(result.stdout?.trim().split('\n')).toEqual(['--json', '--file', 'design.md', 'hello world'])

      const log = fs.readFileSync(logPath, 'utf8')
      expect(log).toContain('Mode: console-command')
      expect(log).not.toContain('--allowedTools')
      expect(log).not.toContain('NEVER send this to the CLI')
      expect(log).not.toContain('## Agent instructions')
      expect(log).toContain('=== Kết quả ===')
      expect(log).toContain('ok: true')
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('empty prompt runs cliPath with flags only', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-console-'))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-workspace-'))
    try {
      const script = writeScript(home, 'ok.sh', '#!/bin/sh\necho ok\nexit 0\n')
      const provider = createConsoleCommandProvider()
      const result = await provider.execute(
        {
          jobId: 'job-console-2',
          resolvedAgent,
          userPrompt: '',
          workspace,
          timeoutMs: 5000,
        },
        { cliPath: script, flags: [] },
        credential,
      )
      expect(result.ok).toBe(true)
      expect(result.stdout?.trim()).toBe('ok')
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})
