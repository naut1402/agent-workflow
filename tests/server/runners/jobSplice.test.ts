import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  submitApprovalJob,
  sendJobFeedback,
  getApprovalDiff,
  approveJob,
  loadJob,
  upsertRunner,
  upsertConnection,
  registerProvider,
} from '../../../server/runners/index.js'
import { spliceLines, extractLines, detectEol, cleanAgentOutput } from '../../../server/runners/jobQueue.js'
import type { ExecuteRequest, ExecuteResult, RunnerProvider } from '../../../server/runners/types.js'

// Selection splice (U0005-4): a selection quick action must only touch the
// picked lines. The agent RESPONDS with the improved text (stdout); the server
// splices that back into a copy of the real artifact at the selected line
// range, keeping every other line byte-identical (incl. original EOL). This
// file unit-tests the splice helpers and drives one full splice approval round
// via a stub provider that returns improved text on stdout.

describe('spliceLines / extractLines / detectEol (pure)', () => {
  test('extractLines returns the 1-indexed inclusive range, joined with LF', () => {
    const content = 'a\nb\nc\nd'
    expect(extractLines(content, 2, 3)).toBe('b\nc')
    expect(extractLines(content, 1, 1)).toBe('a')
  })

  test('spliceLines replaces only the range and preserves everything else', () => {
    const base = 'a\nb\nc\nd'
    expect(spliceLines(base, 2, 3, 'B\nC')).toBe('a\nB\nC\nd')
  })

  test('splice supports M≠N (replacement shorter/longer than the range)', () => {
    const base = 'a\nb\nc\nd'
    expect(spliceLines(base, 2, 3, 'X')).toBe('a\nX\nd') // 1 line replaces 2
    expect(spliceLines(base, 2, 2, 'X\nY\nZ')).toBe('a\nX\nY\nZ\nc\nd') // 3 replace 1
  })

  test('preserves CRLF everywhere; only the replaced region changes bytes', () => {
    const base = 'l1\r\nl2\r\nl3\r\nl4\r\n'
    // Replacement comes in as LF (that's how the agent writes it) — it must be
    // re-normalized to the base EOL so untouched lines stay byte-identical.
    const out = spliceLines(base, 2, 3, 'L2\nL3')
    expect(out).toBe('l1\r\nL2\r\nL3\r\nl4\r\n')
    // Lines outside the range are byte-identical to the base (CRLF intact).
    expect(out.startsWith('l1\r\n')).toBe(true)
    expect(out.endsWith('\r\nl4\r\n')).toBe(true)
  })

  test('a single trailing newline on the replacement is dropped (no spurious blank line)', () => {
    expect(spliceLines('a\nb\nc', 2, 2, 'B\n')).toBe('a\nB\nc')
  })

  test('clamps an out-of-range selection to the file bounds', () => {
    expect(spliceLines('a\nb', 5, 9, 'X')).toBe('a\nX') // start clamps to last line
  })

  test('detectEol', () => {
    expect(detectEol('a\r\nb')).toBe('\r\n')
    expect(detectEol('a\nb')).toBe('\n')
  })

  test('cleanAgentOutput trims and unwraps a single enclosing code fence', () => {
    expect(cleanAgentOutput('  hello \n')).toBe('hello')
    expect(cleanAgentOutput('```markdown\nhello\nworld\n```')).toBe('hello\nworld')
    expect(cleanAgentOutput('```\nhello\n```')).toBe('hello')
    // A fence that is part of the content (not enclosing) is left alone.
    expect(cleanAgentOutput('text\n```js\ncode\n```\nmore')).toBe('text\n```js\ncode\n```\nmore')
  })
})

// ── Full splice approval round via a stub provider ──────────────────────────

interface Captured {
  sessionId?: string
  resumeSessionId?: string
  userPrompt: string
  workspace: string
}
const captured: Captured[] = []

// Stub "agent": RESPONDS with a deterministic improved snippet on stdout
// (derived from the prompt) — the server splices that in. It never writes the
// artifact, mirroring a "respond with the edited content" style prompt.
const stubProvider: RunnerProvider = {
  providerId: 'stub-splice',
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    captured.push({
      sessionId: req.sessionId,
      resumeSessionId: req.resumeSessionId,
      userPrompt: req.userPrompt,
      workspace: req.workspace,
    })
    return { ok: true, exitCode: 0, durationMs: 1, stdout: `[${req.userPrompt}]` }
  },
}

let home: string
const savedEnv = { ...process.env }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(id: string): Promise<ReturnType<typeof loadJob> & {}> {
  for (let i = 0; i < 400; i++) {
    const j = loadJob(id)
    if (j && j.status !== 'queued' && j.status !== 'running') return j
    await sleep(5)
  }
  throw new Error(`job ${id} never settled (status=${loadJob(id)?.status})`)
}

// design.md with CRLF endings (as on Windows) so the test proves the splice
// keeps the untouched lines byte-identical.
const BASE = 'l1\r\nl2\r\nl3\r\nl4\r\n'

function makeWorkspace(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-splice-ws-'))
  fs.writeFileSync(path.join(ws, 'design.md'), BASE, 'utf8')
  return ws
}

function submitSplice(ws: string, prompt: string) {
  // Select lines 2-3 ("l2","l3"); the agent's stdout is spliced into that range.
  return submitApprovalJob({
    runnerId: 'stub-splice-runner',
    agentRef: '',
    workspace: ws,
    userPrompt: prompt,
    approvalArtifact: 'design.md',
    spliceRange: { start: 2, end: 3 },
    metadata: {},
  })
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-splice-home-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  registerProvider(stubProvider)
  upsertConnection({ id: 'stub-splice-conn', kind: 'local-console', providerId: 'stub-splice', cliPath: 'stub' })
  upsertRunner({ id: 'stub-splice-runner', connectionId: 'stub-splice-conn', config: {} })
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})
beforeEach(() => {
  captured.length = 0
})

describe('selection splice — full approval round', () => {
  test('only the selected lines change; other lines (and CRLF) stay byte-identical', async () => {
    const ws = makeWorkspace()
    const job = submitSplice(ws, 'round1')
    expect(job.spliceRange).toEqual({ start: 2, end: 3 })

    const done = await settle(job.id)
    expect(done.status).toBe('awaiting_approval')
    // Real file untouched until approve.
    expect(fs.readFileSync(path.join(ws, 'design.md'), 'utf8')).toBe(BASE)

    const diff = getApprovalDiff(job.id)
    if ('error' in diff) throw new Error(diff.error)
    expect(diff.before).toBe(BASE)
    // Lines 2-3 replaced by the stub's "[round1]" (a single line); l1/l4 + CRLF intact.
    expect(diff.after).toBe('l1\r\n[round1]\r\nl4\r\n')

    const res = approveJob(job.id)
    expect(res.ok).toBe(true)
    expect(fs.readFileSync(path.join(ws, 'design.md'), 'utf8')).toBe('l1\r\n[round1]\r\nl4\r\n')
  })

  test('feedback round re-splices against the same range, resuming the CLI session', async () => {
    const ws = makeWorkspace()
    const first = submitSplice(ws, 'round1')
    await settle(first.id)
    expect(captured[0].sessionId).toBe(first.sessionId)
    expect(captured[0].resumeSessionId).toBeUndefined()

    const fb = sendJobFeedback(first.id, 'round2')
    if ('error' in fb) throw new Error(fb.error)
    const child = fb.job
    expect(child.spliceRange).toEqual({ start: 2, end: 3 })

    await settle(child.id)
    const last = captured[captured.length - 1]
    expect(last.resumeSessionId).toBe(first.sessionId)
    expect(last.sessionId).toBeUndefined()

    // Splice always re-derives from the real base, so round2 is independent.
    const diff = getApprovalDiff(child.id)
    if ('error' in diff) throw new Error(diff.error)
    expect(diff.after).toBe('l1\r\n[round2]\r\nl4\r\n')
  })
})
