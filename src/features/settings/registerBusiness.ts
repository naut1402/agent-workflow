import type { Container } from '../../core/container/index.js'
import { requestScopeToken } from '../../core/container/requestScope.js'
import { SettingsBusiness } from './business/index.js'
import { settingsBusinessToken } from './business/tokens.js'

/** Wiring DI của feature — server-only. Xem `src/api/businessContainer.ts`. */
export function registerRequestScoped(c: Container): void {
  c.register(settingsBusinessToken, (self) => new SettingsBusiness(self.resolve(requestScopeToken).root))
}
