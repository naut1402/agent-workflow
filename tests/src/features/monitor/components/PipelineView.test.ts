import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import PipelineView from '@/features/monitor/components/PipelineView.vue'
import { runPipelineStep } from '@/api'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    fetchFlowProfile: vi.fn(async () => ({ exists: false, profile: null })),
    saveFlowProfile: vi.fn(async () => ({})),
    patchTaskState: vi.fn(),
    runPipelineStep: vi.fn(),
    fetchJob: vi.fn(),
  }
})

// VueFlow renders nodes internally via its own layout/canvas machinery that
// jsdom can't support (ResizeObserver, SVG measurement, …) — stub it with a
// plain list of buttons (one per node) that emit `node-click` the same way
// the real component would, so PipelineView's click-routing logic is what's
// under test, not VueFlow's rendering.
const VueFlowStub = {
  name: 'VueFlow',
  props: ['nodes', 'edges', 'nodeTypes'],
  emits: ['node-click', 'node-drag-stop'],
  template: `
    <div>
      <button
        v-for="n in nodes"
        :key="n.id"
        :data-testid="'node-' + n.id"
        @click="$emit('node-click', { node: n })"
      >{{ n.id }}</button>
    </div>
  `,
}

function mountPipeline(task: Record<string, any>) {
  return mount(PipelineView, {
    props: { task, projectId: null },
    global: { stubs: { VueFlow: VueFlowStub } },
  })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('PipelineView — click a node to run/chain a step', () => {
  it('clicking the active node runs it (targetStepId = itself)', async () => {
    vi.mocked(runPipelineStep).mockResolvedValue({ job: { id: 'job-1', status: 'queued' } })
    const task = { task_id: 'T1', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()

    expect(runPipelineStep).toHaveBeenCalledWith('T1', { targetStepId: 'investigator' }, undefined)
  })

  it('clicking a future pending node chains toward it', async () => {
    vi.mocked(runPipelineStep).mockResolvedValue({ job: { id: 'job-2', status: 'queued' } })
    const task = { task_id: 'T2', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-implementer"]').trigger('click')
    await flushPromises()

    expect(runPipelineStep).toHaveBeenCalledWith('T2', { targetStepId: 'implementer' }, undefined)
  })

  it('clicking a waiting (HITL) node opens the approve modal instead of running', async () => {
    const task = { task_id: 'T3', current_phase: 'investigator', hitl_pending: 'hitl-1', artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()

    expect(runPipelineStep).not.toHaveBeenCalled()
    // Teleported to <body> — not inside the wrapper's own root element.
    expect(document.body.querySelector('.modal-backdrop')).not.toBeNull()
    w.unmount()
  })

  it('clicking a done node does nothing', async () => {
    const task = {
      task_id: 'T4',
      current_phase: 'designer',
      hitl_pending: null,
      artifacts: { 'investigate.md': { exists: true } },
    }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()

    expect(runPipelineStep).not.toHaveBeenCalled()
    expect(w.find('.modal-backdrop').exists()).toBe(false)
  })

  it('does not submit a second run while one is already in flight for this task', async () => {
    vi.mocked(runPipelineStep).mockReturnValue(new Promise(() => {})) // never resolves
    const task = { task_id: 'T5', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-investigator"]').trigger('click')
    await w.find('[data-testid="node-implementer"]').trigger('click')
    await flushPromises()

    expect(runPipelineStep).toHaveBeenCalledTimes(1)
  })

  it('shows an error chip when run-step fails (e.g. 409 already running)', async () => {
    const err: any = new Error('step already running')
    err.status = 409
    vi.mocked(runPipelineStep).mockRejectedValue(err)
    const task = { task_id: 'T6', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()

    expect(w.find('.chip-err').exists()).toBe(true)
  })
})
