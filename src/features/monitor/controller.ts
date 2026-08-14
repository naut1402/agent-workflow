import fs from 'node:fs/promises'
import path from 'node:path'
import { AbstractController } from '../../core/http/AbstractController.js'
import { resolveArtifact } from './business/tasks/index.js'
import { collectTasks, flowProfilePath, createTask, readState } from './business/tasks/index.js'
import {
  advanceStepOnJobSuccess,
  advanceStepOnJobSuccessAssumingLock,
  applyArchiveAction,
  applyHitlAction,
  deleteTask,
  jumpToPipelineStepAssumingLock,
  repairTaskState,
  withTaskLock,
} from './business/tasks/state.js'
import { isRunnableTarget } from './lib/pipelineRunGuards.js'
import {
  loadPipelineConfig,
  submitJob,
  submitApprovalJob,
  sendTaskFeedback,
  findSelectionRange,
  extractLines,
  listJobs,
  closeTaskSession,
  cloneProject,
  setProjectBranch,
} from './business/index.js'
import { emitAudit } from '../../core/log/store.js'
import { TaskArchivePatch, TaskStatePatch } from './schemas/task.js'
import { CreateTaskRequest, GithubIssueRequest } from './schemas/taskCreate.js'
import { mintTaskId } from './lib/createTaskForm.js'
import { RunStepRequest } from './schemas/runStep.js'
import { TaskFeedbackRequest } from './schemas/taskFeedback.js'
import { fetchGithubIssue } from './business/github/index.js'
import { getTaskChatState } from './business/taskChat.js'
import {
  loadArtifactActions,
  loadArtifactActionsFile,
  matchActions,
  matchByAttach,
  findAction,
  substitutePrompt,
  artifactBase,
  toActionView,
  saveArtifactActions,
} from './business/artifactActions/index.js'
import { RunArtifactActionRequest } from './schemas/artifactAction.js'

/** Serialize concurrent PUT /api/artifact for the same target (in-process). */
const artifactWriteLocks = new Map<string, Promise<void>>()

async function withArtifactWriteLock<T>(target: string, fn: () => Promise<T>): Promise<T> {
  const prev = artifactWriteLocks.get(target) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((r) => {
    release = r
  })
  const chain = prev.then(() => gate)
  artifactWriteLocks.set(target, chain)
  await prev
  try {
    return await fn()
  } finally {
    release()
    if (artifactWriteLocks.get(target) === chain) artifactWriteLocks.delete(target)
  }
}

export class MonitorController extends AbstractController {
  // Project registry CRUD — no per-project root needed (Monitor owns project ↔ task UX).
  getProjects() {
    const { registry } = this.ctx
    const id = this.c.req.query('id')
    if (id) {
      const project = registry.get(id)
      if (!project) return this.notFound('unknown project', { id })
      return this.ok({ project })
    }
    return this.ok(registry.list())
  }

  async createProject() {
    const { registry } = this.ctx
    let parsed: any
    try {
      parsed = JSON.parse((await this.c.req.text()) || '{}')
    } catch {
      return this.badRequest('invalid JSON')
    }
    // Clone remote repo when gitUrl is provided.
    if (parsed.gitUrl) {
      const cloned = cloneProject({
        gitUrl: parsed.gitUrl,
        branch: parsed.branch || parsed.defaultBranch,
        name: parsed.name,
        destName: parsed.destName,
      })
      if ('error' in cloned) return this.json(cloned.status || 400, { error: cloned.error })
      emitAudit({
        op: 'create',
        entity: 'project',
        identifier: cloned.project?.id ?? null,
        projectId: cloned.project?.id ?? null,
      })
      return this.created({ project: cloned.project, repoPath: cloned.repoPath, branch: cloned.branch })
    }
    const result = registry.add({ path: parsed.path, name: parsed.name })
    if ('error' in result) return this.json(result.status || 400, { error: result.error })
    // Optional branch metadata on local projects.
    if (parsed.branch && result.project?.id) {
      setProjectBranch(result.project.id, parsed.branch)
      const updated = registry.get(result.project.id)
      emitAudit({
        op: 'create',
        entity: 'project',
        identifier: result.project?.id ?? null,
        projectId: result.project?.id ?? null,
      })
      return this.created({ project: updated || result.project })
    }
    emitAudit({
      op: 'create',
      entity: 'project',
      identifier: result.project?.id ?? null,
      projectId: result.project?.id ?? null,
    })
    return this.created({ project: result.project })
  }

  async updateProjectBranch() {
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON')
    const id = String(b.value.id || b.value.projectId || '')
    const branch = String(b.value.branch || '')
    const result = setProjectBranch(id, branch)
    if ('error' in result) return this.json(result.status || 400, { error: result.error })
    return this.ok({ project: result.project, branch: result.branch })
  }

  deleteProject() {
    const { registry } = this.ctx
    const id = this.c.req.query('id') || ''
    const result = registry.remove(id)
    if ('error' in result) return this.json(result.status || 400, { error: result.error })
    emitAudit({ op: 'delete', entity: 'project', identifier: id, projectId: id })
    return this.ok({ removed: true })
  }

  projectsMethodNotAllowed() {
    return this.methodNotAllowed()
  }

  async listTasks() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    // Backward-compat shape: { root, tasks }, plus project id when requested.
    const payload: any = { root, tasks: await collectTasks(root) }
    if (this.projectId) payload.project = this.projectId
    return this.ok(payload)
  }

  async getPipelineConfig() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const id = this.c.req.query('id') || ''
    const cfg = await loadPipelineConfig(root, id || null)
    return this.ok({ id: id || null, pipeline: cfg })
  }

  async getArtifact() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const id = this.c.req.query('id') || ''
    const name = this.c.req.query('name') || ''
    const target = resolveArtifact(root, id, name)
    if (!target) return this.badRequest('invalid path')
    try {
      const content = await fs.readFile(target, 'utf8')
      const s = await fs.stat(target)
      return this.ok({ id, name, content, mtime: s.mtimeMs })
    } catch {
      return this.notFound('not found', { id, name })
    }
  }

  async putArtifact() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const id = this.c.req.query('id') || ''
    const name = this.c.req.query('name') || ''
    if (!id || /[^\w\-]/.test(id)) return this.badRequest('invalid task id')
    if (!name || !name.endsWith('.md') || name.includes('..') || name.startsWith('.')) {
      return this.badRequest('invalid artifact name')
    }
    const target = resolveArtifact(root, id, name)
    if (!target) return this.badRequest('invalid path')
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON body')
    const { content, mtime } = b.value as { content?: unknown; mtime?: unknown }
    if (typeof content !== 'string') return this.badRequest('content must be a string')

    return withArtifactWriteLock(target, async () => {
      let existingMtime: number | null = null
      try {
        const s = await fs.stat(target)
        existingMtime = s.mtimeMs
      } catch {
        existingMtime = null
      }

      if (typeof mtime === 'number' && existingMtime != null && existingMtime !== mtime) {
        try {
          const current = await fs.readFile(target, 'utf8')
          return this.json(409, {
            error: 'conflict',
            id,
            name,
            content: current,
            mtime: existingMtime,
          })
        } catch {
          return this.json(409, { error: 'conflict', id, name })
        }
      }

      await fs.mkdir(path.dirname(target), { recursive: true })
      const tmp = `${target}.tmp`
      await fs.writeFile(tmp, content, 'utf8')
      await fs.rename(tmp, target)
      const s = await fs.stat(target)
      emitAudit({
        op: 'update',
        entity: 'artifact',
        identifier: `${id}/${name}`,
        projectId: this.projectId,
      })
      return this.ok({ id, name, content, mtime: s.mtimeMs })
    })
  }

  async getProfile() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const profilePath = path.join(root, 'orchestrator-profile.json')
    try {
      const raw = await fs.readFile(profilePath, 'utf8')
      return this.ok({ profile: JSON.parse(raw), exists: true })
    } catch {
      return this.ok({ profile: null, exists: false })
    }
  }

  postProfile() {
    if (!this.root) return this.unknownProject()
    return this.json(501, { error: 'profile editing not implemented yet' })
  }

  async getPipelineExport() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const id = this.c.req.query('id') || ''
    if (!id) return this.badRequest('missing id')
    const fp = path.join(root, 'tasks', id, 'pipeline-export.json')
    try {
      const raw = await fs.readFile(fp, 'utf8')
      return this.ok({ id, export: JSON.parse(raw), exists: true })
    } catch {
      return this.ok({ id, export: null, exists: false })
    }
  }

  async getFlowProfile() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const id = this.c.req.query('id') || ''
    if (!id) return this.badRequest('missing id')
    const fp = flowProfilePath(root, id)
    try {
      const raw = await fs.readFile(fp, 'utf8')
      return this.ok({ id, profile: JSON.parse(raw), exists: true })
    } catch {
      return this.ok({ id, profile: null, exists: false })
    }
  }

  async postFlowProfile() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const id = this.c.req.query('id') || ''
    if (!id) return this.badRequest('missing id')
    const fp = flowProfilePath(root, id)
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON body')
    await fs.mkdir(path.dirname(fp), { recursive: true })
    await fs.writeFile(fp, JSON.stringify(b.value, null, 2), 'utf8')
    emitAudit({ op: 'update', entity: 'flow-profile', identifier: id, projectId: this.projectId })
    return this.ok({ id, saved: true })
  }

  async putTaskState() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const id = this.c.req.query('id') || ''
    if (!id || /[^\w\-]/.test(id)) return this.badRequest('invalid task id')

    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON body')
    const parsed = TaskStatePatch.safeParse(b.value)
    if (!parsed.success) {
      return this.badRequest('invalid patch', { details: parsed.error.flatten() })
    }

    const result = await applyHitlAction(root, id, parsed.data, this.projectId || '')
    if ('error' in result) {
      const body: Record<string, unknown> = { error: result.error, id }
      if (result.state) body.state = result.state
      if (result.mtime != null) body.mtime = result.mtime
      return this.json(result.status, body)
    }

    emitAudit({
      op: 'update',
      entity: 'task-state',
      identifier: id,
      projectId: this.projectId,
      detail: { action: parsed.data.action, gate_id: parsed.data.gate_id },
    })
    return this.ok({ id, state: result.state, mtime: result.mtime })
  }

  async putTaskArchive() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const id = this.c.req.query('id') || ''
    if (!id || /[^\w\-]/.test(id)) return this.badRequest('invalid task id')

    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON body')
    const parsed = TaskArchivePatch.safeParse(b.value)
    if (!parsed.success) {
      return this.badRequest('invalid patch', { details: parsed.error.flatten() })
    }

    const result = await applyArchiveAction(root, id, parsed.data)
    if ('error' in result) {
      const body: Record<string, unknown> = { error: result.error, id }
      if (result.state) body.state = result.state
      if (result.mtime != null) body.mtime = result.mtime
      return this.json(result.status, body)
    }

    emitAudit({
      op: 'update',
      entity: 'task-state',
      identifier: id,
      projectId: this.projectId,
      detail: { action: parsed.data.archived ? 'archive' : 'unarchive' },
    })
    return this.ok({ id, state: result.state, mtime: result.mtime })
  }

  async getArtifactActions() {
    const artifact = this.c.req.query('artifact') || ''
    const attach = this.c.req.query('attach') || ''

    if (!artifact) {
      const file = await loadArtifactActionsFile()
      return this.ok({ version: file.version, actions: file.actions, menus: file.menus })
    }

    const file = await loadArtifactActionsFile()
    const matched = attach
      ? matchByAttach(file.actions, artifact, attach)
      : matchActions(file.actions, artifact)
    return this.ok({
      artifact,
      actions: matched.map(toActionView),
      menus: file.menus,
    })
  }

  async putArtifactActions() {
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON body')
    const result = await saveArtifactActions(b.value)
    if ('error' in result) return this.badRequest(result.error)
    emitAudit({ op: 'update', entity: 'artifact-actions', identifier: 'catalog', projectId: null })
    return this.ok({
      ok: true,
      version: result.version,
      actions: result.actions,
      menus: result.menus,
    })
  }

  async runArtifactAction() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON body')
    const parsed = RunArtifactActionRequest.safeParse(b.value)
    if (!parsed.success) {
      return this.badRequest('invalid request', { details: parsed.error.flatten() })
    }
    const { taskId, actionId, artifactName, runnerId, selectedText, selectionStartLine, selectionEndLine } =
      parsed.data
    if (/[^\w\-]/.test(taskId)) return this.badRequest('invalid task id')

    const target = resolveArtifact(root, taskId, artifactName)
    if (!target) return this.badRequest('invalid artifact path')

    const actions = await loadArtifactActions()
    const action = findAction(actions, actionId)
    if (!action) return this.notFound('unknown action', { actionId })
    if (matchActions([action], artifactName).length === 0) {
      return this.badRequest('action does not apply to artifact')
    }

    const attachPoints = action.attach_points ?? ['artifact-title']
    const selectionOnly =
      attachPoints.includes('artifact-selection') && !attachPoints.includes('artifact-title')
    if (selectionOnly && !selectedText) {
      return this.badRequest('selection required')
    }

    let content: string
    try {
      content = await fs.readFile(target, 'utf8')
    } catch {
      return this.notFound('artifact not found', { taskId, artifactName })
    }

    const useSplice = Boolean(action.require_approval && selectionStartLine != null && selectedText)
    let spliceRange: { start: number; end: number } | undefined
    let selectionForPrompt = selectedText ?? ''
    if (useSplice) {
      const lineCount = content.split(/\r?\n/).length
      const matched = findSelectionRange(content, selectedText!)
      if (matched) {
        spliceRange = matched
      } else {
        const rawEnd = selectionEndLine ?? selectionStartLine!
        const start = Math.min(Math.max(1, selectionStartLine!), lineCount)
        const end = Math.min(Math.max(start, rawEnd), lineCount)
        spliceRange = { start, end }
      }
      selectionForPrompt = extractLines(content, spliceRange.start, spliceRange.end)
    }

    const userPrompt = substitutePrompt(action.prompt_template, {
      artifact_name: artifactName,
      artifact_base: artifactBase(artifactName),
      selection: selectionForPrompt,
      selectionStartLine: spliceRange?.start ?? selectionStartLine,
      selectionEndLine: spliceRange?.end ?? selectionEndLine,
    })

    const resolvedRunnerId = runnerId ?? action.runner_id
    const jobInput = {
      runnerId: resolvedRunnerId,
      agentRef: action.agent_ref,
      workspace: path.join(root, 'tasks', taskId),
      userPrompt,
      produces: action.produces,
      metadata: {
        projectRoot: path.dirname(root),
        devTeamRoot: root,
        projectId: this.projectId || undefined,
        artifactAction: actionId,
        taskId,
        artifactName,
        artifactBytes: content.length,
        hasSelection: Boolean(selectedText),
        selectionChars: selectedText?.length ?? 0,
        selectionStartLine,
        selectionEndLine,
      },
    }
    const job = action.require_approval
      ? submitApprovalJob({
          ...jobInput,
          approvalArtifact: artifactName,
          ...(useSplice ? { spliceRange } : {}),
        })
      : submitJob(jobInput)

    emitAudit({
      op: 'update',
      entity: 'artifact',
      identifier: `${taskId}/${artifactName}#${actionId}`,
      projectId: this.projectId,
      detail: { jobId: job.id, agentRef: action.agent_ref, action: actionId },
    })
    return this.created({ job })
  }

  async createTask() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON body')
    const parsed = CreateTaskRequest.safeParse(b.value)
    if (!parsed.success) {
      return this.badRequest('invalid request', { details: parsed.error.flatten() })
    }
    const body = parsed.data
    const taskId = body.taskId ?? mintTaskId()
    const result = await createTask(root, {
      taskId,
      source: body.source,
      prompt: body.prompt,
      issueUrl: body.issueUrl,
      parentTaskId: body.parentTaskId,
      profileName: body.profileName,
      pipeline: body.pipeline,
      knowledgeInputs: body.knowledgeInputs,
      autoReview: body.autoReview,
      exportJson: body.exportJson,
      branch: body.branch,
    })
    if ('error' in result) return this.json(result.status, { error: result.error, taskId })

    emitAudit({
      op: 'create',
      entity: 'task-state',
      identifier: result.taskId,
      projectId: this.projectId,
    })

    let job: ReturnType<typeof submitJob> | undefined
    if (body.run) {
      const agentRef = result.firstStep?.agent
      if (typeof agentRef !== 'string' || !agentRef) {
        return this.badRequest('pipeline has no first-step agent', { taskId: result.taskId })
      }
      job = submitJob({
        runnerId: body.runnerId ?? undefined,
        agentRef,
        workspace: path.join(root, 'tasks', result.taskId),
        userPrompt: result.requestContent,
        metadata: {
          projectRoot: path.dirname(root),
          devTeamRoot: root,
          projectId: this.projectId || undefined,
          taskId: result.taskId,
          pipelineStepId: result.firstStep.id,
          createTaskRun: true,
          ...(body.branch ? { branch: body.branch } : {}),
        },
      })
    }

    return this.created({
      task: {
        taskId: result.taskId,
        state: result.state,
        pipeline: result.pipeline,
        firstStep: result.firstStep,
        requestFile: result.requestFile,
        pipelineFile: result.pipelineFile,
      },
      ...(job ? { job } : {}),
    })
  }

  async deleteTask() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const id = this.c.req.param('id')
    if (!id || /[^\w\-]/.test(id)) return this.badRequest('invalid task id')

    await deleteTask(root, id)

    emitAudit({ op: 'delete', entity: 'task-state', identifier: id, projectId: this.projectId })
    return this.ok({ id, deleted: true })
  }

  async repairTaskState() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const id = this.c.req.param('id')
    if (!id || /[^\w\-]/.test(id)) return this.badRequest('invalid task id')

    const stateFile = path.join(root, '.dev-state', `${id}.json`)
    const before = await readState(stateFile)
    if (before.ok) {
      const stepId = String(before.state.current_phase ?? '')
      const lastSucceeded = listJobs(200).find(
        (j) =>
          j.metadata?.taskId === id &&
          j.status === 'succeeded' &&
          !j.applyTarget &&
          j.metadata?.pipelineStepId === stepId,
      )
      if (lastSucceeded && stepId) {
        await advanceStepOnJobSuccess(root, id, stepId)
      }
    }

    const result = await repairTaskState(root, id)
    if ('error' in result) return this.json(result.status, { error: result.error, taskId: id })

    emitAudit({
      op: 'update',
      entity: 'task-state',
      identifier: id,
      projectId: this.projectId,
      detail: { action: 'repair' },
    })
    return this.ok({ id, state: result.state, mtime: result.mtime })
  }

  async closeTaskChatSession() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const id = this.c.req.param('id')
    if (!id || /[^\w\-]/.test(id)) return this.badRequest('invalid task id')
    const stepId = this.c.req.query('stepId') || undefined

    closeTaskSession(this.projectId || '', id, { stepId })
    emitAudit({
      op: 'update',
      entity: 'task-state',
      identifier: id,
      projectId: this.projectId,
      detail: { action: 'close-session' },
    })
    return this.ok({ id, closed: true })
  }

  async runTaskStep() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const id = this.c.req.param('id')
    if (!id || /[^\w\-]/.test(id)) return this.badRequest('invalid task id')

    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON body')
    const parsed = RunStepRequest.safeParse(b.value)
    if (!parsed.success) {
      return this.badRequest('invalid request', { details: parsed.error.flatten() })
    }

    const body = parsed.data

    // Everything below reads-checks-writes task state and, on success, creates
    // the step's job. Serialize per task: without this, two concurrent
    // requests can both observe "no job running", each move current_phase,
    // and both submit a job — running a step twice or tagging a job with a
    // pipelineStepId that no longer matches the final cursor.
    return withTaskLock(root, id, async () => {
      const stateFile = path.join(root, '.dev-state', `${id}.json`)
      let read = await readState(stateFile)
      if (!read.ok) return this.notFound('task not found', { taskId: id })
      let state = read.state as Record<string, unknown>
      if (state.hitl_pending) {
        return this.badRequest('task is waiting for HITL approval', { taskId: id })
      }

      const existing = listJobs(50).find(
        (j) =>
          j.metadata?.taskId === id &&
          (j.status === 'queued' || j.status === 'running'),
      )
      if (existing) return this.json(409, { error: 'step already running', taskId: id, job: existing })

      let stepId = String(state.current_phase ?? '')
      const lastSucceeded = listJobs(200).find(
        (j) =>
          j.metadata?.taskId === id &&
          j.status === 'succeeded' &&
          !j.applyTarget &&
          j.metadata?.pipelineStepId === stepId,
      )
      if (lastSucceeded && stepId) {
        await advanceStepOnJobSuccessAssumingLock(root, id, stepId, stateFile)
        read = await readState(stateFile)
        if (!read.ok) return this.notFound('task not found', { taskId: id })
        state = read.state as Record<string, unknown>
        if (state.hitl_pending) {
          return this.badRequest('task is waiting for HITL approval', { taskId: id })
        }
        stepId = String(state.current_phase ?? '')
      }

      const pipeline = await loadPipelineConfig(root, id)
      const phaseKeys = (pipeline.steps || []).map((s: any) => s.id).filter(Boolean)
      const target = body.targetStepId ?? undefined
      const skip = body.skipIntermediate === true && !!target && target !== stepId
      // Chain: no skip requested, but a target ahead of the start step — the
      // job queue auto-advances toward it and stops once reached (jobQueue.ts
      // `advancePipelineStepChain`). Validate it same as a jump target so an
      // out-of-pipeline/past id can't be recorded as `chainTarget` and let the
      // chain run past where the caller meant to stop.
      const chainTarget = !skip && !!target && target !== stepId

      if ((skip || chainTarget) && target) {
        if (!phaseKeys.includes(target) || !isRunnableTarget(phaseKeys, stepId, target)) {
          return this.badRequest('invalid target step', { taskId: id, stepId, targetStepId: target })
        }
      }

      // Resolve the step that will actually run BEFORE mutating current_phase
      // (jump), so a missing agent / request.md aborts without moving the
      // cursor to a step nothing then executes for.
      const runStepId = skip && target ? target : stepId
      const step = (pipeline.steps || []).find((s: any) => s.id === runStepId)
      if (!step?.agent) {
        return this.badRequest('no runnable current step', { taskId: id, stepId: runStepId })
      }

      const requestFile = path.join(root, 'tasks', id, 'request.md')
      let userPrompt: string
      try {
        userPrompt = await fs.readFile(requestFile, 'utf8')
      } catch {
        return this.notFound('request.md not found', { taskId: id })
      }

      if (skip && target) {
        const jumped = await jumpToPipelineStepAssumingLock(stateFile, target)
        if ('error' in jumped) {
          return this.json(jumped.status, { error: jumped.error, taskId: id })
        }
        state = jumped.state
        stepId = target
      }

      const job = submitJob({
        runnerId: body.runnerId ?? undefined,
        agentRef: step.agent,
        workspace: path.join(root, 'tasks', id),
        userPrompt,
        produces: Array.isArray(step.produces) ? step.produces : undefined,
        sessionMode: 'new',
        metadata: {
          projectRoot: path.dirname(root),
          devTeamRoot: root,
          projectId: this.projectId || undefined,
          taskId: id,
          pipelineStepId: stepId,
          ...(chainTarget && target ? { chainTarget: target } : {}),
        },
      })

      emitAudit({
        op: 'update',
        entity: 'task-state',
        identifier: id,
        projectId: this.projectId,
        detail: { action: 'run-step', stepId, jobId: job.id, ...(skip ? { skipIntermediate: true } : {}) },
      })

      return this.created({ job })
    })
  }

  async postTaskFeedback() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const id = this.c.req.param('id')
    if (!id || /[^\w\-]/.test(id)) return this.badRequest('invalid task id')

    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON body')
    const parsed = TaskFeedbackRequest.safeParse(b.value)
    if (!parsed.success) {
      return this.badRequest('invalid request', { details: parsed.error.flatten() })
    }

    const stateFile = path.join(root, '.dev-state', `${id}.json`)
    const read = await readState(stateFile)
    if (!read.ok) return this.notFound('task not found', { taskId: id })

    const projectId = this.projectId || ''
    const result = await sendTaskFeedback(id, projectId, parsed.data.feedback, {
      stepId: parsed.data.stepId ?? undefined,
      mode: parsed.data.mode,
    })
    if ('error' in result) return this.json(result.status || 400, { error: result.error, taskId: id })

    if ('queued' in result) {
      emitAudit({
        op: 'update',
        entity: 'task-state',
        identifier: id,
        projectId: this.projectId,
        detail: { action: 'feedback-queued', stepId: parsed.data.stepId ?? undefined },
      })
      return this.created({ queued: true })
    }

    emitAudit({
      op: 'update',
      entity: 'task-state',
      identifier: id,
      projectId: this.projectId,
      detail: { action: 'feedback', jobId: result.job.id, stepId: parsed.data.stepId ?? undefined },
    })

    return this.created({ job: result.job })
  }

  getTaskChat() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const id = this.c.req.param('id')
    if (!id || /[^\w\-]/.test(id)) return this.badRequest('invalid task id')

    const stepId = this.c.req.query('stepId') || undefined
    const rawFrom = Number(this.c.req.query('from'))
    const state = getTaskChatState(this.projectId || '', id, {
      stepId,
      fromIndex: Number.isFinite(rawFrom) && rawFrom > 0 ? rawFrom : 0,
      includeToolActivity: this.c.req.query('tools') !== '0',
    })
    return this.ok(state)
  }

  async postGithubIssue() {
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON body')
    const parsed = GithubIssueRequest.safeParse(b.value)
    if (!parsed.success) {
      return this.badRequest('invalid request', { details: parsed.error.flatten() })
    }
    const result = await fetchGithubIssue(parsed.data.url)
    if ('error' in result) return this.json(result.status, { error: result.error })
    return this.ok({ issue: result.issue })
  }
}
