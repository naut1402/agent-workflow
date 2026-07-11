import fs from 'node:fs/promises'
import path from 'node:path'
import type { Hono } from 'hono'
import type { HonoEnv } from '../types.js'
import { j, parseBody, unknownProject } from '../respond.js'
import { resolveArtifact } from '../../../shared/sanitize.js'
import { collectTasks, flowProfilePath } from '../../tasks/index.js'
import { applyArchiveAction, applyHitlAction } from '../../tasks/state.js'
import { loadPipelineConfig } from '../../pipeline/index.js'
import { emitAudit } from '../../logging/store.js'
import { TaskArchivePatch, TaskStatePatch } from '../../../shared/schemas/task.js'
import { submitJob, submitApprovalJob } from '../../runners/index.js'
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
  // `?artifact=` present → UI-facing subset filtered to that artifact (and
  // optionally `?attach=`), used by the title toolbar / selection toolbar.
  // `?artifact=` omitted → full catalog (all fields), used by the QuickAction
  // CRUD panel.
  app.get('/api/artifact-actions', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const artifact = c.req.query('artifact') || ''
    const attach = c.req.query('attach') || ''

    if (!artifact) {
      const file = await loadArtifactActionsFile(root)
      return j(c, 200, { version: file.version, actions: file.actions })
    }

    const actions = await loadArtifactActions(root)
    const matched = attach ? matchByAttach(actions, artifact, attach) : matchActions(actions, artifact)
    return j(c, 200, { artifact, actions: matched.map(toActionView) })
  })

  // Full-catalog replace (CRUD save from the QuickAction panel).
  app.put('/api/artifact-actions', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON body' })
    const result = await saveArtifactActions(root, b.value)
    if ('error' in result) return j(c, 400, { error: result.error })
    emitAudit({ op: 'update', entity: 'artifact-actions', identifier: 'catalog', projectId: c.get('projectId') })
    return j(c, 200, { ok: true, version: result.version, actions: result.actions })
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

    const actions = await loadArtifactActions(root)
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

    const userPrompt = substitutePrompt(action.prompt_template, {
      artifact_name: artifactName,
      artifact_base: artifactBase(artifactName),
      selection: selectedText ?? '',
      selectionStartLine,
      selectionEndLine,
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
      ? submitApprovalJob({ ...jobInput, approvalArtifact: artifactName })
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
}
