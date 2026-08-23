import path from 'node:path'
import { AbstractController } from '../../core/http/AbstractController.js'
import { emitAudit } from '../../core/log/store.js'
import { emitEntity } from '../../core/events/index.js'
import * as runnerStore from './business/index.js'
import type { JobStatus } from './business/types.js'

export class RunnerController extends AbstractController {
  listRunners() {
    return this.ok({
      ...runnerStore.listRunners(),
      providers: runnerStore.listProviderCatalog(),
      connections: runnerStore.listConnections(),
    })
  }

  async upsertRunner() {
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const result = runnerStore.upsertRunner(b.value.runner || b.value)
    if ('error' in result) return this.badRequest(result.error)
    emitAudit({ op: 'update', entity: 'runner', identifier: result.runner?.id ?? null, projectId: null })
    emitEntity('updated', 'runner', { id: result.runner?.id ?? null, projectId: null })
    return this.ok({ saved: true, runner: result.runner })
  }

  deleteRunner() {
    const id = this.c.req.query('id') || ''
    const result = runnerStore.deleteRunner(id)
    if ('error' in result) return this.json(result.status || 400, { error: result.error })
    emitAudit({ op: 'delete', entity: 'runner', identifier: id, projectId: null })
    emitEntity('deleted', 'runner', { id, projectId: null })
    return this.ok({ deleted: true, id })
  }

  runnersMethodNotAllowed() {
    return this.methodNotAllowed()
  }

  async setDefaultRunner() {
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const result = runnerStore.setDefaultRunner(b.value.id || b.value.runnerId)
    if ('error' in result) return this.json(result.status || 400, { error: result.error })
    return this.ok({ defaultRunnerId: result.defaultRunnerId })
  }

  scanConnections() {
    return this.ok({ commands: runnerStore.scanLocalCommands() })
  }

  async listAvailableModels() {
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const { providerId, baseURL, credentialId, secretValue } = b.value || {}
    if (!providerId || typeof providerId !== 'string') return this.badRequest('providerId is required')
    const result = await runnerStore.listAvailableModels({ providerId, baseURL, credentialId, secretValue })
    if ('error' in result) return this.badRequest(result.error)
    return this.ok({ models: result.models })
  }

  listConnections() {
    return this.ok({
      connections: runnerStore.listConnections(),
      providers: runnerStore.listProviderCatalog(),
    })
  }

  async upsertConnection() {
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const result = runnerStore.upsertConnection(b.value.connection || b.value)
    if ('error' in result) return this.badRequest(result.error)
    emitAudit({
      op: 'update',
      entity: 'connection',
      identifier: result.connection?.id ?? null,
      projectId: null,
    })
    emitEntity('updated', 'connection', { id: result.connection?.id ?? null, projectId: null })
    return this.ok({ saved: true, connection: result.connection })
  }

  deleteConnection() {
    const id = this.c.req.query('id') || ''
    const usedBy = runnerStore
      .listRunners()
      .runners.filter((r) => r.connectionId === id)
      .map((r) => r.id)
    if (usedBy.length) {
      return this.json(400, { error: `connection in use by runners: ${usedBy.join(', ')}` })
    }
    const result = runnerStore.deleteConnection(id)
    if ('error' in result) return this.json(result.status || 400, { error: result.error })
    emitAudit({ op: 'delete', entity: 'connection', identifier: id, projectId: null })
    emitEntity('deleted', 'connection', { id, projectId: null })
    return this.ok({ deleted: true, id })
  }

  connectionsMethodNotAllowed() {
    return this.methodNotAllowed()
  }

  listCommands() {
    return this.ok({ commands: runnerStore.listCustomCommands() })
  }

  async upsertCommand() {
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const result = runnerStore.upsertCustomCommand(b.value.command || b.value)
    if ('error' in result) return this.badRequest(result.error)
    emitAudit({
      op: 'update',
      entity: 'command',
      identifier: result.command?.id ?? null,
      projectId: null,
    })
    emitEntity('updated', 'command', { id: result.command?.id ?? null, projectId: null })
    return this.ok({ saved: true, command: result.command })
  }

  deleteCommand() {
    const id = this.c.req.query('id') || ''
    const result = runnerStore.deleteCustomCommand(id)
    if ('error' in result) return this.json(result.status || 400, { error: result.error })
    emitAudit({ op: 'delete', entity: 'command', identifier: id, projectId: null })
    emitEntity('deleted', 'command', { id, projectId: null })
    return this.ok({ deleted: true, id })
  }

  commandsMethodNotAllowed() {
    return this.methodNotAllowed()
  }

  listCredentials() {
    return this.ok({ profiles: runnerStore.listCredentials() })
  }

  async upsertCredential() {
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const result = runnerStore.upsertCredential(b.value.profile || b.value)
    if ('error' in result) return this.badRequest(result.error)
    emitAudit({ op: 'update', entity: 'credential', identifier: result.profile?.id ?? null, projectId: null })
    emitEntity('updated', 'credential', { id: result.profile?.id ?? null, projectId: null })
    return this.ok({ saved: true, profile: result.profile })
  }

  deleteCredential() {
    const id = this.c.req.query('id') || ''
    const result = runnerStore.deleteCredential(id)
    if ('error' in result) return this.json(result.status || 400, { error: result.error })
    emitAudit({ op: 'delete', entity: 'credential', identifier: id, projectId: null })
    emitEntity('deleted', 'credential', { id, projectId: null })
    return this.ok({ deleted: true, id })
  }

  credentialsMethodNotAllowed() {
    return this.methodNotAllowed()
  }

  /** Which `ai-api` providers have a full OAuth config set (env vars) — drives the "Connect via browser" button. */
  listOAuthCapabilities() {
    const providers = runnerStore
      .listProviderCatalog()
      .filter((p) => p.family === 'ai-api' && runnerStore.isOAuthCapable(p.id))
      .map((p) => p.id)
    // Lets ConnectionDialog.vue warn proactively instead of the user hitting
    // a raw "DASHBOARD_SECRET_KEY is not set" error after filling the form.
    return this.ok({ providers, vaultConfigured: runnerStore.hasVaultKey() })
  }

  private oauthRedirectUri(): string {
    return new URL('/api/credentials/oauth/callback', this.c.req.url).toString()
  }

  async startOAuthConnect() {
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const providerId = String(b.value?.providerId || '')
    if (!providerId) return this.badRequest('providerId is required')
    const label = typeof b.value?.label === 'string' ? b.value.label : ''
    const result = runnerStore.startOAuth(providerId, label, this.oauthRedirectUri())
    if ('error' in result) return this.badRequest(result.error)
    return this.ok({ state: result.state, authorizeUrl: result.authorizeUrl })
  }

  async oauthCallback() {
    const state = this.c.req.query('state') || ''
    const code = this.c.req.query('code') || ''
    const providerError = this.c.req.query('error')
    if (providerError) {
      return this.c.html(`<p>Connect failed: ${providerError}. You can close this tab and try again.</p>`, 400)
    }
    if (!state || !code) return this.c.html('<p>Missing code/state. You can close this tab and try again.</p>', 400)
    const result = await runnerStore.completeFromCallback(state, code)
    if ('error' in result) return this.c.html(`<p>Connect failed: ${result.error}. You can close this tab and try again.</p>`, 400)
    emitAudit({ op: 'update', entity: 'credential', identifier: result.credentialId, projectId: null })
    emitEntity('updated', 'credential', { id: result.credentialId, projectId: null })
    return this.c.html('<p>Connected — you can close this tab.</p>')
  }

  async exchangeOAuthCode() {
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const state = String(b.value?.state || '')
    const input = String(b.value?.input || '')
    if (!state || !input) return this.badRequest('state and input are required')
    const result = await runnerStore.completeFromPaste(state, input)
    if ('error' in result) return this.badRequest(result.error)
    emitAudit({ op: 'update', entity: 'credential', identifier: result.credentialId, projectId: null })
    emitEntity('updated', 'credential', { id: result.credentialId, projectId: null })
    return this.ok({ credentialId: result.credentialId })
  }

  oauthStatus() {
    const state = this.c.req.query('state') || ''
    const status = runnerStore.getOAuthStatus(state)
    if (!status) return this.notFound('unknown oauth state')
    return this.ok(status)
  }

  listOrGetJobs() {
    const id = this.c.req.query('id')
    if (id) {
      const job = runnerStore.loadJob(id)
      if (!job) return this.notFound('not found')
      return this.ok({ job })
    }
    const statusRaw = this.c.req.query('status')
    let status: JobStatus | undefined
    if (statusRaw) {
      const allowed = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'awaiting_approval']
      if (!allowed.includes(statusRaw)) return this.badRequest('invalid status')
      status = statusRaw as JobStatus
    }
    const limitRaw = this.c.req.query('limit')
    const limit =
      limitRaw !== undefined && limitRaw !== ''
        ? Number(limitRaw) || 20
        : undefined
    return this.ok({ jobs: runnerStore.listJobs(limit, status) })
  }

  async submitJob() {
    const rootResult = this.requireRoot()
    if ('error' in rootResult) return rootResult.error
    const { root } = rootResult
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const parsed = b.value
    if (typeof parsed.agentRef !== 'string' || !parsed.workspace) {
      return this.badRequest('agentRef and workspace are required')
    }
    const projectRoot = path.dirname(root)
    const job = runnerStore.submitJob({
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
    return this.created({ job })
  }

  jobsMethodNotAllowed() {
    return this.methodNotAllowed()
  }

  cancelJob() {
    const id = this.c.req.param('id')
    const result = runnerStore.cancelJob(id)
    if ('error' in result) return this.json(result.status || 400, { error: result.error })
    return this.ok({ cancelled: true, id })
  }

  getJob() {
    const id = this.c.req.param('id')
    const job = runnerStore.loadJob(id)
    if (!job) return this.notFound('not found')
    return this.ok({ job })
  }

  getProposal() {
    const result = runnerStore.getApprovalDiff(this.c.req.param('id'))
    if ('error' in result) return this.json(result.status || 400, { error: result.error })
    return this.ok(result)
  }

  approveJob() {
    const result = runnerStore.approveJob(this.c.req.param('id'))
    if ('error' in result) return this.json(result.status || 400, { error: result.error })
    emitAudit({
      op: 'update',
      entity: 'artifact',
      identifier: `${result.job.applyTarget}/${result.job.approvalArtifact}`,
      projectId: this.projectId,
      detail: { jobId: result.job.id, approved: true },
    })
    return this.ok({ job: result.job })
  }

  discardJob() {
    const result = runnerStore.discardJob(this.c.req.param('id'))
    if ('error' in result) return this.json(result.status || 400, { error: result.error })
    return this.ok({ job: result.job })
  }

  async jobFeedback() {
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON body')
    const feedback = typeof b.value?.feedback === 'string' ? b.value.feedback.trim() : ''
    if (!feedback) return this.badRequest('feedback must be a non-empty string')
    const result = runnerStore.sendJobFeedback(this.c.req.param('id'), feedback)
    if ('error' in result) return this.json(result.status || 400, { error: result.error })
    return this.created({ job: result.job })
  }
}
