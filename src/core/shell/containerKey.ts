import type { InjectionKey } from 'vue'
import type { Container } from '../container'

/** Key `provide/inject` cho service container app-scope — cài ở `src/plugins/index.ts`. */
export const containerKey: InjectionKey<Container> = Symbol('container')
