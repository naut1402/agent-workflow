import type { Container } from '../../core/container/index.js'
import { requestScopeToken } from '../../core/container/requestScope.js'
import { KnowledgeBusiness } from './business/index.js'
import { knowledgeBusinessToken } from './business/tokens.js'

/** Wiring DI của feature — server-only. Xem `src/api/businessContainer.ts`. */
export function registerRequestScoped(c: Container): void {
  c.register(knowledgeBusinessToken, (self) => new KnowledgeBusiness(self.resolve(requestScopeToken).root))
}
