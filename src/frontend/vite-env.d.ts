/// <reference types="vite/client" />

/** Injected from package.json `version` via vite/vitest `define`. */
declare const __APP_VERSION__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
