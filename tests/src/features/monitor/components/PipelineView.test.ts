import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import PipelineView from '@/features/monitor/components/PipelineView.vue'
import { fetchJob, fetchJobs } from '../../../../../src/features/runner/scripts/runnerApi'
import { runPipelineStep } from '../../../../../src/features/monitor/scripts/PipelineViewApi'

vi.mock('@/features/monitor/scripts/PipelineViewApi', () => ({
  fetchFlowProfile: vi.fn(async () => ({ exists: false, profile: null })),
  saveFlowProfile: vi.fn(async () => ({})),
  patchTaskState: vi.fn(),
  runPipelineStep: vi.fn(),
}))

vi.mock('@/features/runner/scripts/runnerApi', () => ({
  fetchJob: vi.fn(),
  fetchJobs: vi.fn(async () => ({ jobs: [] })),
}))

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

// Run-confirm / HITL modals are Teleported to <body> — not inside the
// wrapper's own root element — so they're queried/clicked via the raw DOM.
async function clickModalButton(selector: string) {
  const btn = document.body.querySelector(selector) as HTMLElement | null
  expect(btn).not.toBeNull()
  btn!.click()
  await flushPromises()
}

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('PipelineView — click a node to run/chain a step', () => {
  it('clicking the active node opens a confirm dialog instead of running immediately', async () => {
    const task = { task_id: 'T1', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()

    expect(runPipelineStep).not.toHaveBeenCalled()
    expect(document.body.querySelector('.modal-backdrop')).not.toBeNull()
    expect(document.body.textContent).toContain('Chạy step')
  })

  it('confirming the dialog runs the step (targetStepId = itself)', async () => {
    vi.mocked(runPipelineStep).mockResolvedValue({ job: { id: 'job-1', status: 'queued' } })
    const task = { task_id: 'T1', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()
    await clickModalButton('.modal .btn-primary')

    expect(runPipelineStep).toHaveBeenCalledWith('T1', { targetStepId: 'investigator' }, undefined)
  })

  it('cancelling the confirm dialog does not run the step', async () => {
    const task = { task_id: 'T1', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()
    await clickModalButton('.modal .btn-ghost')

    expect(runPipelineStep).not.toHaveBeenCalled()
    expect(document.body.querySelector('.modal-backdrop')).toBeNull()
  })

  it('clicking a future pending node opens a confirm dialog, then chains toward it once confirmed', async () => {
    vi.mocked(runPipelineStep).mockResolvedValue({ job: { id: 'job-2', status: 'queued' } })
    const task = { task_id: 'T2', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-implementer"]').trigger('click')
    await flushPromises()
    expect(runPipelineStep).not.toHaveBeenCalled()

    await clickModalButton('.modal .btn-primary')
    expect(runPipelineStep).toHaveBeenCalledWith('T2', { targetStepId: 'implementer' }, undefined)
  })

  it('warns about overwriting the clicked node\'s own artifact when it already exists (e.g. rerunning after a HITL reject)', async () => {
    // current_phase === the clicked node here (investigator) — the realistic
    // case an active node still has an existing artifact: it was rejected via
    // HITL, hitl_pending cleared, current_phase stays put, and the artifact
    // from the earlier attempt is still on disk.
    const task = {
      task_id: 'T7',
      current_phase: 'investigator',
      hitl_pending: null,
      artifacts: { 'investigate.md': { exists: true } },
    }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('investigate.md')
    expect(document.body.querySelector('.modal .btn-primary')?.textContent).toContain('Ghi đè')
  })

  it('does not warn when the clicked node has no existing artifact yet', async () => {
    const task = { task_id: 'T8', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()

    expect(document.body.querySelector('.modal .btn-primary')?.textContent).not.toContain('Ghi đè')
  })

  it('clicking a far pending node ignores another phase\'s existing artifact (e.g. current_phase\'s)', async () => {
    // A `pending` node can never itself already have an existing artifact —
    // phaseStatus would classify it as `done` instead (and done nodes aren't
    // clickable) — so the only way this scenario differs from "no warning" is
    // if some *other* phase's artifact leaked into the check. It must not.
    const task = {
      task_id: 'T10',
      current_phase: 'investigator',
      hitl_pending: null,
      artifacts: { 'investigate.md': { exists: true } },
    }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-implementer"]').trigger('click')
    await flushPromises()

    expect(document.body.querySelector('.modal .btn-primary')?.textContent).not.toContain('Ghi đè')
    expect(document.body.textContent).not.toContain('investigate.md')
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
    expect(document.body.querySelector('.modal-backdrop')).toBeNull()
  })

  it('does not open a second confirm dialog while a run is already in flight for this task', async () => {
    vi.mocked(runPipelineStep).mockReturnValue(new Promise(() => {})) // never resolves
    const task = { task_id: 'T5', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()
    await clickModalButton('.modal .btn-primary')

    await w.find('[data-testid="node-implementer"]').trigger('click')
    await flushPromises()

    expect(runPipelineStep).toHaveBeenCalledTimes(1)
    expect(document.body.querySelector('.modal-backdrop')).toBeNull()
  })

  it('blocks click-to-run while an existing job for the task is still queued/running', async () => {
    vi.mocked(fetchJobs).mockResolvedValue({
      jobs: [
        {
          id: 'job-create',
          status: 'running',
          metadata: { taskId: 'T13', pipelineStepId: 'investigator' },
        },
      ],
    } as any)
    vi.mocked(fetchJob).mockReturnValue(new Promise(() => {})) // keep polling

    const task = { task_id: 'T13', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()

    expect(runPipelineStep).not.toHaveBeenCalled()
    expect(document.body.querySelector('.modal-backdrop')).toBeNull()
    expect(w.find('.chip-err').exists()).toBe(true)
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
    await clickModalButton('.modal .btn-primary')

    expect(w.find('.chip-err').exists()).toBe(true)
  })

  it('does not open run confirm when task state is broken (state_ok: false)', async () => {
    const task = {
      task_id: 'T11',
      current_phase: 'investigator',
      hitl_pending: null,
      artifacts: {},
      state_ok: false,
    }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()

    expect(runPipelineStep).not.toHaveBeenCalled()
    expect(document.body.querySelector('.modal-backdrop')).toBeNull()
    expect(w.find('.chip-err').exists()).toBe(true)
  })

  it('clicking a past pending node (before current_phase) does not run current step', async () => {
    // implementer is active; designer has no artifact → pending, but before current.
    // Must not submit (server would start implementer and look like "clicked design, ran implement").
    const task = {
      task_id: 'T12',
      current_phase: 'implementer',
      hitl_pending: null,
      artifacts: { 'investigate.md': { exists: true } },
    }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-designer"]').trigger('click')
    await flushPromises()

    expect(runPipelineStep).not.toHaveBeenCalled()
    expect(document.body.querySelector('.modal-backdrop')).toBeNull()
    expect(w.find('.chip-err').exists()).toBe(true)
  })
})

// The chat action on a node is gated on `data.executed` — only a step with a CLI
// session has history to replay. VueFlow is stubbed, so the flag is asserted on
// the node data PipelineView hands it.
describe('PipelineView — node data for the chat action', () => {
  function nodeData(w: any, id: string) {
    return w.findComponent({ name: 'VueFlow' }).props('nodes').find((n: any) => n.id === id).data
  }

  it('marks a step executed once its artifact exists, and passes the step identity', async () => {
    const task = {
      task_id: 'T20',
      current_phase: 'implementer',
      hitl_pending: null,
      artifacts: { 'investigate.md': { exists: true } },
    }
    const w = mountPipeline(task)
    await flushPromises()

    expect(nodeData(w, 'investigator')).toMatchObject({ taskId: 'T20', stepId: 'investigator', executed: true })
    // Never ran → no chat history to show.
    expect(nodeData(w, 'reviewer').executed).toBe(false)
  })

  it('a step waiting at its HITL gate counts as executed', async () => {
    const task = { task_id: 'T21', current_phase: 'designer', hitl_pending: 'hitl-1', artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    const investigator = nodeData(w, 'investigator')
    expect(investigator.status).toBe('waiting')
    expect(investigator.executed).toBe(true)
  })

  it('a step that ran and failed stays active but still counts as executed', async () => {
    // current_phase never advanced, yet the artifact from that run exists.
    const task = {
      task_id: 'T22',
      current_phase: 'designer',
      hitl_pending: null,
      artifacts: { 'design.md': { exists: true } },
    }
    const w = mountPipeline(task)
    await flushPromises()

    const designer = nodeData(w, 'designer')
    expect(designer.status).toBe('active')
    expect(designer.executed).toBe(true)
  })
})
