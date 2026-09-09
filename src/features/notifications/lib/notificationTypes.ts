export type NotificationKind = 'hitl_pending' | 'qa_ready'

export interface NotificationEvent {
  /** `${taskId}:${kind}` — stable dedup key across polling ticks. */
  id: string
  taskId: string
  kind: NotificationKind
  /** hitl_pending's phase string, if any; null for qa_ready. */
  detail: string | null
  createdAt: string
  read: boolean
}
