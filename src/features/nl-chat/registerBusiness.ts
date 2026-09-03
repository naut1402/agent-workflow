import type { Container } from '../../core/container/index.js'
import { requestScopeToken } from '../../core/container/requestScope.js'
import { NlChatBusiness } from './business/NlChatBusiness.js'
import { nlChatBusinessToken } from './business/tokens.js'

/** Wiring DI của feature — server-only. Xem `src/api/businessContainer.ts`. */
export function registerRequestScoped(c: Container): void {
  c.register(nlChatBusinessToken, (self) => new NlChatBusiness(self.resolve(requestScopeToken).root))
}
