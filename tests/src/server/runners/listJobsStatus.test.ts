import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listJobs } from '../../../../src/features/runner/business/index.js'
import type { JobRecord, JobStatus } from '../../../../src/features/runner/business/types.js'

// Characterization: status filter before limit; default limit=20 only when no status.

let home: string
const savedEnv = { ...process.env }

function writeJob(job: Partial<JobRecord> & { id: string; status: JobStatus; createdAt: string }): void {
  const dir = path.join(home, 'jobs')
  fs.mkdirSync(dir, { recursive: true })
  const full: JobRecord = {
    runnerId: 'r1',
    agentRef: 'a1',
    workspace: home,
    startedAt: job.createdAt,
    finishedAt: null,
    exitCode: null,
    metadata: {},
    ...job,
  } as JobRecord
  fs.writeFileSync(path.join(dir, `${job.id}.json`), JSON.stringify(full), 'utf8')
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-listjobs-status-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterAll(() => {
  process.env = savedEnv
  try {
    fs.rmSync(home, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

beforeEach(() => {
  const dir = path.join(home, 'jobs')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
})

describe('listJobs status filter', () => {
  test('listJobs() without status caps at 20 (legacy)', () => {
    for (let i = 0; i < 25; i++) {
      writeJob({
        id: `j-${String(i).padStart(2, '0')}`,
        status: 'succeeded',
        createdAt: `2026-01-01T00:${String(i).padStart(2, '0')}:00.000Z`,
      })
    }
    expect(listJobs()).toHaveLength(20)
  })

  test('listJobs(undefined, running) returns all running even when older than 20 newer jobs', () => {
    // 25 newer succeeded jobs + 3 older running
    for (let i = 0; i < 25; i++) {
      writeJob({
        id: `s-${String(i).padStart(2, '0')}`,
        status: 'succeeded',
        createdAt: `2026-02-01T00:${String(i).padStart(2, '0')}:00.000Z`,
      })
    }
    writeJob({ id: 'r-old-1', status: 'running', createdAt: '2026-01-01T00:00:00.000Z' })
    writeJob({ id: 'r-old-2', status: 'running', createdAt: '2026-01-01T00:01:00.000Z' })
    writeJob({ id: 'r-old-3', status: 'running', createdAt: '2026-01-01T00:02:00.000Z' })

    const running = listJobs(undefined, 'running')
    expect(running).toHaveLength(3)
    expect(running.every((j) => j.status === 'running')).toBe(true)
    expect(running.map((j) => j.id).sort()).toEqual(['r-old-1', 'r-old-2', 'r-old-3'])
  })

  test('listJobs(2, running) slices after filter', () => {
    writeJob({ id: 'r1', status: 'running', createdAt: '2026-01-01T00:03:00.000Z' })
    writeJob({ id: 'r2', status: 'running', createdAt: '2026-01-01T00:02:00.000Z' })
    writeJob({ id: 'r3', status: 'running', createdAt: '2026-01-01T00:01:00.000Z' })
    writeJob({ id: 's1', status: 'succeeded', createdAt: '2026-01-01T00:04:00.000Z' })

    const got = listJobs(2, 'running')
    expect(got).toHaveLength(2)
    expect(got.map((j) => j.id)).toEqual(['r1', 'r2'])
  })

  test('listJobs(50) without status keeps uncapped-by-status behavior (slice only)', () => {
    for (let i = 0; i < 30; i++) {
      writeJob({
        id: `x-${i}`,
        status: i % 2 === 0 ? 'running' : 'failed',
        createdAt: `2026-01-01T01:${String(i).padStart(2, '0')}:00.000Z`,
      })
    }
    expect(listJobs(50)).toHaveLength(30)
  })
})
