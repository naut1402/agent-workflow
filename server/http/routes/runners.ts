import path from 'node:path'
import type { Hono } from 'hono'
import type { HonoEnv } from '../types.js'
import { j, parseBody, unknownProject } from '../respond.js'
import {
  listRunners,
  upsertRunner,
  deleteRunner,
  setDefaultRunner,
  listCredentials,
  upsertCredential,
  deleteCredential,
  submitJob,
  loadJob,
  listJobs,
  cancelJob,
  listProviderIds,
} from '../../runners/index.js'

// Runners, credentials & jobs — global (not per-project), except job submission
// which needs the resolved `.dev-team-agent/` root.
export function registerRunnerRoutes(app: Hono<HonoEnv>): void {
  // ── Runners ──────────────────────────────────────────────────────────────
  app.get('/api/runners', (c) => j(c, 200, { ...listRunners(), providers: listProviderIds() }))
  app.post('/api/runners', async (c) => {
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON' })
    const result = upsertRunner(b.value.runner || b.value)
    if (!result.ok) return j(c, 400, { error: result.error })
    return j(c, 200, { saved: true, runner: result.runner })
  })
  app.delete('/api/runners', (c) => {
    const result = deleteRunner(c.req.query('id') || '')
    if (!result.ok) return j(c, result.status || 400, { error: result.error })
    return j(c, 200, { deleted: true, id: c.req.query('id') || '' })
  })
  app.all('/api/runners', (c) => j(c, 405, { error: 'method not allowed' }))

  app.post('/api/runners/default', async (c) => {
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON' })
    const result = setDefaultRunner(b.value.id || b.value.runnerId)
    if (!result.ok) return j(c, result.status || 400, { error: result.error })
    return j(c, 200, { defaultRunnerId: result.defaultRunnerId })
  })

  // ── Credentials ──────────────────────────────────────────────────────────
  app.get('/api/credentials', (c) => j(c, 200, { profiles: listCredentials() }))
  app.post('/api/credentials', async (c) => {
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON' })
    const result = upsertCredential(b.value.profile || b.value)
    if (!result.ok) return j(c, 400, { error: result.error })
    return j(c, 200, { saved: true, profile: result.profile })
  })
  app.delete('/api/credentials', (c) => {
    const result = deleteCredential(c.req.query('id') || '')
    if (!result.ok) return j(c, result.status || 400, { error: result.error })
    return j(c, 200, { deleted: true, id: c.req.query('id') || '' })
  })
  app.all('/api/credentials', (c) => j(c, 405, { error: 'method not allowed' }))

  // ── Jobs ─────────────────────────────────────────────────────────────────
  app.get('/api/jobs', (c) => {
    const id = c.req.query('id')
    if (id) {
      const job = loadJob(id)
      if (!job) return j(c, 404, { error: 'not found' })
      return j(c, 200, { job })
    }
    const limit = Number(c.req.query('limit')) || 20
    return j(c, 200, { jobs: listJobs(limit) })
  })
  app.post('/api/jobs', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON' })
    const parsed = b.value
    if (!parsed.agentRef || !parsed.workspace) {
      return j(c, 400, { error: 'agentRef and workspace are required' })
    }
    const projectRoot = path.dirname(root)
    const job = submitJob({
      runnerId: parsed.runnerId,
      agentRef: parsed.agentRef,
      workspace: path.isAbsolute(parsed.workspace)
        ? parsed.workspace
        : path.join(root, parsed.workspace),
      userPrompt: parsed.userPrompt,
      promptRef: parsed.promptRef,
      produces: parsed.produces,
      metadata: { projectRoot, devTeamRoot: root, ...parsed.metadata },
    })
    return j(c, 201, { job })
  })
  app.all('/api/jobs', (c) => j(c, 405, { error: 'method not allowed' }))

  app.post('/api/jobs/:id/cancel', (c) => {
    const id = c.req.param('id')
    const result = cancelJob(id)
    if (!result.ok) return j(c, result.status || 400, { error: result.error })
    return j(c, 200, { cancelled: true, id })
  })
  app.get('/api/jobs/:id', (c) => {
    const id = c.req.param('id')
    const job = loadJob(id)
    if (!job) return j(c, 404, { error: 'not found' })
    return j(c, 200, { job })
  })
}
