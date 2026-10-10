/**
 * Public business surface cho automations — barrel thuần, nạp không có side
 * effect. Controller + cross-feature (nl-chat: `listAutomations`,
 * `KNOWN_AUTOMATION_EVENT_TYPES`) import từ đây.
 *
 * Khởi động scheduler / event subscriber nằm ở `bootstrap.ts` (composition
 * root, nạp từ `api.ts`).
 */

export * from './matcher.js'
export * from '../lib/vars.js'
export * from './rules.js'
export * from './runLedger.js'
export * from './AutomationRunner.js'
export * from './runAction.js'
export * from './scheduler.js'
export * from './eventTrigger.js'
export type { AutomationActionKind } from '../schemas/automation.js'

/** Peer mà controller cần — lấy qua cổng `peers.ts`. */
export { getConnection, listRunners, profilesDir, providerFamilyOf } from './peers.js'
