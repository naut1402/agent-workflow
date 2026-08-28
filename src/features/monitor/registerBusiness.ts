import type { Container } from '../../core/container/index.js'
import { requestScopeToken } from '../../core/container/requestScope.js'
import { MonitorBusiness } from './business/MonitorBusiness.js'
import { monitorBusinessToken } from './business/tokens.js'

/** Wiring DI của feature — server-only. Xem `src/api/businessContainer.ts`. */
export function registerRequestScoped(c: Container): void {
  c.register(monitorBusinessToken, (self) => new MonitorBusiness(self.resolve(requestScopeToken).root))
}
