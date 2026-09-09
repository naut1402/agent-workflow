/**
 * Runtime state + run history cho automations — đặt ở registryHome
 * (`~/.dev-team-dashboard/automations/<projectKey>/`) cùng vùng với `jobs/`,
 * `recover/` vì đây là state của dashboard, không phải config project.
 *
 * - `state.json`: per-rule runtime state (lastRunAt / fired / inFlight) —
 *   sống sót qua restart, scheduler dựa vào đây tính due.
 * - `runs/<runId>.json`: lịch sử chạy, prune giữ N bản gần nhất.
 *
 * Đồng bộ fs (atomic temp+rename) — khối lượng nhỏ, tick 30s.
 */

import {
  joinPath,
  mkdirSync,
  readTextFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeTextFileSync,
} from '../../../core/lib/fileHelper.js'
import { registryHome } from '../../../core/registry.js'
import type { AutomationRun, AutomationRunOutcome, RuleRuntimeState } from '../schemas/automation.js'

export type { AutomationRun, AutomationRunOutcome, RuleRuntimeState }

interface StateFile {
  version: 1
  rules: Record<string, RuleRuntimeState>
}

const MAX_RUNS_PER_PROJECT = 50

function projectKey(projectId: string | null | undefined): string {
  const raw = String(projectId || '').trim() || 'default'
  const key = raw.replace(/[^\w.-]/g, '-').slice(0, 80)
  return key || 'default'
}

function projectDir(projectId: string | null | undefined): string {
  return joinPath(registryHome(), 'automations', projectKey(projectId))
}

function stateFile(projectId: string | null | undefined): string {
  return joinPath(projectDir(projectId), 'state.json')
}

function runsDir(projectId: string | null | undefined): string {
  return joinPath(projectDir(projectId), 'runs')
}

function writeJsonAtomic(file: string, data: unknown): void {
  const tmp = `${file}.tmp`
  writeTextFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, file)
}

function loadStateFile(projectId: string | null | undefined): StateFile {
  try {
    const raw = readTextFileSync(stateFile(projectId))
    const data = JSON.parse(raw) as StateFile
    if (data && data.version === 1 && data.rules && typeof data.rules === 'object') {
      return data
    }
  } catch {
    /* missing/corrupt → fresh */
  }
  return { version: 1, rules: {} }
}

function saveStateFile(projectId: string | null | undefined, state: StateFile): void {
  mkdirSync(projectDir(projectId), { recursive: true })
  writeJsonAtomic(stateFile(projectId), state)
}

export function getRuleState(projectId: string | null | undefined, ruleId: string): RuleRuntimeState {
  return loadStateFile(projectId).rules[ruleId] ?? { lastRunAt: null, lastOutcome: null }
}

export function setRuleState(
  projectId: string | null | undefined,
  ruleId: string,
  patch: RuleRuntimeState,
): void {
  const state = loadStateFile(projectId)
  state.rules[ruleId] = patch
  saveStateFile(projectId, state)
}

/**
 * Startup sweep: run `inFlight` còn kẹt từ lần chạy trước (server crash giữa
 * action) → đóng là failed để scheduler không khoá vĩnh viễn.
 */
export function clearStaleInFlight(projectId: string | null | undefined): void {
  const state = loadStateFile(projectId)
  let dirty = false
  for (const [ruleId, rs] of Object.entries(state.rules)) {
    if (rs.inFlight) {
      state.rules[ruleId] = { ...rs, inFlight: false }
      dirty = true
    }
  }
  if (dirty) saveStateFile(projectId, state)
}

export function saveRun(run: AutomationRun): void {
  const dir = runsDir(run.projectId)
  mkdirSync(dir, { recursive: true })
  writeJsonAtomic(joinPath(dir, `${run.runId}.json`), run)
  pruneRuns(run.projectId)
}

function loadRun(projectId: string, file: string): AutomationRun | null {
  try {
    const data = JSON.parse(readTextFileSync(file)) as AutomationRun
    if (!data || data.version !== 1 || !data.runId) return null
    return data
  } catch {
    return null
  }
}

function listRunFiles(projectId: string | null | undefined): string[] {
  try {
    return readdirSync(runsDir(projectId)).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
  } catch {
    return []
  }
}

/** Mới nhất trước. */
export function listRuns(projectId: string | null | undefined, limit = 20): AutomationRun[] {
  const files = listRunFiles(projectId)
  const runs: AutomationRun[] = []
  for (const f of files) {
    const run = loadRun(String(projectId || ''), joinPath(runsDir(projectId), f))
    if (run) runs.push(run)
  }
  runs.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
  return runs.slice(0, Math.max(1, limit))
}

function pruneRuns(projectId: string | null | undefined): void {
  const runs = listRuns(projectId, MAX_RUNS_PER_PROJECT)
  const keep = new Set(runs.map((r) => `${r.runId}.json`))
  let files: string[]
  try {
    files = readdirSync(runsDir(projectId))
  } catch {
    return
  }
  for (const f of files) {
    if (!f.endsWith('.json') || keep.has(f)) continue
    try {
      rmSync(joinPath(runsDir(projectId), f), { force: true })
    } catch {
      /* best-effort */
    }
  }
}

/** Xoá state + history khi rule bị xoá (best-effort). */
export function removeRuleRuntime(projectId: string | null | undefined, ruleId: string): void {
  const state = loadStateFile(projectId)
  if (state.rules[ruleId]) {
    delete state.rules[ruleId]
    saveStateFile(projectId, state)
  }
  for (const run of listRuns(projectId, MAX_RUNS_PER_PROJECT)) {
    if (run.automationId !== ruleId) continue
    try {
      rmSync(joinPath(runsDir(projectId), `${run.runId}.json`), { force: true })
    } catch {
      /* best-effort */
    }
  }
}
