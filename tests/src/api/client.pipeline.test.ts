import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deletePipelineProfile,
  fetchPipelineProfile,
  fetchPipelineProfiles,
  savePipelineProfile,
  writePipelineConfig,
} from '../../../src/api/client'

describe('pipeline API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetchPipelineProfiles hits /api/pipeline-profiles', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ profiles: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    await fetchPipelineProfiles()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/pipeline-profiles')
  })

  it('fetchPipelineProfile appends name query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pipeline: {} }) })
    vi.stubGlobal('fetch', fetchMock)
    await fetchPipelineProfile('my-flow')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/pipeline-profiles?name=my-flow')
  })

  it('savePipelineProfile POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ saved: true }) })
    vi.stubGlobal('fetch', fetchMock)
    await savePipelineProfile('p1', { steps: [] })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/pipeline-profiles')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
  })

  it('deletePipelineProfile DELETE with name query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deleted: true }) })
    vi.stubGlobal('fetch', fetchMock)
    await deletePipelineProfile('p1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/pipeline-profiles?name=p1')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE')
  })

  it('writePipelineConfig POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ written: true }) })
    vi.stubGlobal('fetch', fetchMock)
    await writePipelineConfig('global', { steps: [] })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/pipeline-config-write')
  })
})
