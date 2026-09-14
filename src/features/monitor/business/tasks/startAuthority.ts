/**
 * Quyền start step của một task — nguồn chân lý duy nhất cho câu hỏi "đường này
 * có được phép submit job cho step không".
 *
 * Đặt ở `monitor` (chủ sở hữu task state) chứ không ở feature `orchestrator`:
 * runner và automations đều phải gọi tới, để guard ở orchestrator thì hai
 * feature đó phải import ngược vào nó và sinh vòng barrel.
 *
 * Hai tầng:
 * - `assertStartAllowed` (async) — đọc `pipeline.yaml` + state thật, dùng ở mọi
 *   call-site có thể `await`. Đây là guard thật.
 * - `assertStartAllowedSync` — lưới an toàn cuối trong `submitJob` (đồng bộ,
 *   không `await loadPipelineConfig` được), đọc cờ cache đã ghi sẵn trong state.
 */

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
}

export type StartDecision = { allowed: true } | { allowed: false; status: number; error: string }

export function stateFileOf(root: string, taskId: string): string {
  return joinPath(root, '.dev-state', `${taskId}.json`)
}

/** Ghi lại cờ cache `orchestrator_enabled` — chỉ ghi khi thật sự lệch. */
export async function setOrchestratorEnabledFlag(
  root: string,
  taskId: string,
  enabled: boolean,
): Promise<void> {
  const stateFile = stateFileOf(root, taskId)
  await withTaskLock(root, taskId, async () => {
    const read = await readState(stateFile)
    if (!read.ok) return
    const state = read.state as Record<string, unknown>
    if (state.orchestrator_enabled === enabled) return
    await writeStateAtomic(stateFile, { ...state, orchestrator_enabled: enabled })
  })
}

/**
 * Lưu pipeline scope `task` ⇒ đồng bộ `.dev-state` với YAML vừa ghi.
 *
 * Ghi cờ cache `orchestrator_enabled` (điều kiện để lượt quét nhặt được task) và
 * xoá cờ halt: lưu lại checkbox là cách người dùng reset node điều phối.
 */
export async function applyOrchestratorConfigChange(
  root: string,
  taskId: string,
  enabled: boolean,
): Promise<void> {
  const stateFile = stateFileOf(root, taskId)
  await withTaskLock(root, taskId, async () => {
    const read = await readState(stateFile)
    if (!read.ok) return
    const state = read.state as Record<string, unknown>
    if (state.orchestrator_enabled === enabled && state.orchestrator_halted !== true) return
    await writeStateAtomic(stateFile, {
      ...state,
      orchestrator_enabled: enabled,
      orchestrator_halted: false,
      orchestrator_halted_at: null,
    })
  })
}

/**
 * Trạng thái điều phối của một task, đọc từ pipeline thật + state thật.
 * Đồng thời **tự chữa** cờ cache khi nó lệch với pipeline (pipeline được bật/tắt
 * giữa chừng): đường async đúng ngay, cờ cache chỉ lệch tới lần gọi kế tiếp.
 */
export async function resolveOrchestration(
  root: string,
  taskId: string,
  pipeline?: any,
  opts: {
    /**
     * `await` lượt ghi cờ cache thay vì để nó chạy nền.
     *
     * Bắt buộc với caller **không** giữ khoá task mà ngay sau đó sẽ `submitJob`
     * (đường chain): backstop đồng bộ đọc chính cờ này và **ném lỗi**, nên một
     * cờ `true` cũ chưa kịp ghi lại sẽ làm `submitJob` throw đúng lúc người dùng
     * vừa tắt điều phối. Caller đang ở trong `withTaskLock` thì KHÔNG được bật —
     * chờ một lượt khoá mới của cùng state file từ trong khoá đó là deadlock.
     */
    awaitFlagSync?: boolean
  } = {},
): Promise<Orchestration> {
  const cfg = pipeline ?? (await loadPipelineConfig(root, taskId))
  const enabled = cfg?.orchestrator?.enabled === true
  const read = await readState(stateFileOf(root, taskId))
  const state = read.ok ? (read.state as Record<string, unknown>) : null
  const halted = state?.orchestrator_halted === true
  // Mặc định KHÔNG `await`: guard được gọi cả từ bên trong `withTaskLock` (vd
  // `runTaskStep`), và chờ một lượt khoá mới của **cùng** state file từ trong
  // khoá đó là deadlock. Caller sắp `submitJob` ngay sau đây phải bật
  // `awaitFlagSync` — xem ghi chú ở `opts`.
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
  }
}

/**
 * Đường `origin` này có được start step của `taskId` không.
 *
 * Điều phối tắt (hoặc đã halt) ⇒ mọi đường được phép, y như trước khi có tính
 * năng này. Điều phối bật ⇒ chỉ `origin: 'orchestrator'`; các đường khác nhận
 * 403 tường minh thay vì im lặng không làm gì.
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

/** Đọc state đồng bộ, nuốt mọi lỗi — backstop không được làm hỏng `submitJob`. */
function readStateSyncSafe(root: string, taskId: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readTextFileSync(stateFileOf(root, taskId))) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Lưới an toàn cuối trong `submitJob`. Chỉ soi job của một step pipeline; chat
 * (`isChatFeedback`) là ngoại lệ **không giới hạn** theo yêu cầu đề bài.
 *
 * ⚠️ Ném lỗi chứ không lọc im lặng: mọi call-site hợp lệ đã qua `assertStartAllowed`,
 * nên chạm được vào đây nghĩa là còn một đường start bị bỏ sót — phải đỏ to.
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
