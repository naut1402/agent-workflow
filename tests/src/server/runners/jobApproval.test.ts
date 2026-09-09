import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  submitApprovalJob,
  sendJobFeedback,
  getApprovalDiff,
  approveJob,
  discardJob,
  loadJob,
  upsertRunner,
  upsertConnection,
  registerProvider,
} from '../../../../src/features/runner/business/index.js'
import type { ExecuteRequest, ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'

// End-to-end characterization of the approval flow (U0005-4): a `require_approval`
// quick action runs against a throwaway copy of the task workspace, reaches
// `awaiting_approval` without touching the real file, and is resolved by
// approve / discard / feedback(--resume). A stub provider (injected via
// registerProvider) writes the "proposed" edit into the scratch workspace
// instead of spawning a real CLI, and records each ExecuteRequest so we can
// assert session-id vs resume-session-id continuity — the strongest "it runs"
// proof available without a browser/real CLI in the sandbox.

interface Captured {
  sessionId?: string
  resumeSessionId?: string
  userPrompt: string
  workspace: string
}
const captured: Captured[] = []

const stubProvider: RunnerProvider = {
  providerId: 'stub-approval',
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
    // Simulate the agent editing the artifact IN the (scratch) workspace: append
    // a line derived from the prompt so before/after differ and feedback rounds
    // accumulate visibly.
    const target = String((req.metadata as any)?.targetFile ?? '')
    if (target) {
      const p = path.join(req.workspace, target)
      let prev = ''
      try {
        prev = fs.readFileSync(p, 'utf8')
      } catch {
        /* brand-new file the agent is proposing to create */
      }
      fs.writeFileSync(p, `${prev}\n[edit: ${req.userPrompt}]`, 'utf8')
    }
    return { ok: true, exitCode: 0, durationMs: 1 }
  },
}

let home: string
const savedEnv = { ...process.env }

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// Poll the on-disk job until it leaves queued/running (the queue runs async).
async function settle(id: string): Promise<ReturnType<typeof loadJob> & {}> {
  for (let i = 0; i < 400; i++) {
    const j = loadJob(id)
    if (j && j.status !== 'queued' && j.status !== 'running') return j
    await sleep(5)
  }
  throw new Error(`job ${id} never settled (status=${loadJob(id)?.status})`)
}

function makeWorkspace(fileName: string, content: string): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-approval-ws-'))
  fs.writeFileSync(path.join(ws, fileName), content, 'utf8')
  return ws
}

function submit(ws: string, prompt: string, artifact = 'design.md') {
  return submitApprovalJob({
    runnerId: 'stub-runner',
    agentRef: '',
    workspace: ws,
    userPrompt: prompt,
    approvalArtifact: artifact,
    metadata: { targetFile: artifact },
  })
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-approval-home-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  registerProvider(stubProvider)
  upsertConnection({ id: 'stub-conn', kind: 'local-console', providerId: 'stub-approval', cliPath: 'stub' })
  upsertRunner({ id: 'stub-runner', connectionId: 'stub-conn', config: {} })
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})
beforeEach(() => {
  captured.length = 0
})

describe('approval flow — submitApprovalJob', () => {
  test('runs against a scratch copy, reaches awaiting_approval, leaves the real file untouched', async () => {
    const ws = makeWorkspace('design.md', 'original\n')
    const job = submit(ws, 'improve')
    expect(job.status).toBe('queued')
    expect(job.sessionId).toBeTruthy()
    expect(job.applyTarget).toBe(path.resolve(ws))
    // Runs on a scratch copy, never the real workspace.
    expect(job.workspace).not.toBe(path.resolve(ws))

    const done = await settle(job.id)
    expect(done.status).toBe('awaiting_approval')
    // Real file is unchanged — the proposed edit lives only in the scratch copy.
    expect(fs.readFileSync(path.join(ws, 'design.md'), 'utf8')).toBe('original\n')
    // The first job of a thread establishes a fresh session (not a resume).
    expect(captured[0].sessionId).toBe(job.sessionId)
    expect(captured[0].resumeSessionId).toBeUndefined()
  })
})

describe('approval flow — getApprovalDiff', () => {
  test('returns the real "before" and the scratch "after"', async () => {
    const ws = makeWorkspace('design.md', 'original\n')
    const job = submit(ws, 'p')
    await settle(job.id)
    const diff = getApprovalDiff(job.id)
    expect(diff.ok).toBe(true)
    if ('error' in diff) throw new Error(diff.error)
    expect(diff.artifactName).toBe('design.md')
    expect(diff.before).toBe('original\n')
    expect(diff.after).toBe('original\n\n[edit: p]')
  })

  test('"before" is empty when the real artifact does not exist yet', async () => {
    const ws = makeWorkspace('design.md', 'unrelated')
    const job = submit(ws, 'p', 'brand-new.md')
    await settle(job.id)
    const diff = getApprovalDiff(job.id)
    if ('error' in diff) throw new Error(diff.error)
    expect(diff.before).toBe('')
    expect(diff.after).toBe('\n[edit: p]')
  })
})

describe('approval flow — approveJob / discardJob', () => {
  test('approveJob applies the scratch content to the real file, then removes the scratch copy', async () => {
    const ws = makeWorkspace('design.md', 'original\n')
    const job = submit(ws, 'improve')
    const done = await settle(job.id)
    const scratch = done.workspace

    const res = approveJob(job.id)
    expect(res.ok).toBe(true)
    if ('error' in res) throw new Error(res.error)
    expect(res.job.status).toBe('succeeded')
    expect(fs.readFileSync(path.join(ws, 'design.md'), 'utf8')).toBe('original\n\n[edit: improve]')
    expect(fs.existsSync(scratch)).toBe(false)
  })

  test('discardJob throws the scratch copy away and leaves the real file unchanged', async () => {
    const ws = makeWorkspace('design.md', 'original\n')
    const job = submit(ws, 'improve')
    const done = await settle(job.id)
    const scratch = done.workspace

    const res = discardJob(job.id)
    expect(res.ok).toBe(true)
    if ('error' in res) throw new Error(res.error)
    expect(res.job.status).toBe('cancelled')
    expect(fs.readFileSync(path.join(ws, 'design.md'), 'utf8')).toBe('original\n')
    expect(fs.existsSync(scratch)).toBe(false)
  })
})

describe('approval flow — sendJobFeedback (full round, --resume continuity)', () => {
  test('submit → awaiting → feedback(resume) → awaiting → approve mutates the real file', async () => {
    const ws = makeWorkspace('design.md', 'original\n')
    const first = submit(ws, 'round1')
    await settle(first.id)
    expect(captured[0].sessionId).toBe(first.sessionId)
    expect(captured[0].resumeSessionId).toBeUndefined()

    const fb = sendJobFeedback(first.id, 'round2')
    expect(fb.ok).toBe(true)
    if ('error' in fb) throw new Error(fb.error)
    const child = fb.job
    expect(child.parentJobId).toBe(first.id)
    expect(child.sessionId).toBe(first.sessionId)
    expect(child.workspace).toBe(first.workspace) // same (still-unapplied) scratch
    expect(child.userPrompt).toBe('round2')

    const childDone = await settle(child.id)
    expect(childDone.status).toBe('awaiting_approval')

    // The follow-up round continues the SAME CLI session via --resume, and does
    // NOT open a fresh one.
    const secondReq = captured[captured.length - 1]
    expect(secondReq.resumeSessionId).toBe(first.sessionId)
    expect(secondReq.sessionId).toBeUndefined()

    // Both rounds accumulated in the same scratch workspace.
    const diff = getApprovalDiff(child.id)
    if ('error' in diff) throw new Error(diff.error)
    expect(diff.after).toBe('original\n\n[edit: round1]\n[edit: round2]')

    const res = approveJob(child.id)
    expect(res.ok).toBe(true)
    expect(fs.readFileSync(path.join(ws, 'design.md'), 'utf8')).toBe('original\n\n[edit: round1]\n[edit: round2]')
  })
})

describe('approval flow — guards', () => {
  test('missing job → 404 on every approval mutator', () => {
    expect(getApprovalDiff('nope')).toMatchObject({ ok: false, status: 404 })
    expect(approveJob('nope')).toMatchObject({ ok: false, status: 404 })
    expect(discardJob('nope')).toMatchObject({ ok: false, status: 404 })
    expect(sendJobFeedback('nope', 'x')).toMatchObject({ ok: false, status: 404 })
  })

  test('a job no longer awaiting approval → 400', async () => {
    const ws = makeWorkspace('design.md', 'original\n')
    const job = submit(ws, 'improve')
    await settle(job.id)
    // Resolve it, so it's now `succeeded` (not `awaiting_approval`).
    expect(approveJob(job.id).ok).toBe(true)
    expect(approveJob(job.id)).toMatchObject({ ok: false, status: 400 })
    expect(discardJob(job.id)).toMatchObject({ ok: false, status: 400 })
    expect(sendJobFeedback(job.id, 'x')).toMatchObject({ ok: false, status: 400 })
    expect(getApprovalDiff(job.id)).toMatchObject({ ok: false, status: 400 })
  })
})
