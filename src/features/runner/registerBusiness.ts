import type { Container } from '../../core/container/index.js'
import { requestScopeToken } from '../../core/container/requestScope.js'
import { RunnerBusiness } from './business/RunnerBusiness.js'
import { runnerBusinessToken } from './business/tokens.js'

/**
 * Wiring DI của feature — server-only. Xem `src/api/businessContainer.ts`.
 *
 * State process-scoped của runner (`jobQueue`, provider registry, OAuth pending)
 * vẫn nằm ở module scope; đưa vào root container qua `registerBusiness` là việc
 * của phase sau — chỉ làm khi đã có characterization test (design §4.4-9).
 */
export function registerRequestScoped(c: Container): void {
  c.register(runnerBusinessToken, (self) => new RunnerBusiness(self.resolve(requestScopeToken).root))
}
