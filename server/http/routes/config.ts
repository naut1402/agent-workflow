import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import type { Hono } from 'hono'
import type { HonoEnv } from '../types.js'
import { j, parseBody, unknownProject } from '../respond.js'
import { statSafe } from '../../../shared/fs.js'
import { sanitiseProfileName } from '../../../shared/sanitize.js'
import { profilesDir } from '../../agents/index.js'
import { emitAudit } from '../../logging/store.js'

// Pipeline profiles (named reusable configs) + pipeline.yaml write.
export function registerConfigRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/pipeline-profiles', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const dir = profilesDir(root)
    const nameParam = c.req.query('name')
    if (nameParam) {
      const name = sanitiseProfileName(nameParam)
      if (!name) return j(c, 400, { error: 'invalid profile name' })
      try {
        const raw = await fs.readFile(path.join(dir, `${name}.yaml`), 'utf8')
        return j(c, 200, { name, pipeline: yaml.load(raw) })
      } catch {
        return j(c, 404, { error: 'profile not found' })
      }
    }
    try {
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.yaml'))
      const profiles = await Promise.all(
        files.map(async (f) => {
          const s = await statSafe(path.join(dir, f))
          return { name: f.replace(/\.yaml$/, ''), mtime: s.mtime }
        }),
      )
      return j(c, 200, { profiles })
    } catch {
      return j(c, 200, { profiles: [] })
    }
  })

  app.post('/api/pipeline-profiles', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const dir = profilesDir(root)
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON' })
    const name = sanitiseProfileName(b.value.name)
    if (!name) return j(c, 400, { error: 'invalid profile name' })
    if (!b.value.pipeline || !Array.isArray(b.value.pipeline.steps)) {
      return j(c, 400, { error: 'pipeline.steps must be an array' })
    }
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, `${name}.yaml`), yaml.dump(b.value.pipeline, { lineWidth: 120 }), 'utf8')
    emitAudit({ op: 'create', entity: 'pipeline-profile', identifier: name, projectId: c.get('projectId') })
    return j(c, 200, { saved: true, name })
  })

  app.delete('/api/pipeline-profiles', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const dir = profilesDir(root)
    const name = sanitiseProfileName(c.req.query('name') || '')
    if (!name) return j(c, 400, { error: 'invalid profile name' })
    try {
      await fs.unlink(path.join(dir, `${name}.yaml`))
      emitAudit({ op: 'delete', entity: 'pipeline-profile', identifier: name, projectId: c.get('projectId') })
      return j(c, 200, { deleted: true, name })
    } catch {
      return j(c, 404, { error: 'profile not found' })
    }
  })

  app.post('/api/pipeline-config-write', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON' })
    const { scope, taskId, pipeline } = b.value
    if (!pipeline || !Array.isArray(pipeline.steps)) {
      return j(c, 400, { error: 'pipeline.steps must be an array' })
    }
    let target: string
    if (scope === 'global') {
      target = path.join(root, 'pipeline.yaml')
    } else if (scope === 'task' && taskId) {
      if (/[^\w\-]/.test(taskId)) return j(c, 400, { error: 'invalid taskId' })
      const taskDir = path.join(root, 'tasks', taskId)
      await fs.mkdir(taskDir, { recursive: true })
      target = path.join(taskDir, 'pipeline.yaml')
    } else {
      return j(c, 400, { error: 'scope must be "global" or "task" (with taskId)' })
    }
    const toWrite = scope === 'task' ? { ...pipeline, steps_replace: true } : pipeline
    await fs.writeFile(target, yaml.dump(toWrite, { lineWidth: 120 }), 'utf8')
    emitAudit({
      op: 'update',
      entity: 'pipeline',
      identifier: scope === 'task' ? taskId : 'global',
      projectId: c.get('projectId'),
      detail: { scope },
    })
    return j(c, 200, { written: true, scope, target })
  })
}
