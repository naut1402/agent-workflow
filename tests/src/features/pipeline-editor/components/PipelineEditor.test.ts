import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import PipelineEditor from '@/features/pipeline-editor/components/PipelineEditor.vue'
import { fetchCatalog, fetchRules, fetchPipelineConfig } from '@/features/pipeline-editor/scripts/pipelineEditorApi'

// Regression for Tb8e8ad44: Catalog/Rules tabs kept showing the default
// project's agents/skills/rules when the dashboard's selected project was
// something else, because fetchCatalog()/fetchRules() never forwarded
// projectId, and nothing re-fetched them when the selected project changed
// without unmounting the editor.

vi.mock('@/features/pipeline-editor/scripts/pipelineEditorApi', () => ({
  fetchCatalog: vi.fn(async () => ({ agents: [], skills: [] })),
  fetchRules: vi.fn(async () => ({ rules: [], categories: [] })),
  fetchPipelineConfig: vi.fn(async () => ({ pipeline: { steps: [] } })),
  fetchCatalogAgent: vi.fn(),
  writePipelineConfig: vi.fn(),
}))

vi.mock('@/features/pipeline-editor/scripts/ProfileManagerApi', () => ({
  fetchPipelineProfiles: vi.fn(async () => ({ profiles: [] })),
  fetchPipelineProfile: vi.fn(),
  savePipelineProfile: vi.fn(),
  deletePipelineProfile: vi.fn(),
}))

// VueFlow's canvas (SVG getBBox / ResizeObserver) does not run under jsdom —
// stub the component but keep useVueFlow() (used directly by PipelineEditor).
// fitView is stubbed too: the real implementation warns ("Viewport not
// initialized yet.") when called without a mounted VueFlow canvas, and
// PipelineEditor's onMounted schedules fitView() via an uncancelled
// setTimeout — since these tests never unmount, that warning can otherwise
// fire asynchronously after a test (and this file's jsdom env) has already
// torn down, crashing the run with an unrelated "Closing rpc" error.
vi.mock('@vue-flow/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vue-flow/core')>()
  return {
    ...actual,
    VueFlow: { name: 'VueFlow', props: ['nodes', 'edges', 'nodeTypes'], template: '<div />' },
    useVueFlow: (...args: Parameters<typeof actual.useVueFlow>) => {
      const vueFlow = actual.useVueFlow(...args)
      ;(vueFlow as unknown as { fitView: unknown }).fitView = vi.fn()
      return vueFlow
    },
  }
})

afterEach(() => vi.clearAllMocks())

function mountEditor(props: Record<string, any> = {}) {
  return mount(PipelineEditor, {
    props: { scope: 'global', taskId: '', tasks: [], projectId: null, ...props },
  })
}

describe('PipelineEditor — catalog/rules follow the selected project', () => {
  it('fetches catalog/rules with the selected projectId on mount', async () => {
    mountEditor({ projectId: 'P1' })
    await flushPromises()

    expect(fetchCatalog).toHaveBeenCalledWith('P1')
    expect(fetchRules).toHaveBeenCalledWith('P1')
  })

  it('omits the project when projectId is null (default project) — no regression', async () => {
    mountEditor({ projectId: null })
    await flushPromises()

    expect(fetchCatalog).toHaveBeenCalledWith(undefined)
    expect(fetchRules).toHaveBeenCalledWith(undefined)
  })

  it('re-fetches catalog/rules when the selected project changes without unmounting', async () => {
    const w = mountEditor({ projectId: 'P0' })
    await flushPromises()
    vi.clearAllMocks()

    await w.setProps({ projectId: 'P1' })
    await flushPromises()

    expect(fetchCatalog).toHaveBeenCalledWith('P1')
    expect(fetchRules).toHaveBeenCalledWith('P1')
  })

  it('does not re-fetch catalog/rules when only taskId changes (no project change)', async () => {
    vi.useFakeTimers()
    try {
      const w = mountEditor({ scope: 'task', taskId: 'T1', projectId: 'P0' })
      await flushPromises()
      vi.clearAllMocks()

      await w.setProps({ taskId: 'T2' })
      await vi.advanceTimersByTimeAsync(300) // loadConfig() debounce for scope === 'task'
      await flushPromises()

      expect(fetchCatalog).not.toHaveBeenCalled()
      expect(fetchRules).not.toHaveBeenCalled()
      // Existing scope/taskId/projectId watch still drives loadConfig() as before.
      expect(fetchPipelineConfig).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

// Panel trái không còn nút thu/phóng riêng — state đến từ shell qua v-model
// (`subSidebarCollapsed` + `update:subSidebarCollapsed`), control là mode icon.
describe('PipelineEditor — panel trái nhận state thu/phóng từ shell', () => {
  it('prop subSidebarCollapsed=true thu gọn panel, chỉ còn icon Catalog/Rules', async () => {
    const w = mountEditor({ subSidebarCollapsed: true })
    await flushPromises()

    expect(w.find('.editor-left').classes()).toContain('editor-left-collapsed')
    expect(w.find('.editor-layout').classes()).toContain('editor-layout--left-collapsed')
    expect(w.findAll('.editor-left-tab-icon')).toHaveLength(2)
    expect(w.find('.editor-scope-panel').exists()).toBe(false)
  })

  it('không còn nút thu/phóng bên trong panel trái', async () => {
    const w = mountEditor()
    await flushPromises()
    expect(w.find('.editor-left-collapse-btn').exists()).toBe(false)

    const collapsed = mountEditor({ subSidebarCollapsed: true })
    await flushPromises()
    expect(collapsed.find('.editor-left-collapse-btn').exists()).toBe(false)
  })

  it('click icon Catalog khi đang thu gọn emit update:subSidebarCollapsed=false', async () => {
    const w = mountEditor({ subSidebarCollapsed: true })
    await flushPromises()

    await w.findAll('.editor-left-tab-icon')[0].trigger('click')

    expect(w.emitted('update:subSidebarCollapsed')).toEqual([[false]])
  })
})
