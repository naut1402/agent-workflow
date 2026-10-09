import { ref } from 'vue'
import { normalizePipelineDraft } from '../lib/pipelineDraft'
import { startNlChat, sendNlChatMessage, fetchNlChatTurn, cancelNlChat } from '../scripts/ChatWindowApi'
import { fetchJob } from '../../runner/scripts/runnerApi'
import { fetchCatalog } from '../../pipeline-editor/scripts/pipelineEditorApi'
import { fetchPipelineProfiles, savePipelineProfile } from '../../pipeline-editor/scripts/ProfileManagerApi'
import { createTask } from '../../monitor/scripts/monitorApi'
import { saveCustomAgent } from '../../agent-editor/scripts/agentEditorApi'
import { createAutomation } from '../../automations/scripts/automationsApi'
import { mintTaskId } from '../../monitor/lib/createTaskForm'
import { TASK_ID_PATTERN } from '../../monitor/schemas/taskCreate'

export type NlChatEntityType = 'task' | 'pipeline' | 'agent' | 'automation'
export type NlChatStep = 'chatting' | 'previewDraft' | 'confirming' | 'done' | 'error'

const PERSISTABLE_ENTITY_TYPES: readonly NlChatEntityType[] = ['task', 'pipeline', 'agent', 'automation']
export type NlChatAgentScope = 'project' | 'global'

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
  /** Soft nudge threshold — not a hard cap. */
  nudgeAfterTurns?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTerminal(status?: string): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

export function useNlChatSession(opts: UseNlChatSessionOptions) {
  const step = ref<NlChatStep>('chatting')
  const entityType = ref<NlChatEntityType | null>(null)
  const messages = ref<NlChatMessage[]>([])
  const draft = ref<Record<string, unknown> | null>(null)
  const pipelineName = ref('')
  const agentScope = ref<NlChatAgentScope>('project')

  const chatSessionId = ref<string | null>(null)
  const sending = ref(false)
  const confirming = ref(false)
  const error = ref<string | null>(null)
  const turnCount = ref(0)
  const showLongChatNudge = ref(false)

  // xem docs/architecture/code/nl-chat.md §5
  const catalogAgentIds = ref<Set<string> | null>(null)
  const catalogError = ref<string | null>(null)
  const loadingCatalog = ref(false)

  const catalogProfileNames = ref<Set<string> | null>(null)
  const profileError = ref<string | null>(null)
  const loadingProfiles = ref(false)

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

  // xem docs/architecture/code/nl-chat.md §5
  let catalogInflight: Promise<void> | null = null
  let profilesInflight: Promise<void> | null = null

  async function loadCatalog(): Promise<void> {
    if (catalogInflight) return catalogInflight
    loadingCatalog.value = true
    catalogError.value = null
    catalogInflight = (async () => {
      try {
        const catalog = await fetchCatalog(opts.getProjectId() ?? undefined)
        const rawAgents: unknown = catalog?.agents
        const ids: string[] = Array.isArray(rawAgents)
          ? rawAgents
              .filter((a: unknown): a is { id: string } => !!a && typeof a === 'object' && typeof (a as { id?: unknown }).id === 'string')
              .map((a) => a.id)
          : []
        catalogAgentIds.value = new Set(ids)
      } catch {
        catalogError.value = 'Không tải được danh sách agent để kiểm tra — vui lòng thử lại.'
      }
    })().finally(() => {
      catalogInflight = null
      loadingCatalog.value = false
    })
    return catalogInflight
  }

  async function loadProfiles(): Promise<void> {
    if (profilesInflight) return profilesInflight
    loadingProfiles.value = true
    profileError.value = null
    profilesInflight = (async () => {
      try {
        const res = await fetchPipelineProfiles(opts.getProjectId())
        const raw: unknown = res?.profiles
        const names: string[] = Array.isArray(raw)
          ? raw
              .filter((p: unknown): p is { name: string } => !!p && typeof p === 'object' && typeof (p as { name?: unknown }).name === 'string')
              .map((p) => p.name)
          : []
        catalogProfileNames.value = new Set(names)
      } catch {
        profileError.value = 'Không tải được danh sách pipeline profile để kiểm tra — vui lòng thử lại.'
      }
    })().finally(() => {
      profilesInflight = null
      loadingProfiles.value = false
    })
    return profilesInflight
  }

  function trimmedProfileName(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }

  function referencedProfileNames(
    d: Record<string, unknown> | null,
    type: NlChatEntityType | null,
  ): string[] {
    const actions = Array.isArray(d?.actions) ? (d.actions as unknown[]) : []
    const raw =
      type === 'task'
        ? [d?.profileName]
        : type === 'automation'
          ? actions.map((a) => (a as { profileName?: unknown } | null)?.profileName)
          : []
    return raw.map(trimmedProfileName).filter((n): n is string => n !== null)
  }

  function profileNameError(
    d: Record<string, unknown> | null,
    type: NlChatEntityType | null = entityType.value,
  ): string | null {
    const refs = referencedProfileNames(d, type)
    if (refs.length === 0) return null
    if (profileError.value) return profileError.value
    const known = catalogProfileNames.value
    if (!known) return 'Đang kiểm tra danh sách pipeline profile...'
    const invalid = refs.filter((n) => !known.has(n))
    return invalid.length > 0
      ? `Pipeline profile không tồn tại: ${invalid.join(', ')} — sửa lại hoặc bỏ trống để dùng pipeline mặc định.`
      : null
  }

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
    if (sending.value || !text.trim()) return
    sending.value = true
    error.value = null
    messages.value.push({ role: 'user', text })
    try {
      const projectId = opts.getProjectId()
      const res = chatSessionId.value
        ? await sendNlChatMessage(chatSessionId.value, text, projectId)
        : await startNlChat(
            { entityType: entityType.value ?? undefined, message: text, runnerId: opts.runnerId },
            projectId,
          )

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
        const resolved = (turn.entityType ?? entityType.value) as NlChatEntityType | null | undefined
        if (!resolved || !PERSISTABLE_ENTITY_TYPES.includes(resolved)) {
          messages.value.push({
            role: 'assistant',
            text: 'Mình chưa rõ bạn muốn tạo Task, Pipeline, Agent hay Automation — bạn nói rõ giúp mình nhé?',
          })
          return
        }
        entityType.value = resolved
        const raw = (turn.draft ?? {}) as Record<string, unknown>
        draft.value = resolved === 'pipeline' ? normalizePipelineDraft(raw) : raw
        step.value = 'previewDraft'
        if (resolved === 'pipeline') {
          void loadCatalog()
        }
        // xem docs/architecture/code/nl-chat.md §5
        if (resolved === 'task' || resolved === 'automation') {
          void loadProfiles()
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
    // xem docs/architecture/code/nl-chat.md §5
    if (entityType.value === 'pipeline') {
      await loadCatalog()
      if (catalogError.value || !catalogAgentIds.value) {
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
    if (referencedProfileNames(editedDraft, entityType.value).length > 0) {
      await loadProfiles()
    }
    const profileMsg = profileNameError(editedDraft, entityType.value)
    if (profileMsg) {
      error.value = profileMsg
      step.value = 'previewDraft'
      return
    }
    const projectId = opts.getProjectId()
    if (entityType.value === 'agent' && agentScope.value === 'project' && !projectId) {
      error.value = 'Chưa chọn project — chọn project ở header hoặc đổi phạm vi agent sang "Toàn cục".'
      step.value = 'previewDraft'
      return
    }
    confirming.value = true
    step.value = 'confirming'
    error.value = null
    try {
      if (entityType.value === 'task') {
        const rawId = editedDraft.taskId
        const payload =
          typeof rawId === 'string' && TASK_ID_PATTERN.test(rawId)
            ? editedDraft
            : { ...editedDraft, taskId: mintTaskId() }
        await createTask(payload, projectId)
      } else if (entityType.value === 'pipeline') {
        // xem docs/architecture/code/nl-chat.md §5
        await savePipelineProfile(pipelineName.value, normalizePipelineDraft(editedDraft), projectId)
      } else if (entityType.value === 'automation') {
        await createAutomation(editedDraft as never, projectId)
      } else {
        await saveCustomAgent(editedDraft, projectId, agentScope.value)
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
    step.value = 'chatting'
    entityType.value = null
    messages.value = []
    draft.value = null
    pipelineName.value = ''
    agentScope.value = 'project'
    chatSessionId.value = null
    sending.value = false
    confirming.value = false
    error.value = null
    turnCount.value = 0
    showLongChatNudge.value = false
    catalogAgentIds.value = null
    catalogError.value = null
    loadingCatalog.value = false
    catalogProfileNames.value = null
    profileError.value = null
    loadingProfiles.value = false
    catalogInflight = null
    profilesInflight = null
  }

  return {
    step,
    entityType,
    messages,
    draft,
    pipelineName,
    agentScope,
    chatSessionId,
    sending,
    confirming,
    error,
    turnCount,
    showLongChatNudge,
    catalogAgentIds,
    catalogError,
    loadingCatalog,
    catalogProfileNames,
    profileError,
    loadingProfiles,
    selectEntity,
    sendMessage,
    confirm,
    cancel,
    reset,
    findInvalidPipelineAgentRefs,
    profileNameError,
  }
}
