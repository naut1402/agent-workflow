import type { Container } from '../../core/container/index.js'
import { requestScopeToken } from '../../core/container/requestScope.js'
import { LogsBusiness } from './business/index.js'
import { logsBusinessToken } from './business/tokens.js'

/** Wiring DI của feature — server-only. Xem `src/api/businessContainer.ts`. */
export function registerRequestScoped(c: Container): void {
  c.register(logsBusinessToken, (self) => new LogsBusiness(self.resolve(requestScopeToken).root))
}
