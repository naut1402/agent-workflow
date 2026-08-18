import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import PipelineView from '@/features/monitor/components/PipelineView.vue'
import { fetchJob, fetchJobs } from '../../../../../src/features/runner/scripts/runnerApi'
import { runPipelineStep, resetPipelineStep } from '../../../../../src/features/monitor/scripts/PipelineViewApi'

vi.mock('@/features/monitor/scripts/PipelineViewApi', () => ({
  fetchFlowProfile: vi.fn(async () => ({ exists: false, profile: null })),
  saveFlowProfile: vi.fn(async () => ({})),
  patchTaskState: vi.fn(),
  runPipelineStep: vi.fn(),
  resetPipelineStep: vi.fn(),
}))

vi.mock('@/features/runner/scripts/runnerApi', () => ({
  fetchJob: vi.fn(),
  fetchJobs: vi.fn(async () => ({ jobs: [] })),
}))

// VueFlow's canvas (SVG getBBox / ResizeObserver) does not run under jsdom.
// Stub the export so PipelineView's click-routing is tested, not VueFlow itself.
vi.mock('@vue-flow/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vue-flow/core')>()
  return {
    ...actual,
    VueFlow: {
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
    },
  }
})

function mountPipeline(task: Record<string, any>) {
  return mount(PipelineView, {
    props: { task, projectId: null },
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

  it('clicking a future pending node with intermediates offers jump (primary) and chain', async () => {
    vi.mocked(runPipelineStep).mockResolvedValue({ job: { id: 'job-2', status: 'queued' } })
    const task = { task_id: 'T2', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    // implementer is two steps ahead (designer in between) → skip confirm.
    await w.find('[data-testid="node-implementer"]').trigger('click')
    await flushPromises()
    expect(runPipelineStep).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Bỏ qua các bước trung gian')

    await clickModalButton('.modal .btn-primary')
    expect(runPipelineStep).toHaveBeenCalledWith(
      'T2',
      { targetStepId: 'implementer', skipIntermediate: true },
      undefined,
    )
  })

  it('chain secondary button runs from current without skipIntermediate', async () => {
    vi.mocked(runPipelineStep).mockResolvedValue({ job: { id: 'job-2b', status: 'queued' } })
    const task = { task_id: 'T2b', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-implementer"]').trigger('click')
    await flushPromises()
    const chainBtn = Array.from(document.body.querySelectorAll('.modal .btn-ghost')).find((el) =>
      el.textContent?.includes('Chạy từ bước hiện tại'),
    ) as HTMLElement | undefined
    expect(chainBtn).toBeTruthy()
    chainBtn!.click()
    await flushPromises()
    expect(runPipelineStep).toHaveBeenCalledWith('T2b', { targetStepId: 'implementer' }, undefined)
  })

  it('clicking the immediate next step keeps the classic confirm (no skip dialog)', async () => {
    vi.mocked(runPipelineStep).mockResolvedValue({ job: { id: 'job-next', status: 'queued' } })
    const task = { task_id: 'T2c', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-designer"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).not.toContain('Bỏ qua các bước trung gian')
    await clickModalButton('.modal .btn-primary')
    expect(runPipelineStep).toHaveBeenCalledWith('T2c', { targetStepId: 'designer' }, undefined)
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

  it('clicking a past node (before current_phase) does not run and needs no error chip', async () => {
    // implementer is active; designer has no artifact but is behind the cursor →
    // phaseStatus marks it done, so the click is a no-op (not runnable).
    const task = {
      task_id: 'T12',
      current_phase: 'implementer',
      hitl_pending: null,
      artifacts: { 'investigate.md': { exists: true } },
    }
    const w = mountPipeline(task)
    await flushPromises()

    expect(w.findComponent({ name: 'VueFlow' }).props('nodes').find((n: any) => n.id === 'designer').data.status).toBe('done')

    await w.find('[data-testid="node-designer"]').trigger('click')
    await flushPromises()

    expect(runPipelineStep).not.toHaveBeenCalled()
    expect(document.body.querySelector('.modal-backdrop')).toBeNull()
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

  it('marks a past gate-less step executed once the cursor has moved past it', async () => {
    const task = {
      task_id: 'T20b',
      current_phase: 'reviewer',
      hitl_pending: null,
      artifacts: {},
    }
    const w = mountPipeline(task)
    await flushPromises()

    expect(nodeData(w, 'implementer').status).toBe('done')
    expect(nodeData(w, 'implementer').executed).toBe(true)
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

const SAMPLE_PIPELINE = {
  steps: [
    { id: 'investigator', name: 'Investigate', produces: ['investigate.md'] },
    { id: 'designer', name: 'Design', produces: ['design.md'] },
    { id: 'implementer', name: 'Implement', produces: ['phpstan.md'] },
    { id: 'reviewer', name: 'Review', produces: ['review.md', 'test-spec.md'] },
    { id: 'pr-creator', name: 'PR', produces: ['pr-desc.md'] },
  ],
}

describe('PipelineView — artifact / knowledge graph nodes', () => {
  function flowNodes(w: any) {
    return w.findComponent({ name: 'VueFlow' }).props('nodes') as Array<{ id: string; type: string }>
  }

  it('embeds multi-produces as a single art-<stepId> artifact node', async () => {
    const task = {
      task_id: 'T30',
      current_phase: 'investigator',
      hitl_pending: null,
      artifacts: { 'review.md': { exists: true } },
      pipeline: SAMPLE_PIPELINE,
    }
    const w = mountPipeline(task)
    await flushPromises()

    const art = flowNodes(w).find((n) => n.id === 'art-reviewer')
    expect(art).toBeDefined()
    expect(art!.type).toBe('artifact')
    expect(w.find('[data-testid="node-art-reviewer"]').exists()).toBe(true)
  })

  it('clicking an artifact node does not open run confirm or call runPipelineStep', async () => {
    const task = {
      task_id: 'T31',
      current_phase: 'investigator',
      hitl_pending: null,
      artifacts: {},
      pipeline: SAMPLE_PIPELINE,
    }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-art-reviewer"]').trigger('click')
    await flushPromises()

    expect(runPipelineStep).not.toHaveBeenCalled()
    expect(document.body.querySelector('.modal-backdrop')).toBeNull()
  })

  it('does not create art-knowledge when no step has knowledge_inputs', async () => {
    const task = {
      task_id: 'T32',
      current_phase: 'investigator',
      hitl_pending: null,
      artifacts: {},
      pipeline: SAMPLE_PIPELINE,
    }
    const w = mountPipeline(task)
    await flushPromises()

    expect(flowNodes(w).some((n) => n.id === 'art-knowledge')).toBe(false)
  })

  it('regression: clicking node-investigator still opens run confirm', async () => {
    const task = {
      task_id: 'T33',
      current_phase: 'investigator',
      hitl_pending: null,
      artifacts: {},
      pipeline: SAMPLE_PIPELINE,
    }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()

    expect(runPipelineStep).not.toHaveBeenCalled()
    expect(document.body.querySelector('.modal-backdrop')).not.toBeNull()
    expect(document.body.textContent).toContain('Chạy step')
  })
})

// The reset button itself lives inside PipelineNode.vue, which the VueFlow
// stub above does not render — so these tests invoke `data.onReset()`
// directly, the same callback PipelineNode's button calls on click.
describe('PipelineView — reset step confirm', () => {
  function nodeData(w: any, id: string) {
    return w.findComponent({ name: 'VueFlow' }).props('nodes').find((n: any) => n.id === id).data
  }

  function findModalButton(text: string) {
    return Array.from(document.body.querySelectorAll('.modal-actions button')).find((el) =>
      el.textContent?.includes(text),
    ) as HTMLElement | undefined
  }

  it('no cascade available (later steps have no artifacts) → single confirm button', async () => {
    const task = {
      task_id: 'RS1',
      current_phase: 'reviewer',
      hitl_pending: null,
      artifacts: { 'phpstan.md': { exists: true } },
      pipeline: SAMPLE_PIPELINE,
    }
    const w = mountPipeline(task)
    await flushPromises()

    nodeData(w, 'implementer').onReset()
    await flushPromises()

    expect(document.body.querySelector('.modal-backdrop')).not.toBeNull()
    expect(findModalButton('Xoá cả các step sau')).toBeUndefined()
    expect(findModalButton('Chỉ xoá step này')).toBeTruthy()
  })

  it('cascade available (a later step already has an artifact) → two confirm buttons', async () => {
    const task = {
      task_id: 'RS2',
      current_phase: 'completed',
      hitl_pending: null,
      artifacts: { 'phpstan.md': { exists: true }, 'review.md': { exists: true } },
      pipeline: SAMPLE_PIPELINE,
    }
    const w = mountPipeline(task)
    await flushPromises()

    nodeData(w, 'implementer').onReset()
    await flushPromises()

    expect(findModalButton('Chỉ xoá step này')).toBeTruthy()
    expect(findModalButton('Xoá cả các step sau')).toBeTruthy()
    expect(document.body.textContent).toContain('Review')
  })

  it('cascade delete warning lists files from every removed step, not just the clicked node', async () => {
    // Regression for the bug found in review: the warning must include the
    // downstream step's files too, or cascade-deleting silently removes more
    // than what the user was shown.
    const task = {
      task_id: 'RS3',
      current_phase: 'completed',
      hitl_pending: null,
      artifacts: {
        'phpstan.md': { exists: true },
        'review.md': { exists: true },
        'test-spec.md': { exists: true },
      },
      pipeline: SAMPLE_PIPELINE,
    }
    const w = mountPipeline(task)
    await flushPromises()

    nodeData(w, 'implementer').onReset()
    await flushPromises()

    const warning = document.body.querySelector('.editor-error')?.textContent ?? ''
    expect(warning).toContain('phpstan.md')
    expect(warning).toContain('review.md')
    expect(warning).toContain('test-spec.md')
  })

  it('"only this step" confirms with cascade: false', async () => {
    vi.mocked(resetPipelineStep).mockResolvedValue({})
    const task = {
      task_id: 'RS4',
      current_phase: 'completed',
      hitl_pending: null,
      artifacts: { 'phpstan.md': { exists: true }, 'review.md': { exists: true } },
      pipeline: SAMPLE_PIPELINE,
    }
    const w = mountPipeline(task)
    await flushPromises()

    nodeData(w, 'implementer').onReset()
    await flushPromises()
    findModalButton('Chỉ xoá step này')!.click()
    await flushPromises()

    expect(resetPipelineStep).toHaveBeenCalledWith('RS4', { stepId: 'implementer', cascade: false }, undefined)
  })

  it('"delete later steps too" confirms with cascade: true', async () => {
    vi.mocked(resetPipelineStep).mockResolvedValue({})
    const task = {
      task_id: 'RS5',
      current_phase: 'completed',
      hitl_pending: null,
      artifacts: { 'phpstan.md': { exists: true }, 'review.md': { exists: true } },
      pipeline: SAMPLE_PIPELINE,
    }
    const w = mountPipeline(task)
    await flushPromises()

    nodeData(w, 'implementer').onReset()
    await flushPromises()
    findModalButton('Xoá cả các step sau')!.click()
    await flushPromises()

    expect(resetPipelineStep).toHaveBeenCalledWith('RS5', { stepId: 'implementer', cascade: true }, undefined)
  })

  it('reset success shows a toast and asks the parent to refetch (hitl-action)', async () => {
    // Listen via an `onHitlAction` attr instead of `wrapper.emitted()` — in
    // this environment `emitted()` misses custom component emits (same
    // pre-existing quirk documented in FloatingRunningJobsIcon.test.ts), while
    // a plain listener prop is invoked directly by Vue's runtime emit.
    vi.mocked(resetPipelineStep).mockResolvedValue({})
    const onHitlAction = vi.fn()
    const task = {
      task_id: 'RS6',
      current_phase: 'reviewer',
      hitl_pending: null,
      artifacts: { 'phpstan.md': { exists: true } },
      pipeline: SAMPLE_PIPELINE,
    }
    const w = mount(PipelineView, { props: { task, projectId: null }, attrs: { onHitlAction } })
    await flushPromises()

    nodeData(w, 'implementer').onReset()
    await flushPromises()
    findModalButton('Chỉ xoá step này')!.click()
    await flushPromises()

    expect(w.text()).toContain('Đã reset step')
    expect(onHitlAction).toHaveBeenCalled()
  })

  it('shows an error chip on 409 (a job is already running)', async () => {
    const err: any = new Error('step already running')
    err.status = 409
    vi.mocked(resetPipelineStep).mockRejectedValue(err)
    const task = {
      task_id: 'RS7',
      current_phase: 'reviewer',
      hitl_pending: null,
      artifacts: { 'phpstan.md': { exists: true } },
      pipeline: SAMPLE_PIPELINE,
    }
    const w = mountPipeline(task)
    await flushPromises()

    nodeData(w, 'implementer').onReset()
    await flushPromises()
    findModalButton('Chỉ xoá step này')!.click()
    await flushPromises()

    expect(w.find('.chip-err').exists()).toBe(true)
    expect(w.find('.chip-err').text()).toContain('đang có step chạy')
  })

  it('shows a generic error chip on other failures', async () => {
    vi.mocked(resetPipelineStep).mockRejectedValue(new Error('disk full'))
    const task = {
      task_id: 'RS8',
      current_phase: 'reviewer',
      hitl_pending: null,
      artifacts: { 'phpstan.md': { exists: true } },
      pipeline: SAMPLE_PIPELINE,
    }
    const w = mountPipeline(task)
    await flushPromises()

    nodeData(w, 'implementer').onReset()
    await flushPromises()
    findModalButton('Chỉ xoá step này')!.click()
    await flushPromises()

    expect(w.find('.chip-err').text()).toContain('disk full')
  })

  it('cancelling the reset confirm does not call the API', async () => {
    const task = {
      task_id: 'RS9',
      current_phase: 'reviewer',
      hitl_pending: null,
      artifacts: { 'phpstan.md': { exists: true } },
      pipeline: SAMPLE_PIPELINE,
    }
    const w = mountPipeline(task)
    await flushPromises()

    nodeData(w, 'implementer').onReset()
    await flushPromises()
    ;(document.body.querySelector('.modal-close') as HTMLElement).click()
    await flushPromises()

    expect(resetPipelineStep).not.toHaveBeenCalled()
    expect(document.body.querySelector('.modal-backdrop')).toBeNull()
  })
})
