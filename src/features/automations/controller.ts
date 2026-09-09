import { joinPath, readdirSync } from '../../core/lib/fileHelper.js'
import { AbstractController } from '../../core/http/AbstractController.js'
import { emitAudit } from '../../core/log/store.js'
import { emitEntity } from '../../core/events/index.js'
import { getConnection, listRunners, providerFamilyOf } from '../runner/business/index.js'
import { profilesDir } from '../monitor/business/index.js'
import {
  AUTOMATION_ID_PATTERN,
  CreateAutomationRequest,
  ToggleAutomationRequest,
  UpdateAutomationRequest,
} from './schemas/automation.js'
import * as automationsBusiness from './business/index.js'

/**
 * Automations mode (#233): CRUD rule (triggers[] → actions[]) + run now +
 * history. Config theo project (data root `automations/`); runtime state ở
 * registryHome — xem business/runLedger.ts.
 */
export class AutomationsController extends AbstractController {
  async listAutomations() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    const now = new Date()
    const automations = automationsBusiness.listAutomations(root).map((rule) => {
      const state = automationsBusiness.getRuleState(this.projectId, rule.id)
      const evaluation = automationsBusiness.evaluateRuleTriggers(rule.triggers, state, now)
      return {
        ...rule,
        state: {
          lastRunAt: state.lastRunAt,
          lastOutcome: state.lastOutcome,
          triggerFired: state.triggerFired ?? {},
          inFlight: state.inFlight === true,
        },
        nextRunAt: evaluation.nextRunAt,
      }
    })
    return this.ok({ automations })
  }

  async listEventTypes() {
    return this.ok({ types: automationsBusiness.KNOWN_AUTOMATION_EVENT_TYPES })
  }

  /**
   * Options cho các combobox trong form: task (đang có trong project),
   * pipeline profile, runner — đọc phòng thủ, thiếu thì trả mảng rỗng.
   */
  async formOptions() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    let taskIds: string[] = []
    try {
      taskIds = readdirSync(joinPath(root, '.dev-state'))
        .filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
        .map((f) => f.replace(/\.json$/, ''))
        .sort()
    } catch {
      /* chưa có task nào */
    }

    let profiles: string[] = []
    try {
      profiles = readdirSync(profilesDir(root))
        .filter((f) => f.endsWith('.yaml') && !f.endsWith('.tmp'))
        .map((f) => f.replace(/\.yaml$/, ''))
        .sort()
    } catch {
      /* chưa có profile nào */
    }

    let runners: Array<{ id: string; label: string; family?: string }> = []
    try {
      runners = listRunners().runners.map((r: any) => ({
        id: String(r.id ?? ''),
        label: String(r.name ?? r.id ?? ''),
        family: providerFamilyOf(getConnection(r.connectionId)?.providerId ?? ''),
      }))
    } catch {
      /* registry runner hỏng — combobox rỗng, vẫn gõ tay được */
    }

    // Registry là global (không theo `?project=`) — dùng cho combobox "project đích"
    // của action runTask, nên mọi lần fetch đều trả cùng danh sách.
    let projects: Array<{ id: string; name: string; default: boolean }> = []
    try {
      projects = this.ctx.registry.list().projects.map((p) => ({
        id: p.id,
        name: p.name,
        default: p.default === true,
      }))
    } catch {
      /* registry hỏng — combobox project rỗng, form vẫn lưu được (field optional) */
    }

    return this.ok({ tasks: taskIds, profiles, runners, projects })
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

    const result = automationsBusiness.createAutomation(root, parsed.data)
    if ('error' in result) return this.json(result.status, { error: result.error })

    automationsBusiness.syncTriggerRegistry(root, this.projectId || '')
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

    const result = automationsBusiness.updateAutomation(root, id, parsed.data)
    if ('error' in result) return this.json(result.status, { error: result.error })

    automationsBusiness.syncTriggerRegistry(root, this.projectId || '')
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

    const result = automationsBusiness.setAutomationEnabled(root, id, parsed.data.enabled)
    if ('error' in result) return this.json(result.status, { error: result.error })

    automationsBusiness.syncTriggerRegistry(root, this.projectId || '')
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

    const result = automationsBusiness.deleteAutomation(root, id)
    if ('error' in result) return this.json(result.status, { error: result.error })

    automationsBusiness.removeFromTriggerRegistry(this.projectId || '', id)
    automationsBusiness.removeRuleRuntime(this.projectId, id)
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

    const rule = automationsBusiness.getAutomation(root, id)
    if (!rule) return this.notFound('automation not found', { id })

    emitAudit({
      op: 'update',
      entity: 'automation',
      identifier: id,
      projectId: this.projectId,
      detail: { action: 'run-now' },
    })
    // Chuỗi action chạy nền — trả run đang `running`, kết quả qua history poll.
    const run = automationsBusiness.runAutomation({ root, projectId: this.projectId, rule, source: 'manual' })
    return this.ok({ run })
  }

  async listRuleRuns() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error

    const id = this.c.req.param('id')
    if (!id || !AUTOMATION_ID_PATTERN.test(id)) return this.badRequest('invalid automation id')

    const limitRaw = Number(this.c.req.query('limit') || '20')
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 50) : 20
    return this.ok({ runs: automationsBusiness.listRuns(this.projectId, limit) })
  }

  /** Lịch sử thực thi toàn project (mọi rule) — tab "Lịch sử thực thi" trên FE. */
  async listAllRuns() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error

    const limitRaw = Number(this.c.req.query('limit') || '50')
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 50) : 50
    return this.ok({ runs: automationsBusiness.listRuns(this.projectId, limit) })
  }
}
