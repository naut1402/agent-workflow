import type { Container } from '../../core/container/index.js'
import { requestScopeToken } from '../../core/container/requestScope.js'
import { StatisticsBusiness } from './business/index.js'
import { statisticsBusinessToken } from './business/tokens.js'

/** Wiring DI của feature — server-only. Xem `src/api/businessContainer.ts`. */
export function registerRequestScoped(c: Container): void {
  c.register(statisticsBusinessToken, (self) => new StatisticsBusiness(self.resolve(requestScopeToken).root))
}
