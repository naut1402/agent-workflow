import { shallowReactive, type Component } from 'vue'
import type { RailIconName } from '../ui/RailIcon.vue'
import { i18n } from '../i18n'

export interface ModeDescriptor {
  id: string
  /** i18n key used for both the sidebar label and (unless `titleKey` is set) the button title. */
  labelKey: string
  /** i18n key for the button `title` tooltip, when it differs from `labelKey` (e.g. runner). */
  titleKey?: string
  icon: RailIconName
  entry: Component
  /** Marks the mode selected on first load. Exactly one built-in should set this. */
  default?: boolean
  /**
   * i18n key for the sidebar status-footer text shown while this mode is
   * active and polling is paused. Omit for modes with their own status logic
   * (monitor: shows live/error state instead — kept as a special case in App.vue).
   */
  pausedStatusKey?: string
}

export interface FloatingDescriptor {
  id: string
  entry: Component
}

/**
 * A rail button that opens `entry` as an on-demand dialog (not a full mode
 * panel, not an always-visible floating icon) — e.g. Settings. See
 * design.md (E0004-02) §3.3 for why `registerFloating` doesn't fit here
 * (DOM position: rail sidebar vs. page-level overlay).
 */
export interface RailActionDescriptor {
  id: string
  labelKey: string
  icon: RailIconName
  entry: Component
}

export interface HostContext {
  modes: ModeDescriptor[]
  floatings: FloatingDescriptor[]
  railActions: RailActionDescriptor[]
  registerMode(descriptor: ModeDescriptor): void
  registerFloating(descriptor: FloatingDescriptor): void
  registerRailAction(descriptor: RailActionDescriptor): void
  events: {
    on(topic: string, fn: (payload: unknown) => void): () => void
    emit(topic: string, payload: unknown): void
  }
  i18n: {
    /**
     * Wired to `createI18n()` via `mergeLocaleMessage` (E0004-02, issue #159
     * Việc 2+). Namespaces still ALSO stay registered statically in
     * `src/shared/i18n/locales/{vi,en}/index.ts` — that object is `Messages`,
     * the compile-time schema every typed `t()` call is checked against
     * (see `shared/i18n/types.ts`); dropping a namespace from it would break
     * typing for every `t('<namespace>.*')` call site. `merge` proves the
     * runtime seam works end-to-end for built-ins that call it, without
     * sacrificing that type safety — see design.md (E0004-02) §4.1 Commit 9.
     */
    merge(locale: string, namespace: string, messages: Record<string, unknown>): void
  }
  api: {
    register(domain: string, facade: unknown): void
    get(domain: string): unknown
  }
}

/** Builds a fresh `HostContext`. One instance per app (see `vuePlugin.ts`). */
export function createHostContext(): HostContext {
  const modes = shallowReactive<ModeDescriptor[]>([])
  const floatings = shallowReactive<FloatingDescriptor[]>([])
  const railActions = shallowReactive<RailActionDescriptor[]>([])
  const apiFacades = new Map<string, unknown>()
  const listeners = new Map<string, Set<(payload: unknown) => void>>()

  function registerMode(descriptor: ModeDescriptor): void {
    if (modes.some((m) => m.id === descriptor.id)) {
      throw new Error(`HostContext: mode "${descriptor.id}" already registered`)
    }
    modes.push(descriptor)
  }

  function registerFloating(descriptor: FloatingDescriptor): void {
    if (floatings.some((f) => f.id === descriptor.id)) {
      throw new Error(`HostContext: floating "${descriptor.id}" already registered`)
    }
    floatings.push(descriptor)
  }

  function registerRailAction(descriptor: RailActionDescriptor): void {
    if (railActions.some((a) => a.id === descriptor.id)) {
      throw new Error(`HostContext: rail action "${descriptor.id}" already registered`)
    }
    railActions.push(descriptor)
  }

  function on(topic: string, fn: (payload: unknown) => void): () => void {
    if (!listeners.has(topic)) listeners.set(topic, new Set())
    listeners.get(topic)!.add(fn)
    return () => {
      listeners.get(topic)?.delete(fn)
    }
  }

  function emit(topic: string, payload: unknown): void {
    listeners.get(topic)?.forEach((fn) => fn(payload))
  }

  function registerApi(domain: string, facade: unknown): void {
    if (apiFacades.has(domain)) {
      throw new Error(`HostContext: api facade "${domain}" already registered`)
    }
    apiFacades.set(domain, facade)
  }

  function mergeI18n(locale: string, namespace: string, messages: Record<string, unknown>): void {
    i18n.global.mergeLocaleMessage(locale, { [namespace]: messages })
  }

  return {
    modes,
    floatings,
    railActions,
    registerMode,
    registerFloating,
    registerRailAction,
    events: { on, emit },
    i18n: { merge: mergeI18n },
    api: { register: registerApi, get: (domain) => apiFacades.get(domain) },
  }
}
