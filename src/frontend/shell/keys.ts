import type { InjectionKey } from 'vue'

/** Switch the app shell mode (monitor, editor, runner, …). Provided by App.vue. */
export type NavigateToMode = (mode: string) => void

/** Mode đích có tới được không (đã AND `canAccessMode` với `visible(ctx)`). Provided by App.vue. */
export type CanNavigateToMode = (mode: string) => boolean

/** Reload the project registry list after settings/autoscan changes. Provided by App.vue. */
export type ReloadProjects = () => void | Promise<void>

export const navigateToModeKey: InjectionKey<NavigateToMode> = Symbol('navigateToMode')

export const canNavigateToModeKey: InjectionKey<CanNavigateToMode> = Symbol('canNavigateToMode')

export const reloadProjectsKey: InjectionKey<ReloadProjects> = Symbol('reloadProjects')
