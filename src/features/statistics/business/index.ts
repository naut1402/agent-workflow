import { AbstractBusiness } from '../../../core/business/AbstractBusiness.js'
import { getUsageStats } from './usageStats.js'
import type { UsageStatsQuery } from '../schemas/usageStats.js'

export class StatisticsBusiness extends AbstractBusiness {
  /** Usage logs là global (registryHome), không phụ thuộc root project. */
  usageStats(query: UsageStatsQuery, bounds: { fromMs?: number; toMs?: number } = {}) {
    return getUsageStats(query, bounds)
  }
}

export * from './usageStats.js'
