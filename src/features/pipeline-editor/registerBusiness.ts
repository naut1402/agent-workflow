import type { Container } from '../../core/container/index.js'
import { requestScopeToken } from '../../core/container/requestScope.js'
import { PipelineEditorBusiness } from './business/PipelineEditorBusiness.js'
import { pipelineEditorBusinessToken } from './business/tokens.js'

/** Wiring DI của feature — server-only. Xem `src/api/businessContainer.ts`. */
export function registerRequestScoped(c: Container): void {
  c.register(pipelineEditorBusinessToken, (self) => new PipelineEditorBusiness(self.resolve(requestScopeToken).root))
}
