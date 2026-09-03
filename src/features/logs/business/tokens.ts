import { createToken, type ContainerToken } from '../../../core/container/index.js'
import type { LogsBusiness } from './index.js'

/** Surface hẹp cho controller + peer. FE-safe: xem ghi chú ở `agent-editor/business/tokens.ts`. */
export type LogsPort = Pick<
  LogsBusiness,
  'listLogs' | 'getJobLog' | 'getJobLogDelta' | 'getTaskJobLogDelta'
>

export const logsBusinessToken: ContainerToken<LogsPort> = createToken<LogsPort>('logsBusiness')
