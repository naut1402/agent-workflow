import fs from 'node:fs/promises'
import path from 'node:path'
import type { Hono } from 'hono'
import type { HonoEnv } from '../types.js'
import { j, parseBody, unknownProject } from '../respond.js'
import { resolveArtifact } from '../../../shared/sanitize.js'
import { collectTasks, flowProfilePath, createTask, readState } from '../../tasks/index.js'
import { applyArchiveAction, applyHitlAction } from '../../tasks/state.js'
import { loadPipelineConfig } from '../../pipeline/index.js'
import { emitAudit } from '../../logging/store.js'
import { TaskArchivePatch, TaskStatePatch } from '../../../shared/schemas/task.js'
import { CreateTaskRequest, GithubIssueRequest } from '../../../shared/schemas/taskCreate.js'
import { RunStepRequest } from '../../../shared/schemas/runStep.js'
import { TaskFeedbackRequest } from '../../../shared/schemas/taskFeedback.js'
import { fetchGithubIssue } from '../../github/index.js'
import { getTaskChatState } from '../../chat/taskChat.js'
import {
  submitJob,
  submitApprovalJob,
  sendTaskFeedback,
  findSelectionRange,
  extractLines,
  listJobs,
} from '../../runners/index.js'
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
} from '../../artifactActions/index.js'
import { RunArtifactActionRequest } from '../../../shared/schemas/artifactAction.js'

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

// Task state, artifacts, resolved pipeline config, profile & flow-profile.
export function registerTaskRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/tasks', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    // Backward-compat shape: { root, tasks }, plus project id when requested.
    const payload: any = { root, tasks: await collectTasks(root) }
    if (c.get('projectId')) payload.project = c.get('projectId')
    return j(c, 200, payload)
  })

  app.get('/api/pipeline-config', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const id = c.req.query('id') || ''
    const cfg = await loadPipelineConfig(root, id || null)
    return j(c, 200, { id: id || null, pipeline: cfg })
  })

  app.get('/api/artifact', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const id = c.req.query('id') || ''
    const name = c.req.query('name') || ''
    const target = resolveArtifact(root, id, name)
    if (!target) return j(c, 400, { error: 'invalid path' })
    try {
      const content = await fs.readFile(target, 'utf8')
      const s = await fs.stat(target)
      return j(c, 200, { id, name, content, mtime: s.mtimeMs })
    } catch {
      return j(c, 404, { error: 'not found', id, name })
    }
  })

  app.put('/api/artifact', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const id = c.req.query('id') || ''
    const name = c.req.query('name') || ''
    if (!id || /[^\w\-]/.test(id)) return j(c, 400, { error: 'invalid task id' })
    if (!name || !name.endsWith('.md') || name.includes('..') || name.startsWith('.')) {
      return j(c, 400, { error: 'invalid artifact name' })
    }
    const target = resolveArtifact(root, id, name)
    if (!target) return j(c, 400, { error: 'invalid path' })
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON body' })
    const { content, mtime } = b.value as { content?: unknown; mtime?: unknown }
    if (typeof content !== 'string') return j(c, 400, { error: 'content must be a string' })

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
          return j(c, 409, {
            error: 'conflict',
            id,
            name,
            content: current,
            mtime: existingMtime,
          })
        } catch {
          return j(c, 409, { error: 'conflict', id, name })
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
        projectId: c.get('projectId'),
      })
      return j(c, 200, { id, name, content, mtime: s.mtimeMs })
    })
  })

  app.get('/api/profile', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const profilePath = path.join(root, 'orchestrator-profile.json')
    try {
      const raw = await fs.readFile(profilePath, 'utf8')
      return j(c, 200, { profile: JSON.parse(raw), exists: true })
    } catch {
      return j(c, 200, { profile: null, exists: false })
    }
  })
  app.post('/api/profile', (c) => {
    if (!c.get('root')) return unknownProject(c)
    return j(c, 501, { error: 'profile editing not implemented yet' })
  })

  // Structured phase-summary export (machine-readable, written by orchestrator).
  app.get('/api/pipeline-export', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const id = c.req.query('id') || ''
    if (!id) return j(c, 400, { error: 'missing id' })
    const fp = path.join(root, 'tasks', id, 'pipeline-export.json')
    try {
      const raw = await fs.readFile(fp, 'utf8')
      return j(c, 200, { id, export: JSON.parse(raw), exists: true })
    } catch {
      return j(c, 200, { id, export: null, exists: false })
    }
  })

  // Per-task flow profiles: GET reads, POST creates/updates.
  app.get('/api/flow-profile', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const id = c.req.query('id') || ''
    if (!id) return j(c, 400, { error: 'missing id' })
    const fp = flowProfilePath(root, id)
    try {
      const raw = await fs.readFile(fp, 'utf8')
      return j(c, 200, { id, profile: JSON.parse(raw), exists: true })
    } catch {
      return j(c, 200, { id, profile: null, exists: false })
    }
  })
  app.post('/api/flow-profile', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const id = c.req.query('id') || ''
    if (!id) return j(c, 400, { error: 'missing id' })
    const fp = flowProfilePath(root, id)
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON body' })
    await fs.mkdir(path.dirname(fp), { recursive: true })
    await fs.writeFile(fp, JSON.stringify(b.value, null, 2), 'utf8')
    emitAudit({ op: 'update', entity: 'flow-profile', identifier: id, projectId: c.get('projectId') })
    return j(c, 200, { id, saved: true })
  })

  app.put('/api/task-state', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const id = c.req.query('id') || ''
    if (!id || /[^\w\-]/.test(id)) return j(c, 400, { error: 'invalid task id' })

    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON body' })
    const parsed = TaskStatePatch.safeParse(b.value)
    if (!parsed.success) {
      return j(c, 400, { error: 'invalid patch', details: parsed.error.flatten() })
    }

    const result = await applyHitlAction(root, id, parsed.data)
    if ('error' in result) {
      const body: Record<string, unknown> = { error: result.error, id }
      if (result.state) body.state = result.state
      if (result.mtime != null) body.mtime = result.mtime
      return j(c, result.status, body)
    }

    emitAudit({
      op: 'update',
      entity: 'task-state',
      identifier: id,
      projectId: c.get('projectId'),
      detail: { action: parsed.data.action, gate_id: parsed.data.gate_id },
    })
    return j(c, 200, { id, state: result.state, mtime: result.mtime })
  })

  app.put('/api/task-archive', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const id = c.req.query('id') || ''
    if (!id || /[^\w\-]/.test(id)) return j(c, 400, { error: 'invalid task id' })

    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON body' })
    const parsed = TaskArchivePatch.safeParse(b.value)
    if (!parsed.success) {
      return j(c, 400, { error: 'invalid patch', details: parsed.error.flatten() })
    }

    const result = await applyArchiveAction(root, id, parsed.data)
    if ('error' in result) {
      const body: Record<string, unknown> = { error: result.error, id }
      if (result.state) body.state = result.state
      if (result.mtime != null) body.mtime = result.mtime
      return j(c, result.status, body)
    }

    emitAudit({
      op: 'update',
      entity: 'task-state',
      identifier: id,
      projectId: c.get('projectId'),
      detail: { action: parsed.data.archived ? 'archive' : 'unarchive' },
    })
    return j(c, 200, { id, state: result.state, mtime: result.mtime })
  })

  // ── Artifact quick-actions ─────────────────────────────────────────────────
  // Catalog is dashboard-global (`~/.dev-team-dashboard/artifact-actions.yaml`)
  // — GET/PUT do not need a project root (same pattern as /api/runners).
  // `?artifact=` present → UI-facing subset filtered to that artifact (and
  // optionally `?attach=`), used by the title toolbar / selection toolbar.
  // `?artifact=` omitted → full catalog (all fields), used by the QuickAction
  // CRUD panel.
  app.get('/api/artifact-actions', async (c) => {
    const artifact = c.req.query('artifact') || ''
    const attach = c.req.query('attach') || ''

    if (!artifact) {
      const file = await loadArtifactActionsFile()
      return j(c, 200, { version: file.version, actions: file.actions, menus: file.menus })
    }

    const file = await loadArtifactActionsFile()
    const matched = attach
      ? matchByAttach(file.actions, artifact, attach)
      : matchActions(file.actions, artifact)
    return j(c, 200, {
      artifact,
      actions: matched.map(toActionView),
      menus: file.menus,
    })
  })

  // Full-catalog replace (CRUD save from the QuickAction panel).
  app.put('/api/artifact-actions', async (c) => {
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON body' })
    const result = await saveArtifactActions(b.value)
    if ('error' in result) return j(c, 400, { error: result.error })
    emitAudit({ op: 'update', entity: 'artifact-actions', identifier: 'catalog', projectId: null })
    return j(c, 200, {
      ok: true,
      version: result.version,
      actions: result.actions,
      menus: result.menus,
    })
  })

  // Run a quick-action: build the prompt from its template + the artifact (and
  // optional text selection), then reuse the job queue (same path as
  // POST /api/jobs) to submit it to a runner.
  app.post('/api/artifact-actions/run', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON body' })
    const parsed = RunArtifactActionRequest.safeParse(b.value)
    if (!parsed.success) {
      return j(c, 400, { error: 'invalid request', details: parsed.error.flatten() })
    }
    const { taskId, actionId, artifactName, runnerId, selectedText, selectionStartLine, selectionEndLine } =
      parsed.data
    if (/[^\w\-]/.test(taskId)) return j(c, 400, { error: 'invalid task id' })

    const target = resolveArtifact(root, taskId, artifactName)
    if (!target) return j(c, 400, { error: 'invalid artifact path' })

    const actions = await loadArtifactActions()
    const action = findAction(actions, actionId)
    if (!action) return j(c, 404, { error: 'unknown action', actionId })
    if (matchActions([action], artifactName).length === 0) {
      return j(c, 400, { error: 'action does not apply to artifact' })
    }

    // Selection-only actions (attached to `artifact-selection` but not
    // `artifact-title`) can only ever be triggered from the selection toolbar,
    // which always supplies the selected text — an empty/missing value here
    // means the caller skipped the toolbar (or the selection vanished).
    const attachPoints = action.attach_points ?? ['artifact-title']
    const selectionOnly =
      attachPoints.includes('artifact-selection') && !attachPoints.includes('artifact-title')
    if (selectionOnly && !selectedText) {
      return j(c, 400, { error: 'selection required' })
    }

    let content: string
    try {
      content = await fs.readFile(target, 'utf8')
    } catch {
      return j(c, 404, { error: 'artifact not found', taskId, artifactName })
    }

    // Selection splice (only for require_approval selection runs): the agent's
    // proposed content (its stdout) is spliced back into ONLY the source lines
    // the user selected, so no other line can change.
    //
    // The line range from the viewer is best-effort (it maps a rendered-HTML
    // selection back to source and falls back to the whole block when the
    // rendered text can't be found verbatim — e.g. markdown stripped backticks).
    // Re-locate the selection in the raw source here (markdown-insensitive) to
    // pin the exact lines; fall back to the viewer's range only if that fails.
    // Then hand the agent the SOURCE of that range (not the rendered text) so
    // its improved output splices back cleanly and content/range always agree.
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
        projectId: c.get('projectId') || undefined,
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
      projectId: c.get('projectId'),
      detail: { jobId: job.id, agentRef: action.agent_ref, action: actionId },
    })
    return j(c, 201, { job })
  })

  app.post('/api/tasks', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON body' })
    const parsed = CreateTaskRequest.safeParse(b.value)
    if (!parsed.success) {
      return j(c, 400, { error: 'invalid request', details: parsed.error.flatten() })
    }
    const body = parsed.data
    const result = await createTask(root, {
      taskId: body.taskId,
      source: body.source,
      prompt: body.prompt,
      issueUrl: body.issueUrl,
      parentTaskId: body.parentTaskId,
      profileName: body.profileName,
      pipeline: body.pipeline,
      knowledgeInputs: body.knowledgeInputs,
      autoReview: body.autoReview,
      exportJson: body.exportJson,
    })
    if ('error' in result) return j(c, result.status, { error: result.error, taskId: body.taskId })

    emitAudit({
      op: 'create',
      entity: 'task-state',
      identifier: result.taskId,
      projectId: c.get('projectId'),
    })

    let job: ReturnType<typeof submitJob> | undefined
    if (body.run) {
      const agentRef = result.firstStep?.agent
      if (typeof agentRef !== 'string' || !agentRef) {
        return j(c, 400, { error: 'pipeline has no first-step agent', taskId: result.taskId })
      }
      job = submitJob({
        runnerId: body.runnerId ?? undefined,
        agentRef,
        workspace: path.join(root, 'tasks', result.taskId),
        userPrompt: result.requestContent,
        metadata: {
          projectRoot: path.dirname(root),
          devTeamRoot: root,
          projectId: c.get('projectId') || undefined,
          taskId: result.taskId,
          // Same bookkeeping as run-step — without this, jobQueue's
          // advancePipelineStepChain no-ops and current_phase stays stuck
          // on the first step after a successful "Chạy ngay" create.
          pipelineStepId: result.firstStep.id,
          createTaskRun: true,
        },
      })
    }

    return j(c, 201, {
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
  })

  // Dashboard-triggered execution of a task's current step (clicking a node on
  // the pipeline flow). `targetStepId` opts into chaining: on each job
  // success, jobQueue.ts advances `current_phase` past gate-less steps and
  // keeps submitting the next one until it reaches `targetStepId`, hits a
  // HITL gate, or a job fails. See server/tasks/state.ts (advanceStepOnJobSuccess)
  // and server/runners/jobQueue.ts (advancePipelineStepChain).
  app.post('/api/tasks/:id/run-step', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const id = c.req.param('id')
    if (!id || /[^\w\-]/.test(id)) return j(c, 400, { error: 'invalid task id' })

    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON body' })
    const parsed = RunStepRequest.safeParse(b.value)
    if (!parsed.success) {
      return j(c, 400, { error: 'invalid request', details: parsed.error.flatten() })
    }

    const stateFile = path.join(root, '.dev-state', `${id}.json`)
    const read = await readState(stateFile)
    if (!read.ok) return j(c, 404, { error: 'task not found', taskId: id })
    const state = read.state as Record<string, unknown>
    if (state.hitl_pending) {
      return j(c, 400, { error: 'task is waiting for HITL approval', taskId: id })
    }

    const stepId = String(state.current_phase ?? '')
    const pipeline = await loadPipelineConfig(root, id)
    const step = (pipeline.steps || []).find((s: any) => s.id === stepId)
    if (!step?.agent) {
      return j(c, 400, { error: 'no runnable current step', taskId: id, stepId })
    }

    const existing = listJobs(50).find(
      (j) =>
        j.metadata?.taskId === id &&
        (j.status === 'queued' || j.status === 'running'),
    )
    if (existing) return j(c, 409, { error: 'step already running', taskId: id, job: existing })

    const requestFile = path.join(root, 'tasks', id, 'request.md')
    let userPrompt: string
    try {
      userPrompt = await fs.readFile(requestFile, 'utf8')
    } catch {
      return j(c, 404, { error: 'request.md not found', taskId: id })
    }

    const body = parsed.data
    const job = submitJob({
      runnerId: body.runnerId ?? undefined,
      agentRef: step.agent,
      workspace: path.join(root, 'tasks', id),
      userPrompt,
      // Resume the task's ledger session (if any) instead of always running
      // with no session — resolveSessionPlan() falls back to 'new' on its own
      // if the ledger has no valid open entry, so this is safe from the first
      // run-step call onward. See jobQueue.ts sendTaskFeedback / design F0011.
      sessionMode: 'resume',
      metadata: {
        projectRoot: path.dirname(root),
        devTeamRoot: root,
        projectId: c.get('projectId') || undefined,
        taskId: id,
        pipelineStepId: stepId,
        ...(body.targetStepId ? { chainTarget: body.targetStepId } : {}),
      },
    })

    emitAudit({
      op: 'update',
      entity: 'task-state',
      identifier: id,
      projectId: c.get('projectId'),
      detail: { action: 'run-step', stepId, jobId: job.id },
    })

    return j(c, 201, { job })
  })

  // Task-scoped chat resume: continue the CLI session of the task's most
  // recent finished (non-approval) job with follow-up feedback. Separate from
  // POST /api/jobs/:id/feedback (approval flow, keyed by jobId) — this route
  // is keyed by taskId since the UI operates on the task, not a specific job
  // id. See server/runners/jobQueue.ts (sendTaskFeedback) and design F0011.
  app.post('/api/tasks/:id/feedback', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const id = c.req.param('id')
    if (!id || /[^\w\-]/.test(id)) return j(c, 400, { error: 'invalid task id' })

    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON body' })
    const parsed = TaskFeedbackRequest.safeParse(b.value)
    if (!parsed.success) {
      return j(c, 400, { error: 'invalid request', details: parsed.error.flatten() })
    }

    const stateFile = path.join(root, '.dev-state', `${id}.json`)
    const read = await readState(stateFile)
    if (!read.ok) return j(c, 404, { error: 'task not found', taskId: id })

    const projectId = c.get('projectId') || ''
    const result = sendTaskFeedback(id, projectId, parsed.data.feedback, {
      stepId: parsed.data.stepId ?? undefined,
    })
    if ('error' in result) return j(c, result.status || 400, { error: result.error, taskId: id })

    emitAudit({
      op: 'update',
      entity: 'task-state',
      identifier: id,
      projectId: c.get('projectId'),
      detail: { action: 'feedback', jobId: result.job.id, stepId: parsed.data.stepId ?? undefined },
    })

    return j(c, 201, { job: result.job })
  })

  // Conversation history of the CLI session a step ran under, read from the
  // runner's own transcript — also the live view of a step still running (the
  // CLI appends to the transcript as it works). `from` is a turn cursor: pass
  // back the previous response's `total` to fetch only what is new.
  app.get('/api/tasks/:id/chat', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const id = c.req.param('id')
    if (!id || /[^\w\-]/.test(id)) return j(c, 400, { error: 'invalid task id' })

    const stepId = c.req.query('stepId') || undefined
    const rawFrom = Number(c.req.query('from'))
    const state = getTaskChatState(c.get('projectId') || '', id, {
      stepId,
      fromIndex: Number.isFinite(rawFrom) && rawFrom > 0 ? rawFrom : 0,
      includeToolActivity: c.req.query('tools') !== '0',
    })
    return j(c, 200, state)
  })

  app.post('/api/github/issue', async (c) => {
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON body' })
    const parsed = GithubIssueRequest.safeParse(b.value)
    if (!parsed.success) {
      return j(c, 400, { error: 'invalid request', details: parsed.error.flatten() })
    }
    const result = await fetchGithubIssue(parsed.data.url)
    if ('error' in result) return j(c, result.status, { error: result.error })
    return j(c, 200, { issue: result.issue })
  })
}
