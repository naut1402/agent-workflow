import path from 'node:path'
import type { Hono } from 'hono'
import type { HonoEnv } from '../types.js'
import { j, parseBody, unknownProject } from '../respond.js'
import { emitAudit } from '../../logging/store.js'
import {
  listRunners,
  upsertRunner,
  deleteRunner,
  setDefaultRunner,
  listCredentials,
  upsertCredential,
  deleteCredential,
  listConnections,
  upsertConnection,
  deleteConnection,
  listProviderCatalog,
  scanLocalCommands,
  submitJob,
  loadJob,
  listJobs,
  cancelJob,
  getApprovalDiff,
  approveJob,
  discardJob,
  sendJobFeedback,
} from '../../runners/index.js'

// Runners, connections, credentials & jobs — global (not per-project), except
// job submission which needs the resolved `.dev-team-agent/` root.
export function registerRunnerRoutes(app: Hono<HonoEnv>): void {
  // ── Runners ──────────────────────────────────────────────────────────────
  app.get('/api/runners', (c) =>
    j(c, 200, {
      ...listRunners(),
      providers: listProviderCatalog(),
      connections: listConnections(),
    }),
  )
  app.post('/api/runners', async (c) => {
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON' })
    const result = upsertRunner(b.value.runner || b.value)
    if ('error' in result) return j(c, 400, { error: result.error })
    emitAudit({ op: 'update', entity: 'runner', identifier: result.runner?.id ?? null, projectId: null })
    return j(c, 200, { saved: true, runner: result.runner })
  })
  app.delete('/api/runners', (c) => {
    const result = deleteRunner(c.req.query('id') || '')
    if ('error' in result) return j(c, result.status || 400, { error: result.error })
    emitAudit({ op: 'delete', entity: 'runner', identifier: c.req.query('id') || '', projectId: null })
    return j(c, 200, { deleted: true, id: c.req.query('id') || '' })
  })
  app.all('/api/runners', (c) => j(c, 405, { error: 'method not allowed' }))

  app.post('/api/runners/default', async (c) => {
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON' })
    const result = setDefaultRunner(b.value.id || b.value.runnerId)
    if ('error' in result) return j(c, result.status || 400, { error: result.error })
    return j(c, 200, { defaultRunnerId: result.defaultRunnerId })
  })

  // ── Connections ──────────────────────────────────────────────────────────
  app.get('/api/connections/scan', (c) => j(c, 200, { commands: scanLocalCommands() }))
  app.get('/api/connections', (c) =>
    j(c, 200, { connections: listConnections(), providers: listProviderCatalog() }),
  )
  app.post('/api/connections', async (c) => {
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON' })
    const result = upsertConnection(b.value.connection || b.value)
    if ('error' in result) return j(c, 400, { error: result.error })
    emitAudit({
      op: 'update',
      entity: 'connection',
      identifier: result.connection?.id ?? null,
      projectId: null,
    })
    return j(c, 200, { saved: true, connection: result.connection })
  })
  app.delete('/api/connections', (c) => {
    const result = deleteConnection(c.req.query('id') || '')
    if ('error' in result) return j(c, result.status || 400, { error: result.error })
    emitAudit({
      op: 'delete',
      entity: 'connection',
      identifier: c.req.query('id') || '',
      projectId: null,
    })
    return j(c, 200, { deleted: true, id: c.req.query('id') || '' })
  })
  app.all('/api/connections', (c) => j(c, 405, { error: 'method not allowed' }))

  // ── Credentials ──────────────────────────────────────────────────────────
  app.get('/api/credentials', (c) => j(c, 200, { profiles: listCredentials() }))
  app.post('/api/credentials', async (c) => {
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON' })
    const result = upsertCredential(b.value.profile || b.value)
    if ('error' in result) return j(c, 400, { error: result.error })
    // Log the id only — never the secret payload.
    emitAudit({ op: 'update', entity: 'credential', identifier: result.profile?.id ?? null, projectId: null })
    return j(c, 200, { saved: true, profile: result.profile })
  })
  app.delete('/api/credentials', (c) => {
    const result = deleteCredential(c.req.query('id') || '')
    if ('error' in result) return j(c, result.status || 400, { error: result.error })
    emitAudit({ op: 'delete', entity: 'credential', identifier: c.req.query('id') || '', projectId: null })
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
    // agentRef may be '' for console-command / direct-prompt jobs (no agent file).
    if (typeof parsed.agentRef !== 'string' || !parsed.workspace) {
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
    if ('error' in result) return j(c, result.status || 400, { error: result.error })
    return j(c, 200, { cancelled: true, id })
  })
  app.get('/api/jobs/:id', (c) => {
    const id = c.req.param('id')
    const job = loadJob(id)
    if (!job) return j(c, 404, { error: 'not found' })
    return j(c, 200, { job })
  })

  // ── Approval flow (require_approval quick actions) ──────────────────────
  // A job in `awaiting_approval` ran against a scratch copy — nothing on disk
  // for real yet. `proposal` reads before/after; `approve` applies the scratch
  // content to the real file; `discard` throws the scratch copy away;
  // `feedback` resumes the same CLI session against the same scratch copy and
  // returns a new job that itself becomes `awaiting_approval`.
  app.get('/api/jobs/:id/proposal', (c) => {
    const result = getApprovalDiff(c.req.param('id'))
    if ('error' in result) return j(c, result.status || 400, { error: result.error })
    return j(c, 200, result)
  })
  app.post('/api/jobs/:id/approve', (c) => {
    const result = approveJob(c.req.param('id'))
    if ('error' in result) return j(c, result.status || 400, { error: result.error })
    emitAudit({
      op: 'update',
      entity: 'artifact',
      identifier: `${result.job.applyTarget}/${result.job.approvalArtifact}`,
      projectId: c.get('projectId'),
      detail: { jobId: result.job.id, approved: true },
    })
    return j(c, 200, { job: result.job })
  })
  app.post('/api/jobs/:id/discard', (c) => {
    const result = discardJob(c.req.param('id'))
    if ('error' in result) return j(c, result.status || 400, { error: result.error })
    return j(c, 200, { job: result.job })
  })
  app.post('/api/jobs/:id/feedback', async (c) => {
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON body' })
    const feedback = typeof b.value?.feedback === 'string' ? b.value.feedback.trim() : ''
    if (!feedback) return j(c, 400, { error: 'feedback must be a non-empty string' })
    const result = sendJobFeedback(c.req.param('id'), feedback)
    if ('error' in result) return j(c, result.status || 400, { error: result.error })
    return j(c, 201, { job: result.job })
  })
}
