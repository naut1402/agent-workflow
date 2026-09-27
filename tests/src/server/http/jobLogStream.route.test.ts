import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'
import { emit, _resetEventBusForTest } from '../../../../src/backend/events/index.js'
import { readFrame, parseFrame } from './sseTestHelpers.js'

// GET /api/jobs/:id/log/stream (LogsController.streamJobLog) — SSE thay
// REST-poll cho job log (test-spec.md TC11/TC12/TC13, Nhóm 4, D2 tuỳ chọn).
// Route tự tail bằng interval nội bộ (design.md §4.2), giống chat — event
// vòng đời job chỉ đẩy sớm hơn chứ không thay được interval.

const JOB_A = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee'

let home: string
let app: Awaited<ReturnType<typeof createApp>>
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: home,
    resolveProjectRoot: () => home,
    registry: {
      list: () => ({ projects: [], defaultId: null }),
      get: () => null,
      add: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      remove: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      validateProjectPath: (() => ({ ok: false, status: 400, error: 'stub' })) as any,
      seedDefault: () => null,
    },
  }
}

function jobLogFile(id: string) {
  return path.join(process.env.DEV_TEAM_DASHBOARD_HOME as string, 'jobs', `${id}.log`)
}

function jobFile(id: string) {
  return path.join(process.env.DEV_TEAM_DASHBOARD_HOME as string, 'jobs', `${id}.json`)
}

function writeJobRecord(id: string, over: Record<string, unknown> = {}) {
  fs.writeFileSync(
    jobFile(id),
    JSON.stringify({
      id,
      status: 'running',
      exitCode: null,
      runnerId: 'test-runner',
      agentRef: 'x',
      workspace: home,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      ...over,
    }),
  )
}

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-joblog-stream-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  fs.mkdirSync(path.join(home, 'jobs'), { recursive: true })
  app = await createApp(fakeCtx())
})

afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

afterEach(() => {
  _resetEventBusForTest()
  fs.rmSync(path.join(home, 'jobs'), { recursive: true, force: true })
  fs.mkdirSync(path.join(home, 'jobs'), { recursive: true })
})

describe('GET /api/jobs/:id/log/stream', () => {
  test('400 cho job id không đúng định dạng UUID', async () => {
    const res = await app.request('/api/jobs/not-a-uuid/log/stream')
    expect(res.status).toBe(400)
  })

  test('TC11: nội dung log hiện có (text/size/status) hiển thị đầy đủ ngay khi mở kết nối', async () => {
    fs.writeFileSync(jobLogFile(JOB_A), 'dòng log đầu tiên\n')
    writeJobRecord(JOB_A, { status: 'running' })

    const res = await app.request(`/api/jobs/${JOB_A}/log/stream`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')

    const reader = res.body!.getReader()
    const frame = await readFrame(reader)
    const { type, data } = parseFrame(frame!)
    expect(type).toBe('log')
    expect(data.text).toBe('dòng log đầu tiên\n')
    expect(data.status).toBe('running')
    expect(data.eof).toBe(false)
    await reader.cancel().catch(() => {})
  })

  test('TC12: job ghi thêm dòng rồi kết thúc → frame mới chỉ chứa phần thêm, status/exitCode/eof cuối cùng đúng', async () => {
    fs.writeFileSync(jobLogFile(JOB_A), 'dòng 1\n')
    writeJobRecord(JOB_A, { status: 'running' })

    const res = await app.request(`/api/jobs/${JOB_A}/log/stream`)
    const reader = res.body!.getReader()
    await readFrame(reader) // snapshot đầu

    fs.appendFileSync(jobLogFile(JOB_A), 'dòng 2\n')
    writeJobRecord(JOB_A, { status: 'succeeded', exitCode: 0, finishedAt: new Date().toISOString() })
    emit('job.finished', { jobId: JOB_A })

    const next = await readFrame(reader)
    expect(next).not.toBeNull()
    const { data } = parseFrame(next!)
    // Delta cursor (offset) — chỉ phần MỚI, không lặp lại 'dòng 1'.
    expect(data.text).toBe('dòng 2\n')
    expect(data.status).toBe('succeeded')
    expect(data.exitCode).toBe(0)
    expect(data.eof).toBe(true)
    await reader.cancel().catch(() => {})
  })

  test('TC13: log bị reset ở nguồn (size < offset đã đọc) → frame mới có reset:true, nội dung từ đầu', async () => {
    fs.writeFileSync(jobLogFile(JOB_A), 'nội dung dài của lượt chạy trước\n')
    writeJobRecord(JOB_A, { status: 'running' })

    const res = await app.request(`/api/jobs/${JOB_A}/log/stream`)
    const reader = res.body!.getReader()
    await readFrame(reader) // snapshot đầu, offset đã đọc = độ dài file cũ

    // Log bị rotate/truncate — file mới ngắn hơn offset đã đọc.
    fs.writeFileSync(jobLogFile(JOB_A), 'log mới\n')
    emit('job.started', { jobId: JOB_A })

    const next = await readFrame(reader)
    expect(next).not.toBeNull()
    const { data } = parseFrame(next!)
    expect(data.reset).toBe(true)
    expect(data.text).toBe('log mới\n')
    await reader.cancel().catch(() => {})
  })

  test('sự kiện job không liên quan (không thuộc JOB_STREAM_EVENTS) không kích hoạt frame mới', async () => {
    fs.writeFileSync(jobLogFile(JOB_A), 'a\n')
    writeJobRecord(JOB_A, { status: 'running' })
    const res = await app.request(`/api/jobs/${JOB_A}/log/stream`)
    const reader = res.body!.getReader()
    await readFrame(reader)

    emit('task.advanced', { taskId: 'T1' })
    const next = await readFrame(reader, 200)
    expect(next).toBeNull()
    await reader.cancel().catch(() => {})
  })
})
