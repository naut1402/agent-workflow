import type { Container } from '../../core/container/index.js'
import { requestScopeToken } from '../../core/container/requestScope.js'
import { AgentEditorBusiness } from './business/AgentEditorBusiness.js'
import { agentEditorBusinessToken } from './business/tokens.js'

/**
 * Wiring DI của feature — server-only, đối xứng `registerMode.ts` ở FE.
 * `src/api/businessContainer.ts` tự quét file này (`loadModulesUnder`).
 *
 * Chưa có `registerBusiness` (process-scoped) vì feature này không giữ state
 * sống ngoài request.
 */
export function registerRequestScoped(c: Container): void {
  c.register(agentEditorBusinessToken, (self) => new AgentEditorBusiness(self.resolve(requestScopeToken).root))
}
