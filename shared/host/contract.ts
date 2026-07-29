/**
 * Framework-agnostic contribution contract for built-in (and, later, external)
 * dashboard modules — see issue #159. No Vue/Hono import here on purpose: `TCtx`
 * is whatever host-specific context a runtime hands to `activate` (FE:
 * `HostContext`; server: `RegistryContext`).
 */
export interface DashboardPlugin<TCtx> {
  id: string
  activate(ctx: TCtx): void
  deactivate?(ctx: TCtx): void
}

/**
 * Reserved for Việc 2+ (server job-lifecycle seam) — no `RegistryContext`
 * wiring exists yet because no built-in currently needs it (see
 * investigate.md/design.md §3.3). Kept here only so the shape is agreed on
 * ahead of time.
 */
export interface JobLifecyclePolicy {
  id: string
}
