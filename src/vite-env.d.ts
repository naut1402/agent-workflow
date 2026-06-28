/// <reference types="vite/client" />

// Vue SFC modules for vue-tsc when imported from .ts files.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
