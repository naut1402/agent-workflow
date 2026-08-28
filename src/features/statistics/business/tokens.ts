import { createToken, type ContainerToken } from '../../../core/container/index.js'
import type { StatisticsBusiness } from './index.js'

/** Surface hẹp cho controller + peer. FE-safe: xem ghi chú ở `agent-editor/business/tokens.ts`. */
export type StatisticsPort = Pick<StatisticsBusiness, 'usageStats'>

export const statisticsBusinessToken: ContainerToken<StatisticsPort> =
  createToken<StatisticsPort>('statisticsBusiness')
