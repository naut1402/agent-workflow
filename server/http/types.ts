import type { RegistryContext } from '../registry.js'

// Per-request variables set by the root-resolution middleware (app.ts).
export type HonoEnv = {
  Variables: {
    root: string | null
    projectId: string | null
    ctx: RegistryContext
  }
}
