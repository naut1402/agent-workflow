import { apiGet } from '../../../core/http/client'
import { UsageStatsResultSchema, type UsageStatsResult } from '../schemas/usageStats'

export interface UsageStatsParams {
  project?: string
  task?: string
  step?: string
  from?: string
  to?: string
  groupBy?: string
}

export async function fetchUsageStats(params: UsageStatsParams): Promise<UsageStatsResult> {
  const data = await apiGet<unknown>('/api/statistics/usage', params)
  // Validate biên I/O bằng schema dùng chung với BE — response lệch shape →
  // throw (panel bắt và hiện err-banner) thay vì vỡ render ở template.
  const parsed = UsageStatsResultSchema.safeParse(data)
  if (!parsed.success) throw new Error('invalid usage stats response')
  return parsed.data
}
