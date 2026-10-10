import { AbstractHttpController } from '../../backend/http/AbstractHttpController.js'
import { Controller, Get } from '../../backend/http/decorators.js'
import { FormRequest } from '../../backend/http/FormRequest.js'
import * as statisticsBusiness from './business/index.js'
import { UsageStatsQuerySchema } from './schemas/usageStats.js'

/**
 * `GET /api/statistics/usage?project=&task=&step=&from=&to=&groupBy=`
 *
 * Tên trên dây `task` / `step` → `taskId` / `stepId` của DTO. Chuỗi rỗng coi như không gửi.
 * `UsageStatsQuerySchema` ở lại `schemas/` vì business nhận đúng kiểu đó (`UsageStatsQuery`).
 */
export class UsageStatsRequest extends FormRequest<typeof UsageStatsQuerySchema> {
  static schema = UsageStatsQuerySchema
  static invalid = 'invalid usage stats query'

  /** Mốc thời gian đã parse ở `after()` — chỉ có khi request hợp lệ. */
  bounds: { fromMs?: number; toMs?: number } = {}

  prepare(raw: Record<string, unknown>) {
    const pick = (key: string) => (raw[key] as string | undefined) || undefined
    return {
      project: pick('project'),
      taskId: pick('task'),
      stepId: pick('step'),
      from: pick('from'),
      to: pick('to'),
      groupBy: pick('groupBy'),
    }
  }

  after(): string | null {
    const { from, to } = this.data
    if (from !== undefined) {
      const ms = statisticsBusiness.parseTimeBoundMs(from)
      if (ms === null) return 'invalid from'
      this.bounds.fromMs = ms
    }
    if (to !== undefined) {
      const ms = statisticsBusiness.parseTimeBoundMs(to)
      if (ms === null) return 'invalid to'
      this.bounds.toMs = ms
    }
    return null
  }
}

/** Sau logs (60) — không có route `:param` tranh chấp, giữ thứ tự ổn định. */
@Controller({ order: 65, inject: (scope) => new statisticsBusiness.StatisticsBusiness(scope.root) })
export class StatisticsController extends AbstractHttpController {
  constructor(private readonly biz: statisticsBusiness.StatisticsBusiness) {
    super()
  }

  @Get('/api/statistics/usage', UsageStatsRequest)
  usageStats(req: UsageStatsRequest) {
    return this.biz.usageStats(req.data, req.bounds)
  }
}
