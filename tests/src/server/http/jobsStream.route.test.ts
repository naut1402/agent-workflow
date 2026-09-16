import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/backend/apiServer.js'
import { createRegistryContext } from '../../../../src/backend/registry.js'
import { emit, _resetEventBusForTest } from '../../../../src/backend/events/index.js'
import { readFrame, parseFrame } from './sseTestHelpers.js'

// `GET /api/jobs/stream` (RunnerController.streamJobs) qua Hono test client —
// global, không scope theo project (design.md §2 phát hiện #2).

let home: string
let app: Awaited<ReturnType<typeof createApp>>
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function writeJob(id: string, status: string, extra: Record<string, unknown> = {}) {
  const jobsDir = path.join(home, 'jobs')
  fs.mkdirSync(jobsDir, { recursive: true })
  fs.writeFileSync(
    path.join(jobsDir, `${id}.json`),
    JSON.stringify({
      id,
      status,
      runnerId: 'r1',
      agentRef: 'agent',
      workspace: '/tmp/ws',
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      ...extra,
    }),
  )
}

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-jobsstream-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  app = await createApp(createRegistryContext({ defaultRoot: null }))
})

afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

afterEach(() => {
  _resetEventBusForTest()
  fs.rmSync(path.join(home, 'jobs'), { recursive: true, force: true })
})

describe('GET /api/jobs/stream', () => {
  test('TC-B1: snapshot ban đầu chứa mọi job đang running, không cần ?project=', async () => {
    writeJob('j1', 'running')
    writeJob('j2', 'succeeded')

    const res = await app.request('/api/jobs/stream')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')

    const reader = res.body!.getReader()
    const frame = await readFrame(reader)
    const { type, data } = parseFrame(frame!)
    expect(type).toBe('jobs')
    expect(data.jobs.map((j: any) => j.id)).toEqual(['j1'])
    await reader.cancel().catch(() => {})
  })

  test('TC-B3/B4: một job đổi trạng thái → frame mới; job khác không bị ảnh hưởng', async () => {
    writeJob('j1', 'running')
    writeJob('j2', 'running')

    const res = await app.request('/api/jobs/stream')
    const reader = res.body!.getReader()
    await readFrame(reader) // initial snapshot has both

    writeJob('j1', 'finished', { finishedAt: new Date().toISOString() })
    emit('job.finished', { jobId: 'j1' })
    const next = await readFrame(reader)
    const { data } = parseFrame(next!)
    expect(data.jobs.map((j: any) => j.id)).toEqual(['j2'])
    await reader.cancel().catch(() => {})
  })

  test('TC-B5: sự kiện task không liên quan không kích hoạt frame mới', async () => {
    writeJob('j1', 'running')
    const res = await app.request('/api/jobs/stream')
    const reader = res.body!.getReader()
    await readFrame(reader)

    emit('task.advanced', { taskId: 'A1' })
    const next = await readFrame(reader, 200)
    expect(next).toBeNull()
    await reader.cancel().catch(() => {})
  })
})
