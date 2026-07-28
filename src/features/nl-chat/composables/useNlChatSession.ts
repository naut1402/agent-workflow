import { ref } from 'vue'
import {
  startNlChat,
  sendNlChatMessage,
  fetchNlChatTurn,
  cancelNlChat,
  fetchJob,
  fetchCatalog,
  createTask,
  savePipelineProfile,
  saveCustomAgent,
} from '../../../api'

// Drives the floating NL chat surface end to end: pick an entity type, chat
// multi-turn with the `nl-chat-builder` agent (via the job runner) until it
// hands back a draft, let the user tweak the draft, then persist it through
// the SAME create APIs the existing dialogs use (createTask /
// savePipelineProfile / saveCustomAgent) — see design.md F0012 §4.2.
// Kept as a composable (no render needed) so the state machine is
// unit-testable by mocking the API client, same pattern as useAgentBuild.ts.

export type NlChatEntityType = 'task' | 'pipeline' | 'agent'
export type NlChatStep = 'selectEntity' | 'chatting' | 'previewDraft' | 'confirming' | 'done' | 'error'

export interface NlChatMessage {
  role: 'user' | 'assistant'
  text: string
}

interface JobLike {
  id?: string
  status?: string
  error?: string
}

export interface UseNlChatSessionOptions {
  getProjectId: () => string | undefined
  runnerId?: string
  pollMs?: number
  maxWaitMs?: number
  /** Soft nudge threshold (design.md §4.4 "quá nhiều turn") — not a hard cap. */
  nudgeAfterTurns?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTerminal(status?: string): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

export function useNlChatSession(opts: UseNlChatSessionOptions) {
  const step = ref<NlChatStep>('selectEntity')
  const entityType = ref<NlChatEntityType | null>(null)
  const messages = ref<NlChatMessage[]>([])
  const draft = ref<Record<string, unknown> | null>(null)
  const pipelineName = ref('')

  const chatSessionId = ref<string | null>(null)
  const sending = ref(false)
  const confirming = ref(false)
  const error = ref<string | null>(null)
  const turnCount = ref(0)
  const showLongChatNudge = ref(false)

  // design.md §4.4 edge case "Pipeline draft tham chiếu agent ref không có
  // trong catalog": `CreateTaskPipeline` stays `.passthrough()` (no Zod
  // tightening — §3.1), so this client-side guard is the ONLY thing that
  // stops a pipeline draft with a bogus `steps[].agent` ref from reaching
  // "Xác nhận". Loaded once per pipeline draft (catalog rarely changes
  // mid-session); re-validated against the live-edited draft right before
  // `confirm()` actually calls `savePipelineProfile()` as a hard safety net,
  // in addition to `ChatWindow.vue` disabling the button reactively.
  const catalogAgentIds = ref<Set<string> | null>(null)
  const catalogError = ref<string | null>(null)
  const loadingCatalog = ref(false)

  const pollMs = opts.pollMs ?? 1200
  const maxWaitMs = opts.maxWaitMs ?? 5 * 60 * 1000
  const nudgeAfterTurns = opts.nudgeAfterTurns ?? 8

  function selectEntity(type: NlChatEntityType): void {
    entityType.value = type
    step.value = 'chatting'
    error.value = null
  }

  async function pollJob(id: string): Promise<JobLike> {
    const deadline = Date.now() + maxWaitMs
    for (;;) {
      const res = await fetchJob(id)
      const job: JobLike | undefined = res?.job
      if (!job) throw new Error('job missing')
      if (isTerminal(job.status)) return job
      if (Date.now() >= deadline) return { ...job, status: 'failed', error: 'timeout waiting for job' }
      await sleep(pollMs)
    }
  }

  async function loadCatalogIfNeeded(): Promise<void> {
    if (catalogAgentIds.value || loadingCatalog.value) return
    loadingCatalog.value = true
    catalogError.value = null
    try {
      const catalog = await fetchCatalog()
      const rawAgents: unknown = catalog?.agents
      const ids: string[] = Array.isArray(rawAgents)
        ? rawAgents
            .filter((a: unknown): a is { id: string } => !!a && typeof a === 'object' && typeof (a as { id?: unknown }).id === 'string')
            .map((a) => a.id)
        : []
      catalogAgentIds.value = new Set(ids)
    } catch {
      catalogError.value = 'Không tải được danh sách agent để kiểm tra — vui lòng thử lại.'
    } finally {
      loadingCatalog.value = false
    }
  }

  /** Returns the `steps[].agent` refs in `pipelineDraft` that are not in the loaded catalog. */
  function findInvalidPipelineAgentRefs(pipelineDraft: Record<string, unknown> | null): string[] {
    if (!pipelineDraft || !catalogAgentIds.value) return []
    const steps = Array.isArray((pipelineDraft as { steps?: unknown }).steps)
      ? ((pipelineDraft as { steps: unknown[] }).steps as unknown[])
      : []
    const invalid: string[] = []
    for (const s of steps) {
      const agentRef = s && typeof s === 'object' ? (s as { agent?: unknown }).agent : undefined
      if (typeof agentRef === 'string' && agentRef && !catalogAgentIds.value.has(agentRef)) {
        invalid.push(agentRef)
      }
    }
    return invalid
  }

  async function sendMessage(text: string): Promise<void> {
    if (sending.value || !text.trim() || !entityType.value) return
    sending.value = true
    error.value = null
    messages.value.push({ role: 'user', text })
    try {
      const projectId = opts.getProjectId()
      const res = chatSessionId.value
        ? await sendNlChatMessage(chatSessionId.value, text, projectId)
        : await startNlChat({ entityType: entityType.value, message: text, runnerId: opts.runnerId }, projectId)

      if (!chatSessionId.value && res?.chatSessionId) chatSessionId.value = res.chatSessionId
      const jobId: string | undefined = res?.job?.id
      if (!jobId) throw new Error('no job id returned')

      const finalJob = await pollJob(jobId)
      if (finalJob.status !== 'succeeded') {
        throw new Error(finalJob.error || `job ${finalJob.status}`)
      }

      const turn = await fetchNlChatTurn(chatSessionId.value as string, projectId)
      turnCount.value += 1
      showLongChatNudge.value = turnCount.value >= nudgeAfterTurns

      if (turn.kind === 'draft') {
        draft.value = (turn.draft ?? {}) as Record<string, unknown>
        step.value = 'previewDraft'
        if (entityType.value === 'pipeline') {
          void loadCatalogIfNeeded()
        }
      } else {
        messages.value.push({ role: 'assistant', text: turn.text || '' })
      }
    } catch (e: any) {
      error.value = String(e?.message || e)
      step.value = 'error'
    } finally {
      sending.value = false
    }
  }

  async function confirm(editedDraft: Record<string, unknown>): Promise<void> {
    if (confirming.value || !entityType.value) return
    // Hard safety net (design.md §4.4): even if the UI button is somehow
    // clickable, never let a pipeline draft with an invalid agent ref reach
    // savePipelineProfile(). Re-check against the actual edited draft, not
    // just the original one from the agent.
    if (entityType.value === 'pipeline') {
      if (!catalogAgentIds.value) {
        error.value = catalogError.value || 'Chưa kiểm tra được danh sách agent hợp lệ — vui lòng thử lại.'
        step.value = 'previewDraft'
        return
      }
      const invalid = findInvalidPipelineAgentRefs(editedDraft)
      if (invalid.length > 0) {
        error.value = `Pipeline tham chiếu agent không tồn tại trong catalog: ${invalid.join(', ')}`
        step.value = 'previewDraft'
        return
      }
    }
    confirming.value = true
    step.value = 'confirming'
    error.value = null
    try {
      const projectId = opts.getProjectId()
      if (entityType.value === 'task') {
        await createTask(editedDraft, projectId)
      } else if (entityType.value === 'pipeline') {
        await savePipelineProfile(pipelineName.value, editedDraft, projectId)
      } else {
        await saveCustomAgent(editedDraft, projectId)
      }
      step.value = 'done'
    } catch (e: any) {
      error.value = String(e?.message || e)
      step.value = 'error'
    } finally {
      confirming.value = false
    }
  }

  async function cancel(): Promise<void> {
    if (chatSessionId.value) {
      try {
        await cancelNlChat(chatSessionId.value, opts.getProjectId())
      } catch {
        /* best-effort — the composable still resets local state */
      }
    }
    reset()
  }

  function reset(): void {
    step.value = 'selectEntity'
    entityType.value = null
    messages.value = []
    draft.value = null
    pipelineName.value = ''
    chatSessionId.value = null
    sending.value = false
    confirming.value = false
    error.value = null
    turnCount.value = 0
    showLongChatNudge.value = false
    catalogAgentIds.value = null
    catalogError.value = null
    loadingCatalog.value = false
  }

  return {
    // state
    step,
    entityType,
    messages,
    draft,
    pipelineName,
    chatSessionId,
    sending,
    confirming,
    error,
    turnCount,
    showLongChatNudge,
    catalogAgentIds,
    catalogError,
    loadingCatalog,
    // actions
    selectEntity,
    sendMessage,
    confirm,
    cancel,
    reset,
    findInvalidPipelineAgentRefs,
  }
}
