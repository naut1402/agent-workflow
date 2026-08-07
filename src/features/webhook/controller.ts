import { AbstractController } from '../../core/http/AbstractController.js'
import {
  getWebhookConfig,
  handleGithubWebhook,
  loadWebhookStore,
  upsertWebhookConfig,
} from './business/webhook.js'

export class WebhookController extends AbstractController {
  listConfigs() {
    return this.ok({ webhooks: loadWebhookStore().projects })
  }

  getConfig() {
    const projectId = this.c.req.query('project') || this.projectId || ''
    if (!projectId) return this.badRequest('project required')
    const cfg = getWebhookConfig(projectId)
    if (!cfg) return this.notFound('webhook not configured')
    // Never echo full secret — mask.
    return this.ok({
      webhook: { ...cfg, secret: cfg.secret ? '********' : '' },
    })
  }

  async upsertConfig() {
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON')
    const projectId = String(b.value.projectId || this.projectId || '')
    if (!projectId) return this.badRequest('projectId required')
    const existing = getWebhookConfig(projectId)
    const secret =
      typeof b.value.secret === 'string' && b.value.secret && b.value.secret !== '********'
        ? b.value.secret
        : existing?.secret || ''
    if (!secret) return this.badRequest('secret required')
    const cfg = upsertWebhookConfig({
      projectId,
      secret,
      repo: b.value.repo,
      mappings: b.value.mappings || existing?.mappings || [],
      enabled: b.value.enabled !== false,
    })
    return this.ok({ webhook: { ...cfg, secret: '********' } })
  }

  /** POST /api/webhooks/github?project=<id> — raw body + X-Hub-Signature-256 */
  async receiveGithub() {
    const projectId = this.c.req.query('project') || this.projectId || ''
    if (!projectId) return this.badRequest('project query required')
    const rawBody = await this.c.req.text()
    const signature = this.c.req.header('x-hub-signature-256')
    const eventName = this.c.req.header('x-github-event')
    const result = handleGithubWebhook({ projectId, rawBody, signature, eventName })
    if (!result.ok) return this.json(result.status, { error: result.error })
    return this.ok({ received: true, triggers: result.triggers || [] })
  }
}
