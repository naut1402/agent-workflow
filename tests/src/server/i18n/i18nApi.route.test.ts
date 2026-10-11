import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RegistryContext } from '../../../../src/backend/registry.js'
import { createApp } from '../../../../src/backend/apiServer.js'
import { createRegistryContext } from '../../../../src/backend/registry.js'
import { dumpYaml } from '../../../../src/shared/lib/yamlLib'

/**
 * Nhóm B của `test-spec.md` — bề mặt HTTP của `GET /api/i18n/*`.
 *
 * Chốt status + header + body, không chốt cách controller dựng chúng. Hai header là
 * lý do tồn tại của feature này nên được assert DƯƠNG TÍNH: `Cache-Control: no-cache`
 * (G-C1 — `no-store` là mất sạch lợi ích ETag) và `ETag` ổn định theo nội dung (G-C15).
 */

let tmp: string
let home: string
const savedHome = process.env.DEV_TEAM_DASHBOARD_HOME

function writeFxRoot(root: string): void {
  const l = path.join(root, 'locales')
  fs.mkdirSync(path.join(l, 'vi'), { recursive: true })
  fs.writeFileSync(
    path.join(l, 'vi', 'common.yaml'),
    dumpYaml({ language: { names: { vi: 'OVERLAY-VI' } } }),
  )
}

async function appWith(defaultRoot: string | null) {
  return createApp(createRegistryContext({ defaultRoot }))
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-route-'))
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-route-home-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.rmSync(home, { recursive: true, force: true })
  if (savedHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = savedHome
})

describe('GET /api/i18n/manifest', () => {
  test('TC-B01: 200 kèm danh sách locale và locale mặc định', async () => {
    const app = await appWith(null)
    const res = await app.request('/api/i18n/manifest')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.locales).toContain('vi')
    expect(body.locales).toContain('en')
    expect(body.defaultLocale).toBe('vi')
  })

  test('TC-B02: `manifest` KHÔNG bị nuốt thành `:locale` (thứ tự đăng ký route)', async () => {
    const app = await appWith(null)
    const res = await app.request('/api/i18n/manifest')
    expect(res.status).toBe(200)
    const body = await res.json()
    // Body của route `:locale` là `{ locale, messages }` — không được rơi vào nhánh đó.
    expect(body.locale).toBeUndefined()
    expect(body.messages).toBeUndefined()
    expect(Array.isArray(body.locales)).toBe(true)
  })

  test('TC-B10: manifest cũng cacheable (`no-cache`, không `no-store`)', async () => {
    const app = await appWith(null)
    const res = await app.request('/api/i18n/manifest')
    expect(res.headers.get('Cache-Control')).toBe('no-cache')
  })
})

describe('GET /api/i18n/:locale — bundle', () => {
  test('TC-B03: 200 kèm `{ locale, messages }` đủ namespace', async () => {
    const app = await appWith(null)
    const res = await app.request('/api/i18n/vi')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.locale).toBe('vi')
    expect(body.messages.common).toBeDefined()
    expect(Object.keys(body.messages).length).toBeGreaterThanOrEqual(15)
  })

  test('TC-B04: `Cache-Control` LÀ `no-cache` — assert dương tính (G-C1)', async () => {
    const app = await appWith(null)
    const res = await app.request('/api/i18n/vi')
    expect(res.headers.get('Cache-Control')).toBe('no-cache')
  })

  test('TC-B05: có `ETag` non-empty, đúng cú pháp HTTP', async () => {
    const app = await appWith(null)
    const etag = (await app.request('/api/i18n/vi')).headers.get('ETag')
    expect(etag).toBeTruthy()
    expect(etag!).toMatch(/^"[\x21\x23-\x7E]+"$/)
  })

  test('TC-B06: ETag ổn định giữa 2 lần gọi trên cùng app (G-C15)', async () => {
    const app = await appWith(null)
    const a = (await app.request('/api/i18n/vi')).headers.get('ETag')
    const b = (await app.request('/api/i18n/vi')).headers.get('ETag')
    expect(b).toBe(a)
  })

  test('TC-B07: ETag ổn định giữa 2 instance app — hash theo nội dung', async () => {
    const a = (await (await appWith(null)).request('/api/i18n/vi')).headers.get('ETag')
    const b = (await (await appWith(null)).request('/api/i18n/vi')).headers.get('ETag')
    expect(b).toBe(a)
  })
})

describe('GET /api/i18n/:locale — điều kiện ETag', () => {
  test('TC-B08: `If-None-Match` khớp ⇒ 304, body RỖNG, ETag vẫn còn', async () => {
    const app = await appWith(null)
    const etag = (await app.request('/api/i18n/vi')).headers.get('ETag')!
    const res = await app.request('/api/i18n/vi', { headers: { 'If-None-Match': etag } })
    expect(res.status).toBe(304)
    expect(await res.text()).toBe('')
    expect(res.headers.get('ETag')).toBe(etag)
  })

  test('TC-B09: ETag cũ/sai ⇒ 200 kèm body đầy đủ', async () => {
    const app = await appWith(null)
    const res = await app.request('/api/i18n/vi', { headers: { 'If-None-Match': '"deadbeef"' } })
    expect(res.status).toBe(200)
    expect((await res.json()).messages.common).toBeDefined()
  })

  test('TC-B08b (Q2): weak validator `W/"<etag>"` ⇒ 304 (RFC 9110 §13.1.2)', async () => {
    const app = await appWith(null)
    const etag = (await app.request('/api/i18n/vi')).headers.get('ETag')!
    const res = await app.request('/api/i18n/vi', { headers: { 'If-None-Match': `W/${etag}` } })
    expect(res.status).toBe(304)
    expect(await res.text()).toBe('')
  })

  test('TC-B08c (Q2): `*` khớp mọi resource đang tồn tại ⇒ 304', async () => {
    const app = await appWith(null)
    const res = await app.request('/api/i18n/vi', { headers: { 'If-None-Match': '*' } })
    expect(res.status).toBe(304)
    expect(await res.text()).toBe('')
  })

  test('TC-B09b: danh sách nhiều etag, một cái khớp ⇒ 304', async () => {
    const app = await appWith(null)
    const etag = (await app.request('/api/i18n/vi')).headers.get('ETag')!
    const res = await app.request('/api/i18n/vi', {
      headers: { 'If-None-Match': `"khac", ${etag}` },
    })
    expect(res.status).toBe(304)
  })

  test('TC-B09c: danh sách nhiều etag, không cái nào khớp ⇒ 200', async () => {
    const app = await appWith(null)
    const res = await app.request('/api/i18n/vi', {
      headers: { 'If-None-Match': '"a", "b"' },
    })
    expect(res.status).toBe(200)
  })
})

describe('GET /api/i18n/:locale — overlay', () => {
  test('TC-B11: overlay đè qua route và đổi ETag', async () => {
    writeFxRoot(tmp)
    const plain = await (await appWith(null)).request('/api/i18n/vi')
    const over = await (await appWith(tmp)).request('/api/i18n/vi')

    expect(over.status).toBe(200)
    expect((await over.json()).messages.common.language.names.vi).toBe('OVERLAY-VI')
    expect(over.headers.get('ETag')).not.toBe(plain.headers.get('ETag'))
  })

  test('TC-B11b: sửa overlay giữa hai request cùng app ⇒ ETag mới, ETag cũ không còn 304', async () => {
    writeFxRoot(tmp)
    const app = await appWith(tmp)
    const first = await app.request('/api/i18n/vi')
    const oldEtag = first.headers.get('ETag')!

    const file = path.join(tmp, 'locales', 'vi', 'common.yaml')
    fs.writeFileSync(file, dumpYaml({ language: { names: { vi: 'OVERLAY-VI-2' } } }))
    const later = new Date(Date.now() + 10_000)
    fs.utimesSync(file, later, later)

    const res = await app.request('/api/i18n/vi', { headers: { 'If-None-Match': oldEtag } })
    expect(res.status).toBe(200)
    expect(res.headers.get('ETag')).not.toBe(oldEtag)
    expect((await res.json()).messages.common.language.names.vi).toBe('OVERLAY-VI-2')
  })

  test('TC-B12: overlay dir không tồn tại ⇒ vẫn 200 (G-C8)', async () => {
    const res = await (await appWith(tmp)).request('/api/i18n/vi')
    expect(res.status).toBe(200)
    expect((await res.json()).messages.common).toBeDefined()
  })

  test('TC-B13: file overlay hỏng ⇒ 200, namespace khác vẫn có mặt (G-C7)', async () => {
    writeFxRoot(tmp)
    // YAML hỏng cú pháp: flow sequence không đóng.
    fs.writeFileSync(path.join(tmp, 'locales', 'vi', 'broken.yaml'), 'a: [chua dong ngoac\nb: c\n')
    const warn = console.warn
    console.warn = () => {}
    let res: Response
    try {
      res = await (await appWith(tmp)).request('/api/i18n/vi')
    } finally {
      console.warn = warn
    }
    expect(res.status).toBe(200)
    const messages = (await res.json()).messages
    expect(messages.broken).toBeUndefined()
    expect(messages.common).toBeDefined()
    expect(messages.settings).toBeDefined()
  })
})

describe('GET /api/i18n/:locale — đầu vào sai', () => {
  test('TC-B14: mã locale sai định dạng ⇒ 400, không 404, không 500 (G-C4)', async () => {
    const app = await appWith(null)
    for (const bad of ['VI', 'x', 'vi-vn', '..%2Fetc', 'vi_VN', 'tieng-viet']) {
      const res = await app.request(`/api/i18n/${bad}`)
      expect([bad, res.status]).toEqual([bad, 400])
      expect((await res.json()).error).toBeTruthy()
    }
  })

  test('TC-B15: locale hợp lệ nhưng không tồn tại ⇒ 404, KHÔNG 400', async () => {
    const res = await (await appWith(null)).request('/api/i18n/de')
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBeTruthy()
  })

  test('TC-B16 (Q4): `GET /api/i18n/` ⇒ 404 của router, KHÔNG vào controller', async () => {
    const res = await (await appWith(null)).request('/api/i18n/')
    expect(res.status).toBe(404)
    // Thông điệp của `app.notFound`, không phải của `LocaleParam` — chứng minh request
    // dừng ở router chứ không rơi vào `:locale` với segment rỗng.
    expect((await res.json()).error).toBe('unknown endpoint')
  })

  test('TC-B17: response lỗi KHÔNG cacheable (`no-store`)', async () => {
    const app = await appWith(null)
    const bad = await app.request('/api/i18n/VI')
    const missing = await app.request('/api/i18n/de')
    expect(bad.headers.get('Cache-Control')).toContain('no-store')
    expect(missing.headers.get('Cache-Control')).toContain('no-store')
  })
})

describe('GET /api/i18n/:locale — i18n là GLOBAL, không theo project (G-C3)', () => {
  test('TC-B18: project lạ KHÔNG làm 404, body giống hệt lượt không truyền `?project=`', async () => {
    const app = await appWith(null)
    const plain = await app.request('/api/i18n/vi')
    const scoped = await app.request('/api/i18n/vi?project=khong-ton-tai')

    expect(scoped.status).toBe(200)
    expect(await scoped.json()).toEqual(await plain.json())
    expect(scoped.headers.get('ETag')).toBe(plain.headers.get('ETag'))
  })

  test('TC-B19: hai project có data root khác nhau ⇒ body và ETag KHÔNG đổi', async () => {
    // Hai project trỏ hai root khác nhau, mỗi root có overlay riêng. Controller đọc
    // `ctx.defaultRoot` chứ không `resolveProjectRoot(projectId)` → không root nào ăn.
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-proj-a-'))
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-proj-b-'))
    try {
      fs.mkdirSync(path.join(rootA, 'locales', 'vi'), { recursive: true })
      fs.writeFileSync(
        path.join(rootA, 'locales', 'vi', 'common.yaml'),
        dumpYaml({ language: { names: { vi: 'TU-PROJECT-A' } } }),
      )
      fs.mkdirSync(path.join(rootB, 'locales', 'vi'), { recursive: true })
      fs.writeFileSync(
        path.join(rootB, 'locales', 'vi', 'common.yaml'),
        dumpYaml({ language: { names: { vi: 'TU-PROJECT-B' } } }),
      )

      const ctx: RegistryContext = {
        defaultRoot: null,
        resolveProjectRoot: (id: string | null) =>
          id === 'a' ? rootA : id === 'b' ? rootB : null,
        registry: {
          list: () => ({
            projects: [
              { id: 'a', name: 'A', kind: 'local', path: rootA },
              { id: 'b', name: 'B', kind: 'local', path: rootB },
            ],
            defaultId: 'a',
          }),
          get: (id: string) =>
            id === 'a'
              ? { id: 'a', name: 'A', kind: 'local', path: rootA }
              : id === 'b'
                ? { id: 'b', name: 'B', kind: 'local', path: rootB }
                : null,
          add: (() => ({ ok: false, status: 400, error: 'stub' })) as never,
          remove: (() => ({ ok: false, status: 400, error: 'stub' })) as never,
          validateProjectPath: (() => ({ ok: false, status: 400, error: 'stub' })) as never,
          seedDefault: () => null,
        },
      } as unknown as RegistryContext

      const app = await createApp(ctx)
      const a = await app.request('/api/i18n/vi?project=a')
      const b = await app.request('/api/i18n/vi?project=b')

      expect(a.status).toBe(200)
      expect(b.status).toBe(200)
      expect(a.headers.get('ETag')).toBe(b.headers.get('ETag'))
      const bodyA = await a.json()
      expect(bodyA).toEqual(await b.json())
      // Và không root nào của project chui được vào kết quả.
      expect(JSON.stringify(bodyA)).not.toContain('TU-PROJECT-A')
      expect(JSON.stringify(bodyA)).not.toContain('TU-PROJECT-B')
    } finally {
      fs.rmSync(rootA, { recursive: true, force: true })
      fs.rmSync(rootB, { recursive: true, force: true })
    }
  })
})

describe('TC-B20: env đã tước', () => {
  test('manifest + bundle không đổi khi HOME rỗng và data home trỏ path không tồn tại', async () => {
    const savedUserHome = process.env.HOME
    process.env.HOME = ''
    process.env.DEV_TEAM_DASHBOARD_HOME = '/nonexistent'
    try {
      const app = await appWith(null)
      const manifest = await app.request('/api/i18n/manifest')
      expect(manifest.status).toBe(200)
      expect((await manifest.json()).defaultLocale).toBe('vi')

      const bundle = await app.request('/api/i18n/vi')
      expect(bundle.status).toBe(200)
      expect((await bundle.json()).messages.common).toBeDefined()
    } finally {
      if (savedUserHome === undefined) delete process.env.HOME
      else process.env.HOME = savedUserHome
      process.env.DEV_TEAM_DASHBOARD_HOME = home
    }
  })
})
