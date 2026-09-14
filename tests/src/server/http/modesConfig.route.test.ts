import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/backend/apiServer.js'
import { createRegistryContext } from '../../../../src/backend/registry.js'
import { invalidateLoggingPrefsCache } from '../../../../src/backend/log/loggingPrefsIo.js'
import {
  loadLoggingConfig,
  loadModesConfig,
  saveLoggingConfig,
} from '../../../../src/features/settings/business/dashboardSettings.js'

let home: string
const savedHome = process.env.DEV_TEAM_DASHBOARD_HOME

function settingsFile() {
  return path.join(home, 'settings.json')
}

function readSettings(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
}

async function put(app: Awaited<ReturnType<typeof createApp>>, body: string) {
  return app.request('/api/modes-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'modes-config-http-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  invalidateLoggingPrefsCache()
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
  if (savedHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = savedHome
  invalidateLoggingPrefsCache()
})

describe('HTTP modes-config', () => {
  test('TC-C2/TC-C11: chưa có file settings → GET trả map rỗng, không tạo file rác', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))

    const res = await app.request('/api/modes-config')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ config: { enabled: {} } })
    expect(fs.existsSync(settingsFile())).toBe(false)
  })

  test('TC-C11: response chỉ chứa key đã lưu — không tự sinh entry, không trả metadata', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    await put(app, JSON.stringify({ enabled: { statistics: false } }))

    const body = (await (await app.request('/api/modes-config')).json()) as {
      config: { enabled: Record<string, unknown> }
    }
    expect(body).toEqual({ config: { enabled: { statistics: false } } })
    expect(Object.keys(body.config)).toEqual(['enabled'])
  })

  test('TC-C14: tắt đúng một mode chỉ ghi entry của mode đó', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const res = await put(app, JSON.stringify({ enabled: { statistics: false } }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ config: { enabled: { statistics: false } } })
    expect(readSettings().modes).toEqual({ enabled: { statistics: false } })
  })

  test('TC-C7: PUT một phần merge theo key, không xoá cấu hình mode khác; ghi lại y nguyên là idempotent', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))

    await put(app, JSON.stringify({ enabled: { statistics: false } }))
    const second = await put(app, JSON.stringify({ enabled: { logs: false } }))

    expect(await second.json()).toEqual({
      config: { enabled: { statistics: false, logs: false } },
    })

    const before = fs.readFileSync(settingsFile(), 'utf8')
    await put(app, JSON.stringify({ enabled: { logs: false } }))
    expect(fs.readFileSync(settingsFile(), 'utf8')).toBe(before)
  })

  test('TC-C7: bật lại mode đã tắt cho trạng thái cuối là bật', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))

    await put(app, JSON.stringify({ enabled: { statistics: false } }))
    const res = await put(app, JSON.stringify({ enabled: { statistics: true } }))

    expect(await res.json()).toEqual({ config: { enabled: { statistics: true } } })
  })

  test('TC-C8: ghi modes không mất nhóm cấu hình khác, và ngược lại', async () => {
    saveLoggingConfig({
      showLogsTab: false,
      types: { audit: false, request: true, jobs: true, events: false, usage: true },
      driver: 'file',
    })
    invalidateLoggingPrefsCache()

    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    await put(app, JSON.stringify({ enabled: { statistics: false } }))

    expect(loadLoggingConfig().showLogsTab).toBe(false)
    expect(loadLoggingConfig().types?.audit).toBe(false)

    await app.request('/api/logging-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showLogsTab: true }),
    })
    expect(loadModesConfig()).toEqual({ enabled: { statistics: false } })
  })

  test('TC-C9a: body không phải JSON hợp lệ → 400, file settings không đổi một byte', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    await put(app, JSON.stringify({ enabled: { statistics: false } }))
    const before = fs.readFileSync(settingsFile(), 'utf8')

    const res = await put(app, '{ khong-phai-json')

    expect(res.status).toBe(400)
    expect(fs.readFileSync(settingsFile(), 'utf8')).toBe(before)
  })

  test('TC-C9b: entry sai kiểu bị bỏ riêng nó, phần hợp lệ vẫn lưu, vẫn 200', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const res = await put(app, JSON.stringify({ enabled: { statistics: false, logs: 'nope' } }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ config: { enabled: { statistics: false } } })
  })

  test('TC-C10: khoá dị dạng bị bỏ qua, không ô nhiễm prototype, không lưu vào file', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const res = await put(
      app,
      '{"enabled":{"__proto__":true,"9lives":true,"a b":true,"statistics":false}}',
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ config: { enabled: { statistics: false } } })
    expect(readSettings().modes).toEqual({ enabled: { statistics: false } })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  test('TC-C10: body `{}` hoặc `enabled: null` giữ nguyên cấu hình', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    await put(app, JSON.stringify({ enabled: { statistics: false } }))

    expect(await (await put(app, '{}')).json()).toEqual({
      config: { enabled: { statistics: false } },
    })
    expect(await (await put(app, JSON.stringify({ enabled: null }))).json()).toEqual({
      config: { enabled: { statistics: false } },
    })
  })

  test('TC-C10: `enabled` là mảng → không entry nào được lưu', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const res = await put(app, JSON.stringify({ enabled: [true, false] }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ config: { enabled: {} } })
  })

  test('TC-C10: map quá lớn bị chặn ở mức trần, settings.json không phình vô hạn', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const enabled: Record<string, boolean> = {}
    for (let i = 0; i < 200; i++) enabled[`mode${i}`] = true

    const res = await put(app, JSON.stringify({ enabled }))
    const body = (await res.json()) as { config: { enabled: Record<string, boolean> } }

    expect(res.status).toBe(200)
    expect(Object.keys(body.config.enabled).length).toBeLessThanOrEqual(64)
  })

  test('TC-C3/TC-C12: settings.json hỏng → GET vẫn 200 với mặc định an toàn', async () => {
    fs.writeFileSync(settingsFile(), '{ hỏng', 'utf8')
    const app = await createApp(createRegistryContext({ defaultRoot: null }))

    const res = await app.request('/api/modes-config')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ config: { enabled: {} } })
  })

  test('TC-C12: sửa tay file settings → lượt đọc sau trả đúng giá trị mới, không cache cũ', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    await put(app, JSON.stringify({ enabled: { statistics: false } }))

    const raw = readSettings()
    raw.modes = { enabled: { statistics: true, logs: false } }
    fs.writeFileSync(settingsFile(), JSON.stringify(raw), 'utf8')

    expect(await (await app.request('/api/modes-config')).json()).toEqual({
      config: { enabled: { statistics: true, logs: false } },
    })
  })

  test('TC-C13: PUT thành công ghi đúng 1 audit; PUT lỗi thì không ghi', async () => {
    saveLoggingConfig({
      showLogsTab: true,
      types: { audit: true, request: true, jobs: true, events: false, usage: true },
      driver: 'file',
    })
    invalidateLoggingPrefsCache()
    const app = await createApp(createRegistryContext({ defaultRoot: null }))

    await put(app, JSON.stringify({ enabled: { statistics: false } }))
    await put(app, '{ khong-phai-json')
    // emitAudit ghi fire-and-forget (`void appendLog`) — nhường một nhịp cho nó xuống đĩa.
    await new Promise((r) => setTimeout(r, 50))

    const logs = (await (await app.request('/api/logs?type=audit')).json()) as {
      entries: Record<string, unknown>[]
    }
    const modesAudit = logs.entries.filter((e) => e.entity === 'modes')

    expect(modesAudit).toHaveLength(1)
    expect(modesAudit[0]).toMatchObject({
      op: 'update',
      entity: 'modes',
      identifier: 'config',
      projectId: null,
    })
  })

  test('TC-R1: settings.json bản cũ (không có nhánh modes) đọc được, nhóm cũ giữ nguyên', async () => {
    fs.writeFileSync(
      settingsFile(),
      JSON.stringify({ logging: { showLogsTab: false }, autoscan: { enabled: true } }),
      'utf8',
    )
    const app = await createApp(createRegistryContext({ defaultRoot: null }))

    expect(await (await app.request('/api/modes-config')).json()).toEqual({
      config: { enabled: {} } },
    )
    expect(loadLoggingConfig().showLogsTab).toBe(false)
  })
})
