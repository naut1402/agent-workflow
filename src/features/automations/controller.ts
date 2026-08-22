import { AbstractController } from '../../core/http/AbstractController.js'
import { emitAudit } from '../../core/log/store.js'
import { emitEntity } from '../../core/events/index.js'
import {
  AUTOMATION_ID_PATTERN,
  CreateAutomationRequest,
  ToggleAutomationRequest,
  UpdateAutomationRequest,
} from './schemas/automation.js'
import {
  createAutomation,
  deleteAutomation,
  evaluateScheduleTrigger,
  getAutomation,
  getRuleState,
  KNOWN_AUTOMATION_EVENT_TYPES,
  listAutomations,
  listRuns,
  removeFromTriggerRegistry,
  removeRuleRuntime,
  runAutomation,
  setAutomationEnabled,
  syncTriggerRegistry,
  updateAutomation,
} from './business/index.js'

/**
 * Automations mode (#233): CRUD rule (trigger → action) + run now + history.
 * Config theo project (data root `automations/`); runtime state ở
 * registryHome — xem business/runLedger.ts.
 */
export class AutomationsController extends AbstractController {
  async listAutomations() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    const now = new Date()
    const automations = listAutomations(root).map((rule) => {
      const state = getRuleState(this.projectId, rule.id)
      const evaluation = evaluateScheduleTrigger(rule.trigger, state, rule.createdAt, now)
      return {
        ...rule,
        state: {
          lastRunAt: state.lastRunAt,
          lastOutcome: state.lastOutcome,
          fired: state.fired === true,
          inFlight: state.inFlight === true,
        },
        nextRunAt: evaluation.nextRunAt,
      }
    })
    return this.ok({ automations })
  }

  async listEventTypes() {
    return this.ok({ types: KNOWN_AUTOMATION_EVENT_TYPES })
  }

  async createAutomation() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON body')
    const parsed = CreateAutomationRequest.safeParse(b.value)
    if (!parsed.success) {
      return this.badRequest('invalid request', { details: parsed.error.flatten() })
    }

    const result = createAutomation(root, parsed.data)
    if ('error' in result) return this.json(result.status, { error: result.error })

    syncTriggerRegistry(root, this.projectId || '')
    emitAudit({
      op: 'create',
      entity: 'automation',
      identifier: result.automation.id,
      projectId: this.projectId,
    })
    emitEntity('created', 'automation', { id: result.automation.id, projectId: this.projectId })
    return this.created({ automation: result.automation })
  }

  async updateAutomation() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    const id = this.c.req.param('id')
    if (!id || !AUTOMATION_ID_PATTERN.test(id)) return this.badRequest('invalid automation id')

    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON body')
    const parsed = UpdateAutomationRequest.safeParse(b.value)
    if (!parsed.success) {
      return this.badRequest('invalid request', { details: parsed.error.flatten() })
    }

    const result = updateAutomation(root, id, parsed.data)
    if ('error' in result) return this.json(result.status, { error: result.error })

    syncTriggerRegistry(root, this.projectId || '')
    emitAudit({
      op: 'update',
      entity: 'automation',
      identifier: id,
      projectId: this.projectId,
    })
    emitEntity('updated', 'automation', { id, projectId: this.projectId })
    return this.ok({ automation: result.automation })
  }

  async toggleAutomation() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    const id = this.c.req.param('id')
    if (!id || !AUTOMATION_ID_PATTERN.test(id)) return this.badRequest('invalid automation id')

    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON body')
    const parsed = ToggleAutomationRequest.safeParse(b.value)
    if (!parsed.success) return this.badRequest('invalid request')

    const result = setAutomationEnabled(root, id, parsed.data.enabled)
    if ('error' in result) return this.json(result.status, { error: result.error })

    syncTriggerRegistry(root, this.projectId || '')
    emitAudit({
      op: 'update',
      entity: 'automation',
      identifier: id,
      projectId: this.projectId,
      detail: { action: 'toggle', enabled: parsed.data.enabled },
    })
    emitEntity('updated', 'automation', { id, projectId: this.projectId, detail: { enabled: parsed.data.enabled } })
    return this.ok({ automation: result.automation })
  }

  async deleteAutomation() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    const id = this.c.req.param('id')
    if (!id || !AUTOMATION_ID_PATTERN.test(id)) return this.badRequest('invalid automation id')

    const result = deleteAutomation(root, id)
    if ('error' in result) return this.json(result.status, { error: result.error })

    removeFromTriggerRegistry(this.projectId || '', id)
    removeRuleRuntime(this.projectId, id)
    emitAudit({ op: 'delete', entity: 'automation', identifier: id, projectId: this.projectId })
    emitEntity('deleted', 'automation', { id, projectId: this.projectId })
    return this.ok({ id, deleted: true })
  }

  /** Run now — test thủ công, bỏ qua guard inFlight/coalesce (ý định user). */
  async runNow() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    const id = this.c.req.param('id')
    if (!id || !AUTOMATION_ID_PATTERN.test(id)) return this.badRequest('invalid automation id')

    const rule = getAutomation(root, id)
    if (!rule) return this.notFound('automation not found', { id })

    emitAudit({
      op: 'update',
      entity: 'automation',
      identifier: id,
      projectId: this.projectId,
      detail: { action: 'run-now' },
    })
    const run = await runAutomation({ root, projectId: this.projectId, rule, source: 'manual' })
    return this.ok({ run })
  }

  async listRuleRuns() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error

    const id = this.c.req.param('id')
    if (!id || !AUTOMATION_ID_PATTERN.test(id)) return this.badRequest('invalid automation id')

    const limitRaw = Number(this.c.req.query('limit') || '20')
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 50) : 20
    return this.ok({ runs: listRuns(this.projectId, limit) })
  }
}
