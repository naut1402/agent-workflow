/**
 * Vị trí + định danh của node điều phối trên canvas. Thuần tính toán, dùng chung
 * cho **cả hai** canvas (pipeline editor và monitor) — hai bên vẽ cùng một node
 * thì phải cùng một phép tính, nếu không node nhảy chỗ khi chuyển màn.
 */
import { ORCHESTRATOR_STEP_ID } from '../../shared/lib/orchestrator'
import { NODE_Y, type PhasePosition } from './pipelineArtifactGraph'

/** Id của node = id step của orchestrator — cùng một định danh, một nguồn. */
export const ORCHESTRATOR_NODE_ID = ORCHESTRATOR_STEP_ID

/**
 * Đẩy lên trên cả node knowledge (`KNOWLEDGE_Y_OFFSET = -70`) để hai loại node
 * phái sinh không chồng nhau.
 */
export const ORCHESTRATOR_Y_OFFSET = -150

export function isOrchestratorNode(node: { id?: string } | null | undefined): boolean {
  return node?.id === ORCHESTRATOR_NODE_ID
}

/** Trên - chính giữa: hoành độ là trung điểm của dải step, tung độ đẩy lên trên. */
export function orchestratorPositionOf(
  positions: Record<string, PhasePosition> | null | undefined,
): PhasePosition {
  const xs = Object.values(positions ?? {}).map((p) => p?.x ?? 0)
  const x = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0
  return { x, y: NODE_Y + ORCHESTRATOR_Y_OFFSET }
}
