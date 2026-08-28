import { createToken, type ContainerToken } from '../../../core/container/index.js'
import type { MonitorBusiness } from './MonitorBusiness.js'

/**
 * Surface hẹp cho controller + peer (`runner`, `automations`, `nl-chat`).
 * FE-safe: xem ghi chú ở `agent-editor/business/tokens.ts`.
 */
export type MonitorPort = Pick<
  MonitorBusiness,
  'collectTasks' | 'loadPipelineConfig' | 'flowProfilePath' | 'getTaskChatState' | 'fetchGithubIssue'
>

export const monitorBusinessToken: ContainerToken<MonitorPort> =
  createToken<MonitorPort>('monitorBusiness')
