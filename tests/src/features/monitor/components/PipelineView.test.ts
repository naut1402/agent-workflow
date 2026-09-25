import { mountWithI18n as mount, createTestI18nPlugin } from '../../../helpers/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount as mountRaw } from '@vue/test-utils'
import { nextTick } from 'vue'
import PipelineView from '@/features/monitor/components/PipelineView.vue'
import { fetchJob, fetchJobs, cancelJob } from '../../../../../src/features/runner/scripts/runnerApi'
import { runPipelineStep, resetPipelineStep, patchTaskState, saveFlowProfile } from '../../../../../src/features/monitor/scripts/PipelineViewApi'
import { writePipelineConfig } from '../../../../../src/features/pipeline-editor/scripts/pipelineEditorApi'

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
  cancelJob: vi.fn(),
}))

// ProfileSwitchDialog (mounted for real when the swap icon is clicked) hits
// these two APIs — mock them here too so opening it from PipelineView doesn't
// call through to unmocked modules.
vi.mock('@/features/pipeline-editor/scripts/ProfileManagerApi', () => ({
  fetchPipelineProfiles: vi.fn(async () => ({ profiles: [{ name: 'dev' }] })),
  fetchPipelineProfile: vi.fn(async () => ({
    pipeline: { steps: [{ id: 'investigator', label: 'Investigate' }] },
  })),
}))

vi.mock('@/features/pipeline-editor/scripts/pipelineEditorApi', () => ({
  writePipelineConfig: vi.fn(async () => ({})),
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

// `PipelineView` schedules a `setTimeout(() => fitView(), 100)` on mount
// (watch(..., { immediate: true }), see src) — a wrapper never unmounted
// leaves that timer pending, and if it fires after the file's jsdom
// environment has torn down, Vitest's worker RPC crashes on the resulting
// console output ("Closing rpc while onUserConsoleLog was pending"). Track
// every mounted wrapper so `afterEach` can unmount it regardless of whether
// the individual test also does so — double-unmount is harmless.
const mountedWrappers: Array<{ unmount: () => void }> = []
function track<T extends { unmount: () => void }>(w: T): T {
  mountedWrappers.push(w)
  return w
}

function mountPipeline(task: Record<string, any>) {
  return track(
    mount(PipelineView, {
      props: { task, projectId: null },
    }),
  )
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
  for (const w of mountedWrappers.splice(0)) {
    try {
      w.unmount()
    } catch {
      // already unmounted by the test itself — harmless.
    }
  }
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

// ---------------------------------------------------------------------------
// Td16ee130 — hai dialog của PipelineView sau khi đổi UI/UX (`test-spec.md`
// nhóm A/B/D). Cả hai Teleport ra <body>, nên mọi truy vấn đi qua
// `document.body` chứ không qua wrapper.
// ---------------------------------------------------------------------------

function modalOpen(): boolean {
  return document.body.querySelector('.modal-backdrop') !== null
}

function modalText(): string {
  return document.body.querySelector('.modal')?.textContent ?? ''
}

/** Hàng nút footer theo đúng thứ tự DOM — dữ liệu để chấm convention (TC-D01/D02). */
function actionButtons(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll('.modal-actions button'))
}

function primaryButton(): HTMLButtonElement {
  return document.body.querySelector('.modal-actions .btn-primary') as HTMLButtonElement
}

function ghostButton(): HTMLButtonElement {
  return document.body.querySelector('.modal-actions .btn-ghost') as HTMLButtonElement
}

function radios(name: string): HTMLInputElement[] {
  return Array.from(document.body.querySelectorAll(`.modal input[type="radio"][name="${name}"]`))
}

function radio(name: string, value: string): HTMLInputElement | undefined {
  return radios(name).find((el) => el.value === value)
}

/** Hai checkbox mở nhóm tuỳ chọn của dialog reset, theo thứ tự DOM. */
function scopeCheckboxes(): HTMLInputElement[] {
  return Array.from(document.body.querySelectorAll('.modal .modal-body input[type="checkbox"]'))
}

function feedbackTextarea(): HTMLTextAreaElement | null {
  return document.body.querySelector('.modal textarea')
}

/** v-model nghe `change` cho radio/checkbox, `input` cho textarea. */
async function toggle(el: HTMLInputElement, next = true) {
  el.checked = next
  el.dispatchEvent(new Event('change'))
  await flushPromises()
}

async function typeInto(el: HTMLTextAreaElement, value: string) {
  el.value = value
  el.dispatchEvent(new Event('input'))
  await flushPromises()
}

// Dialog duyệt mở bằng click vào node đang chờ gate (`hitl_pending`), đúng
// đường người dùng đi — không gọi thẳng hàm nội bộ nào.
async function openHitlDialog(overrides: Record<string, any> = {}) {
  const task = {
    task_id: 'HD1',
    current_phase: 'investigator',
    hitl_pending: 'hitl-1',
    artifacts: {},
    state_mtime: 1700,
    ...overrides,
  }
  const w = mountPipeline(task)
  await flushPromises()
  await w.find('[data-testid="node-investigator"]').trigger('click')
  await flushPromises()
  return w
}

describe('PipelineView — dialog duyệt nội dung (HITL)', () => {
  it('TC-A01: mở dialog — hai radio quyết định chưa chọn cái nào, chưa có ô lý do, hàng nút là Huỷ + Xác nhận và Xác nhận đang disabled', async () => {
    await openHitlDialog()

    const decision = radios('hitl-decision')
    expect(decision.map((el) => el.value)).toEqual(['approve', 'reject'])
    expect(decision.some((el) => el.checked)).toBe(false)
    expect(feedbackTextarea()).toBeNull()
    expect(actionButtons().map((b) => b.textContent?.trim())).toEqual(['Huỷ', 'Xác nhận'])
    expect(primaryButton().disabled).toBe(true)
  })

  it('TC-A02: chọn Duyệt — ô lý do vẫn không hiện, Xác nhận enabled', async () => {
    await openHitlDialog()

    await toggle(radio('hitl-decision', 'approve')!)

    expect(feedbackTextarea()).toBeNull()
    expect(primaryButton().disabled).toBe(false)
  })

  it('TC-A03: chọn Từ chối — ô lý do hiện ra và đang trắng, Xác nhận vẫn disabled', async () => {
    await openHitlDialog()

    await toggle(radio('hitl-decision', 'reject')!)

    expect(feedbackTextarea()).not.toBeNull()
    expect(feedbackTextarea()!.value).toBe('')
    expect(primaryButton().disabled).toBe(true)
  })

  it('TC-A04: Từ chối kèm lý do — Xác nhận enabled', async () => {
    await openHitlDialog()

    await toggle(radio('hitl-decision', 'reject')!)
    await typeInto(feedbackTextarea()!, 'thiếu mục X')

    expect(primaryButton().disabled).toBe(false)
  })

  it('TC-A05: lý do chỉ khoảng trắng không tính là đã nhập', async () => {
    await openHitlDialog()

    await toggle(radio('hitl-decision', 'reject')!)
    await typeInto(feedbackTextarea()!, '   \n\t ')

    expect(primaryButton().disabled).toBe(true)
  })

  it('TC-A06: đổi lại sang Duyệt sau khi đã gõ lý do — ô lý do ẩn đi và request không mang lý do cũ', async () => {
    vi.mocked(patchTaskState).mockResolvedValue({} as any)
    await openHitlDialog()

    await toggle(radio('hitl-decision', 'reject')!)
    await typeInto(feedbackTextarea()!, 'lý do')
    await toggle(radio('hitl-decision', 'approve')!)

    expect(feedbackTextarea()).toBeNull()
    expect(primaryButton().disabled).toBe(false)

    primaryButton().click()
    await flushPromises()

    const body = vi.mocked(patchTaskState).mock.calls[0][1] as Record<string, unknown>
    expect(body.action).toBe('approve')
    expect(body.feedback).toBeUndefined()
  })

  it('TC-A07: submit duyệt — đúng một request duyệt cho step đang xét, dialog đóng, parent được yêu cầu refetch', async () => {
    vi.mocked(patchTaskState).mockResolvedValue({} as any)
    const onHitlAction = vi.fn()
    const task = {
      task_id: 'HD7',
      current_phase: 'investigator',
      hitl_pending: 'hitl-1',
      artifacts: {},
      state_mtime: 1700,
    }
    const w = track(mount(PipelineView, { props: { task, projectId: null }, attrs: { onHitlAction } }))
    await flushPromises()
    await w.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()

    await toggle(radio('hitl-decision', 'approve')!)
    primaryButton().click()
    await flushPromises()

    expect(patchTaskState).toHaveBeenCalledTimes(1)
    const [taskId, body] = vi.mocked(patchTaskState).mock.calls[0]
    expect(taskId).toBe('HD7')
    expect(body).toMatchObject({ action: 'approve', mtime: 1700 })
    expect((body as any).gate_id).toBeTruthy()
    expect(modalOpen()).toBe(false)
    // Step rời trạng thái chờ duyệt qua lượt refetch của parent.
    expect(onHitlAction).toHaveBeenCalled()
  })

  it('TC-A08: submit từ chối — request mang lý do đã trim hai đầu, dialog đóng', async () => {
    vi.mocked(patchTaskState).mockResolvedValue({} as any)
    await openHitlDialog({ task_id: 'HD8' })

    await toggle(radio('hitl-decision', 'reject')!)
    await typeInto(feedbackTextarea()!, '  thiếu mục X  ')
    primaryButton().click()
    await flushPromises()

    expect(patchTaskState).toHaveBeenCalledTimes(1)
    const body = vi.mocked(patchTaskState).mock.calls[0][1] as Record<string, unknown>
    expect(body.action).toBe('reject')
    expect(body.feedback).toBe('thiếu mục X')
    expect(modalOpen()).toBe(false)
  })

  it('TC-A09: Huỷ — không request nào được gửi, dialog đóng', async () => {
    await openHitlDialog()

    await toggle(radio('hitl-decision', 'reject')!)
    await typeInto(feedbackTextarea()!, 'lý do')
    ghostButton().click()
    await flushPromises()

    expect(patchTaskState).not.toHaveBeenCalled()
    expect(modalOpen()).toBe(false)
  })

  it('TC-A10: ô phản hồi dùng hợp đồng style full-width dùng chung của dashboard', async () => {
    // jsdom không tính layout ⇒ chốt bằng class `cfg-textarea` (`_shell.scss`
    // đặt `width: 100%`). Phép đo hình học thật là nợ E2E, xem test-result.md.
    await openHitlDialog()

    await toggle(radio('hitl-decision', 'reject')!)

    expect(feedbackTextarea()!.classList.contains('cfg-textarea')).toBe(true)
    // 🚫 không còn bám `.profile-editor` (khung hẹp của editor flow profile).
    expect(feedbackTextarea()!.classList.contains('profile-editor')).toBe(false)
  })

  it('TC-A11: mở lại dialog sau khi huỷ — không còn vết của lần nhập trước', async () => {
    const w = await openHitlDialog()

    await toggle(radio('hitl-decision', 'reject')!)
    await typeInto(feedbackTextarea()!, 'lý do cũ')
    ghostButton().click()
    await flushPromises()

    await w.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()

    expect(radios('hitl-decision').some((el) => el.checked)).toBe(false)
    expect(feedbackTextarea()).toBeNull()
  })

  it('TC-A12: bấm Xác nhận hai lần trước khi request đầu trả về — chỉ một request được gửi', async () => {
    // Click thứ hai đi qua `nextTick` (không `flushPromises`): Vue đã patch DOM
    // nhưng request vẫn treo — đúng cái xảy ra khi người dùng double-click thật.
    let release: (() => void) | null = null
    vi.mocked(patchTaskState).mockImplementation(
      () => new Promise((r) => { release = () => r({} as any) }) as any,
    )
    await openHitlDialog()

    await toggle(radio('hitl-decision', 'approve')!)
    primaryButton().click()
    await nextTick()
    primaryButton().click()
    await nextTick()

    expect(patchTaskState).toHaveBeenCalledTimes(1)
    release?.()
    await flushPromises()
  })

  it('TC-A13: lỗi từ server — dialog không đóng, có thông báo lỗi, lựa chọn và lý do giữ nguyên', async () => {
    vi.mocked(patchTaskState).mockRejectedValue(new Error('internal server error'))
    await openHitlDialog()

    await toggle(radio('hitl-decision', 'reject')!)
    await typeInto(feedbackTextarea()!, 'thiếu mục X')
    primaryButton().click()
    await flushPromises()

    expect(modalOpen()).toBe(true)
    expect(modalText()).toContain('internal server error')
    expect(radio('hitl-decision', 'reject')!.checked).toBe(true)
    expect(feedbackTextarea()!.value).toBe('thiếu mục X')
  })

  it('TC-A14: lý do rất dài được gửi nguyên vẹn, không cắt ngắn', async () => {
    vi.mocked(patchTaskState).mockResolvedValue({} as any)
    const long = 'x'.repeat(5000)
    await openHitlDialog()

    await toggle(radio('hitl-decision', 'reject')!)
    await typeInto(feedbackTextarea()!, long)
    primaryButton().click()
    await flushPromises()

    expect((vi.mocked(patchTaskState).mock.calls[0][1] as any).feedback).toBe(long)
  })

  it('TC-A15: lý do nhiều dòng / unicode / markdown được gửi nguyên văn và hiển thị lại dưới dạng text', async () => {
    vi.mocked(patchTaskState).mockResolvedValue({} as any)
    const raw = 'dòng 1\ndòng 2 🎉 `code` <script>alert(1)</script>'
    await openHitlDialog()

    await toggle(radio('hitl-decision', 'reject')!)
    await typeInto(feedbackTextarea()!, raw)

    // Giá trị hiển thị lại là text trong textarea, không phải HTML được parse.
    expect(feedbackTextarea()!.value).toBe(raw)
    expect(document.body.querySelector('.modal script')).toBeNull()

    primaryButton().click()
    await flushPromises()
    expect((vi.mocked(patchTaskState).mock.calls[0][1] as any).feedback).toBe(raw)
  })

  it('TC-A16: mỗi radio và ô lý do đều có nhãn liên kết, click nhãn chọn được lựa chọn', async () => {
    await openHitlDialog()

    for (const el of radios('hitl-decision')) {
      const label = el.closest('label')
      expect(label).not.toBeNull()
      expect(label!.textContent?.trim().length).toBeGreaterThan(0)
      // Cùng `name` ⇒ nhóm radio đi được bằng phím mũi tên.
      expect(el.name).toBe('hitl-decision')
    }

    // Click vào nhãn chữ (không phải vào ô tròn) vẫn chọn đúng lựa chọn.
    const rejectLabel = radio('hitl-decision', 'reject')!.closest('label') as HTMLElement
    rejectLabel.click()
    await flushPromises()
    expect(radio('hitl-decision', 'reject')!.checked).toBe(true)

    expect(feedbackTextarea()!.closest('label')).not.toBeNull()
  })
})

// Nút reset nằm trong PipelineNode.vue — VueFlow bị stub nên không render nó.
// Các test dưới gọi `data.onReset()`, đúng callback mà nút đó gọi khi click.
describe('PipelineView — dialog reset step', () => {
  function nodeData(w: any, id: string) {
    return w.findComponent({ name: 'VueFlow' }).props('nodes').find((n: any) => n.id === id).data
  }

  async function openResetDialog(overrides: Record<string, any> = {}, stepId = 'implementer') {
    const task = {
      task_id: 'RS0',
      current_phase: 'reviewer',
      hitl_pending: null,
      artifacts: { 'phpstan.md': { exists: true } },
      pipeline: SAMPLE_PIPELINE,
      ...overrides,
    }
    const w = mountPipeline(task)
    await flushPromises()
    nodeData(w, stepId).onReset()
    await flushPromises()
    return w
  }

  it('TC-B01: mở dialog — hai checkbox phạm vi chưa tick, chưa có lựa chọn phụ thuộc nào, hàng nút là Huỷ + Reset', async () => {
    await openResetDialog()

    const boxes = scopeCheckboxes()
    expect(boxes).toHaveLength(2)
    expect(boxes.every((b) => b.checked)).toBe(false)
    expect(boxes[0].closest('label')?.textContent).toContain('Phạm vi reset')
    expect(boxes[1].closest('label')?.textContent).toContain('Phạm vi xoá tài liệu')

    expect(radios('reset-scope')).toHaveLength(0)
    expect(radios('delete-scope')).toHaveLength(0)
    expect(actionButtons().map((b) => b.textContent?.trim())).toEqual(['Huỷ', 'Reset'])
    // 🚫 cơ chế nút cố định cũ không còn dấu vết nào.
    expect(modalText()).not.toContain('Chỉ xoá step này')
    expect(modalText()).not.toContain('Xoá cả các step sau')
  })

  it('TC-B02: tick Phạm vi reset — chỉ lựa chọn của nhóm này hiện ra', async () => {
    await openResetDialog()

    await toggle(scopeCheckboxes()[0])

    expect(radios('reset-scope').map((el) => el.value)).toEqual(['step', 'onward'])
    expect(radios('delete-scope')).toHaveLength(0)
  })

  it('TC-B03: tick Phạm vi xoá tài liệu — chỉ lựa chọn của nhóm xoá hiện ra (hai nhóm độc lập)', async () => {
    await openResetDialog()

    await toggle(scopeCheckboxes()[1])

    expect(radios('delete-scope').map((el) => el.value)).toEqual(['step', 'onward'])
    expect(radios('reset-scope')).toHaveLength(0)
  })

  it('TC-B04: tick cả hai nhóm — hai cụm lựa chọn hiện đồng thời, chọn độc lập', async () => {
    await openResetDialog({ current_phase: 'completed' })

    await toggle(scopeCheckboxes()[0])
    await toggle(scopeCheckboxes()[1])

    expect(radios('reset-scope')).toHaveLength(2)
    expect(radios('delete-scope')).toHaveLength(2)

    await toggle(radio('reset-scope', 'onward')!)
    expect(radio('delete-scope', 'step')!.checked).toBe(true)
    expect(radio('reset-scope', 'onward')!.checked).toBe(true)
  })

  it('TC-B05: bỏ tick nhóm xoá — lựa chọn đã chọn không âm thầm đi kèm request', async () => {
    vi.mocked(resetPipelineStep).mockResolvedValue({} as any)
    await openResetDialog({ task_id: 'RS5' })

    await toggle(scopeCheckboxes()[1])
    await toggle(radio('delete-scope', 'step')!)
    await toggle(scopeCheckboxes()[1], false)

    expect(radios('delete-scope')).toHaveLength(0)

    primaryButton().click()
    await flushPromises()

    expect(resetPipelineStep).toHaveBeenCalledWith(
      'RS5',
      { stepId: 'implementer', resetScope: 'step', deleteScope: 'none' },
      undefined,
    )
  })

  it('TC-B06: không tick gì rồi bấm Reset — phạm vi mặc định là chỉ step này, không xoá gì', async () => {
    vi.mocked(resetPipelineStep).mockResolvedValue({} as any)
    await openResetDialog({ task_id: 'RS6' })

    primaryButton().click()
    await flushPromises()

    expect(resetPipelineStep).toHaveBeenCalledWith(
      'RS6',
      { stepId: 'implementer', resetScope: 'step', deleteScope: 'none' },
      undefined,
    )
    expect(modalOpen()).toBe(false)
  })

  it('TC-B07: reset onward nhưng không xoá gì — tổ hợp "lùi con trỏ mà không xoá file nào" gửi được', async () => {
    vi.mocked(resetPipelineStep).mockResolvedValue({} as any)
    await openResetDialog({ task_id: 'RS7', current_phase: 'completed' })

    await toggle(scopeCheckboxes()[0])
    await toggle(radio('reset-scope', 'onward')!)
    primaryButton().click()
    await flushPromises()

    expect(resetPipelineStep).toHaveBeenCalledWith(
      'RS7',
      { stepId: 'implementer', resetScope: 'onward', deleteScope: 'none' },
      undefined,
    )
  })

  it('TC-B08: chỉ tick nhóm xoá — reset giữ mặc định step, xoá phạm vi step', async () => {
    vi.mocked(resetPipelineStep).mockResolvedValue({} as any)
    await openResetDialog({ task_id: 'RS8' })

    await toggle(scopeCheckboxes()[1])
    await toggle(radio('delete-scope', 'step')!)
    primaryButton().click()
    await flushPromises()

    expect(resetPipelineStep).toHaveBeenCalledWith(
      'RS8',
      { stepId: 'implementer', resetScope: 'step', deleteScope: 'step' },
      undefined,
    )
  })

  it('TC-B09: phạm vi reset là "chỉ step này" — lựa chọn xoá onward không chọn được và có giải thích', async () => {
    await openResetDialog({ current_phase: 'completed' })

    await toggle(scopeCheckboxes()[0])
    await toggle(radio('reset-scope', 'step')!)
    await toggle(scopeCheckboxes()[1])

    expect(radio('delete-scope', 'onward')!.disabled).toBe(true)
    expect(modalText()).toContain('Chỉ chọn được khi phạm vi reset')
  })

  it('TC-B10: mở rộng phạm vi reset sang onward — lựa chọn xoá onward trở nên chọn được', async () => {
    await openResetDialog({ current_phase: 'completed' })

    await toggle(scopeCheckboxes()[0])
    await toggle(scopeCheckboxes()[1])
    expect(radio('delete-scope', 'onward')!.disabled).toBe(true)

    await toggle(radio('reset-scope', 'onward')!)

    expect(radio('delete-scope', 'onward')!.disabled).toBe(false)
  })

  it('TC-B11: thu hẹp phạm vi reset khi đã chọn xoá onward — không tồn tại trạng thái mâu thuẫn', async () => {
    vi.mocked(resetPipelineStep).mockResolvedValue({} as any)
    await openResetDialog({ task_id: 'RS11', current_phase: 'completed' })

    await toggle(scopeCheckboxes()[0])
    await toggle(radio('reset-scope', 'onward')!)
    await toggle(scopeCheckboxes()[1])
    await toggle(radio('delete-scope', 'onward')!)
    expect(radio('delete-scope', 'onward')!.checked).toBe(true)

    await toggle(radio('reset-scope', 'step')!)

    expect(radio('delete-scope', 'onward')!.checked).toBe(false)
    primaryButton().click()
    await flushPromises()

    // Tổ hợp bị cấm (reset step + xoá onward) không bao giờ rời khỏi UI.
    expect(resetPipelineStep).toHaveBeenCalledWith(
      'RS11',
      { stepId: 'implementer', resetScope: 'step', deleteScope: 'step' },
      undefined,
    )
  })

  it('TC-B12: step cuối pipeline — lựa chọn onward không được chào mời ở cả hai nhóm', async () => {
    await openResetDialog(
      { task_id: 'RS12', current_phase: 'completed', artifacts: { 'pr-desc.md': { exists: true } } },
      'pr-creator',
    )

    await toggle(scopeCheckboxes()[0])
    await toggle(scopeCheckboxes()[1])

    expect(radios('reset-scope').map((el) => el.value)).toEqual(['step'])
    expect(radios('delete-scope').map((el) => el.value)).toEqual(['step'])
  })

  it('TC-B13: cảnh báo xoá liệt kê đúng tài liệu thực sự tồn tại, gồm cả step sau khi chọn onward', async () => {
    await openResetDialog({
      task_id: 'RS13',
      current_phase: 'completed',
      artifacts: {
        'phpstan.md': { exists: true },
        'review.md': { exists: true },
        'test-spec.md': { exists: true },
        'pr-desc.md': { exists: false },
      },
    })

    await toggle(scopeCheckboxes()[1])
    const stepWarning = document.body.querySelector('.modal .editor-error')?.textContent ?? ''
    expect(stepWarning).toContain('phpstan.md')
    expect(stepWarning).not.toContain('review.md')

    await toggle(scopeCheckboxes()[0])
    await toggle(radio('reset-scope', 'onward')!)
    await toggle(radio('delete-scope', 'onward')!)
    const onwardWarning = document.body.querySelector('.modal .editor-error')?.textContent ?? ''
    expect(onwardWarning).toContain('phpstan.md')
    expect(onwardWarning).toContain('review.md')
    expect(onwardWarning).toContain('test-spec.md')
    // Không hứa xoá file chưa sinh ra.
    expect(onwardWarning).not.toContain('pr-desc.md')
  })

  it('TC-B14: step chưa sinh tài liệu nào — không cảnh báo hão', async () => {
    await openResetDialog({ task_id: 'RS14', artifacts: {} })

    await toggle(scopeCheckboxes()[1])

    expect(document.body.querySelector('.modal .editor-error')).toBeNull()
  })

  it('TC-B15: Huỷ — không request nào được gửi, dialog đóng', async () => {
    await openResetDialog({ task_id: 'RS15' })

    await toggle(scopeCheckboxes()[0])
    await toggle(scopeCheckboxes()[1])
    ghostButton().click()
    await flushPromises()

    expect(resetPipelineStep).not.toHaveBeenCalled()
    expect(modalOpen()).toBe(false)
  })

  it('TC-B16: mở lại dialog sau khi huỷ — về đúng trạng thái khởi tạo', async () => {
    const w = await openResetDialog({ task_id: 'RS16' })

    await toggle(scopeCheckboxes()[0])
    await toggle(scopeCheckboxes()[1])
    ghostButton().click()
    await flushPromises()

    nodeData(w, 'implementer').onReset()
    await flushPromises()

    expect(scopeCheckboxes().every((b) => b.checked)).toBe(false)
    expect(radios('reset-scope')).toHaveLength(0)
    expect(radios('delete-scope')).toHaveLength(0)
  })

  it('TC-B17: bấm Reset hai lần liên tiếp — chỉ một request được gửi', async () => {
    let release: (() => void) | null = null
    vi.mocked(resetPipelineStep).mockImplementation(
      () => new Promise((r) => { release = () => r({} as any) }) as any,
    )
    await openResetDialog({ task_id: 'RS17' })

    primaryButton().click()
    await nextTick()
    document.body.querySelector<HTMLButtonElement>('.modal-actions .btn-primary')?.click()
    await nextTick()

    expect(resetPipelineStep).toHaveBeenCalledTimes(1)
    release?.()
    await flushPromises()
  })

  it('TC-B18: lỗi từ server — dialog không đóng, hiện thông báo lỗi, các tuỳ chọn đã tick giữ nguyên', async () => {
    const err: any = new Error('step already running')
    err.status = 409
    vi.mocked(resetPipelineStep).mockRejectedValue(err)
    await openResetDialog({ task_id: 'RS18', current_phase: 'completed' })

    await toggle(scopeCheckboxes()[0])
    await toggle(radio('reset-scope', 'onward')!)
    await toggle(scopeCheckboxes()[1])
    primaryButton().click()
    await flushPromises()

    expect(modalOpen()).toBe(true)
    expect(modalText()).toContain('đang có step chạy')
    expect(scopeCheckboxes()[0].checked).toBe(true)
    expect(scopeCheckboxes()[1].checked).toBe(true)
    expect(radio('reset-scope', 'onward')!.checked).toBe(true)
  })

  it('reset thành công hiện toast và yêu cầu parent refetch (hitl-action)', async () => {
    // Nghe qua attr `onHitlAction` thay vì `wrapper.emitted()` — môi trường này
    // bỏ sót custom emit (quirk đã ghi ở FloatingRunningJobsIcon.test.ts).
    vi.mocked(resetPipelineStep).mockResolvedValue({} as any)
    const onHitlAction = vi.fn()
    const task = {
      task_id: 'RS19',
      current_phase: 'reviewer',
      hitl_pending: null,
      artifacts: { 'phpstan.md': { exists: true } },
      pipeline: SAMPLE_PIPELINE,
    }
    const w = track(mount(PipelineView, { props: { task, projectId: null }, attrs: { onHitlAction } }))
    await flushPromises()
    nodeData(w, 'implementer').onReset()
    await flushPromises()

    primaryButton().click()
    await flushPromises()

    expect(w.text()).toContain('Đã reset step')
    expect(onHitlAction).toHaveBeenCalled()
  })

  it('lỗi chung khi reset hiện nguyên message của server', async () => {
    vi.mocked(resetPipelineStep).mockRejectedValue(new Error('disk full'))
    const w = await openResetDialog({ task_id: 'RS20' })

    primaryButton().click()
    await flushPromises()

    expect(w.find('.chip-err').exists()).toBe(true)
    expect(w.find('.chip-err').text()).toContain('disk full')
  })

  it('đóng bằng dấu ✕ ở đầu dialog cũng không gọi API', async () => {
    await openResetDialog({ task_id: 'RS21' })
    ;(document.body.querySelector('.modal-close') as HTMLElement).click()
    await flushPromises()

    expect(resetPipelineStep).not.toHaveBeenCalled()
    expect(modalOpen()).toBe(false)
  })
})

describe('PipelineView — convention hàng nút hai dialog (nhóm D)', () => {
  function nodeData(w: any, id: string) {
    return w.findComponent({ name: 'VueFlow' }).props('nodes').find((n: any) => n.id === id).data
  }

  it('TC-D01: dialog duyệt — nút huỷ ghost đứng trước, nút xác nhận primary đứng sau, nằm trong .modal-actions ở footer', async () => {
    await openHitlDialog()

    const buttons = actionButtons()
    expect(buttons).toHaveLength(2)
    expect(buttons[0].className).toContain('btn-ghost')
    expect(buttons[1].className).toContain('btn-primary')
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Huỷ', 'Xác nhận'])
    // Hàng nút là anh em của `.modal-body`, không lọt vào vùng cuộn.
    expect(document.body.querySelector('.modal .modal-body .modal-actions')).toBeNull()
    // 🚫 nhãn của cơ chế cũ không còn ở hàng nút.
    const labels = buttons.map((b) => b.textContent?.trim())
    expect(labels).not.toContain('Duyệt')
    expect(labels).not.toContain('Từ chối')
  })

  it('TC-D02: dialog reset — cùng vị trí và thứ tự với dialog duyệt, primary là Reset', async () => {
    const task = {
      task_id: 'CV2',
      current_phase: 'reviewer',
      hitl_pending: null,
      artifacts: { 'phpstan.md': { exists: true } },
      pipeline: SAMPLE_PIPELINE,
    }
    const w = mountPipeline(task)
    await flushPromises()
    nodeData(w, 'implementer').onReset()
    await flushPromises()

    const buttons = actionButtons()
    expect(buttons).toHaveLength(2)
    expect(buttons[0].className).toContain('btn-ghost')
    expect(buttons[1].className).toContain('btn-primary')
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Huỷ', 'Reset'])
    expect(document.body.querySelector('.modal .modal-body .modal-actions')).toBeNull()
  })

  it('TC-D03/TC-D04: Enter và Esc bám hành vi nền chung của dialog dashboard — không dialog nào tự thêm handler', async () => {
    // `review.md` ghi nhận: không dialog nào của dashboard bắt Enter/Esc.
    // Test này khoá hành vi nền đó lại; yêu cầu mới (nếu có) là task riêng.
    vi.mocked(resetPipelineStep).mockResolvedValue({} as any)
    const task = {
      task_id: 'CV3',
      current_phase: 'reviewer',
      hitl_pending: null,
      artifacts: { 'phpstan.md': { exists: true } },
      pipeline: SAMPLE_PIPELINE,
    }
    const w = mountPipeline(task)
    await flushPromises()
    nodeData(w, 'implementer').onReset()
    await flushPromises()

    document.body.querySelector('.modal')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    )
    await flushPromises()
    expect(resetPipelineStep).not.toHaveBeenCalled()
    expect(modalOpen()).toBe(true)

    document.body.querySelector('.modal')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    await flushPromises()
    expect(resetPipelineStep).not.toHaveBeenCalled()
    expect(modalOpen()).toBe(true)

    // Enter khi Xác nhận đang disabled cũng không gửi gì ở dialog duyệt.
    w.unmount()
    document.body.innerHTML = ''
    await openHitlDialog({ task_id: 'CV4' })
    document.body.querySelector('.modal')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    )
    await flushPromises()
    expect(patchTaskState).not.toHaveBeenCalled()
  })

  it('TC-D05/TC-D07: locale en — mọi nhãn mới lấy qua i18n, không rơi về chuỗi tiếng Việt và không còn nhãn cơ chế cũ', async () => {
    const task = {
      task_id: 'CV5',
      current_phase: 'reviewer',
      hitl_pending: null,
      artifacts: { 'phpstan.md': { exists: true } },
      pipeline: SAMPLE_PIPELINE,
    }
    const w = mountRaw(PipelineView, {
      props: { task, projectId: null },
      global: { plugins: [createTestI18nPlugin('en')] },
    })
    await flushPromises()
    nodeData(w, 'implementer').onReset()
    await flushPromises()

    await toggle(scopeCheckboxes()[0])
    await toggle(scopeCheckboxes()[1])

    const text = modalText()
    expect(text).toContain('Reset scope')
    expect(text).toContain('Document deletion scope')
    expect(text).toContain('This step only')
    expect(actionButtons().map((b) => b.textContent?.trim())).toEqual(['Cancel', 'Reset'])
    for (const vi_ of ['Phạm vi reset', 'Phạm vi xoá tài liệu', 'Chỉ step này', 'Huỷ']) {
      expect(text).not.toContain(vi_)
    }
    // 🚫 nhãn cơ chế cũ không còn ở bất kỳ locale nào.
    expect(text).not.toContain('Chỉ xoá step này')
    expect(text).not.toContain('Xoá cả các step sau')
    w.unmount()
    document.body.innerHTML = ''

    const w2 = track(mountRaw(PipelineView, {
      // Dialog duyệt cần một step có gate — SAMPLE_PIPELINE không khai gate nào,
      // nên phần này dùng pipeline mặc định như các test nhóm A.
      props: {
        task: { task_id: 'CV6', current_phase: 'investigator', hitl_pending: 'hitl-1', artifacts: {}, state_mtime: 1 },
        projectId: null,
      },
      global: { plugins: [createTestI18nPlugin('en')] },
    }))
    await flushPromises()
    await w2.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()
    await toggle(radio('hitl-decision', 'reject')!)

    const hitlText = modalText()
    expect(hitlText).toContain('Approve')
    expect(hitlText).toContain('Reject')
    expect(hitlText).toContain('Rejection reason')
    expect(actionButtons().map((b) => b.textContent?.trim())).toEqual(['Cancel', 'Confirm'])
    expect(hitlText).not.toContain('Duyệt')
    expect(hitlText).not.toContain('Từ chối')
  })
})

// The Stop button itself lives inside PipelineNode.vue (not rendered by the
// VueFlow stub above) — these tests invoke `data.onStop()` directly, the same
// callback the button calls on click.
describe('PipelineView — stopping a running step', () => {
  function nodeData(w: any, id: string) {
    return w.findComponent({ name: 'VueFlow' }).props('nodes').find((n: any) => n.id === id).data
  }

  it('stop calls cancelJob with the job id currently being polled', async () => {
    vi.mocked(runPipelineStep).mockResolvedValue({ job: { id: 'job-stop-1', status: 'queued' } })
    vi.mocked(fetchJob).mockResolvedValue({
      job: { status: 'running', metadata: { pipelineStepId: 'investigator' } },
    })
    vi.mocked(cancelJob).mockResolvedValue({})
    const task = { task_id: 'TSTOP1', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()
    await clickModalButton('.modal .btn-primary')

    expect(nodeData(w, 'investigator').running).toBe(true)
    nodeData(w, 'investigator').onStop()
    await flushPromises()

    expect(cancelJob).toHaveBeenCalledWith('job-stop-1')
  })

  it('a cancelled job shows the stop message, not the failure message', async () => {
    vi.mocked(runPipelineStep).mockResolvedValue({ job: { id: 'job-stop-2', status: 'queued' } })
    vi.mocked(fetchJob).mockResolvedValue({
      job: { status: 'cancelled', metadata: { pipelineStepId: 'investigator' } },
    })
    const task = { task_id: 'TSTOP2', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()
    await clickModalButton('.modal .btn-primary')
    await flushPromises()

    expect(w.text()).toContain('Đã dừng step')
    expect(w.text()).not.toContain('Step chạy thất bại')
    expect(nodeData(w, 'investigator').running).toBe(false)
  })

  it('a failed job (not stopped) still shows the failure message', async () => {
    vi.mocked(runPipelineStep).mockResolvedValue({ job: { id: 'job-stop-3', status: 'queued' } })
    vi.mocked(fetchJob).mockResolvedValue({
      job: { status: 'failed', error: null, metadata: { pipelineStepId: 'investigator' } },
    })
    const task = { task_id: 'TSTOP3', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    await w.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()
    await clickModalButton('.modal .btn-primary')
    await flushPromises()

    expect(w.text()).toContain('Step chạy thất bại')
    expect(w.text()).not.toContain('Đã dừng step')
  })
})

// Lưới an toàn cấu trúc cho regression "hàng nút rơi ra ngoài border dưới"
// (task Tb692264f). .modal không khai báo overflow — nó dựa vào .modal-body
// (flex: 1; min-height: 0; overflow-y: auto) để hút phần cao quá max-height:
// 88vh. Modal thiếu .modal-body thì hàng nút bị vẽ ngoài border. jsdom không
// tính layout nên chỉ chốt được cấu trúc; hình học do e2e gánh.
describe('PipelineView — cấu trúc modal (.modal-body)', () => {
  function nodeData(w: any, id: string) {
    return w.findComponent({ name: 'VueFlow' }).props('nodes').find((n: any) => n.id === id).data
  }

  function assertModalContract() {
    const modal = document.body.querySelector('.modal')
    expect(modal).not.toBeNull()
    const bodies = modal!.querySelectorAll('.modal-body')
    // Đúng một: 0 → hàng nút tràn khỏi border; 2 → scrollbar lồng nhau.
    expect(bodies).toHaveLength(1)
    // Head và hàng nút phải cố định, không cuộn theo nội dung.
    expect(bodies[0].querySelector('.modal-head')).toBeNull()
    expect(bodies[0].querySelector('.modal-actions')).toBeNull()
    expect(modal!.querySelectorAll('.modal-actions button').length).toBeGreaterThan(0)
  }

  it('modal HITL', async () => {
    const task = { task_id: 'MB1', current_phase: 'investigator', hitl_pending: 'hitl-1', artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()
    await w.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()
    assertModalContract()
    w.unmount()
  })

  it('modal xác nhận chạy step — nhánh không bỏ qua bước trung gian', async () => {
    const task = { task_id: 'MB2', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()
    await w.find('[data-testid="node-investigator"]').trigger('click')
    await flushPromises()
    assertModalContract()
    w.unmount()
  })

  it('modal xác nhận chạy step — nhánh bỏ qua bước trung gian', async () => {
    const task = { task_id: 'MB3', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()
    await w.find('[data-testid="node-implementer"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('Bỏ qua các bước trung gian')
    assertModalContract()
    w.unmount()
  })

  // Dialog reset giờ chỉ còn MỘT nhánh hàng nút (trước đây tách theo cascade).
  it('modal xác nhận reset — mọi tổ hợp tuỳ chọn vẫn giữ đúng một .modal-body', async () => {
    const task = {
      task_id: 'MB4',
      current_phase: 'completed',
      hitl_pending: null,
      artifacts: { 'phpstan.md': { exists: true }, 'review.md': { exists: true } },
      pipeline: SAMPLE_PIPELINE,
    }
    const w = mountPipeline(task)
    await flushPromises()
    nodeData(w, 'implementer').onReset()
    await flushPromises()
    assertModalContract()

    // Mở cả hai nhóm tuỳ chọn: nội dung dài ra nhưng hợp đồng không đổi.
    const boxes = Array.from(
      document.body.querySelectorAll<HTMLInputElement>('.modal .modal-body input[type="checkbox"]'),
    )
    for (const box of boxes) {
      box.checked = true
      box.dispatchEvent(new Event('change'))
    }
    await flushPromises()
    assertModalContract()
    w.unmount()
  })
})

// TC-01/TC-03/TC-05 — canvas monitor là bề mặt người dùng thấy triệu chứng ①
// ("không có cách nào start pipeline; UI chỉ hiển thị một nút dừng"). Chấm trên
// `data` mà view đưa xuống node — đó là thứ quyết định nút nào render ra.
describe('PipelineView — node điều phối', () => {
  const ORCH_ID = '__orchestrator__'
  const ORCH_PIPELINE = { ...SAMPLE_PIPELINE, orchestrator: { enabled: true, agent: 'a:orch' } }

  function nodeData(w: any, id: string) {
    return w.findComponent({ name: 'VueFlow' }).props('nodes').find((n: any) => n.id === id)?.data
  }

  function orchestratorTask(over: Record<string, any> = {}) {
    return {
      task_id: 'ORCH-1',
      current_phase: 'investigator',
      hitl_pending: null,
      artifacts: {},
      state_mtime: 1000,
      pipeline: ORCH_PIPELINE,
      ...over,
    }
  }

  it('checkbox TẮT ⇒ không có node điều phối trên canvas (TC-26, TC-32)', async () => {
    const w = mountPipeline({ ...orchestratorTask(), pipeline: SAMPLE_PIPELINE })
    await flushPromises()
    expect(nodeData(w, ORCH_ID)).toBeUndefined()
    w.unmount()
  })

  it('checkbox BẬT ⇒ node hiện, ở trạng thái lắng nghe và KHÔNG bận (có Run)', async () => {
    const w = mountPipeline(orchestratorTask())
    await flushPromises()
    expect(nodeData(w, ORCH_ID)).toMatchObject({
      kind: 'orchestrator',
      orchestratorState: 'listening',
      orchestratorBusy: false,
    })
    w.unmount()
  })

  // TC-25 vế (a)+(b): sau khi reset bằng checkbox, node rời trạng thái dừng và
  // lại có Run. Ở đây chấm vế "đã dừng thì vẫn có Run" — đúng chỗ bug gốc.
  it('đã DỪNG ⇒ vẫn không bận, tức node vẫn có đường chạy lại (TC-04)', async () => {
    const w = mountPipeline(orchestratorTask({ orchestrator_halted: true }))
    await flushPromises()
    expect(nodeData(w, ORCH_ID)).toMatchObject({
      orchestratorState: 'halted',
      orchestratorBusy: false,
    })
    w.unmount()
  })

  it('có lượt của node đang chạy ⇒ bận (đổi sang Stop) và trạng thái là dispatching', async () => {
    vi.mocked(fetchJobs).mockResolvedValue({
      jobs: [
        {
          id: 'job-orch',
          status: 'running',
          metadata: { taskId: 'ORCH-1', orchestratorJob: true },
        },
      ],
    } as any)
    const w = mountPipeline(orchestratorTask())
    await flushPromises()
    expect(nodeData(w, ORCH_ID)).toMatchObject({ orchestratorState: 'dispatching', orchestratorBusy: true })
    w.unmount()
  })

  it('có step đang chạy ⇒ node bận, nhưng vẫn ở trạng thái lắng nghe', async () => {
    vi.mocked(fetchJob).mockResolvedValue({
      job: { id: 'job-step', status: 'running', metadata: { taskId: 'ORCH-1', pipelineStepId: 'investigator' } },
    } as any)
    vi.mocked(fetchJobs).mockResolvedValue({
      jobs: [
        {
          id: 'job-step',
          status: 'running',
          metadata: { taskId: 'ORCH-1', pipelineStepId: 'investigator' },
        },
      ],
    } as any)
    const w = mountPipeline(orchestratorTask())
    await flushPromises()
    expect(nodeData(w, ORCH_ID)).toMatchObject({ orchestratorState: 'listening', orchestratorBusy: true })
    w.unmount()
  })

  it('node mang đủ hai handler Run/Stop để không có trạng thái cụt đường', async () => {
    const w = mountPipeline(orchestratorTask())
    await flushPromises()
    const data = nodeData(w, ORCH_ID)
    expect(typeof data.onRun).toBe('function')
    expect(typeof data.onStop).toBe('function')
    w.unmount()
  })

  // TC-13 — khung chat mở từ node phải trỏ vào chính node, không vào step nào.
  it('khung chat của node trỏ đúng stepId của node', async () => {
    const w = mountPipeline(orchestratorTask())
    await flushPromises()
    expect(nodeData(w, ORCH_ID).stepId).toBe(ORCH_ID)
    expect(nodeData(w, ORCH_ID).executed).toBe(true)
    w.unmount()
  })

  // Bug B (test-spec.md TC-15…TC-20) — root cause G2: trước fix, node chỉ
  // re-sync khi `props.task.state_mtime` đổi giá trị. Nhưng vòng lặp orchestrator
  // "đang nghĩ" giữa hai lần dispatch KHÔNG ghi state file, nên `state_mtime` bất
  // biến trong lúc chính đó. Các case dưới đây cố tình giữ NGUYÊN `state_mtime`
  // và chỉ đổi identity của object `task` (đúng như `collectTasks()` làm ở mỗi
  // snapshot SSE) — nếu watch còn bám `state_mtime` như code cũ, các case này đỏ.
  it('TC-15/TC-18: có lượt orchestrator mới dù state_mtime KHÔNG đổi ⇒ node chuyển dispatching ngay, không đứng hình', async () => {
    vi.mocked(fetchJobs).mockResolvedValue({ jobs: [] } as any)
    const w = mountPipeline(orchestratorTask())
    await flushPromises()
    expect(nodeData(w, ORCH_ID)).toMatchObject({ orchestratorState: 'listening', orchestratorBusy: false })

    vi.mocked(fetchJobs).mockResolvedValue({
      jobs: [{ id: 'job-orch-2', status: 'running', metadata: { taskId: 'ORCH-1', orchestratorJob: true } }],
    } as any)
    // Object MỚI (identity khác) nhưng state_mtime giữ nguyên 1000 — đúng khoảng
    // "giữa hai lượt quyết định" mà request.md mô tả cho triệu chứng ②.
    await w.setProps({ task: orchestratorTask() })
    await flushPromises()

    expect(nodeData(w, ORCH_ID)).toMatchObject({ orchestratorState: 'dispatching', orchestratorBusy: true })
    w.unmount()
  })

  // TC-16/TC-17 — Stop (người bấm) và tự halt (agent tự quyết định) phải cập
  // nhật UI như nhau: request.md không phân biệt nguồn gốc dừng.
  it('TC-16/TC-17: dừng (Stop hoặc tự halt) ⇒ hết "đang lắng nghe" ngay dù state_mtime không đổi', async () => {
    vi.mocked(fetchJobs).mockResolvedValue({
      jobs: [{ id: 'job-orch-3', status: 'running', metadata: { taskId: 'ORCH-1', orchestratorJob: true } }],
    } as any)
    const w = mountPipeline(orchestratorTask())
    await flushPromises()
    expect(nodeData(w, ORCH_ID)).toMatchObject({ orchestratorState: 'dispatching', orchestratorBusy: true })

    vi.mocked(fetchJobs).mockResolvedValue({ jobs: [] } as any)
    await w.setProps({ task: orchestratorTask({ orchestrator_halted: true }) }) // cùng state_mtime: 1000
    await flushPromises()

    expect(nodeData(w, ORCH_ID)).toMatchObject({ orchestratorState: 'halted', orchestratorBusy: false })
    w.unmount()
  })

  // TC-19 — chuyển trạng thái dồn dập vẫn phải hội tụ đúng vào giá trị mới nhất
  // ở mỗi bước, không kẹt ở trạng thái trung gian của bước trước.
  it('TC-19: start → stop → start liên tiếp ⇒ luôn phản ánh đúng trạng thái mới nhất', async () => {
    vi.mocked(fetchJobs).mockResolvedValue({ jobs: [] } as any)
    const w = mountPipeline(orchestratorTask())
    await flushPromises()

    vi.mocked(fetchJobs).mockResolvedValue({
      jobs: [{ id: 'job-a', status: 'running', metadata: { taskId: 'ORCH-1', orchestratorJob: true } }],
    } as any)
    await w.setProps({ task: orchestratorTask() })
    await flushPromises()
    expect(nodeData(w, ORCH_ID)).toMatchObject({ orchestratorState: 'dispatching' })

    vi.mocked(fetchJobs).mockResolvedValue({ jobs: [] } as any)
    await w.setProps({ task: orchestratorTask({ orchestrator_halted: true }) })
    await flushPromises()
    expect(nodeData(w, ORCH_ID)).toMatchObject({ orchestratorState: 'halted' })

    vi.mocked(fetchJobs).mockResolvedValue({
      jobs: [{ id: 'job-b', status: 'running', metadata: { taskId: 'ORCH-1', orchestratorJob: true } }],
    } as any)
    await w.setProps({ task: orchestratorTask() })
    await flushPromises()
    expect(nodeData(w, ORCH_ID)).toMatchObject({ orchestratorState: 'dispatching', orchestratorBusy: true })
    w.unmount()
  })

  // TC-20 (mở lại/refresh giữa lúc đang chạy) — bề mặt là mount ĐẦU ("reload" =
  // component mount mới với `fetchJobs` đã có job orchestrator từ trước). Đã có
  // coverage tương đương ở case "có lượt của node đang chạy ⇒ bận..." phía trên
  // (initial mount, không phải setProps) — không lặp lại ở đây.
})

// TC-A1/TC-A2/TC-A8 (T21270146) — canvas monitor: node điều phối vẽ hub edge
// tới từng step khi bật, giữ nguyên chuỗi step-step khi tắt.
describe('PipelineView — hub edge', () => {
  const ORCH_ID = '__orchestrator__'
  const HUB_PIPELINE = { ...SAMPLE_PIPELINE, orchestrator: { enabled: true, agent: 'a:orch' } }

  function flowEdges(w: any): any[] {
    // Loại edge dữ liệu (`de-*`, phái sinh từ artifact/knowledge) — chỉ so control/hub edge.
    return (w.findComponent({ name: 'VueFlow' }).props('edges') as any[]).filter(
      (e) => !String(e.id).startsWith('de-'),
    )
  }

  function nodeData(w: any, id: string) {
    return w.findComponent({ name: 'VueFlow' }).props('nodes').find((n: any) => n.id === id)?.data
  }

  it('TC-A1: bật ⇒ mỗi step có đúng 1 edge từ node điều phối, không còn edge step-step', async () => {
    const task = {
      task_id: 'HUB1',
      current_phase: 'investigator',
      hitl_pending: null,
      artifacts: {},
      pipeline: HUB_PIPELINE,
    }
    const w = mountPipeline(task)
    await flushPromises()

    const edges = flowEdges(w)
    expect(edges).toHaveLength(SAMPLE_PIPELINE.steps.length)
    expect(edges.every((e) => e.source === ORCH_ID)).toBe(true)
    expect(edges.map((e) => e.target).sort()).toEqual(SAMPLE_PIPELINE.steps.map((s) => s.id).sort())
    w.unmount()
  })

  it('TC-A2: tắt ⇒ edges là chuỗi step-step nối tiếp như cũ, không có edge nào từ node điều phối', async () => {
    const task = {
      task_id: 'HUB2',
      current_phase: 'investigator',
      hitl_pending: null,
      artifacts: {},
      pipeline: SAMPLE_PIPELINE,
    }
    const w = mountPipeline(task)
    await flushPromises()

    const edges = flowEdges(w)
    expect(edges).toHaveLength(SAMPLE_PIPELINE.steps.length - 1)
    expect(edges.every((e) => e.source !== ORCH_ID && e.target !== ORCH_ID)).toBe(true)
    w.unmount()
  })

  it('TC-A8 (regression): trạng thái step (active/done) vẫn hiển thị đúng ở chế độ hub edge', async () => {
    const task = {
      task_id: 'HUB3',
      current_phase: 'designer',
      hitl_pending: null,
      artifacts: { 'investigate.md': { exists: true } },
      pipeline: HUB_PIPELINE,
    }
    const w = mountPipeline(task)
    await flushPromises()

    expect(nodeData(w, 'designer')?.status).toBe('active')
    expect(nodeData(w, 'investigator')?.status).toBe('done')
    w.unmount()
  })
})

// Tebf65c74 — 2 icon mới góc trên-phải canvas: auto-layout + đổi pipeline profile.
// AC-1/AC-3: overlay chỉ render khi task editable (D3 — ẩn cả 2 icon cùng lúc
// trên task archived/completed, xem design.md §2 D3 + test-spec.md TC-14).
describe('PipelineView — canvas corner actions (auto-layout, đổi profile)', () => {
  it('TC-02/TC-13: overlay góc trên-phải render đủ 2 icon (layout, đổi profile) khi task đang chỉnh sửa được', async () => {
    const task = { task_id: 'CA1', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    const actions = w.find('.canvas-corner-actions')
    expect(actions.exists()).toBe(true)
    const buttons = actions.findAll('button.icon-btn')
    expect(buttons).toHaveLength(2)

    // TC-12: mỗi icon-only button phải có title/aria-label đọc được — không có
    // nhãn này thì Tab-focus tới nút cũng không biết nút làm gì.
    expect(buttons[0].attributes('aria-label')).toBe('Tự sắp xếp layout')
    expect(buttons[0].attributes('title')).toBe('Tự sắp xếp layout')
    expect(buttons[1].attributes('aria-label')).toBe('Đổi pipeline profile')
    expect(buttons[1].attributes('title')).toBe('Đổi pipeline profile')
    w.unmount()
  })

  it('TC-14: ẩn cả 2 icon khi task đã archived', async () => {
    const task = { task_id: 'CA2', current_phase: 'investigator', hitl_pending: null, artifacts: {}, archived: true }
    const w = mountPipeline(task)
    await flushPromises()

    expect(w.find('.canvas-corner-actions').exists()).toBe(false)
    w.unmount()
  })

  it('TC-14: ẩn cả 2 icon khi task đã ở current_phase completed', async () => {
    const task = { task_id: 'CA3', current_phase: 'completed', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    expect(w.find('.canvas-corner-actions').exists()).toBe(false)
    w.unmount()
  })

  it('TC-09/TC-10: click icon auto-layout dàn đều phaseKeys theo NODE_SPACING/NODE_Y, giữ nguyên tập step', async () => {
    const task = { task_id: 'CA4', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    const layoutBtn = w.findAll('.canvas-corner-actions button.icon-btn')[0]
    await layoutBtn.trigger('click')
    await flushPromises()

    expect(saveFlowProfile).toHaveBeenCalledTimes(1)
    const [taskId, payload] = vi.mocked(saveFlowProfile).mock.calls[0]
    expect(taskId).toBe('CA4')
    // Tập step + thứ tự không đổi so với phaseKeys mặc định (investigator →
    // designer → implementer → reviewer → pr-creator) — chỉ toạ độ đổi.
    expect((payload as any).phases.map((p: any) => p.key)).toEqual([
      'investigator',
      'designer',
      'implementer',
      'reviewer',
      'pr-creator',
    ])
    expect((payload as any).phases).toEqual([
      { key: 'investigator', x: 0, y: 40 },
      { key: 'designer', x: 200, y: 40 },
      { key: 'implementer', x: 400, y: 40 },
      { key: 'reviewer', x: 600, y: 40 },
      { key: 'pr-creator', x: 800, y: 40 },
    ])
    w.unmount()
  })

  it('TC-11: bấm auto-layout nhiều lần liên tiếp không lỗi, kết quả cuối vẫn nhất quán', async () => {
    const task = { task_id: 'CA5', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    const layoutBtn = w.findAll('.canvas-corner-actions button.icon-btn')[0]
    await layoutBtn.trigger('click')
    await layoutBtn.trigger('click')
    await layoutBtn.trigger('click')
    await flushPromises()

    expect(saveFlowProfile).toHaveBeenCalledTimes(3)
    // Mỗi lượt ghi đè cùng một kết quả xác định — không debounce (§4.4 #3),
    // không có step nào biến mất/trùng lặp ở lần gọi cuối.
    const lastCall = vi.mocked(saveFlowProfile).mock.calls.at(-1)![1] as any
    expect(lastCall.phases.map((p: any) => p.key)).toEqual([
      'investigator',
      'designer',
      'implementer',
      'reviewer',
      'pr-creator',
    ])
    expect(w.find('.canvas-corner-actions').exists()).toBe(true)
    w.unmount()
  })

  it('TC-04: click icon đổi profile mở dialog, người dùng vẫn ở màn Monitor', async () => {
    const task = { task_id: 'CA6', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    const swapBtn = w.findAll('.canvas-corner-actions button.icon-btn')[1]
    await swapBtn.trigger('click')
    await flushPromises()

    const dialog = document.body.querySelector('.modal[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-label')).toBe('Đổi pipeline profile')
    // Không điều hướng/rời PipelineView — component vẫn còn nguyên trong DOM.
    expect(w.find('.vflow-container').exists()).toBe(true)
    w.unmount()
  })

  it('TC-04: dialog nhận đúng task-id/project-id/hitl-pending khi mở', async () => {
    const task = {
      task_id: 'CA7',
      current_phase: 'investigator',
      hitl_pending: 'hitl-1',
      artifacts: {},
    }
    const w = mount(PipelineView, { props: { task, projectId: 'proj-9' } })
    await flushPromises()

    const swapBtn = w.findAll('.canvas-corner-actions button.icon-btn')[1]
    await swapBtn.trigger('click')
    await flushPromises()
    // hitlPending=true chỉ hiện cảnh báo SAU khi người dùng chọn 1 profile —
    // chọn option đầu tiên (duy nhất, mock trả về 1 profile 'dev') để bộc lộ nó.
    const select = document.body.querySelector('.modal select') as HTMLSelectElement
    expect(select).not.toBeNull()
    select.value = 'dev'
    select.dispatchEvent(new Event('change'))
    await flushPromises()

    expect(document.body.textContent).toContain('Task đang có gate HITL chờ duyệt — ghi đè pipeline sẽ huỷ gate đó.')
    w.unmount()
  })

  it('TC-05: chọn profile và Áp dụng → writePipelineConfig ghi pipeline task, dialog đóng và Monitor được báo refetch', async () => {
    const task = { task_id: 'CA8', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mount(PipelineView, { props: { task, projectId: 'proj-1' } })
    await flushPromises()

    await w.findAll('.canvas-corner-actions button.icon-btn')[1].trigger('click')
    await flushPromises()

    const select = document.body.querySelector('.modal select') as HTMLSelectElement
    select.value = 'dev'
    select.dispatchEvent(new Event('change'))
    await flushPromises()

    const applyBtn = document.body.querySelector('.modal .btn-primary') as HTMLButtonElement
    expect(applyBtn.disabled).toBe(false)
    applyBtn.click()
    await flushPromises()

    expect(writePipelineConfig).toHaveBeenCalledWith(
      'task',
      { steps: [{ id: 'investigator', label: 'Investigate' }] },
      'CA8',
      'proj-1',
    )
    // Dialog tự đóng sau khi ghi thành công (khác đường lỗi TC-08).
    expect(document.body.querySelector('.modal[role="dialog"]')).toBeNull()
    // Cha (MonitorLayout) refetch task để canvas vẽ lại theo pipeline vừa ghi.
    expect(w.emitted('hitl-action')).toBeTruthy()
    w.unmount()
  })

  it('TC-06: huỷ dialog mà không chọn/xác nhận → không gọi writePipelineConfig, pipeline task không đổi', async () => {
    const task = { task_id: 'CA9', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    await w.findAll('.canvas-corner-actions button.icon-btn')[1].trigger('click')
    await flushPromises()
    expect(document.body.querySelector('.modal[role="dialog"]')).not.toBeNull()

    const cancelBtn = document.body.querySelector('.modal .btn-ghost') as HTMLButtonElement
    cancelBtn.click()
    await flushPromises()

    expect(writePipelineConfig).not.toHaveBeenCalled()
    expect(document.body.querySelector('.modal[role="dialog"]')).toBeNull()
    expect(w.emitted('hitl-action')).toBeFalsy()
    w.unmount()
  })

  it('TC-08: writePipelineConfig lỗi 400 (task archived/completed giữa lúc dialog mở) → hiện lỗi inline, dialog không tự đóng, không refetch', async () => {
    vi.mocked(writePipelineConfig).mockRejectedValueOnce({ status: 400 })
    const task = { task_id: 'CA10', current_phase: 'investigator', hitl_pending: null, artifacts: {} }
    const w = mountPipeline(task)
    await flushPromises()

    await w.findAll('.canvas-corner-actions button.icon-btn')[1].trigger('click')
    await flushPromises()
    const select = document.body.querySelector('.modal select') as HTMLSelectElement
    select.value = 'dev'
    select.dispatchEvent(new Event('change'))
    await flushPromises()

    const applyBtn = document.body.querySelector('.modal .btn-primary') as HTMLButtonElement
    applyBtn.click()
    await flushPromises()

    expect(document.body.querySelector('.modal[role="dialog"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Task đã archived hoặc hoàn tất — không thể ghi pipeline mới.')
    expect(w.emitted('hitl-action')).toBeFalsy()
    w.unmount()
  })
})
