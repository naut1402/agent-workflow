import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import PipelineEditor from '@/features/pipeline-editor/components/PipelineEditor.vue'
import { fetchCatalog, fetchRules, fetchPipelineConfig, writePipelineConfig } from '@/features/pipeline-editor/scripts/pipelineEditorApi'
import { fetchPipelineProfile, savePipelineProfile, deletePipelineProfile } from '@/features/pipeline-editor/scripts/ProfileManagerApi'

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
  fetchPipelineProfiles: vi.fn(async () => ({ profiles: [{ name: 'p1' }] })),
  fetchPipelineProfile: vi.fn(async () => ({ pipeline: { steps: [] } })),
  savePipelineProfile: vi.fn(async () => ({ ok: true })),
  deletePipelineProfile: vi.fn(async () => ({ ok: true })),
}))

// VueFlow's canvas (SVG getBBox / ResizeObserver) does not run under jsdom —
// stub the component but keep useVueFlow() (used directly by PipelineEditor).
// fitView is stubbed too: the real implementation warns ("Viewport not
// initialized yet.") when called without a mounted VueFlow canvas, and
// PipelineEditor's onMounted schedules fitView() via an uncancelled
// setTimeout — since these tests never unmount, that warning can otherwise
// fire asynchronously after a test (and this file's jsdom env) has already
// torn down, crashing the run with an unrelated "Closing rpc" error.
// `v-model:nodes` chỉ được đồng bộ ngược bởi VueFlow thật; với stub thì ref
// `nodes` đứng yên, nên state canvas phải đọc từ store — giữ lại instance cuối
// mà PipelineEditor lấy qua useVueFlow().
const flowStore = vi.hoisted(() => ({ current: null as any }))

vi.mock('@vue-flow/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vue-flow/core')>()
  return {
    ...actual,
    VueFlow: { name: 'VueFlow', props: ['nodes', 'edges', 'nodeTypes'], template: '<div />' },
    useVueFlow: (...args: Parameters<typeof actual.useVueFlow>) => {
      const vueFlow = actual.useVueFlow(...args)
      ;(vueFlow as unknown as { fitView: unknown }).fitView = vi.fn()
      flowStore.current = vueFlow
      return vueFlow
    },
  }
})

/** Id của mọi node đang nằm trên canvas (kể cả node phái sinh). */
function canvasNodeIds(): string[] {
  return (flowStore.current?.getNodes.value ?? []).map((n: any) => n.id)
}

// `mockResolvedValue` trong từng test sống dai hơn `clearAllMocks` (chỉ xoá calls),
// nên đặt lại implementation mặc định trước mỗi test để chúng không rò sang nhau.
beforeEach(() => {
  vi.mocked(fetchPipelineConfig).mockResolvedValue({ pipeline: { steps: [] } } as any)
  vi.mocked(fetchPipelineProfile).mockResolvedValue({ pipeline: { steps: [] } } as any)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

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
  it('prop subSidebarCollapsed=true thu gọn panel, chỉ còn dải icon', async () => {
    const w = mountEditor({ subSidebarCollapsed: true })
    await flushPromises()

    expect(w.find('.editor-left').classes()).toContain('editor-left-collapsed')
    expect(w.find('.editor-layout').classes()).toContain('editor-layout--left-collapsed')
    expect(w.findAll('.target-section-icon')).toHaveLength(3)
    // Không render select/input khi thu gọn — chỉ icon.
    expect(w.find('.target-select').exists()).toBe(false)
    expect(w.find('.editor-left-sections').exists()).toBe(false)
  })

  it('không còn nút thu/phóng bên trong panel trái', async () => {
    const w = mountEditor()
    await flushPromises()
    expect(w.find('.editor-left-collapse-btn').exists()).toBe(false)

    const collapsed = mountEditor({ subSidebarCollapsed: true })
    await flushPromises()
    expect(collapsed.find('.editor-left-collapse-btn').exists()).toBe(false)
  })

  it('click icon Agents khi đang thu gọn emit update:subSidebarCollapsed=false', async () => {
    const w = mountEditor({ subSidebarCollapsed: true })
    await flushPromises()

    await w.findAll('.target-section-icon')[0].trigger('click')

    expect(w.emitted('update:subSidebarCollapsed')).toEqual([[false]])
  })

  // G4 — cụm action chứa nút Stop, khoá cả panel khi preview là tự nhốt mình.
  it('preview chỉ khoá phần nội dung, không khoá cụm action', async () => {
    const w = mountEditor()
    await flushPromises()
    expect(w.find('.editor-left-sections').exists()).toBe(true)
    expect(w.find('.editor-target-panel').exists()).toBe(true)
  })
})

// 1.3 — top bar chỉ còn 2 nút tab; tab là biểu diễn của `scope` do shell giữ.
describe('PipelineEditor — top bar 2 tab Task / Profile', () => {
  it('render đúng 2 nút tab, không còn ProfileManager hay cụm action ở top', async () => {
    const w = mountEditor()
    await flushPromises()

    const tabs = w.findAll('.editor-tab')
    expect(tabs).toHaveLength(2)
    expect(tabs.map((b) => b.text())).toEqual(['Task', 'Profile'])
    expect(w.find('.profile-manager').exists()).toBe(false)
    expect(w.find('.editor-toolbar-actions').exists()).toBe(false)
  })

  it('scope=global đánh dấu tab Profile là tab đang chọn', async () => {
    const w = mountEditor({ scope: 'global' })
    await flushPromises()
    expect(w.findAll('.editor-tab')[1].attributes('aria-selected')).toBe('true')
    expect(w.findAll('.editor-tab')[0].attributes('aria-selected')).toBe('false')
  })

  it('bấm tab Task emit update:scope="task"; bấm tab Profile emit "global"', async () => {
    const w = mountEditor({ scope: 'global' })
    await flushPromises()

    await w.findAll('.editor-tab')[0].trigger('click')
    expect(w.emitted('update:scope')).toEqual([['task']])

    const onTask = mountEditor({ scope: 'task', taskId: '' })
    await flushPromises()
    await onTask.findAll('.editor-tab')[1].trigger('click')
    expect(onTask.emitted('update:scope')).toEqual([['global']])
  })

  it('bấm lại tab đang mở không emit gì', async () => {
    const w = mountEditor({ scope: 'global' })
    await flushPromises()
    await w.findAll('.editor-tab')[1].trigger('click')
    expect(w.emitted('update:scope')).toBeUndefined()
  })
})

// E1 — node artifact/knowledge chỉ để nhìn. Nếu chúng lọt vào buildFullPipeline,
// YAML lưu ra mọc step rác `art-*` và profile không mở lại đúng nữa.
describe('PipelineEditor — node phái sinh không lọt vào pipeline lưu ra', () => {
  const PIPELINE_WITH_PRODUCES = {
    version: 3,
    defaults: { review_retry_max: 2 },
    doc_reviewer: { agent: 'dev:doc-reviewer' },
    steps: [
      {
        id: 'investigator',
        name: 'Investigate',
        agent: 'dev:investigator',
        produces: ['investigate.md'],
        knowledge_inputs: ['k1'],
        export_key: 'investigator',
        hitl: { mode: 'gate', gate_id: 'design-approved', retry: 3 },
      },
      { id: 'designer', name: 'Design', agent: 'dev:designer', produces: ['design.md'] },
    ],
  }

  async function mountWithPipeline() {
    vi.mocked(fetchPipelineConfig).mockResolvedValue({ pipeline: PIPELINE_WITH_PRODUCES } as any)
    const w = mountEditor({ scope: 'task', taskId: 'T1', tasks: [{ task_id: 'T1' }] })
    await flushPromises()
    return w
  }

  it('canvas dựng node artifact/knowledge phái sinh từ produces / knowledge_inputs', async () => {
    await mountWithPipeline()
    const ids = canvasNodeIds()
    expect(ids).toContain('art-investigator')
    expect(ids).toContain('art-designer')
    expect(ids).toContain('art-knowledge')
  })

  it('Save chỉ ghi step gốc — không có step nào id bắt đầu bằng "art-"', async () => {
    const w = await mountWithPipeline()

    await w.findComponent({ name: 'EditorTargetPanel' }).vm.$emit('save')
    await flushPromises()

    expect(writePipelineConfig).toHaveBeenCalledTimes(1)
    const pipeline = vi.mocked(writePipelineConfig).mock.calls[0][1] as any
    expect(pipeline.steps.map((s: any) => s.id)).toEqual(['investigator', 'designer'])
    expect(pipeline.steps.some((s: any) => String(s.id).startsWith('art-'))).toBe(false)
  })

  // G7 — round-trip: meta và field lạ của step phải sống sót qua canvas.
  it('round-trip giữ version / defaults / doc_reviewer và field lạ của step', async () => {
    const w = await mountWithPipeline()

    await w.findComponent({ name: 'EditorTargetPanel' }).vm.$emit('save')
    await flushPromises()

    const pipeline = vi.mocked(writePipelineConfig).mock.calls[0][1] as any
    expect(pipeline.version).toBe(3)
    expect(pipeline.defaults).toEqual({ review_retry_max: 2 })
    expect(pipeline.doc_reviewer).toEqual({ agent: 'dev:doc-reviewer' })
    const first = pipeline.steps[0]
    expect(first.export_key).toBe('investigator')
    expect(first.name).toBe('Investigate')
    expect(first.hitl).toMatchObject({ mode: 'gate', gate_id: 'design-approved', retry: 3 })
  })
})

// 1.2 / a.1 / a.3 — một nút Save rẽ theo tab; profile tự nạp khi đổi select.
describe('PipelineEditor — Save / set-default rẽ nhánh theo tab', () => {
  it('tab Profile: Save ghi profile (không gọi writePipelineConfig)', async () => {
    vi.mocked(fetchPipelineConfig).mockResolvedValue({
      pipeline: { steps: [{ id: 's1', name: 'S1' }] },
    } as any)
    const w = mountEditor({ scope: 'global' })
    await flushPromises()

    const panel = w.findComponent({ name: 'EditorTargetPanel' })
    await panel.vm.$emit('update:profileName', 'my-profile')
    await panel.vm.$emit('save')
    await flushPromises()

    expect(savePipelineProfile).toHaveBeenCalledWith('my-profile', expect.anything(), undefined)
    expect(writePipelineConfig).not.toHaveBeenCalled()
  })

  it('tab Profile: set-default ghi pipeline.yaml global qua scope "global"', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(fetchPipelineConfig).mockResolvedValue({
      pipeline: { steps: [{ id: 's1', name: 'S1' }] },
    } as any)
    const w = mountEditor({ scope: 'global' })
    await flushPromises()

    await w.findComponent({ name: 'EditorTargetPanel' }).vm.$emit('set-default')
    await flushPromises()

    expect(writePipelineConfig).toHaveBeenCalledWith('global', expect.anything(), undefined, undefined)
  })

  it('a.1: đổi select profile tự nạp profile đó (không có nút Load)', async () => {
    vi.mocked(fetchPipelineProfile).mockResolvedValue({
      pipeline: { version: 9, steps: [{ id: 'from-profile', name: 'From profile' }] },
    } as any)
    const w = mountEditor({ scope: 'global', projectId: 'P1' })
    await flushPromises()

    await w.findComponent({ name: 'EditorTargetPanel' }).vm.$emit('update:profileSelected', 'p1')
    await flushPromises()

    expect(fetchPipelineProfile).toHaveBeenCalledWith('p1', 'P1')
    const ids = canvasNodeIds()
    expect(ids).toContain('from-profile')
  })

  it('b.1: tab Task đổi select profile chỉ nạp canvas, không ghi file', async () => {
    vi.mocked(fetchPipelineProfile).mockResolvedValue({
      pipeline: { steps: [{ id: 'drafted', name: 'Drafted' }] },
    } as any)
    const w = mountEditor({ scope: 'task', taskId: 'T1', tasks: [{ task_id: 'T1' }] })
    await flushPromises()

    await w.findComponent({ name: 'EditorTargetPanel' }).vm.$emit('update:taskProfile', 'p1')
    await flushPromises()

    expect(fetchPipelineProfile).toHaveBeenCalledWith('p1', undefined)
    expect(writePipelineConfig).not.toHaveBeenCalled()
    const ids = canvasNodeIds()
    expect(ids).toContain('drafted')
  })

  it('D6: xoá profile hỏi confirm trước, huỷ thì không gọi API', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const w = mountEditor({ scope: 'global' })
    await flushPromises()

    const panel = w.findComponent({ name: 'EditorTargetPanel' })
    await panel.vm.$emit('update:profileSelected', 'p1')
    await flushPromises()
    await panel.vm.$emit('delete-profile')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalled()
    expect(deletePipelineProfile).not.toHaveBeenCalled()
  })
})

// E3 — bỏ nút Load nên đổi select là mất thay đổi chưa lưu; phải hỏi trước.
describe('PipelineEditor — confirm trước khi auto-load đè thay đổi chưa lưu', () => {
  async function mountDirty() {
    vi.mocked(fetchPipelineConfig).mockResolvedValue({
      pipeline: { steps: [{ id: 'onCanvas', name: 'On canvas' }] },
    } as any)
    const w = mountEditor({ scope: 'global' })
    await flushPromises()
    // Sửa canvas → khác snapshot lúc nạp.
    const panel = w.findComponent({ name: 'EditorTargetPanel' })
    w.findComponent({ name: 'VueFlow' }) // canvas đã mount
    flowStore.current.setNodes([
      ...flowStore.current.getNodes.value,
      { id: 'them-tay', type: 'pipelineEditor', position: { x: 0, y: 0 }, data: { label: 'Thêm tay' } },
    ])
    await flushPromises()
    return { w, panel }
  }

  it('huỷ confirm thì không nạp profile và canvas giữ nguyên', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { panel } = await mountDirty()

    await panel.vm.$emit('update:profileSelected', 'p1')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(fetchPipelineProfile).not.toHaveBeenCalled()
    expect(canvasNodeIds()).toContain('them-tay')
  })

  // Watcher tự ghi ngược vào ref nó đang theo dõi khi người dùng huỷ. Không chặn
  // thì lần trả-về-giá-trị-cũ lại đếm là "đổi select" và hỏi confirm lần nữa.
  it('đổi từ profile này sang profile khác rồi huỷ: chỉ hỏi confirm một lần', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(fetchPipelineProfile).mockResolvedValue({
      pipeline: { steps: [{ id: 'tu-p1', name: 'Từ p1' }] },
    } as any)
    const { panel } = await mountDirty()

    // Chọn p1 (đồng ý bỏ thay đổi) → canvas sạch, đúng bằng p1.
    await panel.vm.$emit('update:profileSelected', 'p1')
    await flushPromises()

    // Làm bẩn canvas lại, rồi đổi sang p2 và huỷ.
    flowStore.current.setNodes([
      ...flowStore.current.getNodes.value,
      { id: 'them-tay-2', type: 'pipelineEditor', position: { x: 0, y: 0 }, data: { label: 'x' } },
    ])
    await flushPromises()
    confirmSpy.mockClear()
    confirmSpy.mockReturnValue(false)
    vi.mocked(fetchPipelineProfile).mockClear()

    await panel.vm.$emit('update:profileSelected', 'p2')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(fetchPipelineProfile).not.toHaveBeenCalled()
    // Select quay lại p1 mà không kéo theo một lượt nạp lại.
    expect(panel.props('profileSelected')).toBe('p1')
    expect(canvasNodeIds()).toContain('them-tay-2')
  })

  it('đồng ý confirm thì nạp profile đè lên canvas', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(fetchPipelineProfile).mockResolvedValue({
      pipeline: { steps: [{ id: 'tu-profile', name: 'Từ profile' }] },
    } as any)
    const { panel } = await mountDirty()

    await panel.vm.$emit('update:profileSelected', 'p1')
    await flushPromises()

    expect(canvasNodeIds()).toContain('tu-profile')
    expect(canvasNodeIds()).not.toContain('them-tay')
  })

  it('Save ở tab Profile không kéo theo một lượt nạp lại profile vừa ghi', async () => {
    vi.mocked(fetchPipelineConfig).mockResolvedValue({
      pipeline: { steps: [{ id: 's1', name: 'S1' }] },
    } as any)
    const w = mountEditor({ scope: 'global' })
    await flushPromises()

    const panel = w.findComponent({ name: 'EditorTargetPanel' })
    await panel.vm.$emit('update:profileName', 'p-moi')
    await panel.vm.$emit('save')
    await flushPromises()

    expect(savePipelineProfile).toHaveBeenCalledTimes(1)
    expect(fetchPipelineProfile).not.toHaveBeenCalled()
  })
})

// Nút xám không lý do là ngõ cụt: ở tab Profile Save vẫn bấm được để báo lỗi.
describe('PipelineEditor — trạng thái nút Save', () => {
  it('tab Profile chưa nhập tên: Save bấm được và báo cần nhập tên', async () => {
    const w = mountEditor({ scope: 'global' })
    await flushPromises()

    const panel = w.findComponent({ name: 'EditorTargetPanel' })
    expect(panel.props('saveDisabled')).toBe(false)

    await panel.vm.$emit('save')
    await flushPromises()

    expect(savePipelineProfile).not.toHaveBeenCalled()
    expect(panel.props('message')).toContain('Nhập tên profile')
  })

  it('E8: tab Task với task đã hoàn tất → Save disabled', async () => {
    const w = mountEditor({
      scope: 'task',
      taskId: 'T1',
      tasks: [{ task_id: 'T1', current_phase: 'completed' }],
    })
    await flushPromises()

    expect(w.findComponent({ name: 'EditorTargetPanel' }).props('saveDisabled')).toBe(true)
  })

  it('G6: task đang chờ gate → panel nhận cảnh báo trước khi bấm Save', async () => {
    const w = mountEditor({
      scope: 'task',
      taskId: 'T1',
      tasks: [{ task_id: 'T1', hitl_pending: 'design-approved' }],
    })
    await flushPromises()

    expect(w.findComponent({ name: 'EditorTargetPanel' }).props('warning')).toContain('chờ gate')
  })
})

// Bất biến của bố cục 2 tab: canvas và select luôn nói về **cùng một** đối tượng.
// Tab Profile cũng là `scope === 'global'`, nên nếu quay lại tab mà nạp pipeline
// global trong khi select vẫn giữ profile cũ thì Save sẽ ghi đè profile đó.
describe('PipelineEditor — canvas và select luôn cùng một đối tượng', () => {
  it('quay lại tab Profile nạp lại profile đang chọn, Save ghi đúng nội dung đó', async () => {
    vi.mocked(fetchPipelineConfig).mockResolvedValue({
      pipeline: { steps: [{ id: 'globalStep', name: 'Global' }] },
    } as any)
    vi.mocked(fetchPipelineProfile).mockResolvedValue({
      pipeline: { steps: [{ id: 'fromP1', name: 'Từ p1' }] },
    } as any)
    const w = mountEditor({ scope: 'global' })
    await flushPromises()

    const panel = w.findComponent({ name: 'EditorTargetPanel' })
    await panel.vm.$emit('update:profileSelected', 'p1')
    await flushPromises()
    expect(canvasNodeIds()).toContain('fromP1')

    // Sang tab Task rồi quay lại tab Profile.
    await w.setProps({ scope: 'task', taskId: '' })
    await flushPromises()
    await w.setProps({ scope: 'global' })
    await flushPromises()

    // Canvas phải là p1 (khớp select), không phải pipeline global.
    expect(canvasNodeIds()).toContain('fromP1')
    expect(canvasNodeIds()).not.toContain('globalStep')
    expect(w.findComponent({ name: 'EditorTargetPanel' }).props('profileSelected')).toBe('p1')

    await w.findComponent({ name: 'EditorTargetPanel' }).vm.$emit('save')
    await flushPromises()

    const [, savedPipeline] = vi.mocked(savePipelineProfile).mock.calls.at(-1) as any[]
    expect(savedPipeline.steps.map((s: any) => s.id)).toEqual(['fromP1'])
  })

  it('đổi project khi đang ở tab Profile thì về pipeline global, không nạp profile cũ', async () => {
    vi.mocked(fetchPipelineConfig).mockResolvedValue({
      pipeline: { steps: [{ id: 'globalStep', name: 'Global' }] },
    } as any)
    vi.mocked(fetchPipelineProfile).mockResolvedValue({
      pipeline: { steps: [{ id: 'fromP1', name: 'Từ p1' }] },
    } as any)
    const w = mountEditor({ scope: 'global', projectId: 'P1' })
    await flushPromises()

    await w.findComponent({ name: 'EditorTargetPanel' }).vm.$emit('update:profileSelected', 'p1')
    await flushPromises()
    vi.mocked(fetchPipelineProfile).mockClear()

    await w.setProps({ projectId: 'P2' })
    await flushPromises()

    expect(fetchPipelineProfile).not.toHaveBeenCalled()
    expect(canvasNodeIds()).toContain('globalStep')
  })

  it('đổi tab khi canvas bẩn phải hỏi trước; huỷ thì ở lại tab cũ', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    vi.mocked(fetchPipelineConfig).mockResolvedValue({
      pipeline: { steps: [{ id: 'onCanvas', name: 'On canvas' }] },
    } as any)
    const w = mountEditor({ scope: 'global' })
    await flushPromises()
    flowStore.current.setNodes([
      ...flowStore.current.getNodes.value,
      { id: 'them-tay', type: 'pipelineEditor', position: { x: 0, y: 0 }, data: { label: 'x' } },
    ])
    await flushPromises()

    await w.findAll('.editor-tab')[0].trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(w.emitted('update:scope')).toBeUndefined()
    expect(canvasNodeIds()).toContain('them-tay')
  })

  // Canvas rỗng là "sạch" — confirm giả lặp lại khiến người dùng bấm OK theo
  // phản xạ, làm confirm mất tác dụng ở đúng chỗ nó cần thiết.
  it('tab Task chưa chọn task: canvas rỗng không bị coi là có thay đổi chưa lưu', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(fetchPipelineConfig).mockResolvedValue({
      pipeline: { steps: [{ id: 'globalStep', name: 'Global' }] },
    } as any)
    const w = mountEditor({ scope: 'global' })
    await flushPromises()

    await w.setProps({ scope: 'task', taskId: '' })
    await flushPromises()
    expect(canvasNodeIds()).toEqual([])

    confirmSpy.mockClear()
    await w.findComponent({ name: 'EditorTargetPanel' }).vm.$emit('update:taskProfile', 'p1')
    await flushPromises()

    expect(confirmSpy).not.toHaveBeenCalled()
  })
})
