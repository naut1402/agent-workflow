import { computed, ref } from 'vue'
import type { CreateTaskRequest, TaskSource } from '../../../../shared/schemas/taskCreate.js'
import { createTask, fetchGithubIssue, fetchPipelineProfile, fetchPipelineProfiles, fetchRunners } from '../../../api'
import {
  buildCreateTaskPreviewSummary,
  canAdvanceFromSourceStep,
  promptFromIssue,
  validateTaskId,
  type CreateTaskPreviewSummary,
} from '../lib/createTaskForm'

export const CREATE_TASK_STEPS = 4

export function emptyCreateTaskForm() {
  return {
    taskId: '',
    source: 'prompt' as TaskSource,
    prompt: '',
    issueUrl: '',
    profileName: '' as string | null,
    knowledgeInputs: [] as string[],
    autoReview: false,
    exportJson: false,
    run: false,
    runnerId: '' as string | null,
  }
}

export interface UseCreateTaskOptions {
  getProjectId: () => string | null
}

export function useCreateTask(opts: UseCreateTaskOptions) {
  const step = ref(1)
  const form = ref(emptyCreateTaskForm())
  const loading = ref(false)
  const error = ref<string | null>(null)
  const issuePreview = ref<{ title: string; body: string | null; url: string; prompt: string } | null>(
    null,
  )
  const issueLoaded = ref(false)
  const profiles = ref<{ name: string }[]>([])
  const runners = ref<{ id: string; name: string; enabled?: boolean }[]>([])
  const firstStepLabel = ref<string | null>(null)
  const submittedJobId = ref<string | null>(null)
  const createdTaskId = ref<string | null>(null)

  const taskIdError = computed(() => validateTaskId(form.value.taskId))

  const previewSummary = computed((): CreateTaskPreviewSummary =>
    buildCreateTaskPreviewSummary({
      taskId: form.value.taskId,
      source: form.value.source,
      issueUrl: form.value.issueUrl,
      profileName: form.value.profileName,
      knowledgeInputs: form.value.knowledgeInputs,
      autoReview: form.value.autoReview,
      exportJson: form.value.exportJson,
      run: form.value.run,
      runnerLabel: runners.value.find((r) => r.id === form.value.runnerId)?.name ?? null,
      firstStepLabel: firstStepLabel.value,
    }),
  )

  const canNext = computed(() => {
    if (step.value === 1) {
      return canAdvanceFromSourceStep(
        form.value.taskId,
        form.value.source,
        form.value.prompt,
        form.value.issueUrl,
        issueLoaded.value,
      )
    }
    if (step.value === 2) return true
    if (step.value === 3) return true
    return false
  })

  function reset() {
    step.value = 1
    form.value = emptyCreateTaskForm()
    loading.value = false
    error.value = null
    issuePreview.value = null
    issueLoaded.value = false
    firstStepLabel.value = null
    submittedJobId.value = null
    createdTaskId.value = null
  }

  async function loadMeta() {
    const projectId = opts.getProjectId() ?? undefined
    try {
      const [profData, runData] = await Promise.all([
        fetchPipelineProfiles(projectId),
        fetchRunners(),
      ])
      profiles.value = (profData.profiles || []).map((p: { name: string }) => ({ name: p.name }))
      runners.value = (runData.runners || []).filter((r: { enabled?: boolean }) => r.enabled !== false)
      if (!form.value.runnerId && runners.value.length) {
        form.value.runnerId = runners.value[0].id
      }
    } catch {
      profiles.value = []
      runners.value = []
    }
  }

  async function refreshFirstStepLabel() {
    firstStepLabel.value = null
    const name = form.value.profileName?.trim()
    if (!name) return
    try {
      const data = await fetchPipelineProfile(name, opts.getProjectId() ?? undefined)
      const first = data.pipeline?.steps?.[0]
      firstStepLabel.value = first?.label || first?.id || null
    } catch {
      firstStepLabel.value = null
    }
  }

  async function fetchIssue() {
    error.value = null
    issueLoaded.value = false
    issuePreview.value = null
    const url = form.value.issueUrl.trim()
    if (!url) return
    loading.value = true
    try {
      const data = await fetchGithubIssue(url, opts.getProjectId() ?? undefined)
      const issue = data.issue
      issuePreview.value = issue
      form.value.prompt = promptFromIssue(issue)
      issueLoaded.value = true
    } catch (e: unknown) {
      error.value = String((e as Error)?.message ?? e)
    } finally {
      loading.value = false
    }
  }

  function next() {
    if (!canNext.value) return
    if (step.value < CREATE_TASK_STEPS) step.value += 1
  }

  function back() {
    if (step.value > 1) step.value -= 1
  }

  function toggleKnowledge(id: string) {
    const list = form.value.knowledgeInputs
    const i = list.indexOf(id)
    if (i >= 0) list.splice(i, 1)
    else list.push(id)
  }

  function addKnowledge(id: string) {
    if (!form.value.knowledgeInputs.includes(id)) form.value.knowledgeInputs.push(id)
  }

  async function submit(): Promise<{ taskId: string; jobId: string | null } | null> {
    error.value = null
    loading.value = true
    try {
      const payload: CreateTaskRequest = {
        taskId: form.value.taskId.trim(),
        source: form.value.source,
        prompt: form.value.prompt.trim(),
        issueUrl: form.value.source === 'issue' ? form.value.issueUrl.trim() : undefined,
        profileName: form.value.profileName?.trim() || undefined,
        knowledgeInputs: [...form.value.knowledgeInputs],
        autoReview: form.value.autoReview,
        exportJson: form.value.exportJson,
        run: form.value.run,
        runnerId: form.value.run ? form.value.runnerId || undefined : undefined,
      }
      const data = await createTask(payload, opts.getProjectId() ?? undefined)
      const taskId = data.task?.taskId ?? payload.taskId
      createdTaskId.value = taskId
      const jobId = data.job?.id ?? null
      submittedJobId.value = jobId
      if (form.value.run && jobId) step.value = CREATE_TASK_STEPS
      return { taskId, jobId }
    } catch (e: unknown) {
      error.value = String((e as Error)?.message ?? e)
      return null
    } finally {
      loading.value = false
    }
  }

  return {
    step,
    form,
    loading,
    error,
    issuePreview,
    issueLoaded,
    profiles,
    runners,
    taskIdError,
    previewSummary,
    canNext,
    submittedJobId,
    createdTaskId,
    firstStepLabel,
    reset,
    loadMeta,
    refreshFirstStepLabel,
    fetchIssue,
    next,
    back,
    toggleKnowledge,
    addKnowledge,
    submit,
  }
}
