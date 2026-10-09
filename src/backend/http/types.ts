/** Nguồn type thống nhất cho kernel (HTTP + registry). */
export type {
  Project,
  Registry,
  RegistryContext,
  ValidateResult,
  AddResult,
} from '../registry.js'

export type { BusinessError } from '../business/AbstractBusiness.js'

/** Per-request variables set by the root-resolution middleware (`apiServer.ts`). */
export type HonoEnv = {
  Variables: {
    root: string | null
    projectId: string | null
    ctx: import('../registry.js').RegistryContext
  }
}
