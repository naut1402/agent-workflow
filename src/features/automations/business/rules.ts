/**
 * CRUD automation rule — persist `<root>/automations/<id>.yaml` (data root,
 * cùng pattern `pipeline-profiles/`). Defensive read (file hỏng → skip) +
 * atomic write (temp + rename) theo bất biến AGENTS.md §4.
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
  type AutomationRuleRecord as AutomationRuleRecordType,
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

/** Ngữ nghĩa trigger mà Zod không đo được (cron parse được, time còn tương lai hay không để tuỳ user). */
function validateTriggerSemantics(trigger: AutomationRuleRecordType['trigger']): string | null {
  if (trigger.kind === 'cron' && !parseCronExpr(trigger.cron)) {
    return 'invalid cron expression'
  }
  return null
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
  const parsed = AutomationRuleRecord.safeParse(raw)
  return parsed.success ? parsed.data : null
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

/**
 * Tạo rule mới. Id: ưu tiên `body.id` (đã qua schema), không có thì slug từ
 * tên; trùng → tự tăng hậu tố `-2`, `-3`… (chat/NL không biết id tồn tại).
 */
export function createAutomation(
  root: string,
  body: CreateAutomationRequest,
): RuleResult<AutomationRuleRecordType> {
  const semError = validateTriggerSemantics(body.trigger)
  if (semError) return { ok: false, status: 400, error: semError }

  mkdirSync(automationsDir(root), { recursive: true })
  const base = body.id || sanitiseAutomationId(body.name)
  if (!base || !AUTOMATION_ID_PATTERN.test(base)) {
    return { ok: false, status: 400, error: 'invalid automation id' }
  }
  let id = base
  for (let n = 2; existsSync(ruleFile(root, id)); n++) {
    const suffix = `-${n}`
    id = `${base.slice(0, AUTOMATION_ID_PATTERN.source.length ? 64 - suffix.length : 64)}${suffix}`
    if (n > 100) return { ok: false, status: 409, error: 'cannot derive a free automation id' }
  }

  const now = new Date().toISOString()
  const rule: AutomationRuleRecordType = AutomationRuleRecord.parse({
    version: 1,
    id,
    name: body.name,
    ...(body.description ? { description: body.description } : {}),
    enabled: body.enabled,
    trigger: body.trigger,
    action: body.action,
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

  const semError = validateTriggerSemantics(body.trigger)
  if (semError) return { ok: false, status: 400, error: semError }

  const rule: AutomationRuleRecordType = AutomationRuleRecord.parse({
    ...existing,
    name: body.name,
    ...(body.description ? { description: body.description } : {}),
    enabled: body.enabled,
    trigger: body.trigger,
    action: body.action,
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

export interface TriggerProjectRef {
  projectId: string
}

export function syncTriggerRegistry(root: string, projectId: string): void {
  const rules = listAutomations(root)
  const live = new Set<string>()
  for (const rule of rules) {
    if (!rule.enabled) continue
    const id = `${projectId}:${rule.id}`
    live.add(id)
    if (rule.trigger.kind === 'event') {
      registerTrigger({ id, kind: 'event', match: rule.trigger.eventType, enabled: true })
    } else {
      const match =
        rule.trigger.kind === 'time'
          ? String(rule.trigger.at)
          : rule.trigger.kind === 'interval'
            ? String(rule.trigger.everyMs)
            : String(rule.trigger.cron)
      registerTrigger({ id, kind: 'schedule', match, enabled: true })
    }
  }
  for (const reg of listTriggers()) {
    if (reg.id.startsWith(`${projectId}:`) && !live.has(reg.id)) unregisterTrigger(reg.id)
  }
}

export function removeFromTriggerRegistry(projectId: string, ruleId: string): void {
  unregisterTrigger(`${projectId}:${ruleId}`)
}
