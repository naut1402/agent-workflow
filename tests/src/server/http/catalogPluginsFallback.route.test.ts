import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'

// Characterization cho #447 (Tfb77cf90-P8): fallback `<projectRoot>/plugins/<name>`
// của `GET /api/catalog-agent` và `GET /api/skill-content` khi id `repo:` không
// resolve được qua marketplace.json. Fallback này dời từ controller vào
// `RepoPluginSource` — hành vi route phải giữ nguyên văn, trừ khe traversal ở
// fallback của route agent đã vá ở #513.

let outerBase: string
let projectRoot: string
let root: string
let home: string
let app: Awaited<ReturnType<typeof createApp>>
const savedHome = process.env.HOME
const savedUserProfile = process.env.USERPROFILE

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: root,
    resolveProjectRoot: (id: string | null) => (id ? null : root),
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

function write(file: string, body: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body)
}

beforeAll(async () => {
  // projectRoot nằm đúng 2 cấp dưới outerBase để tính chính xác số `../`.
  outerBase = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-fallback-'))
  projectRoot = path.join(outerBase, 'a', 'project')
  root = path.join(projectRoot, '.dev-team-agent')
  fs.mkdirSync(root, { recursive: true })
  home = path.join(outerBase, 'home')
  fs.mkdirSync(home, { recursive: true })
  process.env.HOME = home
  process.env.USERPROFILE = home

  write(
    path.join(projectRoot, 'plugins', 'builtin', 'agents', 'helper.md'),
    '---\ndescription: builtin helper\nskills: [s1]\n---\n\n## Vai trò\n\nHelp\n',
  )
  write(path.join(projectRoot, 'plugins', 'builtin', 'skills', 'tool', 'SKILL.md'), '# Tool\n\nBUILTIN SKILL BODY')
  write(path.join(root, 'custom-agents', 'mine.md'), '---\ndescription: mine\n---\n\n## Vai trò\n\nMine\n')

  // File NGOÀI `plugins/` — chỉ tới được bằng traversal trong phần pluginName.
  write(path.join(outerBase, 'outside', 'agents', 'secret.md'), '---\ndescription: outside\n---\nOUTSIDE AGENT')
  write(path.join(outerBase, 'outside', 'skills', 'secret', 'SKILL.md'), 'OUTSIDE SKILL')

  app = await createApp(fakeCtx())
})

afterAll(() => {
  if (savedHome === undefined) delete process.env.HOME
  else process.env.HOME = savedHome
  if (savedUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = savedUserProfile
  fs.rmSync(outerBase, { recursive: true, force: true })
})

const q = (route: string, id: string) => app.request(`${route}?id=${encodeURIComponent(id)}`)

describe('GET /api/catalog-agent — fallback plugins/', () => {
  test('repo:<plugin>:<name> không có marketplace.json → đọc <projectRoot>/plugins/<plugin>/agents/<name>.md', async () => {
    const res = await q('/api/catalog-agent', 'repo:builtin:helper')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('repo:builtin:helper')
    expect(body.path).toBe(path.join(projectRoot, 'plugins', 'builtin', 'agents', 'helper.md'))
    expect(body.content).toContain('builtin helper')
    expect(body.draft.name).toBe('helper-copy')
    expect(body.draft.description).toBe('builtin helper')
    expect(body.draft.skills).toEqual(['s1'])
  })

  test('repo: không có file ở plugins/ → 404 "agent file not found"', async () => {
    const res = await q('/api/catalog-agent', 'repo:builtin:nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'agent file not found' })
  })

  test('dashboard:<name> → 200 với path trong custom-agents', async () => {
    const res = await q('/api/catalog-agent', 'dashboard:mine')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.path).toBe(path.join(root, 'custom-agents', 'mine.md'))
    expect(body.draft.description).toBe('mine')
  })

  test('thiếu id → 400 "missing id"', async () => {
    const res = await app.request('/api/catalog-agent')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'missing id' })
  })

  test('project không resolve được → 404 "unknown project"', async () => {
    const res = await app.request('/api/catalog-agent?id=dashboard:mine&project=nope')
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('unknown project')
  })

  // Chặn traversal (#513): pluginName và name của fallback plugins/ qua whitelist
  // ký tự + `resolvePathUnder(<projectRoot>/plugins)`; không hợp lệ → 404 như không tìm thấy.
  test('traversal trong pluginName bị chặn ở route agent → 404', async () => {
    const res = await q('/api/catalog-agent', 'repo:../../../outside:secret')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'agent file not found' })
  })

  test('traversal trong name bị chặn ở route agent → 404', async () => {
    const res = await q('/api/catalog-agent', 'repo:builtin:../../../../../outside/agents/secret')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'agent file not found' })
  })

  test('id hợp lệ sau khi chặn traversal vẫn trả nội dung agent', async () => {
    const res = await q('/api/catalog-agent', 'repo:builtin:helper')
    expect(res.status).toBe(200)
    expect((await res.json()).content).toContain('## Vai trò')
  })
})

describe('GET /api/skill-content — fallback plugins/', () => {
  test('repo:<plugin>:<name> không có marketplace.json → đọc plugins/<plugin>/skills/<name>/SKILL.md', async () => {
    const res = await q('/api/skill-content', 'repo:builtin:tool')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'repo:builtin:tool', content: '# Tool\n\nBUILTIN SKILL BODY' })
  })

  test('repo: không có file → 404 "skill file not found"', async () => {
    const res = await q('/api/skill-content', 'repo:builtin:nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'skill file not found' })
  })

  test('traversal trong pluginName bị chặn ở route skill', async () => {
    const res = await q('/api/skill-content', 'repo:../../../outside:secret')
    expect(res.status).toBe(404)
  })
})

describe('GET /api/catalog', () => {
  test('gồm agent dashboard + agent/skill từ plugins/ không qua marketplace thì không có', async () => {
    const res = await app.request('/api/catalog')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.agents.map((a: any) => a.id)).toEqual(['dashboard:mine'])
    expect(body.skills).toEqual([])
  })
})
