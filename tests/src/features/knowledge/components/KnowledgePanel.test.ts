import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import KnowledgePanel from '@/features/knowledge/components/KnowledgePanel.vue'

afterEach(() => vi.unstubAllGlobals())

describe('KnowledgePanel', () => {
  it('mounts and loads the list (fetch stubbed)', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.includes('/tags') ? { tags: ['php'] } : { entries: [] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const w = mount(KnowledgePanel)
    await flushPromises()

    expect(w.find('.knowledge-panel').exists()).toBe(true)
    // onMounted → loadList hits both the list + tags endpoints.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.startsWith('/api/knowledge'))).toBe(true)
    expect(urls.some((u) => u.includes('/api/knowledge/tags'))).toBe(true)
  })
})
