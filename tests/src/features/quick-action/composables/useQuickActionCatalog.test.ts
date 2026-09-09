import { afterEach, describe, expect, it, vi } from 'vitest'
import { useQuickActionCatalog, type QuickActionDraft } from '@/features/quick-action/composables/useQuickActionCatalog'

function stubApi(opts: { getBody?: any; putOk?: boolean }) {
  const fetchMock = vi.fn(async (input: any, init: any = {}) => {
    const url = String(input)
    const method = (init.method || 'GET').toUpperCase()
    if (url.includes('/api/artifact-actions') && method === 'GET') {
      return { ok: true, status: 200, json: async () => opts.getBody ?? { version: 1, actions: [] } }
    }
    if (url.includes('/api/artifact-actions') && method === 'PUT') {
      if (opts.putOk === false) return { ok: false, status: 400, json: async () => ({ error: 'boom' }) }
      const body = JSON.parse(init.body)
      return { ok: true, status: 200, json: async () => ({ ok: true, ...body }) }
    }
    throw new Error(`unexpected fetch: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const draft = (over: Partial<QuickActionDraft> = {}): QuickActionDraft => ({
  id: 'a1',
  label: 'Action 1',
  artifact_patterns: ['design.md'],
  agent_ref: 'dev-agent-teams:doc-reviewer',
  prompt_template: 'Đọc {{artifact_name}}',
  produces: [],
  confirm: false,
  attach_points: ['artifact-title'],
  ...over,
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useQuickActionCatalog', () => {
  it('load() populates version + actions from the full catalog', async () => {
    stubApi({ getBody: { version: 3, actions: [draft()], menus: [{ id: 'docs', label: 'Docs', children: [] }] } })
    const c = useQuickActionCatalog({ getProjectId: () => null })
    await c.load()

    expect(c.version.value).toBe(3)
    expect(c.actions.value).toHaveLength(1)
    expect(c.menus.value).toEqual([{ id: 'docs', label: 'Docs', children: [] }])
    expect(c.error.value).toBeNull()
  })

  it('load() surfaces a fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    const c = useQuickActionCatalog({ getProjectId: () => null })
    await c.load()

    expect(c.error.value).toBeTruthy()
  })

  it('upsert() rejects an empty id / missing required fields', () => {
    const c = useQuickActionCatalog({ getProjectId: () => null })
    expect(c.upsert(draft({ id: '' }), null)).toEqual({ ok: false, error: expect.stringContaining('id') })
    expect(c.upsert(draft({ artifact_patterns: [] }), null)).toEqual({
      ok: false,
      error: expect.stringContaining('pattern'),
    })
  })

  it('upsert() rejects a duplicate id when creating', () => {
    const c = useQuickActionCatalog({ getProjectId: () => null })
    c.actions.value = [draft({ id: 'dup' })]
    const result = c.upsert(draft({ id: 'dup' }), null)
    expect(result).toEqual({ ok: false, error: expect.stringContaining('đã tồn tại') })
  })

  it('upsert() appends a new action, replaces an existing one when editing', () => {
    const c = useQuickActionCatalog({ getProjectId: () => null })
    expect(c.upsert(draft({ id: 'a1' }), null)).toEqual({ ok: true })
    expect(c.actions.value.map((a) => a.id)).toEqual(['a1'])

    expect(c.upsert(draft({ id: 'a1', label: 'Renamed' }), 'a1')).toEqual({ ok: true })
    expect(c.actions.value).toHaveLength(1)
    expect(c.actions.value[0].label).toBe('Renamed')
  })

  it('remove() drops the action by id', () => {
    const c = useQuickActionCatalog({ getProjectId: () => null })
    c.actions.value = [draft({ id: 'a1' }), draft({ id: 'a2' })]
    c.remove('a1')
    expect(c.actions.value.map((a) => a.id)).toEqual(['a2'])
  })

  it('persist() PUTs actions + menus and updates local state from the response', async () => {
    stubApi({})
    const c = useQuickActionCatalog({ getProjectId: () => null })
    const ok = await c.persist([draft({ id: 'a1' })], [{ id: 'docs', label: 'Docs', children: [] }])

    expect(ok).toBe(true)
    expect(c.actions.value.map((a) => a.id)).toEqual(['a1'])
    expect(c.menus.value).toEqual([{ id: 'docs', label: 'Docs', children: [] }])
    expect(c.error.value).toBeNull()
  })

  it('persist() surfaces a server error and leaves error set', async () => {
    stubApi({ putOk: false })
    const c = useQuickActionCatalog({ getProjectId: () => null })
    const ok = await c.persist([draft({ id: 'a1' })])

    expect(ok).toBe(false)
    expect(c.error.value).toBeTruthy()
  })
})
