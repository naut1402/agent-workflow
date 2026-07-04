import fs from 'node:fs/promises'
import path from 'node:path'
import type { Hono } from 'hono'
import type { HonoEnv } from '../types.js'
import { j, parseBody, unknownProject } from '../respond.js'
import { resolveArtifact } from '../../../shared/sanitize.js'
import { collectTasks, flowProfilePath } from '../../tasks/index.js'
import { applyHitlAction } from '../../tasks/state.js'
import { loadPipelineConfig } from '../../pipeline/index.js'
import { emitAudit } from '../../logging/store.js'
import { TaskStatePatch } from '../../../shared/schemas/task.js'

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
}
