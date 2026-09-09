import { AbstractController } from '../../core/http/AbstractController.js'
import * as statisticsBusiness from './business/index.js'
import { UsageStatsQuerySchema } from './schemas/usageStats.js'

export class StatisticsController extends AbstractController {
  private biz() {
    return new statisticsBusiness.StatisticsBusiness(this.root)
  }

  /** GET /api/statistics/usage?project=&task=&step=&from=&to=&groupBy= */
  async usageStats() {
    const parsed = UsageStatsQuerySchema.safeParse({
      project: this.c.req.query('project') || undefined,
      taskId: this.c.req.query('task') || undefined,
      stepId: this.c.req.query('step') || undefined,
      from: this.c.req.query('from') || undefined,
      to: this.c.req.query('to') || undefined,
      groupBy: this.c.req.query('groupBy') || undefined,
    })
    if (!parsed.success) return this.badRequest('invalid usage stats query')
    const query = parsed.data

    const bounds: { fromMs?: number; toMs?: number } = {}
    if (query.from !== undefined) {
      const ms = statisticsBusiness.parseTimeBoundMs(query.from)
      if (ms === null) return this.badRequest('invalid from')
      bounds.fromMs = ms
    }
    if (query.to !== undefined) {
      const ms = statisticsBusiness.parseTimeBoundMs(query.to)
      if (ms === null) return this.badRequest('invalid to')
      bounds.toMs = ms
    }

    return this.ok(await this.biz().usageStats(query, bounds))
  }
}
