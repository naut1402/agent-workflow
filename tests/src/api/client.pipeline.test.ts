import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deletePipelineProfile,
  fetchPipelineProfile,
  fetchPipelineProfiles,
  savePipelineProfile,
  writePipelineConfig,
} from '../../../src/api/resources/pipeline'

describe('pipeline API client project scope', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetchPipelineProfiles appends ?project=', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ profiles: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    await fetchPipelineProfiles('proj-b')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/pipeline-profiles?project=proj-b')
  })

  it('fetchPipelineProfile appends name and project', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pipeline: {} }) })
    vi.stubGlobal('fetch', fetchMock)
    await fetchPipelineProfile('my-flow', 'proj-b')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/pipeline-profiles?name=my-flow&project=proj-b')
  })

  it('savePipelineProfile POST with project query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ saved: true }) })
    vi.stubGlobal('fetch', fetchMock)
    await savePipelineProfile('p1', { steps: [] }, 'proj-b')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/pipeline-profiles?project=proj-b')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
  })

  it('deletePipelineProfile DELETE with project query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deleted: true }) })
    vi.stubGlobal('fetch', fetchMock)
    await deletePipelineProfile('p1', 'proj-b')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/pipeline-profiles?name=p1&project=proj-b')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE')
  })

  it('writePipelineConfig POST with project query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ written: true }) })
    vi.stubGlobal('fetch', fetchMock)
    await writePipelineConfig('global', { steps: [] }, undefined, 'proj-b')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/pipeline-config-write?project=proj-b')
  })

  it('omits project query when projectId unset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ profiles: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    await fetchPipelineProfiles()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/pipeline-profiles')
  })
})
