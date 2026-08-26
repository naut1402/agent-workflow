import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCatalog, fetchRules } from '@/features/pipeline-editor/scripts/pipelineEditorApi'

// Regression for Tb8e8ad44: fetchCatalog/fetchRules used to call
// /api/catalog and /api/rules without a `project` query param, so the
// backend middleware always resolved the default project's root instead
// of the one currently selected in the dashboard.
function stubApi() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => ({}),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchCatalog', () => {
  it('sends the given projectId as the `project` query param', async () => {
    const fetchMock = stubApi()
    await fetchCatalog('P1')
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/api/catalog')
    expect(url).toContain('project=P1')
  })

  it('omits the `project` param when no projectId is given (default project)', async () => {
    const fetchMock = stubApi()
    await fetchCatalog()
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/api/catalog')
    expect(url).not.toContain('project=')
  })
})

describe('fetchRules', () => {
  it('sends the given projectId as the `project` query param', async () => {
    const fetchMock = stubApi()
    await fetchRules('P1')
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/api/rules')
    expect(url).toContain('project=P1')
  })

  it('omits the `project` param when no projectId is given (default project)', async () => {
    const fetchMock = stubApi()
    await fetchRules()
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/api/rules')
    expect(url).not.toContain('project=')
  })
})
