import { computed, ref } from 'vue'
import { i18n } from '../../../shared/i18n'
import { buildAndRunAgent, fetchJob, fetchRunners, generateAgentDraft } from '../../../api'

// Drives the "Build agent từ NL" wizard end to end: generate a draft from a
// natural-language description, let the user tweak it, then persist + smoke-run
// it through a runner while polling the job to a terminal state. Kept as a
// composable so the multi-step logic and poll loop are unit-testable without
// rendering the modal.

export type WizardStep = 'describe' | 'preview' | 'run'

export interface AgentDraft {
  name: string
  description: string
  model?: string
  skills?: string[]
  sections?: Record<string, string>
  section_order?: string[]
  [key: string]: unknown
}

export interface RunnerOption {
  id: string
  name: string
  enabled?: boolean
}

interface JobLike {
  id?: string
  status?: string
  error?: string
  logPath?: string
}

export interface UseAgentBuildOptions {
  getProjectId: () => string | null
  // Workspace for the smoke job: task dir when opened from a task context,
  // otherwise a sandbox path for a standalone build.
  getWorkspace: () => string
  // Smoke prompt sent to the runner (defaults to a benign one-liner).
  smokePrompt?: string
  pollMs?: number
  maxWaitMs?: number
  maxPollErrors?: number
}

const DEFAULT_SMOKE_PROMPT = () => i18n.global.t('agentEditor.build.smokePrompt')

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTerminal(status?: string): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

function failureMessage(job: JobLike): string {
  if (job.status === 'cancelled') return i18n.global.t('agentEditor.build.jobCancelled')
  return job.error
    ? i18n.global.t('agentEditor.build.jobFailedWithError', { error: job.error })
    : i18n.global.t('agentEditor.build.jobFailed')
}

export function useAgentBuild(opts: UseAgentBuildOptions) {
  const step = ref<WizardStep>('describe')
  const description = ref('')
  const draft = ref<AgentDraft | null>(null)

  const runners = ref<RunnerOption[]>([])
  const selectedRunnerId = ref<string | null>(null)

  const generating = ref(false)
  const running = ref(false)
  const error = ref<string | null>(null)

  const savedName = ref<string | null>(null)
  const jobId = ref<string | null>(null)
  const jobStatus = ref<string | null>(null)
  const jobError = ref<string | null>(null)
  const jobLogPath = ref<string | null>(null)

  const pollMs = opts.pollMs ?? 1500
  const maxWaitMs = opts.maxWaitMs ?? 5 * 60 * 1000
  const maxPollErrors = opts.maxPollErrors ?? 3
  const smokePrompt = opts.smokePrompt ?? DEFAULT_SMOKE_PROMPT()

  // A runner is usable unless explicitly disabled (`enabled === false`), matching
  // the server's `getDefaultRunner` selection rule.
  const usableRunners = computed(() => runners.value.filter((r) => r.enabled !== false))
  const hasUsableRunner = computed(() => usableRunners.value.length > 0)

  async function loadRunners(): Promise<void> {
    try {
      const res = await fetchRunners()
      const list: RunnerOption[] = Array.isArray(res?.runners) ? res.runners : []
      runners.value = list
      const defaultId: string | null = res?.defaultRunnerId ?? null
      const usable = list.filter((r) => r.enabled !== false)
      // Prefer the configured default if it is usable, else the first usable one.
      const preferred = usable.find((r) => r.id === defaultId) ?? usable[0] ?? null
      if (!selectedRunnerId.value || !usable.some((r) => r.id === selectedRunnerId.value)) {
        selectedRunnerId.value = preferred?.id ?? null
      }
    } catch (e: any) {
      error.value = i18n.global.t('agentEditor.build.loadRunnersFailed', { message: String(e?.message || e) })
    }
  }

  async function generate(): Promise<void> {
    if (generating.value) return
    if (!description.value.trim()) {
      error.value = i18n.global.t('agentEditor.build.describeRequired')
      return
    }
    generating.value = true
    error.value = null
    try {
      const data = await generateAgentDraft(description.value)
      draft.value = { ...(data?.draft ?? {}) } as AgentDraft
      step.value = 'preview'
    } catch (e: any) {
      error.value = i18n.global.t('agentEditor.build.draftFailed', { message: String(e?.message || e) })
    } finally {
      generating.value = false
    }
  }

  function backToDescribe(): void {
    step.value = 'describe'
    error.value = null
  }

  function backToPreview(): void {
    step.value = 'preview'
    error.value = null
    jobError.value = null
  }

  async function pollJob(id: string): Promise<JobLike> {
    const deadline = Date.now() + maxWaitMs
    let consecutiveErrors = 0
    for (;;) {
      let job: JobLike | undefined
      try {
        const res = await fetchJob(id)
        job = res?.job
        consecutiveErrors = 0
      } catch (e) {
        // Tolerate transient network/5xx blips instead of failing the whole run.
        consecutiveErrors += 1
        if (consecutiveErrors > maxPollErrors) throw e
        if (Date.now() >= deadline) return { status: 'failed', error: i18n.global.t('agentEditor.build.jobTimeout') }
        await sleep(pollMs)
        continue
      }
      if (!job) throw new Error(i18n.global.t('agentEditor.build.jobMissing'))
      jobStatus.value = job.status ?? null
      if (isTerminal(job.status)) return job
      if (Date.now() >= deadline) return { ...job, status: 'failed', error: i18n.global.t('agentEditor.build.jobTimeout') }
      await sleep(pollMs)
    }
  }

  async function buildAndRun(): Promise<void> {
    if (running.value) return
    if (!draft.value || !draft.value.name?.trim()) {
      error.value = i18n.global.t('agentEditor.build.draftNameRequired')
      return
    }
    if (!hasUsableRunner.value) {
      error.value =
        i18n.global.t('agentEditor.build.noRunner')
      return
    }
    running.value = true
    error.value = null
    jobError.value = null
    jobStatus.value = null
    jobLogPath.value = null
    step.value = 'run'
    try {
      const res = await buildAndRunAgent({
        draft: draft.value,
        userPrompt: smokePrompt,
        workspace: opts.getWorkspace(),
        runnerId: selectedRunnerId.value ?? undefined,
        projectId: opts.getProjectId() ?? undefined,
      })
      savedName.value = res.name
      const id: string | undefined = res.job?.id
      jobId.value = id ?? null
      if (!id) throw new Error(i18n.global.t('agentEditor.build.noJobId'))
      const final = await pollJob(id)
      jobStatus.value = final.status ?? null
      jobLogPath.value = final.logPath ?? null
      if (final.status !== 'succeeded') jobError.value = failureMessage(final)
    } catch (e: any) {
      jobError.value = String(e?.message || e)
    } finally {
      running.value = false
    }
  }

  function reset(): void {
    step.value = 'describe'
    description.value = ''
    draft.value = null
    generating.value = false
    running.value = false
    error.value = null
    savedName.value = null
    jobId.value = null
    jobStatus.value = null
    jobError.value = null
    jobLogPath.value = null
  }

  return {
    // state
    step,
    description,
    draft,
    runners,
    usableRunners,
    hasUsableRunner,
    selectedRunnerId,
    generating,
    running,
    error,
    savedName,
    jobId,
    jobStatus,
    jobError,
    jobLogPath,
    // actions
    loadRunners,
    generate,
    backToDescribe,
    backToPreview,
    buildAndRun,
    reset,
  }
}
