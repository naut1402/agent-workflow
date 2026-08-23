/**
 * CRUD automation rule — persist `<root>/automations/<id>.yaml` (data root,
 * cùng pattern `pipeline-profiles/`). Defensive read (file hỏng → skip) +
 * atomic write (temp + rename) theo bất biến AGENTS.md §4.
 *
 * Đọc file cũ (trigger/action đơn) được chuẩn hoá sang shape hiện hành qua
 * `normaliseAutomationDoc` — ghi lại luôn theo shape mới.
 */

import {
  existsSync,
  joinPath,
  mkdirSync,
  readTextFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeTextFileSync,
} from '../../../core/lib/fileHelper.js'
import { dumpYaml, loadYaml } from '../../../core/lib/yamlLib.js'
import { listTriggers, registerTrigger, unregisterTrigger } from '../../../core/events/index.js'
import {
  AUTOMATION_ID_PATTERN,
  AutomationRuleRecord,
  normaliseAutomationDoc,
  type AutomationRuleRecord as AutomationRuleRecordType,
  type AutomationTrigger,
  type CreateAutomationRequest,
  type UpdateAutomationRequest,
} from '../schemas/automation.js'
import { parseCronExpr } from './matcher.js'

export type RuleResult<T> = { ok: true; automation: T } | { ok: false; status: number; error: string }

export function automationsDir(root: string): string {
  return joinPath(root, 'automations')
}

function ruleFile(root: string, id: string): string {
  return joinPath(automationsDir(root), `${id}.yaml`)
}

/**
 * Slug hoá tên rule thành id an toàn cho filesystem (chặn path-traversal).
 * Trả '' khi không suy ra được gì sau khi làm sạch.
 */
export function sanitiseAutomationId(name: unknown): string {
  return String(name || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
}

/** Ngữ nghĩa trigger mà Zod không đo được (cron parse được; id trùng nhau). */
function validateTriggersSemantics(triggers: AutomationTrigger[]): string | null {
  const ids = new Set<string>()
  for (const trigger of triggers) {
    // Trigger thiếu id được mint sau — chỉ tính trùng với id đã gửi.
    if (trigger.id) {
      if (ids.has(trigger.id)) return 'duplicate trigger id'
      ids.add(trigger.id)
    }
    if (trigger.kind === 'timer' && trigger.repeat.mode === 'cron' && !parseCronExpr(trigger.repeat.expr)) {
      return 'invalid cron expression'
    }
  }
  return null
}

/** Sinh id ổn định cho trigger thiếu id (`t1`, `t2`… — không trùng trong rule). */
function withTriggerIds(triggers: AutomationTrigger[]): AutomationTrigger[] {
  const used = new Set<string>()
  let n = 1
  return triggers.map((t) => {
    if (t.id && !used.has(t.id)) {
      used.add(t.id)
      return t
    }
    while (used.has(`t${n}`)) n++
    const id = `t${n}`
    used.add(id)
    n++
    return { ...t, id }
  })
}

/** Đọc một file rule — parse hỏng trả null (defensive), không throw. */
function loadRule(root: string, id: string): AutomationRuleRecordType | null {
  let raw: unknown
  try {
    raw = loadYaml(readTextFileSync(ruleFile(root, id)))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const parsed = AutomationRuleRecord.safeParse(normaliseAutomationDoc(raw))
  return parsed.success ? parsed.data : null
}

function writeRuleAtomic(root: string, rule: AutomationRuleRecordType): void {
  mkdirSync(automationsDir(root), { recursive: true })
  const file = ruleFile(root, rule.id)
  const tmp = `${file}.tmp`
  writeTextFileSync(tmp, dumpYaml(rule))
  renameSync(tmp, file)
}

/** Liệt kê file rule `.yaml` (bỏ tmp) — thư mục chưa có / lỗi → []. */
function listRuleFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.yaml') && !f.endsWith('.tmp'))
  } catch {
    return []
  }
}

export function listAutomations(root: string): AutomationRuleRecordType[] {
  const files = listRuleFiles(automationsDir(root))
  const rules: AutomationRuleRecordType[] = []
  for (const f of files) {
    const id = f.replace(/\.yaml$/, '')
    const rule = loadRule(root, id)
    if (rule && rule.id === id) rules.push(rule)
  }
  rules.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
  return rules
}

export function getAutomation(root: string, id: string): AutomationRuleRecordType | null {
  if (!AUTOMATION_ID_PATTERN.test(id)) return null
  return loadRule(root, id)
}

/**
 * Tạo rule mới. Id: ưu tiên `body.id` (đã qua schema), không có thì slug từ
 * tên; trùng → tự tăng hậu tố `-2`, `-3`… (chat/NL không biết id tồn tại).
 */
export function createAutomation(
  root: string,
  body: CreateAutomationRequest,
): RuleResult<AutomationRuleRecordType> {
  const semError = validateTriggersSemantics(body.triggers)
  if (semError) return { ok: false, status: 400, error: semError }

  mkdirSync(automationsDir(root), { recursive: true })
  const base = body.id || sanitiseAutomationId(body.name)
  if (!base || !AUTOMATION_ID_PATTERN.test(base)) {
    return { ok: false, status: 400, error: 'invalid automation id' }
  }
  let id = base
  for (let n = 2; existsSync(ruleFile(root, id)); n++) {
    const suffix = `-${n}`
    id = `${base.slice(0, 64 - suffix.length)}${suffix}`
    if (n > 100) return { ok: false, status: 409, error: 'cannot derive a free automation id' }
  }

  const now = new Date().toISOString()
  const rule: AutomationRuleRecordType = AutomationRuleRecord.parse({
    version: 1,
    id,
    name: body.name,
    ...(body.description ? { description: body.description } : {}),
    enabled: body.enabled,
    triggers: withTriggerIds(body.triggers),
    actions: body.actions,
    createdAt: now,
    updatedAt: now,
  })
  writeRuleAtomic(root, rule)
  return { ok: true, automation: rule }
}

/** Thay thế toàn bộ nội dung rule (giữ id + createdAt). */
export function updateAutomation(
  root: string,
  id: string,
  body: UpdateAutomationRequest,
): RuleResult<AutomationRuleRecordType> {
  if (!AUTOMATION_ID_PATTERN.test(id)) return { ok: false, status: 400, error: 'invalid automation id' }
  const existing = loadRule(root, id)
  if (!existing) return { ok: false, status: 404, error: 'automation not found' }

  const semError = validateTriggersSemantics(body.triggers)
  if (semError) return { ok: false, status: 400, error: semError }

  const rule: AutomationRuleRecordType = AutomationRuleRecord.parse({
    ...existing,
    name: body.name,
    ...(body.description ? { description: body.description } : {}),
    enabled: body.enabled,
    triggers: withTriggerIds(body.triggers),
    actions: body.actions,
    updatedAt: new Date().toISOString(),
  })
  writeRuleAtomic(root, rule)
  return { ok: true, automation: rule }
}

/** Đổi `enabled` cho nhanh (toggle UI) — không cần gửi toàn bộ rule. */
export function setAutomationEnabled(
  root: string,
  id: string,
  enabled: boolean,
): RuleResult<AutomationRuleRecordType> {
  if (!AUTOMATION_ID_PATTERN.test(id)) return { ok: false, status: 400, error: 'invalid automation id' }
  const existing = loadRule(root, id)
  if (!existing) return { ok: false, status: 404, error: 'automation not found' }
  const rule: AutomationRuleRecordType = { ...existing, enabled, updatedAt: new Date().toISOString() }
  writeRuleAtomic(root, rule)
  return { ok: true, automation: rule }
}

export function deleteAutomation(root: string, id: string): { ok: true } | { ok: false; status: number; error: string } {
  if (!AUTOMATION_ID_PATTERN.test(id)) return { ok: false, status: 400, error: 'invalid automation id' }
  try {
    if (!existsSync(ruleFile(root, id))) return { ok: false, status: 404, error: 'automation not found' }
    rmSync(ruleFile(root, id), { force: true })
    return { ok: true }
  } catch {
    return { ok: false, status: 500, error: 'failed to delete automation' }
  }
}

// ── Epic D trigger registry (contract-only stub) ─────────────────────────────
//
// Đồng bộ rule đang bật vào registry để `listTriggers()` phản ánh đúng "trigger
// đang sống" — runtime thật vẫn là scheduler/event subscriber của feature này.

export function syncTriggerRegistry(root: string, projectId: string): void {
  const rules = listAutomations(root)
  const live = new Set<string>()
  for (const rule of rules) {
    if (!rule.enabled) continue
    for (const trigger of rule.triggers) {
      const id = `${projectId}:${rule.id}:${trigger.id}`
      live.add(id)
      if (trigger.kind === 'event') {
        registerTrigger({ id, kind: 'event', match: trigger.eventType, enabled: true })
      } else {
        const match =
          trigger.repeat.mode === 'interval'
            ? String(trigger.repeat.everyMs)
            : trigger.repeat.mode === 'cron'
              ? String(trigger.repeat.expr)
              : String(trigger.startAt)
        registerTrigger({ id, kind: 'schedule', match, enabled: true })
      }
    }
  }
  const prefix = `${projectId}:`
  for (const reg of listTriggers()) {
    if (reg.id.startsWith(prefix) && !live.has(reg.id)) unregisterTrigger(reg.id)
  }
}

export function removeFromTriggerRegistry(projectId: string, ruleId: string): void {
  const prefix = `${projectId}:${ruleId}:`
  for (const reg of listTriggers()) {
    if (reg.id.startsWith(prefix)) unregisterTrigger(reg.id)
  }
}
