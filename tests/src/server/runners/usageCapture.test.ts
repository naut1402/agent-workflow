import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { invalidateLoggingPrefsCache } from '../../../../src/core/log/loggingPrefs.js'
import { captureJobUsage } from '../../../../src/features/runner/business/usageCapture.js'
import {
  encodeCwdForClaudeProjects,
  sessionTranscriptPath,
} from '../../../../src/features/runner/business/claudeUsageTranscript.js'
import {
  getUsageCursor,
  setUsageCursor,
  saveTaskSessionLedger,
} from '../../../../src/features/runner/business/sessionLedger.js'
import { loadJob, mergeJobUsage } from '../../../../src/features/runner/business/jobQueue.js'
import type { JobRecord } from '../../../../src/features/runner/business/types.js'
import { registryHome } from '../../../../src/core/registry.js'

let home: string
let prevHome: string | undefined
let prevHomedir: () => string
const PROJECT = 'proj-usage'
const TASK = 'T-usage'
const SESSION = '11111111-1111-4111-8111-111111111111'
const WORKSPACE = '/tmp/usage-ws-capture'

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-usage-cap-'))
  prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  // Point Claude projects root at our temp HOME.
  prevHomedir = os.homedir
  ;(os as { homedir: () => string }).homedir = () => home
})

afterAll(() => {
  ;(os as { homedir: () => string }).homedir = prevHomedir
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

beforeEach(() => {
  fs.rmSync(path.join(home, 'jobs'), { recursive: true, force: true })
  fs.rmSync(path.join(home, 'sessions'), { recursive: true, force: true })
  fs.rmSync(path.join(home, 'logs'), { recursive: true, force: true })
  fs.rmSync(path.join(home, '.claude'), { recursive: true, force: true })
  try {
    fs.unlinkSync(path.join(home, 'settings.json'))
  } catch {
    /* ignore */
  }
  invalidateLoggingPrefsCache()
})

function writeSettings(usageEnabled: boolean) {
  fs.writeFileSync(
    path.join(home, 'settings.json'),
    JSON.stringify({
      logging: { showLogsTab: true, types: { audit: true, request: true, jobs: true, usage: usageEnabled } },
    }),
  )
  invalidateLoggingPrefsCache()
}

function seedJob(id: string): JobRecord {
  const job: JobRecord = {
    id,
    status: 'succeeded',
    runnerId: 'r1',
    agentRef: 'a',
    workspace: WORKSPACE,
    createdAt: new Date().toISOString(),
    startedAt: new Date(Date.now() - 1000).toISOString(),
    finishedAt: null,
    exitCode: 0,
    metadata: { projectId: PROJECT, taskId: TASK, stepId: 'implement' },
    sessionId: SESSION,
  }
  fs.mkdirSync(path.join(registryHome(), 'jobs'), { recursive: true })
  fs.writeFileSync(path.join(registryHome(), 'jobs', `${id}.json`), JSON.stringify(job, null, 2))
  return job
}

function writeTranscript(lines: object[]) {
  const encoded = encodeCwdForClaudeProjects(WORKSPACE)
  const dir = path.join(home, '.claude', 'projects', encoded)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${SESSION}.jsonl`)
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return file
}

describe('captureJobUsage', () => {
  test('no-op for non-claude provider', async () => {
    writeSettings(true)
    const job = seedJob('job-other')
    await captureJobUsage(job, SESSION, 'cursor-cli')
    expect(loadJob(job.id)?.usage).toBeUndefined()
  })

  test('prefs usage=false skips JobRecord and JSONL', async () => {
    writeSettings(false)
    const job = seedJob('job-off')
    writeTranscript([
      {
        type: 'assistant',
        message: {
          id: 'm1',
          model: 'claude',
          usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      },
    ])
    saveTaskSessionLedger(PROJECT, {
      version: 1,
      taskId: TASK,
      sessionPolicy: 'single',
      sessions: [
        {
          sessionId: SESSION,
          providerId: 'claude-code-cli',
          runnerId: 'r1',
          connectionId: 'c1',
          workspace: WORKSPACE,
          host: 'h',
          stepIds: [],
          status: 'open',
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
        },
      ],
    })
    await captureJobUsage(job, SESSION, 'claude-code-cli')
    expect(loadJob(job.id)?.usage).toBeUndefined()
    expect(fs.existsSync(path.join(home, 'logs', 'usage.jsonl'))).toBe(false)
  })

  test('aggregates transcript into JobRecord.usage + usage.jsonl', async () => {
    writeSettings(true)
    const job = seedJob('job-ok')
    writeTranscript([
      {
        type: 'assistant',
        message: {
          id: 'm1',
          model: 'claude-sonnet',
          usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 1, cache_creation_input_tokens: 2 },
        },
      },
      {
        type: 'assistant',
        message: {
          id: 'm1',
          model: 'claude-sonnet',
          usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 1, cache_creation_input_tokens: 2 },
        },
      },
    ])
    saveTaskSessionLedger(PROJECT, {
      version: 1,
      taskId: TASK,
      sessionPolicy: 'single',
      sessions: [
        {
          sessionId: SESSION,
          providerId: 'claude-code-cli',
          runnerId: 'r1',
          connectionId: 'c1',
          workspace: WORKSPACE,
          host: 'h',
          stepIds: [],
          status: 'open',
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
        },
      ],
    })

    await captureJobUsage(job, SESSION, 'claude-code-cli')
    // appendUsageLog is fire-and-forget — wait for JSONL flush
    await new Promise((r) => setTimeout(r, 50))

    const updated = loadJob(job.id)
    expect(updated?.usage?.inputTokens).toBe(100)
    expect(updated?.usage?.outputTokens).toBe(20)
    expect(updated?.usage?.estimatedCostUsd).toBeNull()
    expect(updated?.usage?.provider).toBe('claude-code-cli')
    expect(updated?.usage?.jobId).toBe(job.id)

    const jsonl = fs.readFileSync(path.join(home, 'logs', 'usage.jsonl'), 'utf8')
    expect(jsonl).toContain('"source":"aggregate"')
    expect(jsonl).toContain(job.id)

    const cursor = getUsageCursor(PROJECT, TASK, SESSION)
    expect(cursor?.mainLines).toBe(2)
  })

  test('mergeJobUsage persists usage field', () => {
    const job = seedJob('job-merge')
    const merged = mergeJobUsage(job.id, {
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      estimatedCostUsd: null,
      model: null,
      provider: 'claude-code-cli',
      jobId: job.id,
    })
    expect(merged?.usage?.totalTokens).toBe(3)
    expect(loadJob(job.id)?.usage?.totalTokens).toBe(3)
  })

  test('sessionTranscriptPath rejects bad session id', () => {
    expect(sessionTranscriptPath(WORKSPACE, '../evil')).toBeNull()
  })
})

describe('usageCursor helpers', () => {
  test('get/set usageCursor on ledger entry', () => {
    saveTaskSessionLedger(PROJECT, {
      version: 1,
      taskId: TASK,
      sessionPolicy: 'single',
      sessions: [
        {
          sessionId: SESSION,
          providerId: 'claude-code-cli',
          runnerId: 'r1',
          connectionId: 'c1',
          workspace: WORKSPACE,
          host: 'h',
          stepIds: [],
          status: 'open',
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
        },
      ],
    })
    expect(getUsageCursor(PROJECT, TASK, SESSION)).toBeNull()
    setUsageCursor(PROJECT, TASK, SESSION, { mainLines: 5, subagentFiles: ['agent-a.jsonl'] })
    expect(getUsageCursor(PROJECT, TASK, SESSION)).toEqual({
      mainLines: 5,
      subagentFiles: ['agent-a.jsonl'],
    })
  })
})
