// xem docs/architecture/code/monitor.md §5

import { joinPath, readTextFileSync } from '../../../../backend/lib/fileHelper.js'
import { loadPipelineConfig } from '../peers.js'
import { readState } from './index.js'
import { withTaskLock, writeStateAtomic } from './state.js'

/** Ai đang xin start. `orchestrator` là đường duy nhất được phép khi điều phối bật. */
export type StartOrigin = 'orchestrator' | 'manual' | 'automation' | 'chain' | 'api'

export interface Orchestration {
  /** `pipeline.orchestrator.enabled === true`. */
  enabled: boolean
  /** Người bấm Stop hoặc agent trả `halt` — quyền start trả về chế độ tay. */
  halted: boolean
  /** `enabled && !halted` — điều kiện duy nhất mà guard đọc. */
  active: boolean
  agent?: string
  system_prompt?: string
  knowledge_inputs?: string[]
}

export type StartDecision = { allowed: true } | { allowed: false; status: number; error: string }

export function stateFileOf(root: string, taskId: string): string {
  return joinPath(root, '.dev-state', `${taskId}.json`)
}

async function patchOrchestratorFlags(
  root: string,
  taskId: string,
  build: (state: Record<string, unknown>) => Record<string, unknown> | null,
): Promise<void> {
  const stateFile = stateFileOf(root, taskId)
  await withTaskLock(root, taskId, async () => {
    const read = await readState(stateFile)
    if (!read.ok) return
    const next = build(read.state as Record<string, unknown>)
    if (next) await writeStateAtomic(stateFile, { ...read.state, ...next })
  })
}

/** Ghi lại cờ cache `orchestrator_enabled` — chỉ ghi khi thật sự lệch. */
export async function setOrchestratorEnabledFlag(
  root: string,
  taskId: string,
  enabled: boolean,
): Promise<void> {
  await patchOrchestratorFlags(root, taskId, (state) =>
    state.orchestrator_enabled === enabled ? null : { orchestrator_enabled: enabled },
  )
}

/**
 * Đồng bộ `.dev-state` sau khi lưu pipeline scope `task`: ghi cờ cache
 * `orchestrator_enabled` và xoá cờ halt.
 */
export async function applyOrchestratorConfigChange(
  root: string,
  taskId: string,
  enabled: boolean,
): Promise<void> {
  await patchOrchestratorFlags(root, taskId, (state) =>
    state.orchestrator_enabled === enabled && state.orchestrator_halted !== true
      ? null
      : { orchestrator_enabled: enabled, orchestrator_halted: false, orchestrator_halted_at: null },
  )
}

/**
 * Trạng thái điều phối của một task, đọc từ pipeline + state thật; ghi lại cờ
 * cache `orchestrator_enabled` khi nó lệch với pipeline.
 */
export async function resolveOrchestration(
  root: string,
  taskId: string,
  pipeline?: any,
  opts: {
    /**
     * `await` lượt ghi cờ cache thay vì để nó chạy nền; không bật khi đang ở
     * trong `withTaskLock`. xem docs/architecture/code/monitor.md §5
     */
    awaitFlagSync?: boolean
  } = {},
): Promise<Orchestration> {
  const cfg = pipeline ?? (await loadPipelineConfig(root, taskId))
  const enabled = cfg?.orchestrator?.enabled === true
  const read = await readState(stateFileOf(root, taskId))
  const state = read.ok ? (read.state as Record<string, unknown>) : null
  const halted = state?.orchestrator_halted === true
  if (state && state.orchestrator_enabled !== enabled) {
    const write = setOrchestratorEnabledFlag(root, taskId, enabled)
    if (opts.awaitFlagSync) await write.catch(() => {})
    else void write.catch(() => {})
  }
  return {
    enabled,
    halted,
    active: enabled && !halted,
    agent: typeof cfg?.orchestrator?.agent === 'string' ? cfg.orchestrator.agent : undefined,
    system_prompt:
      typeof cfg?.orchestrator?.system_prompt === 'string' ? cfg.orchestrator.system_prompt : undefined,
    knowledge_inputs: Array.isArray(cfg?.orchestrator?.knowledge_inputs)
      ? cfg.orchestrator.knowledge_inputs.filter((x: unknown) => typeof x === 'string')
      : undefined,
  }
}

/**
 * Đường `origin` có được start step của `taskId` không: điều phối tắt hoặc đã
 * halt ⇒ mọi đường; điều phối bật ⇒ chỉ `orchestrator`, đường khác nhận 403.
 */
export async function assertStartAllowed(
  root: string,
  taskId: string,
  origin: StartOrigin,
): Promise<StartDecision> {
  const orch = await resolveOrchestration(root, taskId)
  if (!orch.active) return { allowed: true }
  if (origin === 'orchestrator') return { allowed: true }
  return {
    allowed: false,
    status: 403,
    error: 'pipeline is orchestrated — start via orchestrator',
  }
}

function readStateSyncSafe(root: string, taskId: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readTextFileSync(stateFileOf(root, taskId))) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Lưới an toàn cuối trong `submitJob` cho job của step pipeline (trừ chat);
 * ném lỗi khi điều phối đang giữ task.
 */
export function assertStartAllowedSync(metadata: Record<string, any> | undefined): void {
  if (!metadata?.pipelineStepId || !metadata?.taskId || !metadata?.devTeamRoot) return
  if (metadata.orchestratorDispatch === true) return
  if (metadata.isChatFeedback === true) return
  const state = readStateSyncSafe(String(metadata.devTeamRoot), String(metadata.taskId))
  if (state?.orchestrator_enabled === true && state?.orchestrator_halted !== true) {
    throw new Error('start not allowed: orchestrator owns this task')
  }
}
