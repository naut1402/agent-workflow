/**
 * Nguồn type thống nhất cho kernel core (HTTP + registry).
 * Import type từ `src/core/http/types.js` — một nguồn duy nhất.
 */
export type {
  Project,
  Registry,
  RegistryContext,
  ValidateResult,
  AddResult,
} from '../registry.js'

export type { BusinessError } from '../business/AbstractBusiness.js'

/** Per-request variables set by the root-resolution middleware (app.ts). */
export type HonoEnv = {
  Variables: {
    root: string | null
    projectId: string | null
    ctx: import('../registry.js').RegistryContext
  }
}
