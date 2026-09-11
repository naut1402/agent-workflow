import { emit } from './eventBus.js'

export type EntityOp = 'created' | 'updated' | 'deleted'

/**
 * Domain CRUD event — song song `emitAudit`, không thay audit.
 * Gọi sau khi mutation/persist thành công.
 */
export function emitEntity(
  op: EntityOp,
  entity: string,
  payload: {
    id: string | null
    projectId?: string | null
    detail?: Record<string, unknown>
  },
): void {
  emit(`entity.${op}`, { entity, ...payload })
}
