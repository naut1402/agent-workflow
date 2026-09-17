import { mountWithI18n as mount } from '../../../helpers/i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import AgentTemplatePicker from '@/features/agent-editor/components/AgentTemplatePicker.vue'

// Regression for T8ee57185: the picker used to call `fetchCatalog()` /
// `fetchCatalogAgent(id)` with no `project` query param at all, so the
// backend always resolved the registry's default project instead of the
// one currently open in the dashboard — silently showing/copying the wrong
// project's agents (500 when the copied agent didn't exist there).

const fetchCatalog = vi.fn(async () => ({ agents: [{ id: 'repo:x:y', name: 'y' }] }))
const fetchCatalogAgent = vi.fn(async () => ({ draft: { name: 'y' } }))

vi.mock('@/features/pipeline-editor/scripts/pipelineEditorApi', () => ({
  fetchCatalog: (...a: unknown[]) => fetchCatalog(...a),
  fetchCatalogAgent: (...a: unknown[]) => fetchCatalogAgent(...a),
}))

vi.mock('@/features/agent-editor/scripts/AgentTemplatePickerApi', () => ({
  fetchAgentTemplates: vi.fn(async () => ({ templates: [] })),
  fetchAgentTemplate: vi.fn(),
  importAgentTemplateUrl: vi.fn(),
  uploadAgentTemplate: vi.fn(),
  deleteAgentTemplate: vi.fn(),
}))

async function mountPicker(props: Record<string, unknown> = {}) {
  const w = mount(AgentTemplatePicker, { props })
  await flushPromises()
  return w
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchCatalog.mockResolvedValue({ agents: [{ id: 'repo:x:y', name: 'y' }] })
  fetchCatalogAgent.mockResolvedValue({ draft: { name: 'y' } })
})

describe('AgentTemplatePicker — forward projectId (TC-D01, TC-D02, TC-D03)', () => {
  it('mount với projectId → fetchCatalog nạp danh sách agent theo đúng project', async () => {
    await mountPicker({ projectId: 'P1' })
    expect(fetchCatalog).toHaveBeenCalledWith('P1')
  })

  it('bấm nút copy 1 agent trong catalog → fetchCatalogAgent forward đúng (id, projectId)', async () => {
    const w = await mountPicker({ projectId: 'P1' })
    await w.find('.catalog-copy-btn').trigger('click')
    await flushPromises()
    expect(fetchCatalogAgent).toHaveBeenCalledWith('repo:x:y', 'P1')
  })

  it('không truyền projectId → không forward project (back-compat)', async () => {
    const w = await mountPicker()
    expect(fetchCatalog).toHaveBeenCalledWith(undefined)
    await w.find('.catalog-copy-btn').trigger('click')
    await flushPromises()
    expect(fetchCatalogAgent).toHaveBeenCalledWith('repo:x:y', undefined)
  })

  it('projectId: null → không forward project (back-compat)', async () => {
    await mountPicker({ projectId: null })
    expect(fetchCatalog).toHaveBeenCalledWith(undefined)
  })
})
